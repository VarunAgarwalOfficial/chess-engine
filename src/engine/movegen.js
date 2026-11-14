// Legal move generation.
//
// This keeps the approach of the original 2021 game: before generating
// anything, look outward from the king to find every check and every pinned
// piece. Then each piece can be restricted directly:
//   - in double check only the king may move;
//   - in single check a move must capture the checker or block its ray;
//   - a pinned piece may only move along the line of its pin.
// No move has to be played and taken back to see whether it is legal. The
// one exception is en passant, which lifts two pawns off a rank at once and
// is rare enough to simply try on the board.

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
  makePiece,
} from './board.js';

// Scratch tables, valid for one call. A square counts as marked when its
// entry equals the current stamp, so nothing has to be cleared between calls.
const blockStamp = new Uint32Array(128);
const pinStamp = new Uint32Array(128);
const pinStep = new Int8Array(128);
let stamp = 0;

// Finds checks and pins for the side to move. Returns the number of checkers.
// Squares that answer a single check (the checker and the squares between it
// and the king) are marked in blockStamp; pinned pieces in pinStamp/pinStep.
function scanKing(pos) {
  const board = pos.board;
  const us = pos.side;
  const them = us ^ 1;
  const king = pos.kingSq[us];
  const enemyQueen = makePiece(them, QUEEN);
  let checkers = 0;
  stamp++;

  for (let i = 0; i < 8; i++) {
    const step = RAY_STEPS[i];
    const enemySlider = makePiece(them, i < 4 ? ROOK : BISHOP);
    let shield = -1;
    for (let s = king + step; !(s & 0x88); s += step) {
      const piece = board[s];
      if (!piece) continue;
      if (piece >> 3 === us) {
        if (shield >= 0) break;
        shield = s;
        continue;
      }
      if (piece === enemySlider || piece === enemyQueen) {
        if (shield >= 0) {
          pinStamp[shield] = stamp;
          pinStep[shield] = step;
        } else {
          checkers++;
          for (let b = king + step; b !== s + step; b += step) blockStamp[b] = stamp;
        }
      }
      break;
    }
  }

  const enemyKnight = makePiece(them, KNIGHT);
  for (let i = 0; i < 8; i++) {
    const s = king + KNIGHT_STEPS[i];
    if (!(s & 0x88) && board[s] === enemyKnight) {
      checkers++;
      blockStamp[s] = stamp;
    }
  }

  const enemyPawn = makePiece(them, PAWN);
  const forward = us === WHITE ? 16 : -16;
  for (const side of [-1, 1]) {
    const s = king + forward + side;
    if (!(s & 0x88) && board[s] === enemyPawn) {
      checkers++;
      blockStamp[s] = stamp;
    }
  }
  return checkers;
}

