// Static evaluation, in centipawns, from the side to move's point of view.
//
// The original game's AI stopped at an empty piece-square "map" and a loop
// that summed it over the board. This is that idea finished: material plus
// a table per piece that says where it likes to stand, with a few terms for
// pawn structure and a second king table for the endgame.

import { WHITE, BLACK, PAWN, BISHOP, ROOK, KING } from './board.js';

export const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];

// Tables are written as the board looks from White's side: the first row is
// rank 8. Values follow Tomasz Michniewski's "simplified evaluation function".
// prettier-ignore
const PAWN_TABLE = [
    0,   0,   0,   0,   0,   0,   0,   0,
   50,  50,  50,  50,  50,  50,  50,  50,
   10,  10,  20,  30,  30,  20,  10,  10,
    5,   5,  10,  25,  25,  10,   5,   5,
    0,   0,   0,  20,  20,   0,   0,   0,
    5,  -5, -10,   0,   0, -10,  -5,   5,
    5,  10,  10, -20, -20,  10,  10,   5,
    0,   0,   0,   0,   0,   0,   0,   0,
];
// prettier-ignore
const KNIGHT_TABLE = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20,   0,   0,   0,   0, -20, -40,
  -30,   0,  10,  15,  15,  10,   0, -30,
  -30,   5,  15,  20,  20,  15,   5, -30,
  -30,   0,  15,  20,  20,  15,   0, -30,
  -30,   5,  10,  15,  15,  10,   5, -30,
  -40, -20,   0,   5,   5,   0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
// prettier-ignore
const BISHOP_TABLE = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10,   0,   0,   0,   0,   0,   0, -10,
  -10,   0,   5,  10,  10,   5,   0, -10,
  -10,   5,   5,  10,  10,   5,   5, -10,
  -10,   0,  10,  10,  10,  10,   0, -10,
  -10,  10,  10,  10,  10,  10,  10, -10,
  -10,   5,   0,   0,   0,   0,   5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
// prettier-ignore
const ROOK_TABLE = [
    0,   0,   0,   0,   0,   0,   0,   0,
    5,  10,  10,  10,  10,  10,  10,   5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
   -5,   0,   0,   0,   0,   0,   0,  -5,
    0,   0,   0,   5,   5,   0,   0,   0,
];
// prettier-ignore
const QUEEN_TABLE = [
  -20, -10, -10,  -5,  -5, -10, -10, -20,
  -10,   0,   0,   0,   0,   0,   0, -10,
  -10,   0,   5,   5,   5,   5,   0, -10,
   -5,   0,   5,   5,   5,   5,   0,  -5,
   -5,   0,   5,   5,   5,   5,   0,  -5,
  -10,   0,   5,   5,   5,   5,   0, -10,
  -10,   0,   0,   0,   0,   0,   0, -10,
  -20, -10, -10,  -5,  -5, -10, -10, -20,
];
// prettier-ignore
const KING_MIDDLE_TABLE = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
   20,  20,   0,   0,   0,   0,  20,  20,
   20,  30,  10,   0,   0,  10,  30,  20,
];
// prettier-ignore
const KING_END_TABLE = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10,   0,   0, -10, -20, -30,
  -30, -10,  20,  30,  30,  20, -10, -30,
  -30, -10,  30,  40,  40,  30, -10, -30,
  -30, -10,  30,  40,  40,  30, -10, -30,
  -30, -10,  20,  30,  30,  20, -10, -30,
  -30, -30,   0,   0,   0,   0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

const TABLES = [null, PAWN_TABLE, KNIGHT_TABLE, BISHOP_TABLE, ROOK_TABLE, QUEEN_TABLE];

// How much each piece counts towards "still a middlegame" (24 at the start).
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];
const MAX_PHASE = 24;

const BISHOP_PAIR = 30;
const DOUBLED_PAWN = 12;
const ISOLATED_PAWN = 12;
const ROOK_OPEN_FILE = 20;
const ROOK_HALF_OPEN_FILE = 10;
// Bonus for a passed pawn by how many ranks it has advanced (0-7).
const PASSED_MIDDLE = [0, 5, 10, 15, 25, 40, 60, 0];
const PASSED_END = [0, 10, 20, 35, 60, 100, 150, 0];

// Scratch arrays, reset on every call. Index 0 and 9 pad the file range.
const pawnCount = [new Int8Array(10), new Int8Array(10)];
const whiteFront = new Int8Array(10); // lowest rank holding a white pawn
const blackFront = new Int8Array(10); // highest rank holding a black pawn

const tableIndex = (colour, rank, file) => (colour === WHITE ? 7 - rank : rank) * 8 + file;

