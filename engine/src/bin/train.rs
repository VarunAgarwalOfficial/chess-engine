//! Trains the network of `nnue.rs` on what `datagen` writes.
//!
//!   train --data FILE [FILE ...] --out net.bin [--epochs 30] [--rate 0.001]
//!         [--scale 400] [--lambda 0.5] [--threads 4]
//!
//! For each position the target is a blend of the game's result and the
//! search score squashed to a winning chance, both from the side to move's
//! point of view: lambda * result + (1 - lambda) * sigmoid(score / scale).
//! The loss is the squared difference between that and the sigmoid of the
//! network's output. Training is in floating point with Adam; the weights
//! are then rounded to the integers the engine uses. The last twentieth of
//! the data is held out and only reported on.

use std::fs;
use std::thread;

use chess::bitboard::*;
use chess::nnue::{feature, Network, HIDDEN, INPUTS, QA, QB};
use chess::position::Position;

struct Sample {
    /// Inputs seen by the side to move, then by the other side.
    inputs: [Vec<u16>; 2],
    target: f32,
}

/// All the weights, or a gradient for them, as one flat vector: first
/// layer, its bias, output weights, output bias.
const FIRST: usize = INPUTS * HIDDEN;
const BIAS: usize = FIRST;
const OUT: usize = BIAS + HIDDEN;
const OUT_BIAS: usize = OUT + 2 * HIDDEN;
const PARAMS: usize = OUT_BIAS + 1;

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

/// The network's output for a sample; with `grad`, also adds the gradient
/// of the squared error.
fn forward(w: &[f32], sample: &Sample, grad: Option<&mut [f32]>) -> f32 {
    let mut hidden = [[0f32; HIDDEN]; 2];
    for (half, inputs) in hidden.iter_mut().zip(&sample.inputs) {
        half.copy_from_slice(&w[BIAS..BIAS + HIDDEN]);
        for &input in inputs {
            let column = &w[input as usize * HIDDEN..(input as usize + 1) * HIDDEN];
            for (h, c) in half.iter_mut().zip(column) {
                *h += c;
            }
        }
    }
    let mut out = w[OUT_BIAS];
    for (s, half) in hidden.iter().enumerate() {
        for (h, o) in half.iter().zip(&w[OUT + s * HIDDEN..OUT + (s + 1) * HIDDEN]) {
            out += h.clamp(0.0, 1.0) * o;
        }
    }
    let p = sigmoid(out);
    if let Some(grad) = grad {
        let d = 2.0 * (p - sample.target) * p * (1.0 - p);
        grad[OUT_BIAS] += d;
        for (s, half) in hidden.iter().enumerate() {
            let mut back = [0f32; HIDDEN];
            for i in 0..HIDDEN {
                grad[OUT + s * HIDDEN + i] += d * half[i].clamp(0.0, 1.0);
                if half[i] > 0.0 && half[i] < 1.0 {
                    back[i] = d * w[OUT + s * HIDDEN + i];
                }
            }
            for (g, b) in grad[BIAS..BIAS + HIDDEN].iter_mut().zip(&back) {
                *g += b;
            }
            for &input in &sample.inputs[s] {
                let column = &mut grad[input as usize * HIDDEN..(input as usize + 1) * HIDDEN];
                for (g, b) in column.iter_mut().zip(&back) {
                    *g += b;
                }
            }
        }
    }
    p
}

fn loss(w: &[f32], samples: &[Sample]) -> f64 {
    samples.iter().map(|s| ((forward(w, s, None) - s.target) as f64).powi(2)).sum::<f64>() / samples.len() as f64
}

