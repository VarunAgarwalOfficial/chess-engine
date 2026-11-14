#!/usr/bin/env node
// UCI engine on standard input and output. Point any chess GUI at this file.

import { createInterface } from 'node:readline';
import { Worker } from 'node:worker_threads';
import { UciSession } from '../src/uci/protocol.js';

const stopBuffer = new SharedArrayBuffer(4);
const stop = new Int32Array(stopBuffer);
const worker = new Worker(new URL('../src/uci/search-worker.js', import.meta.url), {
  workerData: { stopBuffer },
});

let pending = null; // { resolve, reject, onInfo }
worker.on('message', (message) => {
  if (!pending) return;
  if (message.type === 'info') pending.onInfo(message.info);
  else if (message.type === 'done') pending.resolve(message.result);
  else pending.reject(new Error(message.message));
});

const backend = {
  go(job, onInfo) {
    Atomics.store(stop, 0, 0);
    return new Promise((resolve, reject) => {
      pending = { resolve, reject, onInfo };
      worker.postMessage({ type: 'go', job });
    }).finally(() => {
      pending = null;
    });
  },
  stop() {
    Atomics.store(stop, 0, 1);
  },
  newGame() {
    worker.postMessage({ type: 'newgame' });
  },
};

const session = new UciSession({ send: (line) => process.stdout.write(`${line}\n`), backend });

async function shutdown() {
  // Let a search that is still running report its move before leaving. An
  // infinite one would never end, so it is stopped.
  if (session.release) session.stop();
  if (session.running) await session.running;
  await worker.terminate();
  process.exit(0);
}

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (!session.handle(line)) input.close();
});
input.on('close', shutdown);
