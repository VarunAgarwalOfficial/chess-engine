import test from 'node:test';
import assert from 'node:assert/strict';
import { Position } from '../src/engine/board.js';
import { perft } from '../src/engine/movegen.js';

// Node counts from https://www.chessprogramming.org/Perft_Results
const POSITIONS = [
  {
    name: 'start position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    counts: [20, 400, 8902, 197281, 4865609],
  },
  {
    name: 'position 2 (Kiwipete)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    counts: [48, 2039, 97862, 4085603, 193690690],
  },
  {
    name: 'position 3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    counts: [14, 191, 2812, 43238, 674624],
  },
  {
    name: 'position 4',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    counts: [6, 264, 9467, 422333, 15833292],
  },
  {
    name: 'position 5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    counts: [44, 1486, 62379, 2103487, 89941194],
  },
  {
    name: 'position 6',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    counts: [46, 2079, 89890, 3894594, 164075551],
  },
];

// The default run stops at five million nodes per position so the
// suite stays quick. PERFT_DEEP=1 runs every depth listed.
const limit = process.env.PERFT_DEEP ? Infinity : 5_000_000;

for (const { name, fen, counts } of POSITIONS) {
  test(`perft: ${name}`, () => {
    const pos = new Position(fen);
    counts.forEach((expected, i) => {
      if (expected > limit) return;
      assert.equal(perft(pos, i + 1), expected, `depth ${i + 1}`);
    });
    assert.equal(pos.fen(), new Position(fen).fen(), 'position restored after perft');
  });
}
