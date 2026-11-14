// Words and numbers for the page. Pure functions, no DOM.

const cap = (side) => (side === 'white' ? 'White' : 'Black');
const other = (side) => (side === 'white' ? 'black' : 'white');

// One line on how the game stands.
export function describeStatus(status, turn) {
  if (!status.over) return `${cap(turn)} to move${status.check ? '. Check.' : ''}`;
  const { result, reason } = status;
  if (reason === 'checkmate') return `Checkmate. ${cap(result)} wins.`;
  if (reason === 'resignation') return `${cap(other(result))} resigned. ${cap(result)} wins.`;
  if (reason === 'time') return `${cap(other(result))} ran out of time. ${cap(result)} wins.`;
  if (reason === 'agreement') return 'Draw agreed.';
  if (reason === 'result') return result === 'draw' ? 'Draw.' : `${cap(result)} won.`;
  return `Draw by ${reason}.`;
}

// Moves with their numbers, starting from the position the FEN gives:
// "12. Nf3 Nc6 13. Bb5" or "12... Nc6 13. Bb5".
export function numberMoves(sans, fen) {
  const fields = fen.split(' ');
  let number = Number(fields[5]) || 1;
  let white = fields[1] === 'w';
  return sans.map((san, i) => {
    const prefix = white ? `${number}. ` : i === 0 ? `${number}... ` : '';
    if (!white) number++;
    white = !white;
    return prefix + san;
  });
}

const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// From the board alone: the pieces each side has lost, as letters in
// order of value, and the material balance in pawns (positive for White).
export function material(pieces) {
  const count = { w: {}, b: {} };
  for (const code of pieces.values()) count[code[0]][code[1]] = (count[code[0]][code[1]] ?? 0) + 1;
  const lost = (colour) =>
    [...'qrbnp'].flatMap((letter) =>
      Array(Math.max(0, START_COUNT[letter] - (count[colour][letter] ?? 0))).fill(letter),
    );
  const total = (colour) =>
    Object.keys(VALUE).reduce((sum, l) => sum + VALUE[l] * (count[colour][l] ?? 0), 0);
  return { whiteLost: lost('w'), blackLost: lost('b'), balance: total('w') - total('b') };
}

// The weaker levels choose among all moves: each move's score gets random
// noise (about `noise` centipawns) and the best of the noisy scores wins.
// A forced mate is never passed up.
export function pickMove(scores, noise, random = Math.random) {
  let best = null;
  for (const { uci, score } of scores) {
    // Two uniform numbers summed: a rough bell curve.
    const jitter = Math.abs(score) > 20000 ? 0 : (random() + random() - 1) * noise * 1.7;
    if (!best || score + jitter > best.value) best = { uci, value: score + jitter };
  }
  return best?.uci ?? null;
}
