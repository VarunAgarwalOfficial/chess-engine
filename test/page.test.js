import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../web/engine.js';
import { Game, boardField, cannotMate, parseBoard } from '../web/game.js';
import { gameFromPgn, toPgn } from '../web/pgn.js';
import { LINES, findOpening } from '../web/eco.js';
import { Clock, formatClock } from '../web/clock.js';
import { formatScore, reviewMoves, whiteCp } from '../web/review.js';
import { describeOutcome, describeStatus, pickMove } from '../web/text.js';

// The real engine.wasm, loaded the way the page loads it.
const engine = await loadEngine(await readFile(new URL('../web/engine.wasm', import.meta.url)));

test('the page plays a game through the WebAssembly engine', () => {
  const game = new Game(engine);
  assert.equal(game.legalMoves().length, 20);
  assert.equal(game.play('e2e5'), null);
  for (const uci of ['f2f3', 'e7e5', 'g2g4']) assert.ok(game.play(uci), uci);
  assert.equal(parseBoard(game.fen()).get('e5'), 'bp');
  assert.equal(boardField(parseBoard(game.fen())), game.fen().split(' ')[0]);

  // The engine finds the mate, names its line, and the rules agree.
  const reply = engine.go(game.startFen, game.ucis(), 'depth 4');
  assert.deepEqual([reply.best, reply.mate, reply.san], ['d8h4', 1, ['Qh4#']]);
  assert.equal(formatScore(whiteCp(reply, false)), '-M1');
  assert.equal(game.play(reply.best).san, 'Qh4#');
  assert.equal(describeStatus(game.status(), game.turn), 'Checkmate. Black wins.');
  assert.equal(game.play('a2a3'), null);

  // Looking back, taking back, and ending a game off the board.
  assert.equal(game.stateAt(1).turn, 'black');
  game.undo();
  assert.equal(game.status().over, false);
  game.ending = { result: 'black', reason: 'resignation' };
  assert.equal(describeStatus(game.status(), game.turn), 'White resigned. Black wins.');
  assert.deepEqual(Game.fromJSON(engine, game.toJSON()).status(), game.status());
  assert.throws(() => new Game(engine, '8/8/8/8/8/8/8/8 w - - 0 1'), /king/);
});

