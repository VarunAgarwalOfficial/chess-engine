// A game: a position, the moves played so far, and the rules that end it.

import { Position, START_FEN, WHITE, moveFrom, parseSquare } from './board.js';
import { generateMoves } from './movegen.js';
import { findMove, moveToSan, moveToUci } from './notation.js';

export class Game {
  constructor(fen = START_FEN) {
    this.startFen = new Position(fen).fen();
    this.pos = new Position(fen);
    // Each entry: { move, san, uci }.
    this.history = [];
  }

  get turn() {
    return this.pos.side === WHITE ? 'white' : 'black';
  }

  fen() {
    return this.pos.fen();
  }

  legalMoves() {
    return generateMoves(this.pos);
  }

  // Legal moves of the piece on a named square, e.g. "e2".
  movesFrom(square) {
    const from = parseSquare(square);
    return this.legalMoves().filter((m) => moveFrom(m) === from);
  }

  // Plays a move given as an encoded move or as coordinate text. Returns the
  // history entry, or null when the move is not legal here.
  play(move) {
    if (this.status().over) return null;
    const m =
      typeof move === 'string'
        ? findMove(this.pos, move)
        : this.legalMoves().includes(move)
          ? move
          : 0;
    if (!m) return null;
    const entry = { move: m, san: moveToSan(this.pos, m), uci: moveToUci(m) };
    this.pos.make(m);
    this.history.push(entry);
    return entry;
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) return null;
    this.pos.unmake(entry.move);
    return entry;
  }

  // { over, result, reason, check }. result is 'white', 'black' or 'draw'.
  // Checkmate is tested first, so a mating move wins even when it is also
  // the hundredth half-move without a capture or pawn move.
  status() {
    const pos = this.pos;
    const check = pos.inCheck();
    const playing = { over: false, result: null, reason: null, check };
    if (this.legalMoves().length === 0) {
      if (check) {
        const winner = pos.side === WHITE ? 'black' : 'white';
        return { over: true, result: winner, reason: 'checkmate', check };
      }
      return { over: true, result: 'draw', reason: 'stalemate', check };
    }
    let reason = null;
    if (pos.insufficientMaterial()) reason = 'insufficient material';
    else if (pos.halfmove >= 100) reason = 'fifty-move rule';
    else if (pos.repetitionCount() >= 3) reason = 'threefold repetition';
    return reason ? { over: true, result: 'draw', reason, check } : playing;
  }
}

// Rebuilds a position, with its history, from a start FEN and coordinate
// moves. Throws on a move that is not legal.
export function positionFromMoves(fen = START_FEN, moves = []) {
  const pos = new Position(fen);
  for (const text of moves) {
    const m = findMove(pos, text);
    if (!m) throw new Error(`Illegal move: ${text}`);
    pos.make(m);
  }
  return pos;
}
