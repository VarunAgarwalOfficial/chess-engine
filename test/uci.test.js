import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/uci.js', import.meta.url));

// Starts the real program and gives line-level access to it.
function startEngine() {
  const child = spawn(process.execPath, [cli], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = [];
  const waiters = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    for (const line of parts) {
      lines.push(line);
      for (const w of [...waiters]) {
        if (!line.startsWith(w.prefix)) continue;
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(line);
      }
    }
  });
  return {
    lines,
    send: (text) => child.stdin.write(`${text}\n`),
    waitFor: (prefix) => new Promise((resolve) => waiters.push({ prefix, resolve })),
    end: () =>
      new Promise((resolve) => {
        child.on('exit', resolve);
        child.stdin.end();
      }),
  };
}

test('handshake, a mate score, and repetition history from the move list', async () => {
  const engine = startEngine();
  engine.send('uci');
  await engine.waitFor('uciok');

  engine.send('position fen 6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
  engine.send('go depth 4');
  assert.equal(await engine.waitFor('bestmove'), 'bestmove a1a8');
  assert.ok(engine.lines.some((l) => l.includes('score mate 1')));

  // White has a rook against a queen. The moves shuffle there and back, so
  // the position after Ra2 has occurred before; playing it again is a draw
  // the engine can only know about from the move list.
  engine.send('position fen 3q3k/8/8/8/8/8/8/R6K w - - 0 1 moves a1a2 d8d7 a2a1 d7d8');
  engine.send('go depth 4');
  assert.equal(await engine.waitFor('bestmove'), 'bestmove a1a2');
  assert.ok(engine.lines.at(-2).includes('score cp 0 '), engine.lines.at(-2));
  await engine.end();
});

test('answers during a search, and stop ends it at once', async () => {
  const engine = startEngine();
  engine.send('position startpos moves e2e4');
  engine.send('go infinite');
  await engine.waitFor('info depth 6');
  engine.send('isready');
  await engine.waitFor('readyok');
  assert.ok(!engine.lines.some((l) => l.startsWith('bestmove')), 'still searching');
  const started = Date.now();
  engine.send('stop');
  assert.match(await engine.waitFor('bestmove'), /^bestmove [a-h][1-8][a-h][1-8]$/);
  assert.ok(Date.now() - started < 1000);
  await engine.end();
});
