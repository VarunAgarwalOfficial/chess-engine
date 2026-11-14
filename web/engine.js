// The Rust engine, compiled to WebAssembly. Requests and replies are text
// in a buffer inside the module's memory: a FEN and the moves played since
// go in, JSON comes out.

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

  function call(fen, moves, run) {
    const request = encoder.encode(`${fen}\n${moves.join(' ')}`);
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
    describe: (fen, moves = []) => call(fen, moves, wasm.describe),
    // { best, depth, score, mate, nodes, time }
    think: (fen, moves, milliseconds) => call(fen, moves, () => wasm.think(milliseconds)),
  };
}
