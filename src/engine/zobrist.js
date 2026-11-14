// Zobrist keys. JavaScript has no fast 64-bit integers, so every key is a
// pair of 32-bit halves. The generator is seeded so hashes are reproducible.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}

const next = mulberry32(0x5eed1e55);

function table(length) {
  const keys = new Int32Array(length);
  for (let i = 0; i < length; i++) keys[i] = next();
  return keys;
}

// Indexed by piece * 128 + square.
export const PIECE_LO = table(16 * 128);
export const PIECE_HI = table(16 * 128);
// Indexed by the four-bit castling rights value.
export const CASTLE_LO = table(16);
export const CASTLE_HI = table(16);
// Indexed by the file of the en passant square.
export const EP_LO = table(8);
export const EP_HI = table(8);
export const SIDE_LO = next();
export const SIDE_HI = next();
