// Worker thread for the UCI program. The search is one long synchronous
// call, so it lives here and the main thread stays free to read "stop",
// which it signals through a shared flag.

import { parentPort, workerData } from 'node:worker_threads';
import { Searcher } from '../engine/search.js';
import { runSearchJob } from '../engine/search-job.js';

const stop = new Int32Array(workerData.stopBuffer);
const searcher = new Searcher();

parentPort.on('message', (message) => {
  if (message.type === 'newgame') {
    searcher.clear();
    return;
  }
  try {
    const result = runSearchJob(searcher, message.job, {
      stop,
      onInfo: (info) => parentPort.postMessage({ type: 'info', info }),
    });
    parentPort.postMessage({ type: 'done', result });
  } catch (error) {
    parentPort.postMessage({ type: 'error', message: error.message });
  }
});