// Evaluation from White's point of view.
function evaluateWhite(pos) {
  const board = pos.board;
  pawnCount[0].fill(0);
  pawnCount[1].fill(0);
  whiteFront.fill(7);
  blackFront.fill(0);

  const material = [0, 0];
  const bishops = [0, 0];
  let phase = 0;
  let score = 0;

  for (let sq = 0; sq < 120; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const piece = board[sq];
    if (!piece) continue;
    const type = piece & 7;
    const colour = piece >> 3;
    if (type === KING) continue;
    const rank = sq >> 4;
    const file = sq & 7;
    const sign = colour === WHITE ? 1 : -1;
    material[colour] += PIECE_VALUE[type];
    phase += PHASE_WEIGHT[type];
    score += sign * TABLES[type][tableIndex(colour, rank, file)];
    if (type === PAWN) {
      pawnCount[colour][file + 1]++;
      if (colour === WHITE) {
        if (rank < whiteFront[file + 1]) whiteFront[file + 1] = rank;
      } else if (rank > blackFront[file + 1]) blackFront[file + 1] = rank;
    } else if (type === BISHOP) {
      bishops[colour]++;
    }
  }

  score += material[WHITE] - material[BLACK];
  if (bishops[WHITE] >= 2) score += BISHOP_PAIR;
  if (bishops[BLACK] >= 2) score -= BISHOP_PAIR;

  // Terms that change with the stage of the game are kept as two integer
  // totals and blended at the end, so the result is exact and symmetric.
  let middle = 0;
  let end = 0;

  // Second pass for the terms that need the pawn structure.
  for (let sq = 0; sq < 120; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const piece = board[sq];
    if (!piece) continue;
    const type = piece & 7;
    if (type !== PAWN && type !== ROOK) continue;
    const colour = piece >> 3;
    const rank = sq >> 4;
    const f = (sq & 7) + 1;
    const sign = colour === WHITE ? 1 : -1;
    const own = pawnCount[colour];
    const enemy = pawnCount[colour ^ 1];

    if (type === ROOK) {
      if (own[f] === 0) score += sign * (enemy[f] === 0 ? ROOK_OPEN_FILE : ROOK_HALF_OPEN_FILE);
      continue;
    }
    if (own[f] > 1) score -= sign * DOUBLED_PAWN;
    if (own[f - 1] === 0 && own[f + 1] === 0) score -= sign * ISOLATED_PAWN;
    // Passed: no enemy pawn ahead on this file or the two beside it.
    const passed =
      colour === WHITE
        ? blackFront[f - 1] <= rank && blackFront[f] <= rank && blackFront[f + 1] <= rank
        : whiteFront[f - 1] >= rank && whiteFront[f] >= rank && whiteFront[f + 1] >= rank;
    if (passed) {
      const advanced = colour === WHITE ? rank : 7 - rank;
      middle += sign * PASSED_MIDDLE[advanced];
      end += sign * PASSED_END[advanced];
    }
  }

  // Kings: sheltered in the middlegame, central in the endgame.
  const wk = pos.kingSq[WHITE];
  const bk = pos.kingSq[BLACK];
  const wi = tableIndex(WHITE, wk >> 4, wk & 7);
  const bi = tableIndex(BLACK, bk >> 4, bk & 7);
  middle += KING_MIDDLE_TABLE[wi] - KING_MIDDLE_TABLE[bi];
  end += KING_END_TABLE[wi] - KING_END_TABLE[bi];

  // Mop-up: with a decisive lead, drive the losing king to the edge and
  // bring the winning king close. Without this, king and rook against king
  // is "won" in every position and the engine has nothing to steer by.
  const lead = material[WHITE] - material[BLACK];
  if (Math.abs(lead) >= 400) {
    const loser = lead > 0 ? bk : wk;
    const fromCentre =
      Math.max(3 - (loser >> 4), (loser >> 4) - 4) + Math.max(3 - (loser & 7), (loser & 7) - 4);
    const apart = Math.abs((wk >> 4) - (bk >> 4)) + Math.abs((wk & 7) - (bk & 7));
    end += Math.sign(lead) * (10 * fromCentre + 4 * (14 - apart));
  }

  // weight is 24 at the start of the game, 0 with only kings and pawns left.
  const weight = Math.min(phase, MAX_PHASE);
  return score + Math.trunc((middle * weight + end * (MAX_PHASE - weight)) / MAX_PHASE);
}

export function evaluate(pos) {
  const score = evaluateWhite(pos);
  return pos.side === WHITE ? score : 0 - score;
}
