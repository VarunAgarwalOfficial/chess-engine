//! A small efficiently updatable neural network evaluation (NNUE), after
//! Yu Nasu's design in its simplest modern form: 768 inputs (colour, piece
//! and square, seen from each side) feed one hidden layer of `HIDDEN`
//! clipped linear units per side, and the two halves, the side to move's
//! first, feed one output.
//!
//! The first layer is a sum of one weight column per piece on the board,
//! so a move changes it by a few column additions; `Position` keeps those
//! sums (the accumulator) up to date. Weights are integers: the first
//! layer is scaled by `QA`, the output layer by `QB`.
//!
//! The network is optional. Without one installed the engine uses the
//! hand-written evaluation, and nothing here costs anything.

use std::sync::OnceLock;

use crate::bitboard::WHITE;

pub const INPUTS: usize = 768;
pub const HIDDEN: usize = 64;
pub const QA: i32 = 255;
pub const QB: i32 = 64;
const MAGIC: &[u8; 4] = b"CNN1";

/// The hidden layer before clipping, from White's and from Black's side.
pub type Accumulator = [[i16; HIDDEN]; 2];

pub struct Network {
    /// `INPUTS` columns of `HIDDEN` weights.
    pub feature_weights: Vec<i16>,
    pub feature_bias: [i16; HIDDEN],
    /// The side to move's half, then the other side's.
    pub output_weights: [i16; 2 * HIDDEN],
    pub output_bias: i32,
    /// Centipawns per unit of output.
    pub scale: i32,
}

static NETWORK: OnceLock<Network> = OnceLock::new();

/// The installed network, if any.
#[inline]
pub fn network() -> Option<&'static Network> {
    NETWORK.get()
}

/// Installs a network for the rest of the process. Positions created
/// afterwards carry accumulators and are evaluated by it.
pub fn install(bytes: &[u8]) -> Result<(), String> {
    let network = Network::from_bytes(bytes)?;
    NETWORK.set(network).map_err(|_| "a network is already installed".to_string())
}

/// The input a piece switches on, as seen by `perspective`.
#[inline]
pub fn feature(perspective: usize, colour: usize, piece: usize, sq: usize) -> usize {
    let sq = if perspective == WHITE { sq } else { sq ^ 56 };
    ((colour ^ perspective) * 6 + piece) * 64 + sq
}

impl Network {
    pub fn from_bytes(bytes: &[u8]) -> Result<Network, String> {
        let expected = 12 + 2 * (INPUTS * HIDDEN + HIDDEN + 2 * HIDDEN) + 4;
        if bytes.len() != expected || &bytes[..4] != MAGIC {
            return Err(format!("not a network file for this engine ({} bytes, expected {expected})", bytes.len()));
        }
        let int = |at: usize| i32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
        if int(4) != HIDDEN as i32 {
            return Err(format!("the network has {} hidden units, the engine {HIDDEN}", int(4)));
        }
        let mut words = bytes[12..expected - 4].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]));
        let feature_weights: Vec<i16> = words.by_ref().take(INPUTS * HIDDEN).collect();
        let mut feature_bias = [0; HIDDEN];
        feature_bias.iter_mut().for_each(|b| *b = words.next().unwrap_or(0));
        let mut output_weights = [0; 2 * HIDDEN];
        output_weights.iter_mut().for_each(|w| *w = words.next().unwrap_or(0));
        Ok(Network { feature_weights, feature_bias, output_weights, output_bias: int(expected - 4), scale: int(8) })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = MAGIC.to_vec();
        bytes.extend((HIDDEN as i32).to_le_bytes());
        bytes.extend(self.scale.to_le_bytes());
        let words = self.feature_weights.iter().chain(&self.feature_bias).chain(&self.output_weights);
        words.for_each(|w| bytes.extend(w.to_le_bytes()));
        bytes.extend(self.output_bias.to_le_bytes());
        bytes
    }

    /// The accumulator of an empty board.
    pub fn empty(&self) -> Accumulator {
        [self.feature_bias; 2]
    }

    #[inline]
    pub fn add(&self, accumulator: &mut Accumulator, colour: usize, piece: usize, sq: usize) {
        for (perspective, half) in accumulator.iter_mut().enumerate() {
            let at = feature(perspective, colour, piece, sq) * HIDDEN;
            for (a, w) in half.iter_mut().zip(&self.feature_weights[at..at + HIDDEN]) {
                *a += *w;
            }
        }
    }

    #[inline]
    pub fn remove(&self, accumulator: &mut Accumulator, colour: usize, piece: usize, sq: usize) {
        for (perspective, half) in accumulator.iter_mut().enumerate() {
            let at = feature(perspective, colour, piece, sq) * HIDDEN;
            for (a, w) in half.iter_mut().zip(&self.feature_weights[at..at + HIDDEN]) {
                *a -= *w;
            }
        }
    }

    /// Centipawns for the side to move.
    #[inline]
    pub fn evaluate(&self, accumulator: &Accumulator, side: usize) -> i32 {
        let mut sum = 0i32;
        for (half, weights) in [side, side ^ 1].into_iter().zip(self.output_weights.chunks_exact(HIDDEN)) {
            for (a, w) in accumulator[half].iter().zip(weights) {
                sum += (*a as i32).clamp(0, QA) * *w as i32;
            }
        }
        (sum + self.output_bias) * self.scale / (QA * QB)
    }
}
