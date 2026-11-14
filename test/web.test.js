import test from 'node:test';
import assert from 'node:assert/strict';
import { describeScore, describeStatus, moveRows } from '../web/format.js';
import { createAppServer, resolvePath } from '../bin/serve.js';
import { runSearchJob } from '../src/engine/search-job.js';
import { Searcher, MATE } from '../src/engine/search.js';
import { START_FEN } from '../src/engine/board.js';

test('move list rows', () => {
  assert.deepEqual(moveRows(['e4', 'e5', 'Nf3'], START_FEN), [
    { number: 1, white: 'e4', black: 'e5' },
    { number: 2, white: 'Nf3', black: '' },
  ]);
  assert.deepEqual(moveRows(['Kd7', 'Kb2'], '4k3/8/8/8/8/8/8/K7 b - - 0 31'), [
    { number: 31, white: '…', black: 'Kd7' },
    { number: 32, white: 'Kb2', black: '' },
  ]);
  assert.deepEqual(moveRows([], START_FEN), []);
});

test('score and status text', () => {
  assert.equal(describeScore(35, true), 'evaluation +0.35');
  assert.equal(describeScore(35, false), 'evaluation -0.35');
  assert.equal(describeScore(0, false), 'evaluation 0.00');
  assert.equal(describeScore(MATE - 3, false), 'Black mates in 2');
  assert.equal(describeScore(-MATE + 2, false), 'White mates in 1');
  const playing = { over: false, check: true };
  assert.equal(describeStatus(playing, 'black'), 'Black to move. Check.');
  assert.equal(
    describeStatus({ over: true, result: 'white', reason: 'checkmate' }, 'black'),
    'Checkmate. White wins.',
  );
  assert.equal(
    describeStatus({ over: true, result: 'draw', reason: 'stalemate' }, 'white'),
    'Draw by stalemate.',
  );
});

test('search job: plain data in, move text out', () => {
  const searcher = new Searcher({ ttBits: 16 });
  const infos = [];
  const result = runSearchJob(
    searcher,
    { fen: START_FEN, moves: ['f2f3', 'e7e5', 'g2g4'], limits: { depth: 3 } },
    { onInfo: (info) => infos.push(info) },
  );
  assert.equal(result.best, 'd8h4');
  assert.equal(result.pv[0], 'd8h4');
  assert.equal(infos.length, result.depth);
  const stuck = runSearchJob(searcher, {
    fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
    moves: [],
    limits: {},
  });
  assert.equal(stuck.best, null);
});

test('server only resolves page and engine files', () => {
  assert.match(resolvePath('/web/'), /web[/\\]index\.html$/);
  assert.match(resolvePath('/src/engine/board.js?x=1'), /src[/\\]engine[/\\]board\.js$/);
  assert.equal(resolvePath('/package.json'), null);
  assert.equal(resolvePath('/web/../package.json'), null);
  assert.equal(resolvePath('/web/..%2f.env'), null);
  assert.equal(resolvePath('/.env'), null);
  assert.equal(resolvePath('/web/%E0%A4%A'), null);
});

test('server serves the page and refuses everything else', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get('location'), '/web/');
    const page = await fetch(`${base}/web/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /<title>Chess<\/title>/);
    const module = await fetch(`${base}/src/engine/index.js`);
    assert.match(module.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/web/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/web/`, { method: 'POST' })).status, 405);
  } finally {
    server.close();
  }
});
