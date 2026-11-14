// The engine, off the main thread, so the page stays responsive while it
// thinks. Three kinds of request:
//   go       one search, one answer
//   scores   a score for each candidate move (for the weaker levels)
//   analyse  deeper and deeper searches, each reported as it finishes
// A search cannot be interrupted from outside. Analysis runs in slices and
// gives way to a newer request between them; to stop a slice the page
// replaces the worker.

import { loadEngine } from './engine.js';

const engine = loadEngine(new URL('./engine.wasm', import.meta.url));
let current = 0;

// A full turn of the event loop, so that a waiting message is delivered.
const turn = () => new Promise((resolve) => setTimeout(resolve));

async function handle(engine, data) {
  const { id, fen, moves } = data;
  if (data.kind === 'scores') {
    // What each move is worth to the side making it.
    const scores = data.candidates.map((uci) => ({
      uci,
      score: -engine.go(fen, [...moves, uci], data.go).score,
    }));
    self.postMessage({ id, result: scores, done: true });
  } else if (data.kind === 'analyse') {
    const start = performance.now();
    for (let depth = 1; depth <= data.maxDepth; depth++) {
      const left = data.budget - (performance.now() - start);
      if (left <= 0) break;
      const result = engine.go(fen, moves, `depth ${depth} movetime ${Math.ceil(left)}`);
      self.postMessage({ id, result, done: false });
      if (!result.best || (result.mate !== null && depth >= 2 * Math.abs(result.mate))) break;
      await turn();
      if (current !== id) return;
    }
    self.postMessage({ id, done: true });
  } else {
    self.postMessage({ id, result: engine.go(fen, moves, data.go), done: true });
  }
}

self.onmessage = async ({ data }) => {
  current = data.id;
  try {
    await handle(await engine, data);
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message, done: true });
  }
};
