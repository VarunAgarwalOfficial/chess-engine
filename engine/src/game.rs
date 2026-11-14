//! The rules that end a game, and setting up a position from a move list.

use crate::bitboard::WHITE;
use crate::movegen::legal_moves;
use crate::notation::find_move;
use crate::position::Position;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub struct Status {
    pub over: bool,
    /// "white", "black" or "draw" once the game is over.
    pub result: Option<&'static str>,
    pub reason: Option<&'static str>,
    pub check: bool,
}

/// Checkmate is tested first, so a mating move wins even when it is also
/// the hundredth half-move without a capture or pawn move. Draws by
/// repetition and the fifty-move rule are applied without being claimed.
pub fn status(pos: &Position) -> Status {
    let check = pos.in_check();
    let ended = |result, reason| Status { over: true, result: Some(result), reason: Some(reason), check };
    if legal_moves(pos).is_empty() {
        return if check {
            ended(if pos.side == WHITE { "black" } else { "white" }, "checkmate")
        } else {
            ended("draw", "stalemate")
        };
    }
    if pos.insufficient_material() {
        ended("draw", "insufficient material")
    } else if pos.halfmove >= 100 {
        ended("draw", "fifty-move rule")
    } else if pos.repetitions() >= 2 {
        ended("draw", "threefold repetition")
    } else {
        Status { over: false, result: None, reason: None, check }
    }
}

/// Builds a position, with its history, from a start FEN and coordinate
/// moves. Fails on a move that is not legal.
pub fn position_from_moves<S: AsRef<str>>(fen: &str, moves: &[S]) -> Result<Position, String> {
    let mut pos = Position::from_fen(fen)?;
    for text in moves {
        let m = find_move(&pos, text.as_ref()).ok_or(format!("Illegal move: {}", text.as_ref()))?;
        pos.make(m);
    }
    Ok(pos)
}