test('PGN goes out with headers and comes back, variations and comments ignored', () => {
  const text = `[Event "Test"]
[White "A \\"quoted\\" name"]
[Result "1-0"]

1. e4 {best by test} e5 2. Nf3 (2. f4 exf4 (2... d5) 3. Nf3) 2... Nc6 $1 3. Bb5 a6
4. Ba4 Nf6 5. 0-0 Be7!? ; the closed line
6. Re1 b5 7. Bb3 d6 1-0`;
  const { game, headers } = gameFromPgn(engine, text);
  assert.equal(headers.White, 'A "quoted" name');
  assert.equal(game.sans().join(' '), 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6');
  assert.equal(describeStatus(game.status(), game.turn), 'White won.');
  assert.equal(findOpening(game.sans()).name, 'Ruy Lopez, Closed');

  const out = toPgn(game, { White: headers.White, Black: 'B' });
  assert.match(
    out,
    /\[White "A \\"quoted\\" name"\]\n\[Black "B"\]\n\[Result "1-0"\]\n\n1\. e4 e5 /,
  );
  assert.equal(gameFromPgn(engine, out).game.fen(), game.fen());

  // From a set-up position with Black to move, and a move that is not legal.
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 2';
  const black = new Game(engine, fen);
  black.play('g8f6');
  assert.match(toPgn(black), /\[SetUp "1"\]\n\[FEN "r1bq.* 2 2"\]\n\n2\.\.\. Nf6 \*/);
  assert.equal(gameFromPgn(engine, toPgn(black)).game.fen(), black.fen());
  assert.throws(() => gameFromPgn(engine, '1. e4 e5 2. Ke3'), /Move 2 \(Ke3\) is not legal/);
});

test('a review marks the moves that threw away winning chances', () => {
  // White is level, blunders a piece on move 2, and Black then lets it go.
  const evals = [20, 30, 25, -400, 0];
  const best = ['e2e4', 'e7e5', 'g1f3', 'd8h4', null];
  const played = ['e2e4', 'e7e5', 'f1a6', 'a7a5'];
  const { moves, white, black } = reviewMoves(evals, best, played);
  assert.deepEqual(
    moves.map((m) => m.mark),
    [null, null, 'blunder', 'blunder'],
  );
  assert.deepEqual([white.blunder, black.blunder, white.inaccuracy], [1, 1, 0]);
  assert.ok(white.accuracy < 80 && white.accuracy > 20);
  // The engine's own choice is never marked, whatever the scores say.
  assert.equal(reviewMoves([0, -500], ['e2e4'], ['e2e4']).moves[0].mark, null);
});

test('the clock counts down for the side to move and adds the increment', () => {
  let now = 0;
  const clock = new Clock(60000, 2000, () => now);
  clock.start('white');
  now = 5000;
  clock.press('white');
  assert.deepEqual([clock.remaining('white'), clock.running], [57000, 'black']);
  const snapshot = clock.snapshot();
  now = 70000;
  assert.equal(clock.flagged(), 'black');
  clock.restore(snapshot);
  assert.equal(clock.flagged(), null);
  assert.deepEqual([60000, 9400, 3725000].map(formatClock), ['1:00', '0:09.4', '1:02:05']);
});

test('a flag fall is a draw when the other side could never give mate', () => {
  // Asked of the engine, with the side that ran out of time reduced to its king.
  const rookVersusKnight = '4k3/8/8/8/8/8/R7/4K1n1 w - - 0 1';
  assert.equal(cannotMate(engine, rookVersusKnight, 'black'), true);
  assert.equal(cannotMate(engine, rookVersusKnight, 'white'), false);
  // A pawn is enough, and so is a knight that is giving check at the time.
  assert.equal(cannotMate(engine, '4k3/8/8/8/8/8/p6R/4K3 w - - 0 1', 'black'), false);
  assert.equal(cannotMate(engine, '4k3/8/8/8/8/3n4/R7/4K3 w - - 0 1', 'black'), true);

  const drawn = { over: true, result: 'draw', reason: 'time', side: 'white' };
  assert.equal(describeStatus(drawn, 'white'), 'White ran out of time. Draw.');
  assert.deepEqual(describeOutcome(drawn, 'white'), {
    title: 'Draw',
    detail: 'White ran out of time, but Black has too little left to give mate.',
  });
  const repeated = { over: true, result: 'draw', reason: 'threefold repetition' };
  assert.equal(describeOutcome(repeated, 'black').title, 'Draw by repetition');
  const lost = { over: true, result: 'black', reason: 'time' };
  assert.deepEqual(describeOutcome(lost, 'white'), {
    title: 'You lost',
    detail: 'White ran out of time.',
  });
});

test('every line of the opening table can be played', () => {
  for (const [moves, { eco }] of LINES) {
    const game = new Game(engine);
    for (const word of moves.split(' ')) {
      const move = game.legalMoves().find((m) => m.san.replace(/[+#]/g, '') === word);
      assert.ok(move, `${eco}: ${word} in "${moves}"`);
      game.play(move.uci);
    }
    assert.match(eco, /^[A-E]\d\d$/);
  }
});

test('a weak level plays noisily but never passes up a mate', () => {
  const scores = [
    { uci: 'a2a3', score: 10 },
    { uci: 'd1h5', score: 31999 },
    { uci: 'e2e4', score: 40 },
  ];
  assert.equal(pickMove(scores, 300), 'd1h5');
  const quiet = scores.filter((s) => s.score < 1000);
  assert.equal(pickMove(quiet, 0), 'e2e4');
  // With noise the worse move is sometimes chosen: here the random numbers favour it.
  const numbers = [1, 1, 0, 0];
  assert.equal(
    pickMove(quiet, 300, () => numbers.shift()),
    'a2a3',
  );
});

test('explain searches every move and names the threat', () => {
  // Scholar's mate threatened: Black to move must stop Qxf7#.
  const moves = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5'];
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const { depth, moves: choices, threat } = engine.explain(start, moves, 3);
  assert.equal(depth, 3);
  assert.equal(choices.length, engine.describe(start, moves).moves.length);
  assert.deepEqual([threat.san[0], threat.mate], ['Qxf7#', -1]);
  const scores = choices.map((c) => c.score);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a),
  );
  assert.ok(choices[0].mate === null || choices[0].mate > 0, choices[0].san.join(' '));
  assert.ok(choices.at(-1).mate < 0, 'some move allows the mate');
});
