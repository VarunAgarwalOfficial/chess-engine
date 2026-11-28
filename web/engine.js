// The Rust engine, compiled to WebAssembly. Requests and replies are text
// in a buffer inside the module's memory: a FEN, the moves played since and
// search parameters go in, JSON comes out.

// source: a URL to fetch, or the bytes of engine.wasm.
export async function loadEngine(source) {
  // WebAssembly has no clock, so the engine asks the page for the time.
  const imports = { env: { now: () => performance.now() } };
  const { instance } =
    source instanceof URL
      ? await WebAssembly.instantiateStreaming(fetch(source), imports)
      : await WebAssembly.instantiate(source, imports);
  const wasm = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function call(run, fen, moves = [], parameters = '') {
    const request = encoder.encode(`${fen}\n${moves.join(' ')}\n${parameters}`);
    // Each call may grow the memory, which replaces memory.buffer, so the
    // buffer is looked up only after the call that precedes its use.
    const at = wasm.buffer(request.length);
    new Uint8Array(wasm.memory.buffer, at, request.length).set(request);
    const length = run();
    const reply = new Uint8Array(wasm.memory.buffer, wasm.reply(), length);
    const result = JSON.parse(decoder.decode(reply));
    if (result.error) throw new Error(result.error);
    return result;
  }

  return {
    // { fen, turn, over, result, reason, check, moves: [{ uci, san, capture }] }
    describe: (fen, moves) => call(wasm.describe, fen, moves),
    // A search under UCI "go" parameters, e.g. "depth 8" or "movetime 500".
    // { best, depth, score, mate, nodes, time, pv: [uci], san: [san] }
    // score is in centipawns for the side to move.
    go: (fen, moves, parameters) => call(wasm.go, fen, moves, parameters),
    // Every legal move searched on its own to a depth (1 to 10, default 6),
    // best first, and the opponent's threat if the side to move could pass.
    // { depth, moves: [{ score, mate, pv, san }], threat: { score, mate, pv, san } | null }
    // Scores are for the side to move, so a threat to mate has a negative mate.
    explain: (fen, moves, depth = 6) => call(wasm.explain, fen, moves, `depth ${depth}`),
  };
}
