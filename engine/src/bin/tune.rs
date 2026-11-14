//! Fits the evaluation's weights to game results (Texel's tuning method).
//!
//!   tune --data FILE [FILE ...] --out src/weights.rs [--epochs 40] [--rate 1.0] [--tables]
//!
//! The data is what `datagen` writes. The evaluation is linear in its
//! weights, so each position is reduced to its feature counts (White minus
//! Black) and its game phase. The loss is the mean squared difference
//! between the game's result and sigmoid(K * evaluation / 400); K is fitted
//! once to the weights the engine has now and then held, so the scale of the
//! evaluation, which the search's margins depend on, does not drift. The
//! weights are then moved downhill with Adam. The last tenth of the data is
//! held out and only reported on.

use std::fmt::Write as _;
use std::fs;

use chess::bitboard::*;
use chess::eval::{evaluate, terms, FEATURES, MAX_PHASE};
use chess::position::Position;
use chess::weights::{ENDGAME, MATERIAL, MIDDLEGAME, WEIGHTS};

const TABLE: usize = 6 * 64;
const PARAMS: usize = TABLE + FEATURES;

struct Data {
    /// Start of each position's features in `features`; one extra at the end.
    starts: Vec<u32>,
    features: Vec<(u16, i8)>,
    phase: Vec<u8>,
    result: Vec<f32>,
}

fn extract(pos: &Position, out: &mut Vec<(u16, i8)>) {
    let mut counts = [0i32; PARAMS];
    for colour in [WHITE, BLACK] {
        let sign = if colour == WHITE { 1 } else { -1 };
        for piece in PAWN..=KING {
            for sq in bits(pos.pieces[piece] & pos.colours[colour]) {
                counts[piece * 64 + if colour == WHITE { sq ^ 56 } else { sq }] += sign;
            }
        }
        terms(pos, colour, &mut |feature, count| counts[TABLE + feature] += sign * count);
    }
    out.extend(counts.iter().enumerate().filter(|(_, &c)| c != 0).map(|(i, &c)| (i as u16, c as i8)));
}

fn initial() -> Vec<[f64; 2]> {
    let mut w = vec![[0.0; 2]; PARAMS];
    for piece in 0..6 {
        for i in 0..64 {
            w[piece * 64 + i] =
                [(MATERIAL[piece].0 + MIDDLEGAME[piece][i]) as f64, (MATERIAL[piece].1 + ENDGAME[piece][i]) as f64];
        }
    }
    for f in 0..FEATURES {
        w[TABLE + f] = [WEIGHTS[f].0 as f64, WEIGHTS[f].1 as f64];
    }
    w
}

impl Data {
    fn len(&self) -> usize {
        self.phase.len()
    }

    fn eval(&self, i: usize, w: &[[f64; 2]]) -> f64 {
        let (mut mg, mut eg) = (0.0, 0.0);
        for &(f, c) in &self.features[self.starts[i] as usize..self.starts[i + 1] as usize] {
            mg += w[f as usize][0] * c as f64;
            eg += w[f as usize][1] * c as f64;
        }
        let phase = self.phase[i] as f64;
        (mg * phase + eg * (MAX_PHASE as f64 - phase)) / MAX_PHASE as f64
    }

