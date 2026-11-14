// The search: iterative deepening over a principal-variation alpha-beta
// search, with a transposition table, null-move pruning, late-move
// reductions, a check extension and a quiescence search at the leaves.

import {
  CAPTURE,
  QUEEN,
  PAWN,
  KING,
  moveFrom,
  moveTo,
  moveFlags,
  moveCaptured,
  movePiece,
  movePromotion,
} from './board.js';
import { generateMoves } from './movegen.js';
import { evaluate } from './eval.js';

export const MATE = 30000;
export const MAX_PLY = 96;
// Scores beyond this are "mate in n", not material.
export const MATE_BOUND = MATE - 2 * MAX_PLY;

const EXACT = 1;
const LOWER = 2; // the real score is at least this (a beta cutoff)
const UPPER = 3; // the real score is at most this (no move raised alpha)

const TT_MOVE_SCORE = 1 << 30;
const CAPTURE_SCORE = 1 << 28;
const KILLER_SCORE = 1 << 26;
const HISTORY_MAX = 1 << 24;

export class Searcher {
  constructor({ ttBits = 20 } = {}) {
    const size = 1 << ttBits;
    this.ttMask = size - 1;
    this.ttLo = new Int32Array(size);
    this.ttHi = new Int32Array(size);
    this.ttMove = new Int32Array(size);
    this.ttScore = new Int16Array(size);
    this.ttDepth = new Int8Array(size);
    this.ttFlag = new Uint8Array(size);
    this.history = new Int32Array(2 * 128 * 128);
    this.killers = new Int32Array(MAX_PLY * 2);
    this.nodes = 0;
  }

  clear() {
    this.ttLo.fill(0);
    this.ttHi.fill(0);
    this.ttMove.fill(0);
    this.ttFlag.fill(0);
    this.history.fill(0);
  }

  // Finds the best move for the side to move.
  //   depth     stop after this many plies of iterative deepening
  //   moveTime  hard limit in milliseconds
  //   softTime  do not start another iteration after this many milliseconds
  //   nodes     stop after this many nodes
  //   stop      an Int32Array; the search ends when element 0 becomes non-zero
  //   onInfo    called after each finished iteration
  // Returns { move, score, depth, nodes, time, pv }. move is 0 only when the
  // side to move has no legal move.
  search(pos, limits = {}) {
    const {
      depth = MAX_PLY - 1,
      moveTime = Infinity,
      softTime = Infinity,
      nodes = Infinity,
      stop = null,
      onInfo = null,
    } = limits;
    this.pos = pos;
    this.start = Date.now();
    this.deadline = this.start + moveTime;
    this.nodeLimit = nodes;
    this.stopFlag = stop;
    this.nodes = 0;
    this.aborted = false;
    this.canAbort = false;
    this.killers.fill(0);
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= 3;

    const rootMoves = generateMoves(pos);
    const result = { move: rootMoves[0] ?? 0, score: 0, depth: 0, nodes: 0, time: 0, pv: [] };
    if (rootMoves.length === 0) {
      result.score = pos.inCheck() ? -MATE : 0;
      return result;
    }

    const maxDepth = Math.max(1, Math.min(depth, MAX_PLY - 1));
    for (let d = 1; d <= maxDepth; d++) {
      this.rootMove = 0;
      this.rootScore = 0;
      const score = this.negamax(d, -MATE, MATE, 0, false);
      // An interrupted iteration still counts if it finished at least one
      // move: the previous best move is searched first, so anything that
      // replaced it was proven better with a full-window search.
      if (this.rootMove) {
        result.move = this.rootMove;
        result.score = this.aborted ? this.rootScore : score;
      }
      if (this.aborted) break;
      result.depth = d;
      result.nodes = this.nodes;
      result.time = Date.now() - this.start;
      result.pv = this.principalVariation(d);
      if (onInfo) onInfo({ ...result });
      // The first iteration always completes, so there is always a move.
      this.canAbort = true;
      if (Math.abs(score) >= MATE_BOUND && d >= MATE - Math.abs(score)) break;
      if (rootMoves.length === 1 && Number.isFinite(softTime)) break;
      if (result.time >= softTime) break;
    }
    result.nodes = this.nodes;
    result.time = Date.now() - this.start;
    return result;
  }