// All legal moves for the side to move. With tacticalOnly set, only captures
// and queen promotions are produced (used by the quiescence search).
export function generateMoves(pos, tacticalOnly = false) {
  const moves = [];
  const board = pos.board;
  const us = pos.side;
  const them = us ^ 1;
  const king = pos.kingSq[us];
  const checkers = scanKing(pos);
  const mark = stamp;

  // King steps. The king is lifted off the board while testing so that it
  // cannot hide behind itself when stepping away along a checking ray.
  board[king] = 0;
  for (let i = 0; i < 8; i++) {
    const to = king + RAY_STEPS[i];
    if (to & 0x88) continue;
    const target = board[to];
    if (target ? target >> 3 === us : tacticalOnly) continue;
    if (pos.isAttacked(to, them)) continue;
    moves.push(encodeMove(king, to, KING, target & 7, 0, target ? CAPTURE : 0));
  }
  board[king] = makePiece(us, KING);

  if (checkers >= 2) return moves;

  if (checkers === 0 && !tacticalOnly) {
    const kingside = us === WHITE ? WK : BK;
    const queenside = us === WHITE ? WQ : BQ;
    if (
      pos.castling & kingside &&
      !board[king + 1] &&
      !board[king + 2] &&
      !pos.isAttacked(king + 1, them) &&
      !pos.isAttacked(king + 2, them)
    ) {
      moves.push(encodeMove(king, king + 2, KING, 0, 0, CASTLE));
    }
    // The b-file square must be empty but may be attacked.
    if (
      pos.castling & queenside &&
      !board[king - 1] &&
      !board[king - 2] &&
      !board[king - 3] &&
      !pos.isAttacked(king - 1, them) &&
      !pos.isAttacked(king - 2, them)
    ) {
      moves.push(encodeMove(king, king - 2, KING, 0, 0, CASTLE));
    }
  }

  const inCheck = checkers === 1;
  const forward = us === WHITE ? 16 : -16;
  const startRank = us === WHITE ? 1 : 6;
  const lastRank = us === WHITE ? 6 : 1;

  for (let from = 0; from < 120; from++) {
    if (from & 0x88) {
      from += 7;
      continue;
    }
    const piece = board[from];
    if (!piece || piece >> 3 !== us) continue;
    const type = piece & 7;
    if (type === KING) continue;
    const pinned = pinStamp[from] === mark;
    const pin = pinStep[from];

    if (type === PAWN) {
      const promotes = from >> 4 === lastRank;
      if (!pinned || pin === forward || pin === -forward) {
        const to = from + forward;
        if (!board[to]) {
          if (!inCheck || blockStamp[to] === mark) {
            if (promotes) {
              moves.push(encodeMove(from, to, PAWN, 0, QUEEN));
              if (!tacticalOnly) {
                moves.push(encodeMove(from, to, PAWN, 0, ROOK));
                moves.push(encodeMove(from, to, PAWN, 0, BISHOP));
                moves.push(encodeMove(from, to, PAWN, 0, KNIGHT));
              }
            } else if (!tacticalOnly) {
              moves.push(encodeMove(from, to, PAWN));
            }
          }
          const two = to + forward;
          if (
            !tacticalOnly &&
            from >> 4 === startRank &&
            !board[two] &&
            (!inCheck || blockStamp[two] === mark)
          ) {
            moves.push(encodeMove(from, two, PAWN, 0, 0, DOUBLE_PUSH));
          }
        }
      }
      for (const side of [-1, 1]) {
        const step = forward + side;
        const to = from + step;
        if (to & 0x88) continue;
        const target = board[to];
        if (target) {
          if (target >> 3 === us) continue;
          if (pinned && pin !== step && pin !== -step) continue;
          if (inCheck && blockStamp[to] !== mark) continue;
          const captured = target & 7;
          if (promotes) {
            moves.push(encodeMove(from, to, PAWN, captured, QUEEN, CAPTURE));
            if (!tacticalOnly) {
              moves.push(encodeMove(from, to, PAWN, captured, ROOK, CAPTURE));
              moves.push(encodeMove(from, to, PAWN, captured, BISHOP, CAPTURE));
              moves.push(encodeMove(from, to, PAWN, captured, KNIGHT, CAPTURE));
            }
          } else {
            moves.push(encodeMove(from, to, PAWN, captured, 0, CAPTURE));
          }
        } else if (to === pos.ep) {
          // Play it on the board and look at the king.
          const capSq = to - forward;
          const enemyPawn = board[capSq];
          board[from] = 0;
          board[capSq] = 0;
          board[to] = piece;
          const safe = !pos.isAttacked(king, them);
          board[to] = 0;
          board[capSq] = enemyPawn;
          board[from] = piece;
          if (safe) moves.push(encodeMove(from, to, PAWN, PAWN, 0, CAPTURE | EN_PASSANT));
        }
      }
      continue;
    }

    if (type === KNIGHT) {
      if (pinned) continue;
      for (let i = 0; i < 8; i++) {
        const to = from + KNIGHT_STEPS[i];
        if (to & 0x88) continue;
        const target = board[to];
        if (target ? target >> 3 === us : tacticalOnly) continue;
        if (inCheck && blockStamp[to] !== mark) continue;
        moves.push(encodeMove(from, to, KNIGHT, target & 7, 0, target ? CAPTURE : 0));
      }
      continue;
    }

    const first = type === BISHOP ? 4 : 0;
    const last = type === ROOK ? 4 : 8;
    for (let i = first; i < last; i++) {
      const step = RAY_STEPS[i];
      if (pinned && pin !== step && pin !== -step) continue;
      for (let to = from + step; !(to & 0x88); to += step) {
        const target = board[to];
        if (target) {
          if (target >> 3 !== us && (!inCheck || blockStamp[to] === mark)) {
            moves.push(encodeMove(from, to, type, target & 7, 0, CAPTURE));
          }
          break;
        }
        if (!tacticalOnly && (!inCheck || blockStamp[to] === mark)) {
          moves.push(encodeMove(from, to, type));
        }
      }
    }
  }
  return moves;
}

// Counts the leaf positions reachable in exactly `depth` moves. Comparing
// these counts with published values is the standard test of a generator.
export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = generateMoves(pos);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    pos.make(m);
    nodes += perft(pos, depth - 1);
    pos.unmake(m);
  }
  return nodes;
}
