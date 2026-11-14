#!/usr/bin/env node
// Counts move paths from a position, split by first move.
//   node bin/perft.js <depth> [fen]

import { Position, START_FEN } from '../src/engine/board.js';
import { generateMoves, perft } from '../src/engine/movegen.js';
import { moveToUci } from '../src/engine/notation.js';

const depth = Number(process.argv[2]);
const fen = process.argv.slice(3).join(' ') || START_FEN;
if (!Number.isInteger(depth) || depth < 1) {
  console.error('usage: node bin/perft.js <depth> [fen]');
  process.exit(1);
}

let pos;
try {
  pos = new Position(fen);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const started = Date.now();
let total = 0;
for (const m of generateMoves(pos)) {
  pos.make(m);
  const count = perft(pos, depth - 1);
  pos.unmake(m);
  total += count;
  console.log(`${moveToUci(m)}: ${count}`);
}
const seconds = (Date.now() - started) / 1000;
console.log(`\nnodes ${total}  time ${seconds.toFixed(2)}s`);
