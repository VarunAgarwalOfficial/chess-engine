//! The board: where the pieces are, whose turn it is, and how a move
//! changes that. Moves are made and unmade in place; the undo stack doubles
//! as the game history used to detect repetition.

use crate::bitboard::*;
use crate::eval::{piece_square, PHASE_WEIGHT};

pub const START_FEN: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/// Value of `Position::ep` when no en passant capture is possible.
pub const NO_SQUARE: u8 = 64;

const WHITE_KINGSIDE: u8 = 1;
const WHITE_QUEENSIDE: u8 = 2;
const BLACK_KINGSIDE: u8 = 4;
const BLACK_QUEENSIDE: u8 = 8;

/// A move in 16 bits: from (6), to (6), kind (4).
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct Move(pub u16);

impl Move {
    pub const NONE: Move = Move(0);
    pub const QUIET: u16 = 0;
    pub const DOUBLE_PUSH: u16 = 1;
    pub const CASTLE_KING: u16 = 2;
    pub const CASTLE_QUEEN: u16 = 3;
    pub const CAPTURE: u16 = 4;
    pub const EN_PASSANT: u16 = 5;
    /// Promotion kinds are `PROMOTION + (piece - KNIGHT)`, plus `CAPTURE`.
    pub const PROMOTION: u16 = 8;

    #[inline]
    pub fn new(from: usize, to: usize, kind: u16) -> Move {
        Move(from as u16 | (to as u16) << 6 | kind << 12)
    }
    #[inline]
    pub fn from(self) -> usize {
        (self.0 & 63) as usize
    }
    #[inline]
    pub fn to(self) -> usize {
        (self.0 >> 6 & 63) as usize
    }
    #[inline]
    pub fn kind(self) -> u16 {
        self.0 >> 12
    }
    #[inline]
    pub fn is_capture(self) -> bool {
        self.kind() & Move::CAPTURE != 0
    }
    #[inline]
    pub fn is_castle(self) -> bool {
        matches!(self.kind(), Move::CASTLE_KING | Move::CASTLE_QUEEN)
    }
    /// The piece promoted to, if any.
    #[inline]
    pub fn promotion(self) -> Option<usize> {
        (self.kind() & Move::PROMOTION != 0).then(|| (self.kind() & 3) as usize + KNIGHT)
    }
    /// Neither a capture nor a promotion.
    #[inline]
    pub fn is_quiet(self) -> bool {
        self.kind() < Move::CAPTURE
    }
}

