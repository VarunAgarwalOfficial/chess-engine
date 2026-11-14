import test from 'node:test';
import assert from 'node:assert/strict';
import { Position, START_FEN } from '../src/engine/board.js';
import { generateMoves } from '../src/engine/movegen.js';
import { moveToUci } from '../src/engine/notation.js';
import { referenceMoves, seededRandom } from './helpers.js';

const uciMoves = (fen) => generateMoves(new Position(fen)).map(moveToUci).sort();
const sorted = (moves) => moves.map(moveToUci).sort();

test('the pin-and-check generator agrees with play-and-verify over random games', () => {
  const random = seededRandom(2021);
  const starts = [
    START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  ];
  let checked = 0;
  for (let game = 0; game < 120; game++) {
    const pos = new Position(starts[game % starts.length]);
    for (let ply = 0; ply < 120; ply++) {
      const moves = generateMoves(pos);
      assert.deepEqual(sorted(moves), sorted(referenceMoves(pos)), pos.fen());
      const tactical = generateMoves(pos, true);
      for (const m of tactical)
        assert.ok(moves.includes(m), `tactical move is legal: ${pos.fen()}`);
      checked++;
      if (moves.length === 0) break;
      pos.make(moves[Math.floor(random() * moves.length)]);
    }
  }
  assert.ok(checked > 5000, `only ${checked} positions checked`);
});

test('make and unmake restore the position and keep the hash in step', () => {
  const random = seededRandom(7);
  for (let game = 0; game < 40; game++) {
    const pos = new Position(START_FEN);
    const played = [];
    const fens = [pos.fen()];
    for (let ply = 0; ply < 150; ply++) {
      const moves = generateMoves(pos);
      if (moves.length === 0) break;
      const m = moves[Math.floor(random() * moves.length)];
      pos.make(m);
      played.push(m);
      fens.push(pos.fen());
      assert.deepEqual([pos.hashLo, pos.hashHi], pos.computeHash(), pos.fen());
    }
    while (played.length) {
      pos.unmake(played.pop());
      fens.pop();
      assert.equal(pos.fen(), fens[fens.length - 1]);
      assert.deepEqual([pos.hashLo, pos.hashHi], pos.computeHash());
    }
  }
});

test('the same position reached by different move orders has the same hash', () => {
  const a = new Position(START_FEN);
  const b = new Position(START_FEN);
  const play = (pos, list) => {
    for (const text of list) pos.make(generateMoves(pos).find((m) => moveToUci(m) === text));
  };
  play(a, ['g1f3', 'g8f6', 'b1c3', 'b8c6']);
  play(b, ['b1c3', 'b8c6', 'g1f3', 'g8f6']);
  assert.deepEqual([a.hashLo, a.hashHi], [b.hashLo, b.hashHi]);
});

test('double check allows only king moves', () => {
  // Knight on f6 and rook on e1 both check the king on e8.
  const moves = uciMoves('4k3/8/5N2/8/8/8/8/4R1K1 b - - 0 1');
  assert.ok(moves.length > 0);
  assert.ok(moves.every((m) => m.startsWith('e8')));
});

test('a king cannot step back along the line of a checking slider', () => {
  const moves = uciMoves('8/8/8/8/R3k3/8/8/4K3 b - - 0 1');
  assert.ok(!moves.includes('e4f4'));
  assert.ok(!moves.includes('e4d4'));
  assert.ok(moves.includes('e4e5'));
});

test('a pinned piece may only move along the pin', () => {
  // The rook on e4 is pinned on the e-file by the rook on e8.
  const moves = uciMoves('4r2k/8/8/8/4R3/8/8/4K3 w - - 0 1').filter((m) => m.startsWith('e4'));
  assert.deepEqual(moves, ['e4e2', 'e4e3', 'e4e5', 'e4e6', 'e4e7', 'e4e8']);
  // A pinned knight cannot move at all.
  const knight = uciMoves('4r2k/8/8/8/4N3/8/8/4K3 w - - 0 1').filter((m) => m.startsWith('e4'));
  assert.deepEqual(knight, []);
});

test('en passant: allowed, and refused when it would expose the king', () => {
  assert.ok(uciMoves('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1').includes('e5d6'));
  // Both pawns leave the fifth rank, opening the rook's line to the king.
  assert.ok(!uciMoves('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1').includes('e5d6'));
  // The capturing pawn is pinned on the e-file.
  assert.ok(!uciMoves('4r2k/8/8/3pP3/8/8/8/4K3 w - d6 0 1').includes('e5d6'));
  // The pawn that just moved gives check; taking it en passant is an answer.
  assert.ok(uciMoves('8/8/8/3pP3/4K3/8/8/7k w - d6 0 1').includes('e5d6'));
});

test('castling rules', () => {
  const both = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  assert.ok(uciMoves(both).includes('e1g1'));
  assert.ok(uciMoves(both).includes('e1c1'));
  // Not out of check.
  const inCheck = uciMoves('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1');
  assert.ok(!inCheck.includes('e1g1') && !inCheck.includes('e1c1'));
  // Not through an attacked square.
  const through = uciMoves('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');
  assert.ok(!through.includes('e1g1'));
  assert.ok(through.includes('e1c1'));
  // Queenside is fine when only b1 is attacked.
  const bFile = uciMoves('1r2k3/8/8/8/8/8/8/R3K3 w Q - 0 1');
  assert.ok(bFile.includes('e1c1'));
  // Not when a piece stands between king and rook.
  assert.ok(!uciMoves('4k3/8/8/8/8/8/8/RN2K3 w Q - 0 1').includes('e1c1'));
});

test('castling rights are lost when the king or a rook moves or the rook is taken', () => {
  const pos = new Position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const play = (text) => pos.make(generateMoves(pos).find((m) => moveToUci(m) === text));
  play('a1a8'); // takes the a8 rook: White loses Q, Black loses q
  assert.equal(pos.fen().split(' ')[2], 'Kk');
  play('e8e7');
  assert.equal(pos.fen().split(' ')[2], 'K');
  play('h1h2');
  assert.equal(pos.fen().split(' ')[2], '-');
});

test('promotion offers four pieces, also when capturing', () => {
  const moves = uciMoves('1n5k/P7/8/8/8/8/8/K7 w - - 0 1').filter((m) => m.startsWith('a7'));
  assert.deepEqual(moves, ['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r', 'a7b8b', 'a7b8n', 'a7b8q', 'a7b8r']);
});

test('FEN round trip and validation', () => {
  for (const fen of [
    START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 12',
  ]) {
    assert.equal(new Position(fen).fen(), fen);
  }
  // An en passant square nobody can use is dropped.
  assert.equal(
    new Position('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1').fen(),
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  );
  assert.throws(() => new Position('8/8/8/8/8/8/8/8 w - - 0 1'), /king/);
  assert.throws(() => new Position('k7/8/8/8/8/8/8/K6 w - - 0 1'), /rank/);
  assert.throws(() => new Position('k7/8/8/8/8/8/8/K7 x - - 0 1'), /side/);
  // White to move while Black's king is already attacked.
  assert.throws(() => new Position('k7/R7/8/8/8/8/8/K7 w - - 0 1'), /check/);
  assert.throws(() => new Position('nonsense'));
});
