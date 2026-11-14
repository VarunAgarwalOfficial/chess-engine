// The engine, off the main thread, so the page stays responsive while it
// thinks. One request in, one answer out.

import { Searcher } from '../src/engine/search.js';
import { runSearchJob } from '../src/engine/search-job.js';

const searcher = new Searcher();

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, result: runSearchJob(searcher, data.job) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
