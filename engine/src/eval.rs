//! Static evaluation, in centipawns, from the side to move's point of view.
//!
//! Every term has a middlegame and an endgame value; the two are blended by
//! how much material is left ("tapered"). Material and piece-square tables
//! are kept up to date by `Position` as moves are made; the rest is computed
//! here from the bitboards.

use crate::bitboard::*;
use crate::position::Position;
use crate::weights::{ENDGAME, MATERIAL, MIDDLEGAME, WEIGHTS};

/// How much each piece counts towards the middlegame; 24 in total at the start.
pub const PHASE_WEIGHT: [i32; 6] = [0, 1, 1, 2, 4, 0];
pub const MAX_PHASE: i32 = 24;

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

// The terms beyond material and squares. Each is a feature with a count
// (ours minus theirs) and a weight; `tune` fits the weights to game results.
pub const BISHOP_PAIR: usize = 0;
pub const DOUBLED_PAWN: usize = 1;
pub const ISOLATED_PAWN: usize = 2;
/// Seven features: a passed pawn by how far it has advanced (ranks moved).
pub const PASSED_PAWN: usize = 3;
pub const ROOK_OPEN_FILE: usize = 10;
pub const ROOK_HALF_OPEN_FILE: usize = 11;
/// Four features, knight to queen: per square of mobility beyond a typical count.
pub const MOBILITY: usize = 12;
pub const FEATURES: usize = 16;

const TYPICAL_MOBILITY: [i32; 5] = [0, 4, 6, 7, 13];

fn pawn_attack_set(colour: usize, pawns: u64) -> u64 {
    if colour == WHITE {
        (pawns & !FILE_A) << 7 | (pawns & !FILE_H) << 9
    } else {
        (pawns & !FILE_A) >> 9 | (pawns & !FILE_H) >> 7
    }
}

/// Everything beyond material and piece-square tables, for one colour:
/// calls `add(feature, count)` for each term that applies.
#[inline]
pub fn terms(pos: &Position, us: usize, add: &mut impl FnMut(usize, i32)) {
    let them = us ^ 1;
    let ours = pos.colours[us];
    let occupied = pos.occupied();
    let our_pawns = pos.pieces[PAWN] & ours;
    let their_pawns = pos.pieces[PAWN] & pos.colours[them];

    for sq in bits(our_pawns) {
        let file = FILE_A << (sq & 7);
        let beside = (file & !FILE_A) >> 1 | (file & !FILE_H) << 1;
        let rank = sq / 8;
        let ahead = if us == WHITE { (!0u64 << 8) << (rank * 8) } else { (1u64 << (rank * 8)) - 1 };
        if our_pawns & file & ahead != 0 {
            add(DOUBLED_PAWN, 1);
        } else if their_pawns & (file | beside) & ahead == 0 {
            add(PASSED_PAWN + if us == WHITE { rank } else { 7 - rank }, 1);
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

    // Mobility: squares each piece can go to that are not held by our own
    // pawns or king and not covered by an enemy pawn.
    let area = !(our_pawns | pos.pieces[KING] & ours | pawn_attack_set(them, their_pawns));
    for piece in KNIGHT..=QUEEN {
        for sq in bits(pos.pieces[piece] & ours) {
            let attacks = match piece {
                KNIGHT => knight_attacks(sq),
                BISHOP => bishop_attacks(sq, occupied),
                ROOK => rook_attacks(sq, occupied),
                _ => bishop_attacks(sq, occupied) | rook_attacks(sq, occupied),
            };
            add(MOBILITY + piece - 1, (attacks & area).count_ones() as i32 - TYPICAL_MOBILITY[piece]);
        }
    }
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

pub fn evaluate(pos: &Position) -> i32 {
    let (mut mg, mut eg) = (pos.mg, pos.eg);
    terms(pos, WHITE, &mut |feature, count| {
        mg += WEIGHTS[feature].0 * count;
        eg += WEIGHTS[feature].1 * count;
    });
    terms(pos, BLACK, &mut |feature, count| {
        mg -= WEIGHTS[feature].0 * count;
        eg -= WEIGHTS[feature].1 * count;
    });
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
