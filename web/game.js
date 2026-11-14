// A game as the page sees it: the start position and the moves played.
// Everything about the rules is asked of the engine.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// What stands where, read off a FEN: square name -> "wk", "bp", ...
export function parseBoard(fen) {
  const pieces = new Map();
  fen
    .split(' ')[0]
    .split('/')
    .forEach((row, i) => {
      let file = 0;
      for (const c of row) {
        if (c >= '1' && c <= '8') {
          file += Number(c);
          continue;
        }
        const colour = c === c.toUpperCase() ? 'w' : 'b';
        pieces.set('abcdefgh'[file] + (8 - i), colour + c.toLowerCase());
        file++;
      }
    });
  return pieces;
}

// The board field of a FEN from a map of squares.
export function boardField(pieces) {
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (const file of 'abcdefgh') {
      const piece = pieces.get(file + rank);
      if (!piece) {
        empty++;
        continue;
      }
      if (empty) row += empty;
      empty = 0;
      row += piece[0] === 'w' ? piece[1].toUpperCase() : piece[1];
    }
    rows.push(row + (empty || ''));
  }
  return rows.join('/');
}

// Whether `side` ('white' or 'black') could never give mate with the
// pieces it has, whatever the other side did. The engine is asked about the
// same position with the other side reduced to its king.
export function cannotMate(engine, fen, side) {
  const colour = side[0];
  const kept = [...parseBoard(fen)].filter(([, code]) => code[0] === colour || code[1] === 'k');
  const field = boardField(new Map(kept));
  // With the wrong side to move the position may be refused, or be a
  // stalemate, which says nothing about the material.
  for (const turn of [colour, colour === 'w' ? 'b' : 'w']) {
    try {
      const { reason } = engine.describe(`${field} ${turn} - - 0 1`);
      if (reason !== 'stalemate') return reason === 'insufficient material';
    } catch {
      // Try with the other side to move.
    }
  }
  return false;
}

export class Game {
  // Throws on a FEN the engine rejects.
  constructor(engine, fen = START_FEN) {
    this.engine = engine;
    this.start = engine.describe(fen);
    this.startFen = this.start.fen;
    // Each ply: { uci, san, capture, state }, state being the engine's
    // description of the position after the move.
    this.plies = [];
    // Set when the game ends other than on the board: { result, reason }.
    this.ending = null;
  }

  get length() {
    return this.plies.length;
  }

  // The position after `count` moves.
  stateAt(count = this.length) {
    return count === 0 ? this.start : this.plies[count - 1].state;
  }

  get state() {
    return this.stateAt();
  }

  get turn() {
    return this.state.turn;
  }

  fen(count) {
    return this.stateAt(count).fen;
  }

  ucis(count = this.length) {
    return this.plies.slice(0, count).map((p) => p.uci);
  }

  sans(count = this.length) {
    return this.plies.slice(0, count).map((p) => p.san);
  }

  // { over, result, reason, check }. result is 'white', 'black' or 'draw'.
  status() {
    const { over, result, reason, check } = this.state;
    if (!over && this.ending) return { over: true, ...this.ending, check };
    return { over, result, reason, check };
  }

  legalMoves() {
    return this.status().over ? [] : this.state.moves;
  }

  // Plays a move given in coordinate text. Returns the ply, or null when
  // the move is not legal here.
  play(uci) {
    const move = this.legalMoves().find((m) => m.uci === uci);
    if (!move) return null;
    const state = this.engine.describe(this.startFen, [...this.ucis(), uci]);
    const ply = { ...move, state };
    this.plies.push(ply);
    return ply;
  }

  // Drops everything after the first `count` moves.
  truncate(count) {
    this.plies.length = Math.max(0, Math.min(count, this.plies.length));
    this.ending = null;
  }

  undo() {
    const ply = this.plies.at(-1) ?? null;
    this.truncate(this.length - 1);
    return ply;
  }

  // A plain record for storage, and back.
  toJSON() {
    return { fen: this.startFen, moves: this.ucis(), ending: this.ending };
  }

  static fromJSON(engine, record) {
    const game = new Game(engine, record.fen);
    for (const uci of record.moves) if (!game.play(uci)) throw new Error(`Illegal move: ${uci}`);
    game.ending = game.state.over ? null : (record.ending ?? null);
    return game;
  }
}