  checkLimits() {
    if (!this.canAbort) return;
    if (
      this.nodes >= this.nodeLimit ||
      Date.now() >= this.deadline ||
      (this.stopFlag && Atomics.load(this.stopFlag, 0) !== 0)
    ) {
      this.aborted = true;
    }
  }

  negamax(depth, alpha, beta, ply, allowNull) {
    const pos = this.pos;
    const root = ply === 0;
    const pvNode = beta - alpha > 1;

    if (!root) {
      // A position seen before on this line, or in the game, is scored as a
      // draw at once. Waiting for the third occurrence would only make the
      // search see the same thing later.
      if (pos.repetitionCount() > 1 || pos.insufficientMaterial()) return 0;
      if (pos.halfmove >= 100) {
        // Checkmate on the hundredth half-move still wins.
        return pos.inCheck() && generateMoves(pos).length === 0 ? -MATE + ply : 0;
      }
      if (ply >= MAX_PLY - 1) return evaluate(pos);
    }

    const inCheck = pos.inCheck();
    if (inCheck) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply);

    if ((++this.nodes & 1023) === 0) this.checkLimits();
    if (this.aborted) return 0;

    const slot = pos.hashLo & this.ttMask;
    let ttMove = 0;
    if (this.ttFlag[slot] && this.ttLo[slot] === pos.hashLo && this.ttHi[slot] === pos.hashHi) {
      ttMove = this.ttMove[slot];
      if (!pvNode && this.ttDepth[slot] >= depth) {
        // Mate scores are stored relative to the node, not the root.
        let score = this.ttScore[slot];
        if (score >= MATE_BOUND) score -= ply;
        else if (score <= -MATE_BOUND) score += ply;
        const flag = this.ttFlag[slot];
        if (flag === EXACT) return score;
        if (flag === LOWER && score >= beta) return score;
        if (flag === UPPER && score <= alpha) return score;
      }
    }

    // Null move: if passing the turn still leaves us at or above beta, a
    // real move will too. Unsafe in check and in pawn endings (zugzwang).
    if (
      allowNull &&
      !pvNode &&
      !inCheck &&
      depth >= 3 &&
      this.hasPieces(pos.side) &&
      evaluate(pos) >= beta
    ) {
      const reduction = 2 + ((depth / 6) | 0);
      pos.makeNull();
      const score = -this.negamax(depth - 1 - reduction, -beta, -beta + 1, ply + 1, false);
      pos.unmakeNull();
      if (this.aborted) return 0;
      if (score >= beta && score < MATE_BOUND) return score;
    }

    const moves = generateMoves(pos);
    if (moves.length === 0) return inCheck ? -MATE + ply : 0;
    const scores = this.scoreMoves(moves, ttMove, ply);

    const alphaStart = alpha;
    let best = -MATE;
    let bestMove = 0;

