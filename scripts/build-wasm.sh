#!/bin/sh
# Builds the engine for the browser and writes web/engine.wasm.
# Needs the wasm32-unknown-unknown target for Rust (rustup target add
# wasm32-unknown-unknown, or the distribution's package for it), and uses
# wasm-opt from binaryen when it is installed.
set -eu
cd "$(dirname "$0")/.."
cargo build --manifest-path engine/Cargo.toml --release --lib --target wasm32-unknown-unknown
built=engine/target/wasm32-unknown-unknown/release/chess.wasm
if command -v wasm-opt >/dev/null; then
  wasm-opt -O3 --strip-debug --strip-producers -o web/engine.wasm "$built"
else
  cp "$built" web/engine.wasm
fi
ls -l web/engine.wasm
