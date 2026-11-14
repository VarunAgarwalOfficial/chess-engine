//! The move generator against the published node counts for the six
//! standard positions (https://www.chessprogramming.org/Perft_Results).
//! Between them they exercise every rule of movement.

use chess::movegen::perft;
use chess::position::Position;

const POSITIONS: [(&str, [u64; 5]); 6] = [
    ("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", [20, 400, 8902, 197281, 4865609]),
    ("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862, 4085603, 193690690]),
    ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238, 674624]),
    ("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467, 422333, 15833292]),
    ("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379, 2103487, 89941194]),
    ("r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", [46, 2079, 89890, 3894594, 164075551]),
];

fn check(limit: u64) {
    for (fen, counts) in POSITIONS {
        let mut pos = Position::from_fen(fen).unwrap();
        for (i, &expected) in counts.iter().enumerate().filter(|(_, &n)| n <= limit) {
            assert_eq!(perft(&mut pos, i as u32 + 1), expected, "{fen} depth {}", i + 1);
        }
        assert_eq!(pos.fen(), Position::from_fen(fen).unwrap().fen(), "position restored after perft");
    }
}

#[test]
fn perft_to_five_million_nodes() {
    check(5_000_000);
}

#[test]
#[ignore = "every published depth; run with --ignored"]
fn perft_to_full_depth() {
    check(u64::MAX);
}