    fn loss(&self, range: std::ops::Range<usize>, w: &[[f64; 2]], k: f64) -> f64 {
        let n = range.len() as f64;
        range.map(|i| (self.result[i] as f64 - sigmoid(k * self.eval(i, w))).powi(2)).sum::<f64>() / n
    }
}

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + 10f64.powf(-x / 400.0))
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let files: Vec<&String> = match args.iter().position(|a| a == "--data") {
        Some(at) => args[at + 1..].iter().take_while(|a| !a.starts_with("--")).collect(),
        None => Vec::new(),
    };
    if files.is_empty() {
        eprintln!("usage: tune --data FILE [FILE ...] [--out src/weights.rs] [--epochs 40] [--rate 1.0]");
        std::process::exit(2);
    }
    let epochs: usize = value("--epochs").and_then(|v| v.parse().ok()).unwrap_or(40);
    // Without --tables the piece-square tables keep their shape and only
    // material and the other terms are fitted: far fewer numbers, so far
    // less noise from a small data set.
    let tables = args.iter().any(|a| a == "--tables");
    let rate: f64 = value("--rate").and_then(|v| v.parse().ok()).unwrap_or(1.0);

    let mut data = Data { starts: vec![0], features: Vec::new(), phase: Vec::new(), result: Vec::new() };
    let mut mismatches = 0;
    let start = initial();
    for file in files {
        let text = fs::read_to_string(file).unwrap_or_else(|e| panic!("cannot read {file}: {e}"));
        for line in text.lines() {
            let mut parts = line.split(';');
            let (Some(fen), Some(_score), Some(result)) = (parts.next(), parts.next(), parts.next()) else { continue };
            let Ok(pos) = Position::from_fen(fen) else { continue };
            // Without pawns the evaluation adds a term that is not linear.
            if pos.pieces[PAWN] == 0 {
                continue;
            }
            extract(&pos, &mut data.features);
            data.starts.push(data.features.len() as u32);
            data.phase.push(pos.phase.min(MAX_PHASE) as u8);
            data.result.push(result.parse().expect("a result"));
            // The features must reproduce the engine's evaluation exactly.
            let i = data.len() - 1;
            let white = if pos.side == WHITE { evaluate(&pos) } else { -evaluate(&pos) };
            if (data.eval(i, &start) - white as f64).abs() > 1.0 {
                mismatches += 1;
            }
        }
    }
    let n = data.len();
    println!(
        "{n} positions, {} feature entries, {mismatches} differ from the engine's evaluation",
        data.features.len()
    );
    assert_eq!(mismatches, 0, "the tuner's features do not match the evaluation");
    let train = n * 9 / 10;

    // K by golden-section search on the starting weights.
    let (mut low, mut high) = (0.2f64, 3.0f64);
    while high - low > 0.001 {
        let (a, b) = (low + (high - low) * 0.382, low + (high - low) * 0.618);
        if data.loss(0..train, &start, a) < data.loss(0..train, &start, b) {
            high = b;
        } else {
            low = a;
        }
    }
    let k = (low + high) / 2.0;
    println!("K = {k:.3}");
    println!("start: train {:.6}, held out {:.6}", data.loss(0..train, &start, k), data.loss(train..n, &start, k));

    let mut w = start.clone();
    let (mut m, mut v) = (vec![[0.0f64; 2]; PARAMS], vec![[0.0f64; 2]; PARAMS]);
    let (b1, b2, batch) = (0.9, 0.999, 16384);
    let mut step = 0;
    let mut order: Vec<u32> = (0..train as u32).collect();
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    for epoch in 1..=epochs {
        for i in (1..order.len()).rev() {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            order.swap(i, (seed % (i as u64 + 1)) as usize);
        }
        // The rate falls to a tenth over the run.
        let rate = rate * 0.1f64.powf((epoch - 1) as f64 / epochs.max(2) as f64);
        for chunk in order.chunks(batch) {
            let mut grad = vec![[0.0f64; 2]; PARAMS];
            for &i in chunk {
                let i = i as usize;
                let p = sigmoid(k * data.eval(i, &w));
                let d = 2.0 * (p - data.result[i] as f64) * p * (1.0 - p) * k * std::f64::consts::LN_10 / 400.0;
                let phase = data.phase[i] as f64 / MAX_PHASE as f64;
                for &(f, c) in &data.features[data.starts[i] as usize..data.starts[i + 1] as usize] {
                    grad[f as usize][0] += d * c as f64 * phase;
                    grad[f as usize][1] += d * c as f64 * (1.0 - phase);
                }
            }
            if !tables {
                // Tie each piece's 64 squares together: only its material moves.
                for piece in grad[..TABLE].chunks_mut(64) {
                    for t in 0..2 {
                        let sum: f64 = piece.iter().map(|g| g[t]).sum();
                        piece.iter_mut().for_each(|g| g[t] = sum);
                    }
                }
            }
            step += 1;
            let scale = 1.0 / chunk.len() as f64;
            for f in 0..PARAMS {
                for t in 0..2 {
                    let g = grad[f][t] * scale;
                    m[f][t] = b1 * m[f][t] + (1.0 - b1) * g;
                    v[f][t] = b2 * v[f][t] + (1.0 - b2) * g * g;
                    let (mh, vh) = (m[f][t] / (1.0 - b1.powi(step)), v[f][t] / (1.0 - b2.powi(step)));
                    w[f][t] -= rate * mh / (vh.sqrt() + 1e-8);
                }
            }
        }
        if epoch % 5 == 0 || epoch == epochs {
            println!(
                "epoch {epoch}: train {:.6}, held out {:.6}",
                data.loss(0..train, &w, k),
                data.loss(train..n, &w, k)
            );
        }
    }

    if let Some(out) = value("--out") {
        fs::write(&out, render(&w, n, k)).unwrap_or_else(|e| panic!("cannot write {out}: {e}"));
        println!("wrote {out}");
    }
}

