//! Static evaluation, in centipawns, from the side to move's point of view.
//!
//! Every term has a middlegame and an endgame value; the two are blended by
//! how much material is left ("tapered"). Material and piece-square tables
//! are kept up to date by `Position` as moves are made; the rest is computed
//! here from the bitboards.

use crate::bitboard::*;
use crate::position::Position;
use crate::search::Options;

/// How much each piece counts towards the middlegame; 24 in total at the start.
pub const PHASE_WEIGHT: [i32; 6] = [0, 1, 1, 2, 4, 0];
const MAX_PHASE: i32 = 24;

const MATERIAL: [(i32, i32); 6] = [(82, 94), (337, 281), (365, 297), (477, 512), (1025, 936), (0, 0)];

// Piece-square tables (PeSTO, by Ronald Friederich), written as the board
// looks from White's side: the first row is rank 8.
#[rustfmt::skip]
const MIDDLEGAME: [[i32; 64]; 6] = [
    [
          0,   0,   0,   0,   0,   0,   0,   0,
         98, 134,  61,  95,  68, 126,  34, -11,
         -6,   7,  26,  31,  65,  56,  25, -20,
        -14,  13,   6,  21,  23,  12,  17, -23,
        -27,  -2,  -5,  12,  17,   6,  10, -25,
        -26,  -4,  -4, -10,   3,   3,  33, -12,
        -35,  -1, -20, -23, -15,  24,  38, -22,
          0,   0,   0,   0,   0,   0,   0,   0,
    ],
    [
       -167, -89, -34, -49,  61, -97, -15, -107,
        -73, -41,  72,  36,  23,  62,   7,  -17,
        -47,  60,  37,  65,  84, 129,  73,   44,
         -9,  17,  19,  53,  37,  69,  18,   22,
        -13,   4,  16,  13,  28,  19,  21,   -8,
        -23,  -9,  12,  10,  19,  17,  25,  -16,
        -29, -53, -12,  -3,  -1,  18, -14,  -19,
       -105, -21, -58, -33, -17, -28, -19,  -23,
    ],
    [
        -29,   4, -82, -37, -25, -42,   7,  -8,
        -26,  16, -18, -13,  30,  59,  18, -47,
        -16,  37,  43,  40,  35,  50,  37,  -2,
         -4,   5,  19,  50,  37,  37,   7,  -2,
         -6,  13,  13,  26,  34,  12,  10,   4,
          0,  15,  15,  15,  14,  27,  18,  10,
          4,  15,  16,   0,   7,  21,  33,   1,
        -33,  -3, -14, -21, -13, -12, -39, -21,
    ],
    [
         32,  42,  32,  51,  63,   9,  31,  43,
         27,  32,  58,  62,  80,  67,  26,  44,
         -5,  19,  26,  36,  17,  45,  61,  16,
        -24, -11,   7,  26,  24,  35,  -8, -20,
        -36, -26, -12,  -1,   9,  -7,   6, -23,
        -45, -25, -16, -17,   3,   0,  -5, -33,
        -44, -16, -20,  -9,  -1,  11,  -6, -71,
        -19, -13,   1,  17,  16,   7, -37, -26,
    ],
    [
        -28,   0,  29,  12,  59,  44,  43,  45,
        -24, -39,  -5,   1, -16,  57,  28,  54,
        -13, -17,   7,   8,  29,  56,  47,  57,
        -27, -27, -16, -16,  -1,  17,  -2,   1,
         -9, -26,  -9, -10,  -2,  -4,   3,  -3,
        -14,   2, -11,  -2,  -5,   2,  14,   5,
        -35,  -8,  11,   2,   8,  15,  -3,   1,
         -1, -18,  -9,  10, -15, -25, -31, -50,
    ],
    [
        -65,  23,  16, -15, -56, -34,   2,  13,
         29,  -1, -20,  -7,  -8,  -4, -38, -29,
         -9,  24,   2, -16, -20,   6,  22, -22,
        -17, -20, -12, -27, -30, -25, -14, -36,
        -49,  -1, -27, -39, -46, -44, -33, -51,
        -14, -14, -22, -46, -44, -30, -15, -27,
          1,   7,  -8, -64, -43, -16,   9,   8,
        -15,  36,  12, -54,   8, -28,  24,  14,
    ],
];

