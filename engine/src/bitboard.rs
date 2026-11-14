//! Bitboards: a set of squares is one 64-bit word, bit 0 = a1, bit 63 = h8.
//! Knight, king and pawn attacks are plain tables. Bishop and rook attacks
//! use magic bitboards: the blockers on the piece's lines are multiplied by
//! a constant that gathers them into the top bits, which index a table of
//! precomputed attack sets. The constants are found once at start-up.

use std::sync::LazyLock;

pub const WHITE: usize = 0;
pub const BLACK: usize = 1;

pub const PAWN: usize = 0;
pub const KNIGHT: usize = 1;
pub const BISHOP: usize = 2;
pub const ROOK: usize = 3;
pub const QUEEN: usize = 4;
pub const KING: usize = 5;
/// Board entry for an empty square.
pub const EMPTY: u8 = 6;

pub const FILE_A: u64 = 0x0101_0101_0101_0101;
pub const FILE_H: u64 = FILE_A << 7;
pub const RANK_1: u64 = 0xff;
pub const RANK_8: u64 = RANK_1 << 56;

#[inline]
pub fn bit(sq: usize) -> u64 {
    1u64 << sq
}

#[inline]
pub fn lsb(b: u64) -> usize {
    b.trailing_zeros() as usize
}

/// Iterates over the squares of a set, lowest first.
pub struct Bits(pub u64);

impl Iterator for Bits {
    type Item = usize;
    #[inline]
    fn next(&mut self) -> Option<usize> {
        if self.0 == 0 {
            return None;
        }
        let sq = lsb(self.0);
        self.0 &= self.0 - 1;
        Some(sq)
    }
}

#[inline]
pub fn bits(b: u64) -> Bits {
    Bits(b)
}

struct Magic {
    mask: u64,
    factor: u64,
    shift: u32,
    offset: usize,
}

struct Tables {
    knight: [u64; 64],
    king: [u64; 64],
    pawn: [[u64; 64]; 2],
    between: Vec<u64>,
    line: Vec<u64>,
    bishop: Vec<Magic>,
    rook: Vec<Magic>,
    sliding: Vec<u64>,
}

const BISHOP_DIRS: [(i32, i32); 4] = [(1, 1), (1, -1), (-1, 1), (-1, -1)];
const ROOK_DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

/// Attacks found the slow way, by walking each ray until a blocker.
fn ray_attacks(sq: usize, occupied: u64, dirs: &[(i32, i32); 4]) -> u64 {
    let mut attacks = 0;
    for &(df, dr) in dirs {
        let (mut f, mut r) = ((sq % 8) as i32 + df, (sq / 8) as i32 + dr);
        while (0..8).contains(&f) && (0..8).contains(&r) {
            let b = bit((r * 8 + f) as usize);
            attacks |= b;
            if occupied & b != 0 {
                break;
            }
            f += df;
            r += dr;
        }
    }
    attacks
}

fn step_attacks(sq: usize, steps: &[(i32, i32)]) -> u64 {
    let mut attacks = 0;
    for &(df, dr) in steps {
        let (f, r) = ((sq % 8) as i32 + df, (sq / 8) as i32 + dr);
        if (0..8).contains(&f) && (0..8).contains(&r) {
            attacks |= bit((r * 8 + f) as usize);
        }
    }
    attacks
}