/// The weights as the Rust source of `weights.rs`.
fn render(w: &[[f64; 2]], positions: usize, k: f64) -> String {
    // Material is the average over the squares a piece can stand on; the
    // tables hold the rest. The king has no material value.
    let mut material = [[0i32; 2]; 6];
    for (piece, value) in material.iter_mut().enumerate().take(KING) {
        let squares: Vec<usize> = if piece == PAWN { (8..56).collect() } else { (0..64).collect() };
        for t in 0..2 {
            value[t] =
                (squares.iter().map(|&i| w[piece * 64 + i][t]).sum::<f64>() / squares.len() as f64).round() as i32;
        }
    }
    let mut s = String::new();
    let _ = writeln!(s, "//! The evaluation's weights. Written by `tune` ({positions} positions, K = {k:.3});");
    let _ = writeln!(s, "//! the piece-square tables started from PeSTO's, by Ronald Friederich.");
    let _ = writeln!(s, "//! Every weight is a (middlegame, endgame) pair in centipawns.\n");
    let _ = writeln!(s, "use crate::eval::FEATURES;\n");
    let _ = writeln!(s, "#[rustfmt::skip]");
    let pairs: Vec<String> = material.iter().map(|m| format!("({}, {})", m[0], m[1])).collect();
    let _ = writeln!(s, "pub const MATERIAL: [(i32, i32); 6] = [{}];\n", pairs.join(", "));
    for (t, name) in ["MIDDLEGAME", "ENDGAME"].iter().enumerate() {
        if t == 0 {
            let _ = writeln!(s, "// Piece-square tables, written as the board looks from White's side: the");
            let _ = writeln!(s, "// first row is rank 8.");
        }
        let _ = writeln!(s, "#[rustfmt::skip]\npub const {name}: [[i32; 64]; 6] = [");
        for piece in 0..6 {
            let _ = writeln!(s, "    [");
            for row in 0..8 {
                let cells: Vec<String> = (0..8)
                    .map(|col| {
                        let i = row * 8 + col;
                        let unused = piece == PAWN && (row == 0 || row == 7);
                        let x = if unused { 0 } else { w[piece * 64 + i][t].round() as i32 - material[piece][t] };
                        format!("{x:4}")
                    })
                    .collect();
                let _ = writeln!(s, "        {},", cells.join(","));
            }
            let _ = writeln!(s, "    ],");
        }
        let _ = writeln!(s, "];\n");
    }
    let _ = writeln!(s, "/// The terms of `eval::terms`, in the order of its feature numbers.");
    let _ = writeln!(s, "#[rustfmt::skip]\npub const WEIGHTS: [(i32, i32); FEATURES] = [");
    for f in 0..FEATURES {
        let _ = writeln!(s, "    ({}, {}),", w[TABLE + f][0].round() as i32, w[TABLE + f][1].round() as i32);
    }
    let _ = writeln!(s, "];");
    s
}
