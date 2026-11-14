// The engine, off the main thread, so the page stays responsive while it
// thinks. One request in, one answer out.

import { loadEngine } from './engine.js';

const engine = loadEngine(new URL('./engine.wasm', import.meta.url));

self.onmessage = async ({ data }) => {
  try {
    const result = (await engine).think(data.fen, data.moves, data.milliseconds);
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