// Zobrist keys: one random number per (colour, piece, square), per castling
// state, per en passant file, and one for the side to move. A position's
// hash is the XOR of the keys that apply, so a move updates it in a few
// operations.
const fn splitmix(state: u64) -> u64 {
    let mut z = state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

const fn zobrist_keys() -> [u64; 793] {
    let mut keys = [0u64; 793];
    let mut i = 0;
    while i < keys.len() {
        keys[i] = splitmix((i as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15));
        i += 1;
    }
    keys
}

static ZOBRIST: [u64; 793] = zobrist_keys();

#[inline]
fn piece_key(colour: usize, piece: usize, sq: usize) -> u64 {
    ZOBRIST[(colour * 6 + piece) * 64 + sq]
}
#[inline]
fn castling_key(rights: u8) -> u64 {
    ZOBRIST[768 + rights as usize]
}
#[inline]
fn ep_key(sq: u8) -> u64 {
    ZOBRIST[784 + (sq & 7) as usize]
}
const SIDE_KEY: usize = 792;

/// Castling rights that survive a move touching each square.
const fn castling_masks() -> [u8; 64] {
    let mut masks = [15u8; 64];
    masks[0] = 15 & !WHITE_QUEENSIDE;
    masks[4] = 15 & !(WHITE_KINGSIDE | WHITE_QUEENSIDE);
    masks[7] = 15 & !WHITE_KINGSIDE;
    masks[56] = 15 & !BLACK_QUEENSIDE;
    masks[60] = 15 & !(BLACK_KINGSIDE | BLACK_QUEENSIDE);
    masks[63] = 15 & !BLACK_KINGSIDE;
    masks
}
const CASTLING_MASK: [u8; 64] = castling_masks();

/// Piece values for static exchange evaluation.
pub const SEE_VALUE: [i32; 7] = [100, 320, 330, 500, 900, 20000, 0];

#[derive(Clone)]
struct Undo {
    captured: u8,
    castling: u8,
    ep: u8,
    halfmove: u16,
    hash: u64,
    mg: i32,
    eg: i32,
    phase: i32,
}

#[derive(Clone)]
pub struct Position {
    /// Squares holding each piece type, both colours together.
    pub pieces: [u64; 6],
    /// Squares holding each colour's pieces.
    pub colours: [u64; 2],
    /// Piece type on each square, or `EMPTY`.
    pub board: [u8; 64],
    pub side: usize,
    pub castling: u8,
    /// En passant target square, recorded only when a pawn can capture
    /// there, so that repetition is counted the way the rules define it.
    pub ep: u8,
    pub halfmove: u16,
    pub fullmove: u16,
    pub hash: u64,
    /// Material and piece-square sums, White minus Black, kept up to date
    /// move by move for the evaluation.
    pub mg: i32,
    pub eg: i32,
    pub phase: i32,
    stack: Vec<Undo>,
}

impl Position {
    pub fn start() -> Position {
        Position::from_fen(START_FEN).expect("the start position is valid")
    }

    pub fn from_fen(fen: &str) -> Result<Position, String> {
        let fields: Vec<&str> = fen.split_whitespace().collect();
        if fields.len() < 2 {
            return Err("FEN needs at least a board and a side to move".into());
        }
        let mut pos = Position {
            pieces: [0; 6],
            colours: [0; 2],
            board: [EMPTY; 64],
            side: WHITE,
            castling: 0,
            ep: NO_SQUARE,
            halfmove: 0,
            fullmove: 1,
            hash: 0,
            mg: 0,
            eg: 0,
            phase: 0,
            stack: Vec::with_capacity(256),
        };

        let ranks: Vec<&str> = fields[0].split('/').collect();
        if ranks.len() != 8 {
            return Err("FEN board needs eight ranks".into());
        }
        for (i, rank) in ranks.iter().enumerate() {
            let mut file = 0;
            for c in rank.chars() {
                if let Some(skip) = c.to_digit(10) {
                    file += skip as usize;
                } else {
                    let piece = "pnbrqk".find(c.to_ascii_lowercase()).ok_or(format!("bad piece '{c}' in FEN"))?;
                    if file > 7 {
                        return Err("FEN rank is too long".into());
                    }
                    let colour = if c.is_ascii_uppercase() { WHITE } else { BLACK };
                    pos.put(colour, piece, (7 - i) * 8 + file);
                    file += 1;
                }
            }
            if file != 8 {
                return Err("FEN rank does not have eight squares".into());
            }
        }
        for colour in [WHITE, BLACK] {
            if (pos.pieces[KING] & pos.colours[colour]).count_ones() != 1 {
                return Err("each side needs exactly one king".into());
            }
        }
        if pos.pieces[PAWN] & (RANK_1 | RANK_8) != 0 {
            return Err("pawns cannot stand on the first or last rank".into());
        }

        pos.side = match fields[1] {
            "w" => WHITE,
            "b" => BLACK,
            _ => return Err("side to move must be 'w' or 'b'".into()),
        };
        for c in fields.get(2).unwrap_or(&"-").chars() {
            // A right is kept only if king and rook still stand at home.
            let (right, king, rook, colour) = match c {
                'K' => (WHITE_KINGSIDE, 4, 7, WHITE),
                'Q' => (WHITE_QUEENSIDE, 4, 0, WHITE),
                'k' => (BLACK_KINGSIDE, 60, 63, BLACK),
                'q' => (BLACK_QUEENSIDE, 60, 56, BLACK),
                '-' => continue,
                _ => return Err(format!("bad castling right '{c}' in FEN")),
            };
            let home = |sq: usize, piece: usize| pos.board[sq] == piece as u8 && pos.colours[colour] & bit(sq) != 0;
            if home(king, KING) && home(rook, ROOK) {
                pos.castling |= right;
            }
        }
        if let Some(&text) = fields.get(3) {
            if text != "-" {
                let sq = parse_square(text).ok_or("bad en passant square in FEN")?;
                let pushed = if pos.side == WHITE { sq.wrapping_sub(8) } else { sq + 8 };
                let rank_ok = sq / 8 == if pos.side == WHITE { 5 } else { 2 };
                let them = pos.side ^ 1;
                if rank_ok
                    && pos.board[sq] == EMPTY
                    && pos.pieces[PAWN] & pos.colours[them] & bit(pushed) != 0
                    && pawn_attacks(them, sq) & pos.pieces[PAWN] & pos.colours[pos.side] != 0
                {
                    pos.ep = sq as u8;
                }
            }
        }
        pos.halfmove = fields.get(4).and_then(|t| t.parse().ok()).unwrap_or(0);
        pos.fullmove = fields.get(5).and_then(|t| t.parse().ok()).unwrap_or(1).max(1);

        pos.hash = pos.compute_hash();
        // The side that just moved cannot have left its king in check.
        let king = pos.king_square(pos.side ^ 1);
        if pos.attackers_to(king, pos.occupied()) & pos.colours[pos.side] != 0 {
            return Err("the side not to move is in check".into());
        }
        Ok(pos)
    }

    pub fn fen(&self) -> String {
        let mut out = String::new();
        for rank in (0..8).rev() {
            let mut empty = 0;
            for file in 0..8 {
                let sq = rank * 8 + file;
                if self.board[sq] == EMPTY {
                    empty += 1;
                    continue;
                }
                if empty > 0 {
                    out.push_str(&empty.to_string());
                    empty = 0;
                }
                let letter = b"pnbrqk"[self.board[sq] as usize] as char;
                out.push(if self.colours[WHITE] & bit(sq) != 0 { letter.to_ascii_uppercase() } else { letter });
            }
            if empty > 0 {
                out.push_str(&empty.to_string());
            }
            if rank > 0 {
                out.push('/');
            }
        }
        out.push_str(if self.side == WHITE { " w " } else { " b " });
        if self.castling == 0 {
            out.push('-');
        }
        for (right, letter) in
            [(WHITE_KINGSIDE, 'K'), (WHITE_QUEENSIDE, 'Q'), (BLACK_KINGSIDE, 'k'), (BLACK_QUEENSIDE, 'q')]
        {
            if self.castling & right != 0 {
                out.push(letter);
            }
        }
        let ep = if self.ep == NO_SQUARE { "-".to_string() } else { square_name(self.ep as usize) };
        out.push_str(&format!(" {ep} {} {}", self.halfmove, self.fullmove));
        out
    }

    /// The hash computed from scratch; `hash` must always equal it.
    pub fn compute_hash(&self) -> u64 {
        let mut hash = castling_key(self.castling);
        for colour in [WHITE, BLACK] {
            for sq in bits(self.colours[colour]) {
                hash ^= piece_key(colour, self.board[sq] as usize, sq);
            }
        }
        if self.ep != NO_SQUARE {
            hash ^= ep_key(self.ep);
        }
        if self.side == BLACK {
            hash ^= ZOBRIST[SIDE_KEY];
        }
        hash
    }

    #[inline]
    fn put(&mut self, colour: usize, piece: usize, sq: usize) {
        self.pieces[piece] |= bit(sq);
        self.colours[colour] |= bit(sq);
        self.board[sq] = piece as u8;
        self.hash ^= piece_key(colour, piece, sq);
        let (mg, eg) = piece_square(colour, piece, sq);
        self.mg += mg;
        self.eg += eg;
        self.phase += PHASE_WEIGHT[piece];
    }

    #[inline]
    fn remove(&mut self, colour: usize, piece: usize, sq: usize) {
        self.pieces[piece] ^= bit(sq);
        self.colours[colour] ^= bit(sq);
        self.board[sq] = EMPTY;
        self.hash ^= piece_key(colour, piece, sq);
        let (mg, eg) = piece_square(colour, piece, sq);
        self.mg -= mg;
        self.eg -= eg;
        self.phase -= PHASE_WEIGHT[piece];
    }

    fn save(&mut self, captured: u8) {
        self.stack.push(Undo {
            captured,
            castling: self.castling,
            ep: self.ep,
            halfmove: self.halfmove,
            hash: self.hash,
            mg: self.mg,
            eg: self.eg,
            phase: self.phase,
        });
    }

    fn restore(&mut self) -> u8 {
        let undo = self.stack.pop().expect("a move to take back");
        self.castling = undo.castling;
        self.ep = undo.ep;
        self.halfmove = undo.halfmove;
        self.hash = undo.hash;
        self.mg = undo.mg;
        self.eg = undo.eg;
        self.phase = undo.phase;
        undo.captured
    }

    /// Plays a legal move.
    pub fn make(&mut self, m: Move) {
        let (us, them) = (self.side, self.side ^ 1);
        let (from, to, kind) = (m.from(), m.to(), m.kind());
        let piece = self.board[from] as usize;
        // An en passant capture takes the pawn beside the mover, not on `to`.
        let captured_sq = if kind == Move::EN_PASSANT { to ^ 8 } else { to };
        let captured = if m.is_capture() { self.board[captured_sq] } else { EMPTY };
        self.save(captured);

        if self.ep != NO_SQUARE {
            self.hash ^= ep_key(self.ep);
            self.ep = NO_SQUARE;
        }
        self.halfmove += 1;
        if captured != EMPTY {
            self.remove(them, captured as usize, captured_sq);
            self.halfmove = 0;
        }
        self.remove(us, piece, from);
        self.put(us, m.promotion().unwrap_or(piece), to);

        if piece == PAWN {
            self.halfmove = 0;
            if kind == Move::DOUBLE_PUSH {
                let passed = (from + to) / 2;
                if pawn_attacks(us, passed) & self.pieces[PAWN] & self.colours[them] != 0 {
                    self.ep = passed as u8;
                    self.hash ^= ep_key(self.ep);
                }
            }
        } else if kind == Move::CASTLE_KING {
            self.remove(us, ROOK, to + 1);
            self.put(us, ROOK, to - 1);
        } else if kind == Move::CASTLE_QUEEN {
            self.remove(us, ROOK, to - 2);
            self.put(us, ROOK, to + 1);
        }

        let rights = self.castling & CASTLING_MASK[from] & CASTLING_MASK[to];
        if rights != self.castling {
            self.hash ^= castling_key(self.castling) ^ castling_key(rights);
            self.castling = rights;
        }
        self.side = them;
        self.hash ^= ZOBRIST[SIDE_KEY];
        if us == BLACK {
            self.fullmove += 1;
        }
    }

    /// Takes back the last move, which must be `m`.
    pub fn unmake(&mut self, m: Move) {
        self.side ^= 1;
        let (us, them) = (self.side, self.side ^ 1);
        let (from, to, kind) = (m.from(), m.to(), m.kind());
        let piece = if m.promotion().is_some() { PAWN } else { self.board[to] as usize };
        self.remove(us, self.board[to] as usize, to);
        self.put(us, piece, from);
        if kind == Move::CASTLE_KING {
            self.remove(us, ROOK, to - 1);
            self.put(us, ROOK, to + 1);
        } else if kind == Move::CASTLE_QUEEN {
            self.remove(us, ROOK, to + 1);
            self.put(us, ROOK, to - 2);
        }
        let captured = self.restore();
        if captured != EMPTY {
            let captured_sq = if kind == Move::EN_PASSANT { to ^ 8 } else { to };
            // `restore` has already set hash and sums, so place it directly.
            self.pieces[captured as usize] |= bit(captured_sq);
            self.colours[them] |= bit(captured_sq);
            self.board[captured_sq] = captured;
        }
        if us == BLACK {
            self.fullmove -= 1;
        }
    }

    /// Passes the turn. Only the search does this.
    pub fn make_null(&mut self) {
        self.save(EMPTY);
        if self.ep != NO_SQUARE {
            self.hash ^= ep_key(self.ep);
            self.ep = NO_SQUARE;
        }
        self.halfmove += 1;
        self.side ^= 1;
        self.hash ^= ZOBRIST[SIDE_KEY];
    }

    pub fn unmake_null(&mut self) {
        self.side ^= 1;
        self.restore();
    }

    /// How many earlier times this exact position has occurred, in the game
    /// or on the line being searched.
    pub fn repetitions(&self) -> usize {
        let n = self.stack.len();
        let limit = (self.halfmove as usize).min(n);
        (2..=limit).step_by(2).filter(|i| self.stack[n - i].hash == self.hash).count()
    }

    /// Number of moves played since the position was set up.
    pub fn ply(&self) -> usize {
        self.stack.len()
    }

    #[inline]
    pub fn occupied(&self) -> u64 {
        self.colours[WHITE] | self.colours[BLACK]
    }

    #[inline]
    pub fn king_square(&self, colour: usize) -> usize {
        lsb(self.pieces[KING] & self.colours[colour])
    }

    /// Pieces of both colours that attack a square, given the occupancy.
    #[inline]
    pub fn attackers_to(&self, sq: usize, occupied: u64) -> u64 {
        let diagonal = self.pieces[BISHOP] | self.pieces[QUEEN];
        let straight = self.pieces[ROOK] | self.pieces[QUEEN];
        (pawn_attacks(BLACK, sq) & self.pieces[PAWN] & self.colours[WHITE])
            | (pawn_attacks(WHITE, sq) & self.pieces[PAWN] & self.colours[BLACK])
            | (knight_attacks(sq) & self.pieces[KNIGHT])
            | (king_attacks(sq) & self.pieces[KING])
            | (bishop_attacks(sq, occupied) & diagonal)
            | (rook_attacks(sq, occupied) & straight)
    }

    /// Enemy pieces giving check to the side to move.
    #[inline]
    pub fn checkers(&self) -> u64 {
        self.attackers_to(self.king_square(self.side), self.occupied()) & self.colours[self.side ^ 1]
    }

    #[inline]
    pub fn in_check(&self) -> bool {
        self.checkers() != 0
    }

    /// True when the side has something other than king and pawns.
    pub fn has_pieces(&self, colour: usize) -> bool {
        self.colours[colour] & !(self.pieces[PAWN] | self.pieces[KING]) != 0
    }

    /// Neither side can possibly give mate: bare kings, a single minor
    /// piece, or only bishops that all stand on one colour of square.
    pub fn insufficient_material(&self) -> bool {
        if self.pieces[PAWN] | self.pieces[ROOK] | self.pieces[QUEEN] != 0 {
            return false;
        }
        let minors = self.pieces[KNIGHT] | self.pieces[BISHOP];
        if minors.count_ones() <= 1 {
            return true;
        }
        const LIGHT: u64 = 0x55aa_55aa_55aa_55aa;
        let bishops = self.pieces[BISHOP];
        self.pieces[KNIGHT] == 0 && (bishops & LIGHT == 0 || bishops & !LIGHT == 0)
    }

    /// Static exchange evaluation: does playing `m` and then trading on its
    /// target square, each side always capturing with its cheapest piece,
    /// win at least `threshold` centipawns?
    pub fn see_at_least(&self, m: Move, threshold: i32) -> bool {
        if m.kind() != Move::QUIET && m.kind() != Move::CAPTURE && m.kind() != Move::DOUBLE_PUSH {
            return threshold <= 0;
        }
        let (from, to) = (m.from(), m.to());
        let mut swap = SEE_VALUE[self.board[to] as usize] - threshold;
        if swap < 0 {
            return false;
        }
        swap = SEE_VALUE[self.board[from] as usize] - swap;
        if swap <= 0 {
            return true;
        }
        let mut occupied = (self.occupied() ^ bit(from)) | bit(to);
        let mut attackers = self.attackers_to(to, occupied);
        let diagonal = self.pieces[BISHOP] | self.pieces[QUEEN];
        let straight = self.pieces[ROOK] | self.pieces[QUEEN];
        let mut side = self.side;
        let mut wins = true;
        loop {
            side ^= 1;
            attackers &= occupied;
            let ours = attackers & self.colours[side];
            if ours == 0 {
                break;
            }
            wins = !wins;
            let piece = (PAWN..=KING).find(|&p| ours & self.pieces[p] != 0).expect("an attacker");
            if piece == KING {
                // The king may only capture if nothing can take it back.
                return if attackers & self.colours[side ^ 1] != 0 { !wins } else { wins };
            }
            swap = SEE_VALUE[piece] - swap;
            if swap < wins as i32 {
                break;
            }
            occupied ^= bit(lsb(ours & self.pieces[piece]));
            // Removing a piece may uncover a slider behind it.
            if piece == PAWN || piece == BISHOP || piece == QUEEN {
                attackers |= bishop_attacks(to, occupied) & diagonal;
            }
            if piece == ROOK || piece == QUEEN {
                attackers |= rook_attacks(to, occupied) & straight;
            }
        }
        wins
    }
}

pub fn square_name(sq: usize) -> String {
    format!("{}{}", (b'a' + (sq % 8) as u8) as char, sq / 8 + 1)
}

pub fn parse_square(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    if bytes.len() != 2 || !(b'a'..=b'h').contains(&bytes[0]) || !(b'1'..=b'8').contains(&bytes[1]) {
        return None;
    }
    Some((bytes[1] - b'1') as usize * 8 + (bytes[0] - b'a') as usize)
}
