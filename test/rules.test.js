import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.js';
import { Position } from '../src/engine/board.js';
import { generateMoves } from '../src/engine/movegen.js';
import { moveToUci } from '../src/engine/notation.js';

const moves = (fen) => generateMoves(new Position(fen)).map(moveToUci);

function play(game, list) {
  for (const text of list.split(' ')) assert.ok(game.play(text), `${text} should be legal`);
}

test('checkmate, with moves written in algebraic notation', () => {
  const game = new Game();
  play(game, 'f2f3 e7e5 g2g4 d8h4');
  assert.deepEqual(game.status(), {
    over: true,
    result: 'black',
    reason: 'checkmate',
    check: true,
  });
  assert.deepEqual(
    game.history.map((h) => h.san),
    ['f3', 'e5', 'g4', 'Qh4#'],
  );
  assert.equal(game.play('a2a3'), null);
});

test('stalemate and insufficient material are draws', () => {
  assert.equal(new Game('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status().reason, 'stalemate');
  assert.equal(new Game('8/8/4k3/8/8/4KN2/8/8 w - - 0 1').status().reason, 'insufficient material');
  assert.equal(new Game('8/8/4k3/8/8/4KP2/8/8 w - - 0 1').status().over, false);
});

test('threefold repetition is a draw, and undo takes it back', () => {
  const game = new Game();
  play(game, 'g1f3 g8f6 f3g1 f6g8');
  assert.equal(game.status().over, false);
  play(game, 'g1f3 g8f6 f3g1 f6g8');
  assert.equal(game.status().reason, 'threefold repetition');
  game.undo();
  assert.equal(game.status().over, false);
});

test('fifty-move rule, but checkmate on the same move still wins', () => {
  const draw = new Game('7k/8/8/8/8/8/8/KR6 w - - 99 80');
  draw.play('b1b2');
  assert.equal(draw.status().reason, 'fifty-move rule');
  const mate = new Game('7k/8/6K1/8/8/8/8/1R6 w - - 99 80');
  mate.play('b1b8');
  assert.equal(mate.status().reason, 'checkmate');
});

test('en passant is refused when it would expose the king', () => {
  assert.ok(moves('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1').includes('e5d6'));
  // Both pawns leave the fifth rank, opening the rook's line to the king.
  assert.ok(!moves('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1').includes('e5d6'));
});

test('castling: not through check, but the b-file square may be attacked', () => {
  const through = moves('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');
  assert.ok(!through.includes('e1g1') && through.includes('e1c1'));
  assert.ok(moves('1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1').includes('e1c1'));
});

test('the hash is kept in step through moves and undo', () => {
  const game = new Game('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  play(game, 'e1g1 b4c3 d5e6 e8c8 e6d7 c8b8 a2a4 c3b2');
  assert.deepEqual([game.pos.hashLo, game.pos.hashHi], game.pos.computeHash());
  while (game.undo());
  assert.equal(game.fen(), game.startFen);
  assert.deepEqual([game.pos.hashLo, game.pos.hashHi], game.pos.computeHash());
});

test('a bad FEN is rejected', () => {
  assert.throws(() => new Position('8/8/8/8/8/8/8/8 w - - 0 1'), /king/);
  assert.throws(() => new Position('not a fen'));
});