fn find_magic(sq: usize, dirs: &[(i32, i32); 4], seed: &mut u64, table: &mut Vec<u64>) -> Magic {
    // A blocker on the last square of a ray changes nothing, so the edges
    // are left out of the mask.
    let edges = ((RANK_1 | RANK_8) & !(RANK_1 << (sq & 56))) | ((FILE_A | FILE_H) & !(FILE_A << (sq & 7)));
    let mask = ray_attacks(sq, 0, dirs) & !edges;
    let shift = 64 - mask.count_ones();

    // Every subset of the mask, with the attack set it produces.
    let mut cases = Vec::new();
    let mut subset = 0u64;
    loop {
        cases.push((subset, ray_attacks(sq, subset, dirs)));
        subset = subset.wrapping_sub(mask) & mask;
        if subset == 0 {
            break;
        }
    }

    let offset = table.len();
    table.resize(offset + cases.len(), 0);
    let mut random = || {
        *seed ^= *seed << 13;
        *seed ^= *seed >> 7;
        *seed ^= *seed << 17;
        *seed
    };
    loop {
        let factor = random() & random() & random();
        if (mask.wrapping_mul(factor) >> 56).count_ones() < 6 {
            continue;
        }
        let slots = &mut table[offset..];
        slots.fill(0);
        // A slider always attacks something, so zero marks a free slot.
        let fits = cases.iter().all(|&(blockers, attacks)| {
            let slot = &mut slots[(blockers.wrapping_mul(factor) >> shift) as usize];
            if *slot == 0 {
                *slot = attacks;
            }
            *slot == attacks
        });
        if fits {
            return Magic { mask, factor, shift, offset };
        }
    }
}

static TABLES: LazyLock<Tables> = LazyLock::new(|| {
    let knight_steps = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)];
    let king_steps = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)];
    let mut t = Tables {
        knight: [0; 64],
        king: [0; 64],
        pawn: [[0; 64]; 2],
        between: vec![0; 64 * 64],
        line: vec![0; 64 * 64],
        bishop: Vec::with_capacity(64),
        rook: Vec::with_capacity(64),
        sliding: Vec::new(),
    };
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    for sq in 0..64 {
        t.knight[sq] = step_attacks(sq, &knight_steps);
        t.king[sq] = step_attacks(sq, &king_steps);
        t.pawn[WHITE][sq] = step_attacks(sq, &[(-1, 1), (1, 1)]);
        t.pawn[BLACK][sq] = step_attacks(sq, &[(-1, -1), (1, -1)]);
        let magic = find_magic(sq, &BISHOP_DIRS, &mut seed, &mut t.sliding);
        t.bishop.push(magic);
        let magic = find_magic(sq, &ROOK_DIRS, &mut seed, &mut t.sliding);
        t.rook.push(magic);
    }
    for a in 0..64 {
        for dirs in [&BISHOP_DIRS, &ROOK_DIRS] {
            for b in bits(ray_attacks(a, 0, dirs)) {
                t.between[a * 64 + b] = ray_attacks(a, bit(b), dirs) & ray_attacks(b, bit(a), dirs);
                t.line[a * 64 + b] = (ray_attacks(a, 0, dirs) & ray_attacks(b, 0, dirs)) | bit(a) | bit(b);
            }
        }
    }
    t
});

#[inline]
pub fn knight_attacks(sq: usize) -> u64 {
    TABLES.knight[sq]
}

#[inline]
pub fn king_attacks(sq: usize) -> u64 {
    TABLES.king[sq]
}

/// Squares a pawn of `colour` on `sq` attacks.
#[inline]
pub fn pawn_attacks(colour: usize, sq: usize) -> u64 {
    TABLES.pawn[colour][sq]
}

#[inline]
fn slide(magic: &Magic, occupied: u64) -> u64 {
    let index = ((occupied & magic.mask).wrapping_mul(magic.factor) >> magic.shift) as usize;
    TABLES.sliding[magic.offset + index]
}

#[inline]
pub fn bishop_attacks(sq: usize, occupied: u64) -> u64 {
    slide(&TABLES.bishop[sq], occupied)
}

#[inline]
pub fn rook_attacks(sq: usize, occupied: u64) -> u64 {
    slide(&TABLES.rook[sq], occupied)
}

/// Squares strictly between two squares on a shared line, else empty.
#[inline]
pub fn between(a: usize, b: usize) -> u64 {
    TABLES.between[a * 64 + b]
}

/// The whole line through two squares, edge to edge, else empty.
#[inline]
pub fn line(a: usize, b: usize) -> u64 {
    TABLES.line[a * 64 + b]
}
