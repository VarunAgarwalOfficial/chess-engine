import test from 'node:test';
import assert from 'node:assert/strict';
import { Position, START_FEN } from '../src/engine/board.js';
import { evaluate } from '../src/engine/eval.js';
import { Searcher, MATE } from '../src/engine/search.js';
import { Game } from '../src/engine/game.js';
import { moveToUci } from '../src/engine/notation.js';

const searcher = new Searcher({ ttBits: 18 });

function best(fen, limits) {
  searcher.clear();
  const result = searcher.search(new Position(fen), limits);
  return { ...result, uci: moveToUci(result.move) };
}

test('evaluation is level at the start and counts material for the mover', () => {
  assert.equal(evaluate(new Position(START_FEN)), 0);
  assert.ok(evaluate(new Position('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1')) > 800);
  assert.ok(evaluate(new Position('4k3/8/8/8/8/8/8/Q3K3 b - - 0 1')) < -800);
});

test('finds forced mates in one, two and three', () => {
  const one = best('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', { depth: 3 });
  assert.deepEqual([one.uci, one.score], ['a1a8', MATE - 1]);
  // A queen sacrifice: 1.Qh6+ Kxh6 2.Bxf6 mate.
  const two = best('r1bq2r1/b4pk1/p1pp1p2/1p2pP2/1P2P1PB/3P4/1PPQ2P1/R3K2R w - - 0 1', {
    depth: 5,
  });
  assert.deepEqual([two.uci, two.score], ['d2h6', MATE - 3]);
  const three = best('r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1', { depth: 7 });
  assert.deepEqual([three.uci, three.score], ['f6a6', MATE - 5]);
});

test('takes a hanging queen', () => {
  assert.equal(best('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1', { depth: 4 }).uci, 'd2d5');
});

test('always returns a legal move, however tight the limit', () => {
  for (const limits of [{ moveTime: 0 }, { nodes: 1 }, { depth: 1 }]) {
    const game = new Game();
    assert.ok(game.play(best(START_FEN, limits).move), JSON.stringify(limits));
  }
});

test('mates with king and rook against king', () => {
  const game = new Game('8/8/8/3k4/8/8/8/KR6 w - - 0 1');
  const engine = new Searcher({ ttBits: 18 });
  for (let ply = 0; ply < 80 && !game.status().over; ply++) {
    assert.ok(game.play(engine.search(game.pos, { depth: 6 }).move));
  }
  assert.deepEqual([game.status().reason, game.status().result], ['checkmate', 'white']);
});
