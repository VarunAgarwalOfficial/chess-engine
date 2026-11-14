//! The rules around the move generator: how games end, the special moves,
//! notation, and the hash that repetition depends on.

use chess::game::{position_from_moves, status};
use chess::movegen::legal_moves;
use chess::notation::{find_move, move_to_san, move_to_uci};
use chess::position::{Position, START_FEN};

fn after(fen: &str, moves: &str) -> Position {
    position_from_moves(fen, &moves.split_whitespace().collect::<Vec<_>>()).unwrap()
}

fn reason(pos: &Position) -> Option<&'static str> {
    status(pos).reason
}

fn moves(fen: &str) -> Vec<String> {
    legal_moves(&Position::from_fen(fen).unwrap()).as_slice().iter().map(|&m| move_to_uci(m)).collect()
}

#[test]
fn checkmate_with_moves_written_in_algebraic_notation() {
    let mut pos = Position::start();
    let mut sans = Vec::new();
    for text in ["f2f3", "e7e5", "g2g4", "d8h4"] {
        let m = find_move(&pos, text).unwrap();
        sans.push(move_to_san(&mut pos, m));
        pos.make(m);
    }
    assert_eq!(sans, ["f3", "e5", "g4", "Qh4#"]);
    let end = status(&pos);
    assert_eq!((end.over, end.result, end.reason, end.check), (true, Some("black"), Some("checkmate"), true));
    // Two knights can reach d2, on different files and then on the same file.
    let mut pos = Position::from_fen("4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1").unwrap();
    let m = find_move(&pos, "f3d2").unwrap();
    assert_eq!(move_to_san(&mut pos, m), "Nfd2");
}

#[test]
fn draws_by_stalemate_material_repetition_and_fifty_moves() {
    assert_eq!(reason(&Position::from_fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").unwrap()), Some("stalemate"));
    assert_eq!(reason(&Position::from_fen("8/8/4k3/8/8/4KN2/8/8 w - - 0 1").unwrap()), Some("insufficient material"));
    assert!(!status(&Position::from_fen("8/8/4k3/8/8/4KP2/8/8 w - - 0 1").unwrap()).over);

    let shuffle = "g1f3 g8f6 f3g1 f6g8";
    assert!(!status(&after(START_FEN, shuffle)).over);
    assert_eq!(reason(&after(START_FEN, &format!("{shuffle} {shuffle}"))), Some("threefold repetition"));

    assert_eq!(reason(&after("7k/8/8/8/8/8/8/KR6 w - - 99 80", "b1b2")), Some("fifty-move rule"));
    // Checkmate on the hundredth half-move still wins.
    assert_eq!(reason(&after("7k/8/6K1/8/8/8/8/1R6 w - - 99 80", "b1b8")), Some("checkmate"));
}

#[test]
fn en_passant_is_refused_when_it_would_expose_the_king() {
    assert!(moves("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1").contains(&"e5d6".to_string()));
    // Both pawns leave the fifth rank, opening the rook's line to the king.
    assert!(!moves("8/8/8/K2pP2r/8/8/8/7k w - d6 0 1").contains(&"e5d6".to_string()));
}

#[test]
fn castling_not_through_check_but_the_b_file_square_may_be_attacked() {
    let through = moves("r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1");
    assert!(!through.contains(&"e1g1".to_string()) && through.contains(&"e1c1".to_string()));
    assert!(moves("1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1").contains(&"e1c1".to_string()));
}

#[test]
fn the_hash_is_kept_in_step_through_moves_and_undo() {
    let fen = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
    let mut pos = Position::from_fen(fen).unwrap();
    let mut played = Vec::new();
    // Castling both ways, captures, and a double push beside an enemy pawn.
    for text in "e1g1 b4c3 d5e6 e8c8 e6d7 c8b8 a2a4 c3b2".split(' ') {
        let m = find_move(&pos, text).unwrap_or_else(|| panic!("{text} should be legal"));
        pos.make(m);
        played.push(m);
        assert_eq!(pos.hash, pos.compute_hash(), "after {text}");
    }
    while let Some(m) = played.pop() {
        pos.unmake(m);
    }
    assert_eq!(pos.fen(), fen);
    assert_eq!(pos.hash, pos.compute_hash());
}

#[test]
fn a_bad_fen_is_rejected() {
    assert!(Position::from_fen("8/8/8/8/8/8/8/8 w - - 0 1").is_err_and(|e| e.contains("king")));
    assert!(Position::from_fen("not a fen").is_err());
}