#[rustfmt::skip]
const ENDGAME: [[i32; 64]; 6] = [
    [
          0,   0,   0,   0,   0,   0,   0,   0,
        178, 173, 158, 134, 147, 132, 165, 187,
         94, 100,  85,  67,  56,  53,  82,  84,
         32,  24,  13,   5,  -2,   4,  17,  17,
         13,   9,  -3,  -7,  -7,  -8,   3,  -1,
          4,   7,  -6,   1,   0,  -5,  -1,  -8,
         13,   8,   8,  10,  13,   0,   2,  -7,
          0,   0,   0,   0,   0,   0,   0,   0,
    ],
    [
        -58, -38, -13, -28, -31, -27, -63, -99,
        -25,  -8, -25,  -2,  -9, -25, -24, -52,
        -24, -20,  10,   9,  -1,  -9, -19, -41,
        -17,   3,  22,  22,  22,  11,   8, -18,
        -18,  -6,  16,  25,  16,  17,   4, -18,
        -23,  -3,  -1,  15,  10,  -3, -20, -22,
        -42, -20, -10,  -5,  -2, -20, -23, -44,
        -29, -51, -23, -15, -22, -18, -50, -64,
    ],
    [
        -14, -21, -11,  -8,  -7,  -9, -17, -24,
         -8,  -4,   7, -12,  -3, -13,  -4, -14,
          2,  -8,   0,  -1,  -2,   6,   0,   4,
         -3,   9,  12,   9,  14,  10,   3,   2,
         -6,   3,  13,  19,   7,  10,  -3,  -9,
        -12,  -3,   8,  10,  13,   3,  -7, -15,
        -14, -18,  -7,  -1,   4,  -9, -15, -27,
        -23,  -9, -23,  -5,  -9, -16,  -5, -17,
    ],
    [
         13,  10,  18,  15,  12,  12,   8,   5,
         11,  13,  13,  11,  -3,   3,   8,   3,
          7,   7,   7,   5,   4,  -3,  -5,  -3,
          4,   3,  13,   1,   2,   1,  -1,   2,
          3,   5,   8,   4,  -5,  -6,  -8, -11,
         -4,   0,  -5,  -1,  -7, -12,  -8, -16,
         -6,  -6,   0,   2,  -9,  -9, -11,  -3,
         -9,   2,   3,  -1,  -5, -13,   4, -20,
    ],
    [
         -9,  22,  22,  27,  27,  19,  10,  20,
        -17,  20,  32,  41,  58,  25,  30,   0,
        -20,   6,   9,  49,  47,  35,  19,   9,
          3,  22,  24,  45,  57,  40,  57,  36,
        -18,  28,  19,  47,  31,  34,  39,  23,
        -16, -27,  15,   6,   9,  17,  10,   5,
        -22, -23, -30, -16, -16, -23, -36, -32,
        -33, -28, -22, -43,  -5, -32, -20, -41,
    ],
    [
        -74, -35, -18, -18, -11,  15,   4, -17,
        -12,  17,  14,  17,  17,  38,  23,  11,
         10,  17,  23,  15,  20,  45,  44,  13,
         -8,  22,  24,  27,  26,  33,  26,   3,
        -18,  -4,  21,  24,  27,  23,   9, -11,
        -19,  -3,  11,  21,  23,  16,   7,  -9,
        -27, -11,   4,  13,  14,   4,  -5, -17,
        -53, -34, -21, -11, -28, -14, -24, -43,
    ],
];

/// Material plus square value of one piece, signed for its colour.
#[inline]
pub fn piece_square(colour: usize, piece: usize, sq: usize) -> (i32, i32) {
    if colour == WHITE {
        let i = sq ^ 56;
        (MATERIAL[piece].0 + MIDDLEGAME[piece][i], MATERIAL[piece].1 + ENDGAME[piece][i])
    } else {
        (-MATERIAL[piece].0 - MIDDLEGAME[piece][sq], -MATERIAL[piece].1 - ENDGAME[piece][sq])
    }
}

const BISHOP_PAIR: (i32, i32) = (25, 45);
const DOUBLED_PAWN: (i32, i32) = (-8, -18);
const ISOLATED_PAWN: (i32, i32) = (-10, -12);
/// Bonus for a passed pawn by how far it has advanced (index = ranks moved).
const PASSED_PAWN: [(i32, i32); 7] = [(0, 0), (0, 5), (0, 10), (5, 25), (20, 50), (40, 90), (60, 130)];
const ROOK_OPEN_FILE: (i32, i32) = (25, 10);
const ROOK_HALF_OPEN_FILE: (i32, i32) = (12, 5);
/// Per square of mobility beyond a typical count, for knight to queen.
const MOBILITY: [(i32, i32); 5] = [(0, 0), (4, 4), (5, 5), (2, 4), (1, 2)];
const TYPICAL_MOBILITY: [i32; 5] = [0, 4, 6, 7, 13];
/// Weight of each piece type bearing on the squares around the enemy king.
const KING_ATTACK_WEIGHT: [i32; 5] = [0, 20, 20, 40, 80];
/// Share of the attack weight that counts, by number of attackers: one
/// piece alone is no attack.
const KING_ATTACK_SCALE: [i32; 8] = [0, 0, 50, 75, 88, 94, 97, 99];
const MISSING_SHIELD_PAWN: i32 = -14;
const OPEN_FILE_BY_KING: i32 = -12;

fn pawn_attack_set(colour: usize, pawns: u64) -> u64 {
    if colour == WHITE {
        (pawns & !FILE_A) << 7 | (pawns & !FILE_H) << 9
    } else {
        (pawns & !FILE_A) >> 9 | (pawns & !FILE_H) >> 7
    }
}

