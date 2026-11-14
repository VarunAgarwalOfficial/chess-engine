// A second, deliberately naive move generator used to cross-check the real
// one. It is the method of the earliest version of the original game: list
// every move a piece could make ignoring the king, play each one, and keep
// it only if the mover's king is not left attacked.

import {
  WHITE,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  WK,
  WQ,
  BK,
  BQ,
  CAPTURE,
  EN_PASSANT,
  CASTLE,
  DOUBLE_PUSH,
  KNIGHT_STEPS,
  RAY_STEPS,
  encodeMove,
} from '../src/engine/board.js';

function pseudoLegal(pos) {
  const { board, side: us } = pos;
  const them = us ^ 1;
  const moves = [];
  const forward = us === WHITE ? 16 : -16;
  for (let from = 0; from < 120; from++) {
    if (from & 0x88 || !board[from] || board[from] >> 3 !== us) continue;
    const type = board[from] & 7;
    const add = (to, flags = 0, promotion = 0) =>
      moves.push(encodeMove(from, to, type, flags & EN_PASSANT ? PAWN : board[to] & 7, promotion, flags));
    if (type === PAWN) {
      const addPawn = (to, flags) => {
        if (to >> 4 === 0 || to >> 4 === 7) {
          for (const p of [QUEEN, ROOK, BISHOP, KNIGHT]) add(to, flags, p);
        } else add(to, flags);
      };
      const one = from + forward;
      if (!board[one]) {
        addPawn(one, 0);
        const two = one + forward;
        if (from >> 4 === (us === WHITE ? 1 : 6) && !board[two]) add(two, DOUBLE_PUSH);
      }
      for (const to of [one - 1, one + 1]) {
        if (to & 0x88) continue;
        if (board[to] && board[to] >> 3 === them) addPawn(to, CAPTURE);
        else if (to === pos.ep) add(to, CAPTURE | EN_PASSANT);
      }
    } else if (type === KNIGHT || type === KING) {
      for (const step of type === KNIGHT ? KNIGHT_STEPS : RAY_STEPS) {
        const to = from + step;
        if (to & 0x88) continue;
        if (!board[to]) add(to);
        else if (board[to] >> 3 === them) add(to, CAPTURE);
      }
    } else {
      const steps = type === ROOK ? RAY_STEPS.slice(0, 4) : type === BISHOP ? RAY_STEPS.slice(4) : RAY_STEPS;
      for (const step of steps) {
        for (let to = from + step; !(to & 0x88); to += step) {
          if (!board[to]) add(to);
          else {
            if (board[to] >> 3 === them) add(to, CAPTURE);
            break;
          }
        }
      }
    }
  }
  const king = pos.kingSq[us];
  const safe = (sq) => !pos.isAttacked(sq, them);
  if (safe(king)) {
    if (pos.castling & (us === WHITE ? WK : BK) && !board[king + 1] && !board[king + 2]) {
      if (safe(king + 1)) moves.push(encodeMove(king, king + 2, KING, 0, 0, CASTLE));
    }
    if (
      pos.castling & (us === WHITE ? WQ : BQ) &&
      !board[king - 1] &&
      !board[king - 2] &&
      !board[king - 3]
    ) {
      if (safe(king - 1)) moves.push(encodeMove(king, king - 2, KING, 0, 0, CASTLE));
    }
  }
  return moves;
}

export function referenceMoves(pos) {
  const us = pos.side;
  return pseudoLegal(pos).filter((m) => {
    pos.make(m);
    const legal = !pos.isAttacked(pos.kingSq[us], us ^ 1);
    pos.unmake(m);
    return legal;
  });
}

// Deterministic random numbers for reproducible playouts.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Swaps the colours and flips the board top to bottom.
export function mirrorFen(fen) {
  const [board, side, castling, ep, half, full] = fen.split(' ');
  const swap = (s) =>
    [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
  const rights = castling === '-' ? '-' : [...swap(castling)].sort().join('');
  const epSquare = ep === '-' ? '-' : ep[0] + (9 - Number(ep[1]));
  return [
    board.split('/').reverse().map(swap).join('/'),
    side === 'w' ? 'b' : 'w',
    rights,
    epSquare,
    half,
    full,
  ].join(' ');
}
