import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, positionFromMoves } from '../src/engine/game.js';
import { Position } from '../src/engine/board.js';
import { findMove, moveToSan } from '../src/engine/notation.js';

function playAll(game, moves) {
  for (const text of moves) assert.ok(game.play(text), `move ${text} should be legal`);
}

test("fool's mate is checkmate for Black", () => {
  const game = new Game();
  playAll(game, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
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
  assert.equal(game.play('a2a3'), null, 'no moves after the game is over');
});

test('stalemate is a draw', () => {
  const game = new Game('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.deepEqual(game.status(), {
    over: true,
    result: 'draw',
    reason: 'stalemate',
    check: false,
  });
});

test('threefold repetition is a draw, twofold is not', () => {
  const game = new Game();
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  playAll(game, shuffle);
  assert.equal(game.status().over, false);
  playAll(game, shuffle);
  assert.equal(game.status().reason, 'threefold repetition');
  game.undo();
  assert.equal(game.status().over, false);
});

test('a lost castling right makes the position different for repetition', () => {
  const game = new Game('r3k3/8/8/8/8/8/8/R3K3 w Qq - 0 1');
  // The rooks leave and return: same squares, but the rights are gone, so
  // the starting position has occurred only once.
  playAll(game, ['a1a2', 'a8a7', 'a2a1', 'a7a8', 'a1a2', 'a8a7', 'a2a1', 'a7a8']);
  assert.equal(game.pos.repetitionCount(), 2);
  assert.equal(game.status().over, false);
});

test('fifty-move rule, and checkmate takes precedence over it', () => {
  const draw = new Game('7k/8/8/8/8/8/8/KR6 w - - 99 80');
  assert.equal(draw.status().over, false);
  draw.play('b1b2');
  assert.equal(draw.status().reason, 'fifty-move rule');

  const mate = new Game('7k/8/6K1/8/8/8/8/1R6 w - - 99 80');
  mate.play('b1b8');
  assert.equal(mate.status().reason, 'checkmate');
  assert.equal(mate.status().result, 'white');
});

test('a pawn move or capture resets the fifty-move counter', () => {
  const game = new Game('7k/8/8/8/8/8/P7/K7 w - - 99 80');
  game.play('a2a3');
  assert.equal(game.pos.halfmove, 0);
  assert.equal(game.status().over, false);
});

test('insufficient material', () => {
  const dead = [
    '8/8/4k3/8/8/4K3/8/8 w - - 0 1', // bare kings
    '8/8/4k3/8/8/4KN2/8/8 w - - 0 1', // one knight
    '8/8/4k3/8/8/4KB2/8/8 w - - 0 1', // one bishop
    '8/5b2/4k3/8/8/4KB2/8/8 w - - 0 1', // bishops on the same colour (f3, f7)
  ];
  for (const fen of dead) assert.equal(new Game(fen).status().reason, 'insufficient material', fen);
  const alive = [
    '8/4b3/4k3/8/8/4KB2/8/8 w - - 0 1', // bishops on opposite colours
    '8/8/4k3/8/8/4KNN1/8/8 w - - 0 1', // two knights can still mate with help
    '8/8/4k3/8/8/4KP2/8/8 w - - 0 1',
    '8/8/4k3/8/8/4KR2/8/8 w - - 0 1',
  ];
  for (const fen of alive) assert.equal(new Game(fen).status().over, false, fen);
});

test('undo restores the previous position exactly', () => {
  const game = new Game();
  const before = game.fen();
  playAll(game, ['e2e4', 'd7d5', 'e4d5']);
  game.undo();
  game.undo();
  game.undo();
  assert.equal(game.fen(), before);
  assert.equal(game.undo(), null);
});

test('illegal and malformed moves are refused', () => {
  const game = new Game();
  assert.equal(game.play('e2e5'), null);
  assert.equal(game.play('nonsense'), null);
  assert.equal(game.play(12345), null);
  assert.equal(game.history.length, 0);
});

test('movesFrom lists the moves of one square', () => {
  const game = new Game();
  assert.equal(game.movesFrom('e2').length, 2);
  assert.equal(game.movesFrom('e1').length, 0);
  assert.equal(game.movesFrom('g1').length, 2);
});

test('SAN: disambiguation, captures, castling, promotion, en passant', () => {
  const san = (fen, uci) => {
    const pos = new Position(fen);
    return moveToSan(pos, findMove(pos, uci));
  };
  assert.equal(san('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1g1'), 'O-O');
  assert.equal(san('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'e1c1'), 'O-O-O');
  assert.equal(san('4k3/8/8/8/8/8/4K3/R6R w - - 0 1', 'a1d1'), 'Rad1');
  assert.equal(san('R7/7k/8/8/8/8/8/R3K3 w - - 0 1', 'a1a4'), 'R1a4');
  assert.equal(san('6k1/8/8/8/Q2Q4/8/8/Q3K3 w - - 0 1', 'a4d1'), 'Qa4d1');
  assert.equal(san('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4d5'), 'exd5');
  assert.equal(san('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6'), 'exd6');
  assert.equal(san('7k/P7/8/8/8/8/8/K7 w - - 0 1', 'a7a8q'), 'a8=Q+');
  assert.equal(san('1n5k/P7/8/8/8/8/8/K7 w - - 0 1', 'a7b8n'), 'axb8=N');
  assert.equal(san('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', 'a1a8'), 'Ra8#');
});

test('positionFromMoves rebuilds history and rejects illegal moves', () => {
  const pos = positionFromMoves(undefined, ['g1f3', 'g8f6', 'f3g1', 'f6g8']);
  assert.equal(pos.repetitionCount(), 2);
  assert.throws(() => positionFromMoves(undefined, ['e2e5']), /Illegal move/);
});
