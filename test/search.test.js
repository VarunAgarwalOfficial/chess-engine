import test from 'node:test';
import assert from 'node:assert/strict';
import { Position, START_FEN } from '../src/engine/board.js';
import { generateMoves } from '../src/engine/movegen.js';
import { evaluate } from '../src/engine/eval.js';
import { Searcher, MATE } from '../src/engine/search.js';
import { Game } from '../src/engine/game.js';
import { moveToUci } from '../src/engine/notation.js';
import { mirrorFen, seededRandom } from './helpers.js';

const searcher = new Searcher({ ttBits: 18 });

function best(fen, limits) {
  searcher.clear();
  const pos = new Position(fen);
  const result = searcher.search(pos, limits);
  assert.equal(pos.fen(), new Position(fen).fen(), 'search leaves the position unchanged');
  return { ...result, uci: moveToUci(result.move) };
}

test('evaluation is zero at the start and symmetric under colour swap', () => {
  assert.equal(evaluate(new Position(START_FEN)), 0);
  const random = seededRandom(99);
  for (let game = 0; game < 30; game++) {
    const pos = new Position(START_FEN);
    for (let ply = 0; ply < 80; ply++) {
      const moves = generateMoves(pos);
      if (moves.length === 0) break;
      pos.make(moves[Math.floor(random() * moves.length)]);
      const mirrored = new Position(mirrorFen(pos.fen()));
      assert.equal(evaluate(pos), evaluate(mirrored), pos.fen());
    }
  }
});

test('evaluation prefers more material and is from the mover\'s side', () => {
  const up = '4k3/8/8/8/8/8/8/Q3K3';
  assert.ok(evaluate(new Position(`${up} w - - 0 1`)) > 800);
  assert.ok(evaluate(new Position(`${up} b - - 0 1`)) < -800);
});

test('finds mate in one', () => {
  const r = best('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', { depth: 3 });
  assert.equal(r.uci, 'a1a8');
  assert.equal(r.score, MATE - 1);
});

test('finds mate in two', () => {
  // A queen sacrifice: 1.Qh6+ Kxh6 2.Bxf6 mate.
  const r = best('r1bq2r1/b4pk1/p1pp1p2/1p2pP2/1P2P1PB/3P4/1PPQ2P1/R3K2R w - - 0 1', { depth: 5 });
  assert.equal(r.uci, 'd2h6');
  assert.equal(r.score, MATE - 3);
});

test('finds mate in three', () => {
  const r = best('r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1', { depth: 7 });
  assert.equal(r.uci, 'f6a6');
  assert.equal(r.score, MATE - 5);
});

test('sees that it is being mated', () => {
  const r = best('6k1/5ppp/8/8/8/1r6/r7/6K1 w - - 0 1', { depth: 4 });
  assert.ok(r.score <= -MATE + 4, `score ${r.score}`);
});

test('takes a hanging queen and does not leave its own hanging', () => {
  assert.equal(best('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1', { depth: 4 }).uci, 'd2d5');
  const r = best('4k3/8/8/8/3r4/8/3Q4/4K3 w - - 0 1', { depth: 4 });
  assert.equal(r.uci, 'd2d4');
});

test('does not grab a defended pawn with the queen', () => {
  const r = best('4k3/2p5/3p4/8/8/8/8/3QK3 w - - 0 1', { depth: 4 });
  assert.notEqual(r.uci, 'd1d6');
});

test('avoids stalemate when winning', () => {
  // Qf7 would be stalemate; anything sensible keeps the win.
  const r = best('7k/8/6K1/8/8/8/5Q2/8 w - - 0 1', { depth: 4 });
  assert.ok(r.score > 500);
  assert.notEqual(r.uci, 'f2f7');
});

test('returns a legal move under every kind of limit', () => {
  const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  const legal = generateMoves(new Position(fen)).map(moveToUci);
  for (const limits of [{ depth: 1 }, { moveTime: 0 }, { moveTime: 30 }, { nodes: 1 }, { nodes: 5000 }]) {
    const r = best(fen, limits);
    assert.ok(legal.includes(r.uci), JSON.stringify(limits));
  }
  const stop = new Int32Array(new SharedArrayBuffer(4));
  Atomics.store(stop, 0, 1);
  const stopped = best(fen, { stop });
  assert.ok(legal.includes(stopped.uci));
  assert.equal(stopped.depth, 1, 'a raised stop flag ends the search after the first iteration');
});

test('reports no move when there is none', () => {
  assert.equal(best('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', { depth: 3 }).move, 0);
});

test('deeper search does not change a forced mate score (table mate scores are ply-adjusted)', () => {
  const pos = new Position('r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1');
  searcher.clear();
  const scores = [];
  searcher.search(pos, { depth: 9, onInfo: (info) => scores.push(info.score) });
  const mates = scores.filter((s) => s > MATE - 100);
  assert.ok(mates.length > 0);
  assert.ok(mates.every((s) => s === MATE - 5), scores.join(','));
});

function playOut(fen, maxPlies) {
  const game = new Game(fen);
  const engine = new Searcher({ ttBits: 18 });
  for (let ply = 0; ply < maxPlies && !game.status().over; ply++) {
    const { move } = engine.search(game.pos, { depth: 6 });
    assert.ok(game.play(move), 'engine move is legal');
  }
  return game.status();
}

test('mates with king and queen against king', () => {
  const status = playOut('8/8/8/3k4/8/8/8/KQ6 w - - 0 1', 60);
  assert.equal(status.reason, 'checkmate');
  assert.equal(status.result, 'white');
});

test('mates with king and rook against king', () => {
  const status = playOut('8/8/8/3k4/8/8/8/KR6 w - - 0 1', 80);
  assert.equal(status.reason, 'checkmate');
  assert.equal(status.result, 'white');
});

test('plays a whole game against itself without breaking any rule', () => {
  const game = new Game();
  const engine = new Searcher({ ttBits: 18 });
  let plies = 0;
  while (!game.status().over && plies < 300) {
    const { move } = engine.search(game.pos, { depth: 3 });
    assert.ok(game.play(move), `legal move at ply ${plies}`);
    assert.deepEqual([game.pos.hashLo, game.pos.hashHi], game.pos.computeHash());
    plies++;
  }
  assert.ok(plies > 20);
});
