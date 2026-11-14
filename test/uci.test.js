import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WHITE, BLACK, START_FEN } from '../src/engine/board.js';
import { MATE } from '../src/engine/search.js';
import {
  UciSession,
  formatInfo,
  formatScore,
  parseGo,
  parsePosition,
  searchLimits,
} from '../src/uci/protocol.js';

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
        if (w.match(line)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(line);
        }
      }
    }
  });
  return {
    lines,
    send: (text) => child.stdin.write(`${text}\n`),
    // Resolves with the next line, from now on, that starts with `prefix`.
    waitFor: (prefix) =>
      new Promise((resolve) => waiters.push({ match: (l) => l.startsWith(prefix), resolve })),
    end: () =>
      new Promise((resolve) => {
        child.on('exit', resolve);
        child.stdin.end();
      }),
  };
}

test('parsePosition', () => {
  assert.deepEqual(parsePosition(['startpos']), { fen: START_FEN, moves: [] });
  assert.deepEqual(parsePosition(['startpos', 'moves', 'e2e4', 'e7e5']), {
    fen: START_FEN,
    moves: ['e2e4', 'e7e5'],
  });
  const fen = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
  assert.deepEqual(parsePosition(['fen', ...fen.split(' '), 'moves', 'e1g1']), {
    fen,
    moves: ['e1g1'],
  });
  assert.throws(() => parsePosition(['banana']));
});

test('parseGo and time allocation', () => {
  assert.deepEqual(parseGo(['depth', '7']), { infinite: false, depth: 7 });
  assert.equal(parseGo(['infinite']).infinite, true);
  assert.deepEqual(searchLimits(parseGo(['movetime', '250']), WHITE), { moveTime: 250 });
  assert.deepEqual(searchLimits(parseGo(['nodes', '1000']), WHITE), { nodes: 1000 });
  assert.deepEqual(searchLimits(parseGo(['infinite']), WHITE), {});

  const go = parseGo('wtime 60000 btime 3000 winc 1000 binc 0'.split(' '));
  const white = searchLimits(go, WHITE);
  const black = searchLimits(go, BLACK);
  assert.ok(white.softTime > black.softTime, 'more clock, more thinking');
  assert.ok(white.moveTime < 60000 / 4 && white.softTime <= white.moveTime);
  assert.ok(black.moveTime <= 1500, 'never more than half the remaining time');
  // Almost no time left: still a positive, tiny budget.
  const panic = searchLimits(parseGo('wtime 20 btime 20'.split(' ')), WHITE);
  assert.ok(panic.moveTime > 0 && panic.moveTime <= 1);
});

test('score and info formatting', () => {
  assert.equal(formatScore(35), 'cp 35');
  assert.equal(formatScore(MATE - 1), 'mate 1');
  assert.equal(formatScore(MATE - 5), 'mate 3');
  assert.equal(formatScore(-MATE + 4), 'mate -2');
  assert.equal(
    formatInfo({ depth: 3, score: 12, nodes: 500, time: 10, pv: ['e2e4', 'e7e5'] }),
    'info depth 3 score cp 12 nodes 500 nps 50000 time 10 pv e2e4 e7e5',
  );
});

test('session: handshake, bad input, and a search through a stub backend', async () => {
  const out = [];
  const jobs = [];
  const backend = {
    go: async (job) => {
      jobs.push(job);
      return { best: 'e7e8q' };
    },
    stop() {},
    newGame() {},
  };
  const session = new UciSession({ send: (line) => out.push(line), backend });
  session.handle('uci');
  assert.equal(out.at(-1), 'uciok');
  session.handle('isready');
  assert.equal(out.at(-1), 'readyok');
  session.handle('position startpos moves e2e5');
  assert.match(out.at(-1), /^info string Illegal move: e2e5/);
  session.handle('position fen 8/4P2k/8/8/8/8/8/K7 w - - 0 1');
  session.handle('some unknown command');
  session.handle('go depth 2');
  await session.running;
  assert.equal(jobs[0].fen, '8/4P2k/8/8/8/8/8/K7 w - - 0 1');
  assert.deepEqual(jobs[0].limits, { depth: 2 });
  assert.equal(out.at(-1), 'bestmove e7e8q');
  assert.equal(session.handle('quit'), false);
});

test('program: plays a promotion and reports a mate score', async () => {
  const engine = startEngine();
  engine.send('uci');
  await engine.waitFor('uciok');
  // The pawn promotes with check; "moves" includes a promotion to replay.
  engine.send('position fen 7k/1P6/8/8/8/8/8/K7 w - - 0 1 moves b7b8q h8h7');
  engine.send('go depth 2');
  assert.match(await engine.waitFor('bestmove'), /^bestmove [a-h][1-8][a-h][1-8]/);

  engine.send('position fen 6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
  engine.send('go depth 4');
  assert.equal(await engine.waitFor('bestmove'), 'bestmove a1a8');
  assert.ok(engine.lines.some((l) => l.includes('score mate 1')));
  await engine.end();
});

test('program: "position ... moves" carries the repetition history', async () => {
  const engine = startEngine();
  // White has a rook against a queen. The moves shuffle there and back, so
  // the position after Ra2 has already occurred once. Playing Ra2 again
  // repeats it, which the engine can only know from the move list; it
  // should prefer that draw to playing on in a lost position.
  const fen = '3q3k/8/8/8/8/8/8/R6K w - - 0 1';
  engine.send(`position fen ${fen}`);
  engine.send('go depth 4');
  await engine.waitFor('bestmove');
  assert.ok(!engine.lines.some((l) => l.includes('score cp 0 ')), 'no draw without history');

  engine.lines.length = 0;
  engine.send(`position fen ${fen} moves a1a2 d8d7 a2a1 d7d8`);
  engine.send('go depth 4');
  assert.equal(await engine.waitFor('bestmove'), 'bestmove a1a2');
  assert.ok(engine.lines.at(-2).includes('score cp 0 '), engine.lines.at(-2));
  await engine.end();
});

test('program: stays responsive during a search, and stop ends it', async () => {
  const engine = startEngine();
  engine.send('position startpos');
  engine.send('go infinite');
  await engine.waitFor('info depth 6');
  engine.send('isready');
  await engine.waitFor('readyok');
  assert.ok(!engine.lines.some((l) => l.startsWith('bestmove')), 'still searching');
  const started = Date.now();
  engine.send('stop');
  assert.match(await engine.waitFor('bestmove'), /^bestmove [a-h][1-8][a-h][1-8]$/);
  assert.ok(Date.now() - started < 1000, 'stop is prompt');
  await engine.end();
});

test('program: go infinite holds its answer until stop, even with a forced mate', async () => {
  const engine = startEngine();
  engine.send('position fen 6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
  engine.send('go infinite');
  await engine.waitFor('info depth 1');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(!engine.lines.some((l) => l.startsWith('bestmove')));
  engine.send('stop');
  assert.equal(await engine.waitFor('bestmove'), 'bestmove a1a8');
  await engine.end();
});

test('program: movetime is respected and input ending mid-search still yields a move', async () => {
  const engine = startEngine();
  engine.send('position startpos moves e2e4');
  const started = Date.now();
  engine.send('go movetime 200');
  const done = engine.waitFor('bestmove');
  await engine.end();
  assert.match(await done, /^bestmove /);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1500, `took ${elapsed}ms`);
});