fn quantise(w: &[f32], scale: i32) -> Network {
    let round = |x: f32, by: i32| (x * by as f32).round().clamp(-32767.0, 32767.0) as i16;
    let mut network = Network {
        feature_weights: w[..FIRST].iter().map(|&x| round(x, QA)).collect(),
        feature_bias: [0; HIDDEN],
        output_weights: [0; 2 * HIDDEN],
        output_bias: (w[OUT_BIAS] * (QA * QB) as f32).round() as i32,
        scale,
    };
    for i in 0..HIDDEN {
        network.feature_bias[i] = round(w[BIAS + i], QA);
    }
    for i in 0..2 * HIDDEN {
        network.output_weights[i] = round(w[OUT + i], QB);
    }
    network
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let files: Vec<&String> = match args.iter().position(|a| a == "--data") {
        Some(at) => args[at + 1..].iter().take_while(|a| !a.starts_with("--")).collect(),
        None => Vec::new(),
    };
    let (Some(out), false) = (value("--out"), files.is_empty()) else {
        eprintln!("usage: train --data FILE [FILE ...] --out net.bin [--epochs 30] [--rate 0.001]");
        eprintln!("             [--scale 400] [--lambda 0.5] [--threads 4]");
        std::process::exit(2);
    };
    let epochs: usize = value("--epochs").and_then(|v| v.parse().ok()).unwrap_or(30);
    let rate: f32 = value("--rate").and_then(|v| v.parse().ok()).unwrap_or(0.001);
    let scale: i32 = value("--scale").and_then(|v| v.parse().ok()).unwrap_or(400);
    let lambda: f32 = value("--lambda").and_then(|v| v.parse().ok()).unwrap_or(0.5);
    let threads: usize = value("--threads").and_then(|v| v.parse().ok()).unwrap_or(4).clamp(1, 4);

    let mut samples = Vec::new();
    for file in files {
        let text = fs::read_to_string(file).unwrap_or_else(|e| panic!("cannot read {file}: {e}"));
        for line in text.lines() {
            let mut parts = line.split(';');
            let (Some(fen), Some(score), Some(result)) = (parts.next(), parts.next(), parts.next()) else { continue };
            let (Ok(pos), Ok(score), Ok(result)) =
                (Position::from_fen(fen), score.parse::<f32>(), result.parse::<f32>())
            else {
                continue;
            };
            // The file is from White's side; the network sees the side to move's.
            let (score, result) = if pos.side == WHITE { (score, result) } else { (-score, 1.0 - result) };
            let mut inputs = [Vec::new(), Vec::new()];
            for colour in [WHITE, BLACK] {
                for piece in PAWN..=KING {
                    for sq in bits(pos.pieces[piece] & pos.colours[colour]) {
                        inputs[0].push(feature(pos.side, colour, piece, sq) as u16);
                        inputs[1].push(feature(pos.side ^ 1, colour, piece, sq) as u16);
                    }
                }
            }
            let target = lambda * result + (1.0 - lambda) * sigmoid(score / scale as f32);
            samples.push(Sample { inputs, target });
        }
    }
    let train = samples.len() * 19 / 20;
    let (train_set, held_out) = samples.split_at(train);
    println!("{} positions, {} held out", samples.len(), held_out.len());

    // Small random starting weights from a fixed seed.
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut random = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed >> 40) as f32 / (1u64 << 24) as f32 - 0.5
    };
    let mut w = vec![0f32; PARAMS];
    w[..FIRST].iter_mut().for_each(|x| *x = random() * 0.2);
    w[OUT..OUT_BIAS].iter_mut().for_each(|x| *x = random() * 0.2);

    let (mut m, mut v) = (vec![0f32; PARAMS], vec![0f32; PARAMS]);
    let (b1, b2, batch) = (0.9f32, 0.999f32, 4096);
    let mut order: Vec<u32> = (0..train as u32).collect();
    let mut step = 0;
    for epoch in 1..=epochs {
        for i in (1..order.len()).rev() {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            order.swap(i, (seed % (i as u64 + 1)) as usize);
        }
        // The rate drops to a tenth for the last quarter of the run.
        let rate = if epoch * 4 > epochs * 3 { rate * 0.1 } else { rate };
        for chunk in order.chunks(batch) {
            let w_now = &w;
            let grads: Vec<Vec<f32>> = thread::scope(|scope| {
                let workers: Vec<_> = chunk
                    .chunks(chunk.len().div_ceil(threads))
                    .map(|part| {
                        scope.spawn(move || {
                            let mut grad = vec![0f32; PARAMS];
                            for &i in part {
                                forward(w_now, &train_set[i as usize], Some(&mut grad));
                            }
                            grad
                        })
                    })
                    .collect();
                workers.into_iter().map(|worker| worker.join().expect("training worker")).collect()
            });
            step += 1;
            let (c1, c2) = (1.0 - b1.powi(step), 1.0 - b2.powi(step));
            for i in 0..PARAMS {
                let g = grads.iter().map(|grad| grad[i]).sum::<f32>() / chunk.len() as f32;
                m[i] = b1 * m[i] + (1.0 - b1) * g;
                v[i] = b2 * v[i] + (1.0 - b2) * g * g;
                w[i] -= rate * (m[i] / c1) / ((v[i] / c2).sqrt() + 1e-8);
            }
            // Keep the first layer where its integers cannot overflow.
            w[..OUT].iter_mut().for_each(|x| *x = x.clamp(-1.98, 1.98));
        }
        println!(
            "epoch {epoch}: train {:.6}, held out {:.6}",
            loss(&w, &train_set[..held_out.len()]),
            loss(&w, held_out)
        );
    }

    let network = quantise(&w, scale);
    fs::write(&out, network.to_bytes()).unwrap_or_else(|e| panic!("cannot write {out}: {e}"));
    println!("wrote {out}");
}
