// Words and numbers for the page. Pure functions, no DOM.

const cap = (side) => (side === 'white' ? 'White' : 'Black');
const other = (side) => (side === 'white' ? 'black' : 'white');

// One line on how the game stands.
export function describeStatus(status, turn) {
  if (!status.over) return `${cap(turn)} to move${status.check ? '. Check.' : ''}`;
  const { result, reason } = status;
  if (reason === 'checkmate') return `Checkmate. ${cap(result)} wins.`;
  if (reason === 'resignation') return `${cap(other(result))} resigned. ${cap(result)} wins.`;
  if (reason === 'time') {
    if (result === 'draw') return `${cap(status.side)} ran out of time. Draw.`;
    return `${cap(other(result))} ran out of time. ${cap(result)} wins.`;
  }
  if (reason === 'agreement') return 'Draw agreed.';
  if (reason === 'result') return result === 'draw' ? 'Draw.' : `${cap(result)} won.`;
  return `Draw by ${reason}.`;
}

const WHY = {
  checkmate: () => 'By checkmate.',
  resignation: ({ result }) => `${cap(other(result))} resigned.`,
  agreement: () => 'Both sides agreed to a draw.',
  stalemate: () => 'Stalemate: the side to move has no legal move and is not in check.',
  'insufficient material': () => 'Neither side has enough pieces left to give mate.',
  'fifty-move rule': () => 'Fifty moves by each side passed without a capture or a pawn move.',
  'threefold repetition': () => 'The same position came up three times.',
  time: ({ result, side }) =>
    result === 'draw'
      ? `${cap(side)} ran out of time, but ${cap(other(side))} has too little left to give mate.`
      : `${cap(other(result))} ran out of time.`,
};

// A finished game in two parts, for the player on `side` ('white', 'black',
// or 'both' when nobody in particular is asking): { title, detail }.
export function describeOutcome(status, side) {
  const { result, reason } = status;
  let title = 'Draw';
  if (result !== 'draw') {
    title = side === 'both' ? `${cap(result)} wins` : result === side ? 'You won' : 'You lost';
  } else if (reason === 'threefold repetition') title = 'Draw by repetition';
  else if (reason === 'fifty-move rule') title = 'Draw by the fifty-move rule';
  else if (reason === 'stalemate') title = 'Draw by stalemate';
  return { title, detail: WHY[reason]?.(status) ?? '' };
}

const PIECES = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };

// A move in words, from its notation and its squares: "moved a knight from
// g1 to f3", "castled on the king's side, giving check".
export function plainMove(san, uci) {
  const [from, to] = [uci.slice(0, 2), uci.slice(2, 4)];
  let text;
  if (san.startsWith('O-O-O')) text = "castled on the queen's side";
  else if (san.startsWith('O-O')) text = "castled on the king's side";
  else {
    const piece = PIECES[san[0]] ?? 'pawn';
    text = san.includes('x')
      ? `moved a ${piece} from ${from} and took the piece on ${to}`
      : `moved a ${piece} from ${from} to ${to}`;
    const promoted = san.match(/=([QRBN])/);
    if (promoted) text += `, where it became a ${PIECES[promoted[1]]}`;
  }
  if (san.endsWith('#')) text += ', giving checkmate';
  else if (san.endsWith('+')) text += ', giving check';
  return text;
}

// The engine's score in words. `cp` is centipawns for White; mates are
// near 10000.
export function describeScore(cp) {
  if (Math.abs(cp) >= 9000) {
    const moves = 10000 - Math.abs(cp);
    return `${cp > 0 ? 'White' : 'Black'} can force checkmate in ${moves} ${moves === 1 ? 'move' : 'moves'}.`;
  }
  const pawns = Math.abs(cp) / 100;
  const rule = 'The engine scores positions in pawns: plus means White is ahead, minus Black.';
  if (pawns < 0.2) return `About level. ${rule}`;
  const side = cp > 0 ? 'White' : 'Black';
  const how =
    pawns < 1
      ? 'a little better'
      : pawns < 2.5
        ? 'better'
        : pawns < 5
          ? 'clearly better'
          : 'winning';
  const worth = pawns < 1 ? `${pawns.toFixed(1)} of a pawn` : `${pawns.toFixed(1)} pawns`;
  return `${side} is ${how}, by about ${worth}. ${rule}`;
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

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// From two boards, the game's first and the one shown: the pieces each
// side has lost since, as letters in order of value, and the material
// balance now in pawns (positive for White).
export function material(pieces, initial) {
  const tally = (board) => {
    const count = { w: {}, b: {} };
    for (const [colour, letter] of board.values()) {
      count[colour][letter] = (count[colour][letter] ?? 0) + 1;
    }
    return count;
  };
  const [now, before] = [tally(pieces), tally(initial)];
  const lost = (colour) =>
    [...'qrbnp'].flatMap((letter) =>
      Array(Math.max(0, (before[colour][letter] ?? 0) - (now[colour][letter] ?? 0))).fill(letter),
    );
  const total = (colour) =>
    Object.keys(VALUE).reduce((sum, l) => sum + VALUE[l] * (now[colour][l] ?? 0), 0);
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
