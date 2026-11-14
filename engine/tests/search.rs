//! A handful of search results that must hold whatever the tuning.

use chess::eval::evaluate;
use chess::game::status;
use chess::notation::move_to_uci;
use chess::position::{Position, START_FEN};
use chess::search::{Limits, Searcher, MATE};

fn best(fen: &str, limits: Limits) -> (String, i32) {
    let mut pos = Position::from_fen(fen).unwrap();
    let outcome = Searcher::new(4).search(&mut pos, &limits, &mut |_| {});
    (move_to_uci(outcome.best.unwrap()), outcome.info.score)
}

fn depth(depth: i32) -> Limits {
    Limits { depth: Some(depth), ..Limits::default() }
}

/// The same position seen from the other side: colours swapped, board
/// turned upside down.
fn mirrored(fen: &str) -> String {
    let fields: Vec<&str> = fen.split(' ').collect();
    let swap_case = |text: &str| -> String {
        text.chars()
            .map(|c| if c.is_ascii_uppercase() { c.to_ascii_lowercase() } else { c.to_ascii_uppercase() })
            .collect()
    };
    let board: Vec<String> = fields[0].split('/').rev().map(swap_case).collect();
    let side = if fields[1] == "w" { "b" } else { "w" };
    format!("{} {side} {} - 0 1", board.join("/"), swap_case(fields[2]))
}

#[test]
fn evaluation_is_level_at_the_start_and_the_same_for_both_colours() {
    assert_eq!(evaluate(&Position::start()), 0);
    assert!(evaluate(&Position::from_fen("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1").unwrap()) > 800);
    assert!(evaluate(&Position::from_fen("4k3/8/8/8/8/8/8/Q3K3 b - - 0 1").unwrap()) < -800);
    // Any term with a sign or table error for one colour breaks this.
    for fen in [
        "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
        "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
        "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
        "2kr3r/ppp2ppp/2n5/8/1b1P4/2N1PN2/PP3PPP/R4RK1 b - - 0 12",
    ] {
        let (pos, flipped) = (Position::from_fen(fen).unwrap(), Position::from_fen(&mirrored(fen)).unwrap());
        assert_eq!(evaluate(&pos), evaluate(&flipped), "{fen}");
    }
}

#[test]
fn finds_forced_mates_in_one_two_and_three() {
    assert_eq!(best("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", depth(3)), ("a1a8".into(), MATE - 1));
    // A queen sacrifice: 1.Qh6+ Kxh6 2.Bxf6 mate.
    let two = best("r1bq2r1/b4pk1/p1pp1p2/1p2pP2/1P2P1PB/3P4/1PPQ2P1/R3K2R w - - 0 1", depth(6));
    assert_eq!(two, ("d2h6".into(), MATE - 3));
    assert_eq!(best("r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1", depth(8)), ("f6a6".into(), MATE - 5));
}

#[test]
fn takes_a_hanging_queen() {
    assert_eq!(best("4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1", depth(4)).0, "d2d5");
}

#[test]
fn always_returns_a_legal_move_however_tight_the_limit() {
    let tight = [
        Limits { move_time: Some(0.0), ..Limits::default() },
        Limits { nodes: Some(1), ..Limits::default() },
        depth(1),
    ];
    for limits in tight {
        let (text, _) = best(START_FEN, limits);
        assert!(chess::notation::find_move(&Position::start(), &text).is_some());
    }
}

#[test]
fn mates_with_king_and_rook_against_king() {
    let mut pos = Position::from_fen("8/8/8/3k4/8/8/8/KR6 w - - 0 1").unwrap();
    let mut searcher = Searcher::new(4);
    for _ in 0..80 {
        if status(&pos).over {
            break;
        }
        let m = searcher.search(&mut pos, &depth(8), &mut |_| {}).best.unwrap();
        pos.make(m);
    }
    let end = status(&pos);
    assert_eq!((end.reason, end.result), (Some("checkmate"), Some("white")));
}
