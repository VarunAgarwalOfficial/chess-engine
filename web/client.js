// One engine worker, seen from the page: ask, get progress, cancel.

export class EngineClient {
  constructor() {
    this.worker = null;
    this.id = 0;
    this.pending = null;
  }

  // Resolves with the last result, or null when cancelled or failed.
  // `onProgress` is called with every result as it arrives.
  run(message, onProgress) {
    this.cancel();
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => this.receive(data);
    }
    const id = ++this.id;
    return new Promise((resolve) => {
      this.pending = { id, resolve, onProgress, last: null };
      this.worker.postMessage({ ...message, id });
    });
  }

  receive(data) {
    const pending = this.pending;
    if (!pending || data.id !== pending.id) return;
    if (data.result) {
      pending.last = data.result;
      pending.onProgress?.(data.result);
    }
    if (data.done) {
      this.pending = null;
      pending.resolve(data.error ? null : pending.last);
    }
  }

  // A running search cannot be interrupted, so the worker is replaced.
  cancel() {
    if (!this.pending) return;
    this.worker.terminate();
    this.worker = null;
    const { resolve } = this.pending;
    this.pending = null;
    resolve(null);
  }
}
