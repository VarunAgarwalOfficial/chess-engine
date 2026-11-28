//! Move text: coordinate notation as used by UCI ("e2e4", "e7e8q") and
//! standard algebraic notation ("Nf3", "exd5", "O-O", "e8=Q#").

use crate::bitboard::*;
use crate::movegen::legal_moves;
use crate::position::{square_name, Move, Position};

const LETTERS: &[u8; 6] = b"pnbrqk";

pub fn move_to_uci(m: Move) -> String {
    let mut text = square_name(m.from()) + &square_name(m.to());
    if let Some(piece) = m.promotion() {
        text.push(LETTERS[piece] as char);
    }
    text
}

/// The legal move matching coordinate text, if there is one.
pub fn find_move(pos: &Position, text: &str) -> Option<Move> {
    let wanted = text.trim().to_ascii_lowercase();
    legal_moves(pos).as_slice().iter().copied().find(|&m| move_to_uci(m) == wanted)
}

/// SAN for a legal move in the current position.
pub fn move_to_san(pos: &mut Position, m: Move) -> String {
    let (from, to) = (m.from(), m.to());
    let piece = pos.board[from] as usize;
    let mut san = String::new();

    if m.is_castle() {
        san.push_str(if m.kind() == Move::CASTLE_KING { "O-O" } else { "O-O-O" });
    } else if piece == PAWN {
        if m.is_capture() {
            san.push_str(&square_name(from)[..1]);
            san.push('x');
        }
        san.push_str(&square_name(to));
        if let Some(promoted) = m.promotion() {
            san.push('=');
            san.push(LETTERS[promoted].to_ascii_uppercase() as char);
        }
    } else {
        san.push(LETTERS[piece].to_ascii_uppercase() as char);
        // Name the file, rank or both when another piece of the same kind
        // could reach the same square.
        let rivals: Vec<usize> = legal_moves(pos)
            .as_slice()
            .iter()
            .filter(|o| **o != m && o.to() == to && pos.board[o.from()] as usize == piece)
            .map(|o| o.from())
            .collect();
        if !rivals.is_empty() {
            let name = square_name(from);
            if rivals.iter().all(|r| r % 8 != from % 8) {
                san.push_str(&name[..1]);
            } else if rivals.iter().all(|r| r / 8 != from / 8) {
                san.push_str(&name[1..]);
            } else {
                san.push_str(&name);
            }
        }
        if m.is_capture() {
            san.push('x');
        }
        san.push_str(&square_name(to));
    }

    pos.make(m);
    if pos.in_check() {
        san.push(if legal_moves(pos).is_empty() { '#' } else { '+' });
    }
    pos.unmake(m);
    san
}

/// A line in SAN, cut short at the first move that is not legal where it
/// stands. The position is left as it was.
pub fn line_to_san(pos: &mut Position, line: &[Move]) -> Vec<String> {
    let mut san = Vec::new();
    for &m in line {
        if !legal_moves(pos).as_slice().contains(&m) {
            break;
        }
        san.push(move_to_san(pos, m));
        pos.make(m);
    }
    for &m in line[..san.len()].iter().rev() {
        pos.unmake(m);
    }
    san
}
