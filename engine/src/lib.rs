//! A chess engine. Nothing in the library touches files or the network;
//! the UCI program, the match runner and the WebAssembly interface are thin
//! layers over it.

#![deny(unsafe_code)]

pub mod bitboard;
pub mod clock;
pub mod eval;
pub mod explain;
pub mod game;
pub mod movegen;
pub mod nnue;
pub mod notation;
pub mod position;
pub mod search;
pub mod tt;
pub mod uci;
pub mod wasm;
pub mod weights;