    for (let i = 0; i < moves.length; i++) {
      pickNext(moves, scores, i);
      const m = moves[i];
      const quiet = !(moveFlags(m) & CAPTURE) && !movePromotion(m);

      pos.make(m);
      let score;
      if (i === 0) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        // Later moves are expected to fail low: search them with a zero
        // window, and quiet ones far down the list to a reduced depth. Only
        // a surprise is searched again properly.
        let reduction = 0;
        if (depth >= 3 && i >= 4 && quiet && !inCheck && !pos.inCheck()) {
          reduction = i >= 12 ? 2 : 1;
        }
        score = -this.negamax(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && reduction) {
          score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        }
        if (score > alpha && score < beta) {
          score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
        }
      }
      pos.unmake(m);
      if (this.aborted) return 0;

      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (root) {
            this.rootMove = m;
            this.rootScore = score;
          }
          if (alpha >= beta) {
            if (quiet) this.rewardQuiet(m, depth, ply);
            break;
          }
        }
      }
    }

    let stored = best;
    if (stored >= MATE_BOUND) stored += ply;
    else if (stored <= -MATE_BOUND) stored -= ply;
    this.ttLo[slot] = pos.hashLo;
    this.ttHi[slot] = pos.hashHi;
    this.ttMove[slot] = bestMove;
    this.ttScore[slot] = stored;
    this.ttDepth[slot] = Math.min(depth, 127);
    this.ttFlag[slot] = best <= alphaStart ? UPPER : best >= beta ? LOWER : EXACT;
    return best;
  }

  // Plays out captures until the position is quiet, so the evaluation is
  // never taken in the middle of an exchange.
  quiesce(alpha, beta, ply) {
    const pos = this.pos;
    if ((++this.nodes & 1023) === 0) this.checkLimits();
    if (this.aborted) return 0;
    if (ply >= MAX_PLY - 1) return evaluate(pos);

    // In check there is no "standing pat": every evasion must be tried.
    const inCheck = pos.inCheck();
    let best = -MATE + ply;
    if (!inCheck) {
      best = evaluate(pos);
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    }

    const moves = generateMoves(pos, !inCheck);
    const scores = this.scoreMoves(moves, 0, ply);
    for (let i = 0; i < moves.length; i++) {
      pickNext(moves, scores, i);
      const m = moves[i];
      pos.make(m);
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      pos.unmake(m);
      if (this.aborted) return 0;
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) break;
        }
      }
    }
    return best;
  }

  // Ordering: the table move, then captures by most valuable victim and
  // least valuable attacker, then the killer moves of this ply, then quiet
  // moves by how often they have caused cutoffs.
  scoreMoves(moves, ttMove, ply) {
    const scores = new Int32Array(moves.length);
    const killerA = this.killers[ply * 2];
    const killerB = this.killers[ply * 2 + 1];
    const side = this.pos.side;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m === ttMove) scores[i] = TT_MOVE_SCORE;
      else if (moveFlags(m) & CAPTURE || movePromotion(m)) {
        const gain = moveCaptured(m) * 8 - movePiece(m) + (movePromotion(m) === QUEEN ? 64 : 0);
        scores[i] = CAPTURE_SCORE + gain;
      } else if (m === killerA) scores[i] = KILLER_SCORE + 1;
      else if (m === killerB) scores[i] = KILLER_SCORE;
      else scores[i] = this.history[(side << 14) | (moveFrom(m) << 7) | moveTo(m)];
    }
    return scores;
  }

  rewardQuiet(m, depth, ply) {
    const k = ply * 2;
    if (this.killers[k] !== m) {
      this.killers[k + 1] = this.killers[k];
      this.killers[k] = m;
    }
    const i = (this.pos.side << 14) | (moveFrom(m) << 7) | moveTo(m);
    this.history[i] = Math.min(this.history[i] + depth * depth, HISTORY_MAX);
  }

  // True when the side has something other than king and pawns.
  hasPieces(side) {
    const board = this.pos.board;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const piece = board[sq];
      if (piece && piece >> 3 === side && (piece & 7) !== PAWN && (piece & 7) !== KING) return true;
    }
    return false;
  }

  // Reads the best line back out of the transposition table.
  principalVariation(length) {
    const pos = this.pos;
    const line = [];
    while (line.length < length) {
      const slot = pos.hashLo & this.ttMask;
      if (!this.ttFlag[slot] || this.ttLo[slot] !== pos.hashLo || this.ttHi[slot] !== pos.hashHi) {
        break;
      }
      const m = this.ttMove[slot];
      if (!m || !generateMoves(pos).includes(m)) break;
      pos.make(m);
      line.push(m);
      if (pos.repetitionCount() > 1) break;
    }
    for (let i = line.length - 1; i >= 0; i--) pos.unmake(line[i]);
    return line;
  }
}

// Selection sort step: bring the best remaining move to position i.
function pickNext(moves, scores, i) {
  let bestIndex = i;
  for (let j = i + 1; j < moves.length; j++) {
    if (scores[j] > scores[bestIndex]) bestIndex = j;
  }
  if (bestIndex !== i) {
    const m = moves[i];
    moves[i] = moves[bestIndex];
    moves[bestIndex] = m;
    const s = scores[i];
    scores[i] = scores[bestIndex];
    scores[bestIndex] = s;
  }
}