/// Everything beyond material and piece-square tables, for one colour.
fn terms(pos: &Position, us: usize, options: &Options) -> (i32, i32) {
    let them = us ^ 1;
    let ours = pos.colours[us];
    let occupied = pos.occupied();
    let our_pawns = pos.pieces[PAWN] & ours;
    let their_pawns = pos.pieces[PAWN] & pos.colours[them];
    let (mut mg, mut eg) = (0, 0);
    let mut add = |(m, e): (i32, i32), times: i32| {
        mg += m * times;
        eg += e * times;
    };

    if options.eval_terms {
        for sq in bits(our_pawns) {
            let file = FILE_A << (sq & 7);
            let beside = (file & !FILE_A) >> 1 | (file & !FILE_H) << 1;
            let rank = sq / 8;
            let ahead = if us == WHITE { (!0u64 << 8) << (rank * 8) } else { (1u64 << (rank * 8)) - 1 };
            if our_pawns & file & ahead != 0 {
                add(DOUBLED_PAWN, 1);
            } else if their_pawns & (file | beside) & ahead == 0 {
                add(PASSED_PAWN[if us == WHITE { rank } else { 7 - rank }], 1);
            }
            if our_pawns & beside == 0 {
                add(ISOLATED_PAWN, 1);
            }
        }
        if (pos.pieces[BISHOP] & ours).count_ones() >= 2 {
            add(BISHOP_PAIR, 1);
        }
        for sq in bits(pos.pieces[ROOK] & ours) {
            let file = FILE_A << (sq & 7);
            if our_pawns & file == 0 {
                add(if their_pawns & file == 0 { ROOK_OPEN_FILE } else { ROOK_HALF_OPEN_FILE }, 1);
            }
        }
    }

    // Mobility: squares each piece can go to that are not held by our own
    // pawns or king and not covered by an enemy pawn. The same pass counts
    // the pieces that bear on the enemy king.
    let area = !(our_pawns | pos.pieces[KING] & ours | pawn_attack_set(them, their_pawns));
    let their_king = pos.king_square(them);
    let king_zone = king_attacks(their_king) | bit(their_king);
    let (mut attackers, mut attack_weight) = (0, 0);
    for piece in KNIGHT..=QUEEN {
        for sq in bits(pos.pieces[piece] & ours) {
            let attacks = match piece {
                KNIGHT => knight_attacks(sq),
                BISHOP => bishop_attacks(sq, occupied),
                ROOK => rook_attacks(sq, occupied),
                _ => bishop_attacks(sq, occupied) | rook_attacks(sq, occupied),
            };
            if options.eval_terms {
                add(MOBILITY[piece], (attacks & area).count_ones() as i32 - TYPICAL_MOBILITY[piece]);
            }
            if attacks & king_zone != 0 {
                attackers += 1;
                attack_weight += KING_ATTACK_WEIGHT[piece];
            }
        }
    }

    if options.king_safety {
        mg += attack_weight * KING_ATTACK_SCALE[attackers.min(7)] / 100;
        // Our own king wants pawns in front of it once it has left the centre.
        let king = pos.king_square(us);
        let home_rank = if us == WHITE { king / 8 == 0 } else { king / 8 == 7 };
        if home_rank && king % 8 != 3 && king % 8 != 4 {
            let front = if us == WHITE { 0xffff00u64 } else { 0xffff00u64 << 32 };
            for file in (king % 8).saturating_sub(1)..=(king % 8 + 1).min(7) {
                let file = FILE_A << file;
                if our_pawns & file & front == 0 {
                    mg += MISSING_SHIELD_PAWN;
                    if our_pawns & file == 0 {
                        mg += OPEN_FILE_BY_KING;
                    }
                }
            }
        }
    }
    (mg, eg)
}

/// With a won ending and no pawns to push, what matters is driving the
/// losing king to the edge and bringing the winning king up to it.
fn mop_up(pos: &Position, winner: usize) -> i32 {
    let (ours, theirs) = (pos.king_square(winner), pos.king_square(winner ^ 1));
    let (f, r) = ((theirs % 8) as i32, (theirs / 8) as i32);
    let from_centre = (2 * f - 7).abs() / 2 + (2 * r - 7).abs() / 2;
    let apart = ((ours % 8) as i32 - f).abs() + ((ours / 8) as i32 - r).abs();
    10 * from_centre + 4 * (14 - apart)
}

pub fn evaluate(pos: &Position, options: &Options) -> i32 {
    let (mut mg, mut eg) = (pos.mg, pos.eg);
    if options.eval_terms || options.king_safety {
        let (white, black) = (terms(pos, WHITE, options), terms(pos, BLACK, options));
        mg += white.0 - black.0;
        eg += white.1 - black.1;
    }
    let phase = pos.phase.min(MAX_PHASE);
    let mut score = (mg * phase + eg * (MAX_PHASE - phase)) / MAX_PHASE;
    if pos.pieces[PAWN] == 0 && score.abs() >= 300 {
        let winner = if score > 0 { WHITE } else { BLACK };
        score += if winner == WHITE { mop_up(pos, winner) } else { -mop_up(pos, winner) };
    }
    if pos.side == WHITE {
        score
    } else {
        -score
    }
}
