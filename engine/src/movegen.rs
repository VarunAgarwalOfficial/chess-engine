//! Legal move generation.
//!
//! The design is the one from the original game: look outward from the
//! king once, and record every checking piece and every pinned piece. Then
//!
//! - in double check only the king moves;
//! - in single check other pieces may only capture the checker or block it;
//! - a pinned piece may only move along the line of its pin.
//!
//! No move is ever made and tested afterwards, except en passant, which
//! removes two pawns from one rank at once and is simply tried.

use crate::bitboard::*;
use crate::position::{Move, Position, NO_SQUARE};

/// A fixed-size list; no position has more than 218 legal moves.
pub struct MoveList {
    moves: [Move; 256],
    len: usize,
}

impl MoveList {
    pub fn new() -> MoveList {
        MoveList { moves: [Move::NONE; 256], len: 0 }
    }
    #[inline]
    fn push(&mut self, from: usize, to: usize, kind: u16) {
        self.moves[self.len] = Move::new(from, to, kind);
        self.len += 1;
    }
    pub fn as_slice(&self) -> &[Move] {
        &self.moves[..self.len]
    }
    pub fn as_mut_slice(&mut self) -> &mut [Move] {
        &mut self.moves[..self.len]
    }
    pub fn len(&self) -> usize {
        self.len
    }
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl Default for MoveList {
    fn default() -> Self {
        MoveList::new()
    }
}

/// All legal moves. With `captures_only`, just captures and queen
/// promotions, which is what the quiescence search wants.
pub fn generate(pos: &Position, list: &mut MoveList, captures_only: bool) {
    let (us, them) = (pos.side, pos.side ^ 1);
    let (ours, theirs) = (pos.colours[us], pos.colours[them]);
    let occupied = ours | theirs;
    let king = pos.king_square(us);

    // The scan outward from the king. Knights and pawns check from fixed
    // squares. Along each line, the first enemy slider that could reach the
    // king matters: with nothing of ours in between it gives check, with
    // exactly one piece of ours in between that piece is pinned.
    let mut checkers = (knight_attacks(king) & pos.pieces[KNIGHT] | pawn_attacks(us, king) & pos.pieces[PAWN]) & theirs;
    let mut pinned = 0u64;
    let diagonal = (pos.pieces[BISHOP] | pos.pieces[QUEEN]) & theirs;
    let straight = (pos.pieces[ROOK] | pos.pieces[QUEEN]) & theirs;
    let snipers = bishop_attacks(king, theirs) & diagonal | rook_attacks(king, theirs) & straight;
    for sniper in bits(snipers) {
        let blockers = between(king, sniper) & ours;
        if blockers == 0 {
            checkers |= bit(sniper);
        } else if blockers & (blockers - 1) == 0 {
            pinned |= blockers;
        }
    }

    let wanted = if captures_only { theirs } else { !0 };
    let kind = |to: usize| if theirs & bit(to) != 0 { Move::CAPTURE } else { Move::QUIET };

    // King moves are tested with the king lifted off the board, so that it
    // cannot hide from a slider behind itself.
    let without_king = occupied ^ bit(king);
    for to in bits(king_attacks(king) & !ours & wanted) {
        if pos.attackers_to(to, without_king) & theirs == 0 {
            list.push(king, to, kind(to));
        }
    }
    if checkers & checkers.wrapping_sub(1) != 0 {
        return; // double check
    }

    // Squares that answer a single check: the checker and those in between.
    let answer = if checkers == 0 { !0 } else { between(king, lsb(checkers)) | checkers };
    let target = !ours & answer & wanted;
    let pin_line = |from: usize| if pinned & bit(from) != 0 { line(king, from) } else { !0 };

    // A pinned knight can never stay on its line.
    for from in bits(pos.pieces[KNIGHT] & ours & !pinned) {
        for to in bits(knight_attacks(from) & target) {
            list.push(from, to, kind(to));
        }
    }
    for from in bits((pos.pieces[BISHOP] | pos.pieces[QUEEN]) & ours) {
        for to in bits(bishop_attacks(from, occupied) & target & pin_line(from)) {
            list.push(from, to, kind(to));
        }
    }
    for from in bits((pos.pieces[ROOK] | pos.pieces[QUEEN]) & ours) {
        for to in bits(rook_attacks(from, occupied) & target & pin_line(from)) {
            list.push(from, to, kind(to));
        }
    }

    let (start_rank, last_rank) = if us == WHITE { (1, 6) } else { (6, 1) };
    let forward = |sq: usize| if us == WHITE { sq + 8 } else { sq - 8 };
    let push_pawn = |list: &mut MoveList, from: usize, to: usize, kind: u16| {
        if from / 8 != last_rank {
            list.push(from, to, kind);
            return;
        }
        // Under-promotions are never worth looking at in quiescence.
        let lowest = if captures_only { QUEEN } else { KNIGHT };
        for piece in (lowest..=QUEEN).rev() {
            list.push(from, to, kind | Move::PROMOTION | (piece - KNIGHT) as u16);
        }
    };
    for from in bits(pos.pieces[PAWN] & ours) {
        let allowed = answer & pin_line(from);
        for to in bits(pawn_attacks(us, from) & theirs & allowed) {
            push_pawn(list, from, to, Move::CAPTURE);
        }
        let to = forward(from);
        if occupied & bit(to) == 0 {
            if allowed & bit(to) != 0 && (!captures_only || from / 8 == last_rank) {
                push_pawn(list, from, to, Move::QUIET);
            }
            if !captures_only && from / 8 == start_rank {
                let to = forward(to);
                if occupied & bit(to) == 0 && allowed & bit(to) != 0 {
                    list.push(from, to, Move::DOUBLE_PUSH);
                }
            }
        }
        if pos.ep != NO_SQUARE && pawn_attacks(us, from) & bit(pos.ep as usize) != 0 {
            // Try it: lift both pawns, drop ours on the target, and see
            // whether anything then attacks the king.
            let to = pos.ep as usize;
            let captured = bit(to ^ 8);
            let after = (occupied ^ bit(from) ^ captured) | bit(to);
            if pos.attackers_to(king, after) & theirs & !captured == 0 {
                list.push(from, to, Move::EN_PASSANT);
            }
        }
    }

    // Castling: not out of check, not through an attacked square, and with
    // nothing between king and rook.
    if !captures_only && checkers == 0 {
        let rights = pos.castling >> (2 * us);
        let safe = |sq: usize| pos.attackers_to(sq, occupied) & theirs == 0;
        if rights & 1 != 0 && occupied & (0b11 << (king + 1)) == 0 && safe(king + 1) && safe(king + 2) {
            list.push(king, king + 2, Move::CASTLE_KING);
        }
        if rights & 2 != 0 && occupied & (0b111 << (king - 3)) == 0 && safe(king - 1) && safe(king - 2) {
            list.push(king, king - 2, Move::CASTLE_QUEEN);
        }
    }
}

pub fn legal_moves(pos: &Position) -> MoveList {
    let mut list = MoveList::new();
    generate(pos, &mut list, false);
    list
}

/// Counts the positions reachable in exactly `depth` moves. Comparing the
/// counts with published ones is the standard test of a move generator.
pub fn perft(pos: &mut Position, depth: u32) -> u64 {
    let list = legal_moves(pos);
    if depth <= 1 {
        return if depth == 0 { 1 } else { list.len() as u64 };
    }
    let mut nodes = 0;
    for &m in list.as_slice() {
        pos.make(m);
        nodes += perft(pos, depth - 1);
        pos.unmake(m);
    }
    nodes
}
