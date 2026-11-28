//! The move generator against the node counts in perft.epd: the
//! six standard positions (https://www.chessprogramming.org/Perft_Results),
//! one of them mirrored, and fifteen short ones that each aim at one rule
//! (https://www.chessprogramming.net/perfect-perft/). Between them they
//! exercise every rule of movement. The short positions are published at
//! their deepest count only; their shallower counts come from this
//! generator once it matched every published one.

use chess::movegen::perft;
use chess::position::Position;

/// Each line: a FEN, then `;D1 n ;D2 n ...` for every depth from one.
fn suite() -> Vec<(&'static str, Vec<u64>)> {
    include_str!("perft.epd")
        .lines()
        .map(|line| {
            let mut fields = line.split(';').map(str::trim);
            let fen = fields.next().unwrap();
            let counts = fields
                .enumerate()
                .map(|(i, field)| {
                    let (depth, count) = field.split_once(' ').unwrap();
                    assert_eq!(depth, format!("D{}", i + 1), "{fen}");
                    count.parse().unwrap()
                })
                .collect();
            (fen, counts)
        })
        .collect()
}

fn check(limit: u64) {
    for (fen, counts) in suite() {
        let mut pos = Position::from_fen(fen).unwrap();
        for (i, &expected) in counts.iter().enumerate().filter(|(_, &n)| n <= limit) {
            assert_eq!(perft(&mut pos, i as u32 + 1), expected, "{fen} depth {}", i + 1);
        }
        assert_eq!(pos.fen(), Position::from_fen(fen).unwrap().fen(), "position restored after perft");
    }
}

#[test]
fn the_suite_has_every_position() {
    assert_eq!(suite().len(), 22);
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

#[test]
fn the_runner_checks_a_uci_engine() {
    let run = std::process::Command::new(env!("CARGO_BIN_EXE_perft"))
        .args([env!("CARGO_BIN_EXE_uci"), "--max-nodes", "100000"])
        .output()
        .unwrap();
    let report = String::from_utf8(run.stdout).unwrap();
    assert!(run.status.success(), "{report}");
    assert!(report.ends_with("22 of 22 positions match\n"), "{report}");
}
