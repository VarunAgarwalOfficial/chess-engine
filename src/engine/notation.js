// Move text: coordinate notation as used by UCI ("e2e4", "e7e8q") and
// standard algebraic notation ("Nf3", "exd5", "O-O", "e8=Q#").

import {
  PAWN,
  KING,
  CAPTURE,
  CASTLE,
  fileOf,
  rankOf,
  moveFrom,
  moveTo,
  moveFlags,
  movePiece,
  movePromotion,
  squareName,
} from './board.js';
import { generateMoves } from './movegen.js';

const TYPE_LETTERS = ' pnbrqk';

export function moveToUci(m) {
  const promotion = movePromotion(m);
  return squareName(moveFrom(m)) + squareName(moveTo(m)) + (promotion ? TYPE_LETTERS[promotion] : '');
}

// The legal move matching coordinate text, or 0 when there is none.
export function findMove(pos, text) {
  const wanted = String(text).trim().toLowerCase();
  for (const m of generateMoves(pos)) {
    if (moveToUci(m) === wanted) return m;
  }
  return 0;
}

// SAN for a legal move in the current position.
export function moveToSan(pos, m) {
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const type = movePiece(m);
  let san;

  if (flags & CASTLE) {
    san = fileOf(to) === 6 ? 'O-O' : 'O-O-O';
  } else if (type === PAWN) {
    san = flags & CAPTURE ? `${squareName(from)[0]}x${squareName(to)}` : squareName(to);
    if (movePromotion(m)) san += `=${TYPE_LETTERS[movePromotion(m)].toUpperCase()}`;
  } else {
    san = TYPE_LETTERS[type].toUpperCase();
    if (type !== KING) {
      // Name the file, rank or both when another piece of the same kind
      // could reach the same square.
      const rivals = generateMoves(pos).filter(
        (o) => o !== m && movePiece(o) === type && moveTo(o) === to,
      );
      if (rivals.length) {
        const sameFile = rivals.some((o) => fileOf(moveFrom(o)) === fileOf(from));
        const sameRank = rivals.some((o) => rankOf(moveFrom(o)) === rankOf(from));
        const name = squareName(from);
        if (!sameFile) san += name[0];
        else if (!sameRank) san += name[1];
        else san += name;
      }
    }
    if (flags & CAPTURE) san += 'x';
    san += squareName(to);
  }

  pos.make(m);
  if (pos.inCheck()) san += generateMoves(pos).length ? '+' : '#';
  pos.unmake(m);
  return san;
}
