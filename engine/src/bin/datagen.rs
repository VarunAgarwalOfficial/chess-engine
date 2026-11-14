//! Plays the engine against itself and writes quiet positions with the
//! search score and the game's result, for tuning the evaluation and for
//! training a network.
//!
//!   datagen --out FILE [--threads 4] [--seconds 60] [--nodes 5000] [--seed 1]
//!
//! Each line is `FEN;score;result`: the score is in centipawns from White's
//! side, the result is 1, 0.5 or 0 for White. Games start with eight or nine
//! random moves. A position is written only when the side to move is not in
//! check and the move the search chose is not a capture or promotion, so the
//! static evaluation of the position is a fair thing to compare with its
//! outcome.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::thread;
use std::time::{Duration, Instant};

use chess::bitboard::WHITE;
use chess::game::status;
use chess::movegen::legal_moves;
use chess::position::Position;
use chess::search::{Limits, Searcher, MATE_BOUND};

const WIN_SCORE: i32 = 1500;
const WIN_PLIES: usize = 5;
const MAX_PLIES: usize = 400;

fn play(searcher: &mut Searcher, random: &mut impl FnMut() -> u64, nodes: u64, out: &mut impl Write) -> usize {
    let mut pos = Position::start();
    for _ in 0..8 + random() % 2 {
        let list = legal_moves(&pos);
        if list.is_empty() {
            return 0;
        }
        pos.make(list.as_slice()[(random() % list.len() as u64) as usize]);
    }
    searcher.clear();
    let limits = Limits { nodes: Some(nodes), ..Limits::default() };
    let mut kept: Vec<(String, i32)> = Vec::new();
    let (mut white_winning, mut black_winning) = (0, 0);
    let result = loop {
        let state = status(&pos);
        if state.over {
            break match state.result {
                Some("white") => 1.0,
                Some("black") => 0.0,
                _ => 0.5,
            };
        }
        if pos.ply() >= MAX_PLIES {
            break 0.5;
        }
        let outcome = searcher.search(&mut pos, &limits, &mut |_| {});
        let Some(best) = outcome.best else { break 0.5 };
        let score = if pos.side == WHITE { outcome.info.score } else { -outcome.info.score };
        white_winning = if score >= WIN_SCORE { white_winning + 1 } else { 0 };
        black_winning = if score <= -WIN_SCORE { black_winning + 1 } else { 0 };
        if white_winning >= WIN_PLIES {
            break 1.0;
        }
        if black_winning >= WIN_PLIES {
            break 0.0;
        }
        if !pos.in_check() && best.is_quiet() && score.abs() < MATE_BOUND {
            kept.push((pos.fen(), score));
        }
        pos.make(best);
    };
    for (fen, score) in &kept {
        let _ = writeln!(out, "{fen};{score};{result}");
    }
    kept.len()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let Some(out) = value("--out") else {
        eprintln!("usage: datagen --out FILE [--threads 4] [--seconds 60] [--nodes 5000] [--seed 1]");
        std::process::exit(2);
    };
    let threads: usize = value("--threads").and_then(|v| v.parse().ok()).unwrap_or(4).clamp(1, 4);
    let seconds: u64 = value("--seconds").and_then(|v| v.parse().ok()).unwrap_or(60);
    let nodes: u64 = value("--nodes").and_then(|v| v.parse().ok()).unwrap_or(5000);
    let seed: u64 = value("--seed").and_then(|v| v.parse().ok()).unwrap_or(1).max(1);
    let deadline = Instant::now() + Duration::from_secs(seconds);

    let workers: Vec<_> = (0..threads)
        .map(|t| {
            let path = format!("{out}.{t}");
            thread::spawn(move || {
                let mut state = (seed + t as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
                let mut random = move || {
                    state ^= state << 13;
                    state ^= state >> 7;
                    state ^= state << 17;
                    state
                };
                let mut file = BufWriter::new(File::create(&path).expect("cannot create the output file"));
                let mut searcher = Searcher::new(16);
                let (mut games, mut positions) = (0usize, 0usize);
                while Instant::now() < deadline {
                    positions += play(&mut searcher, &mut random, nodes, &mut file);
                    games += 1;
                }
                (games, positions)
            })
        })
        .collect();
    let (mut games, mut positions) = (0, 0);
    for worker in workers {
        let (g, p) = worker.join().expect("datagen worker");
        games += g;
        positions += p;
    }
    println!("{games} games, {positions} positions in {seconds} s, written to {out}.0 .. {out}.{}", threads - 1);
}
