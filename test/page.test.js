import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../web/engine.js';
import { Game } from '../web/game.js';
import { describeScore } from '../web/format.js';

// The real engine.wasm, loaded the way the page loads it.
const engine = await loadEngine(await readFile(new URL('../web/engine.wasm', import.meta.url)));

test('the page plays a game through the WebAssembly engine', () => {
  const game = new Game(engine);
  assert.equal(game.legalMoves().length, 20);
  assert.equal(game.play('e2e5'), null);
  for (const uci of ['f2f3', 'e7e5', 'g2g4']) assert.ok(game.play(uci), uci);
  assert.equal(game.pieces().get('e5').colour, 'black');

  // The engine finds the mate, and the rules agree that it is one.
  const moves = game.history.map((h) => h.uci);
  const reply = engine.think(game.startFen, moves, 200);
  assert.deepEqual([reply.best, reply.mate], ['d8h4', 1]);
  assert.equal(describeScore(reply, false), 'Black mates in 1');
  assert.equal(game.play(reply.best).san, 'Qh4#');
  assert.deepEqual(game.status(), {
    over: true,
    result: 'black',
    reason: 'checkmate',
    check: true,
  });
  assert.equal(game.play('a2a3'), null);

  game.undo();
  assert.equal(game.status().over, false);
  assert.throws(() => new Game(engine, '8/8/8/8/8/8/8/8 w - - 0 1'), /king/);
});
