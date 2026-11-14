// Text for the side panel. Pure functions, no DOM.

import { MATE, MATE_BOUND } from '../src/engine/search.js';

// Groups SAN moves into numbered rows: [{ number, white, black }]. When the
// game starts with Black to move, the first row has no white move.
export function moveRows(sans, startFen) {
  const fields = startFen.split(' ');
  const blackStarts = fields[1] === 'b';
  let number = Number(fields[5]) || 1;
  const rows = [];
  let i = 0;
  if (blackStarts && sans.length) {
    rows.push({ number, white: '…', black: sans[0] });
    number++;
    i = 1;
  }
  for (; i < sans.length; i += 2) {
    rows.push({ number, white: sans[i], black: sans[i + 1] ?? '' });
    number++;
  }
  return rows;
}

// The engine's score, given from the mover's side, as White-relative text.
export function describeScore(score, moverIsWhite) {
  if (Math.abs(score) >= MATE_BOUND) {
    const moves = Math.ceil((MATE - Math.abs(score)) / 2);
    const winnerIsWhite = score > 0 === moverIsWhite;
    return `${winnerIsWhite ? 'White' : 'Black'} mates in ${moves}`;
  }
  const pawns = (moverIsWhite ? score : -score) / 100;
  return `evaluation ${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export function describeStatus(status, turn) {
  if (status.over) {
    if (status.reason === 'checkmate') {
      return `Checkmate. ${status.result === 'white' ? 'White' : 'Black'} wins.`;
    }
    return `Draw by ${status.reason}.`;
  }
  const side = turn === 'white' ? 'White' : 'Black';
  return status.check ? `${side} to move. Check.` : `${side} to move.`;
}
