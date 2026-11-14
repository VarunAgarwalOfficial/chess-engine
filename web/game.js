// A game as the page sees it: the start position and the moves played.
// Everything about the rules is asked of the engine.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class Game {
  // Throws on a FEN the engine rejects.
  constructor(engine, fen = START_FEN) {
    this.engine = engine;
    this.state = engine.describe(fen);
    this.startFen = this.state.fen;
    // Each entry: { uci, san, capture }.
    this.history = [];
  }

  get turn() {
    return this.state.turn;
  }

  fen() {
    return this.state.fen;
  }

  // { over, result, reason, check }. result is 'white', 'black' or 'draw'.
  status() {
    const { over, result, reason, check } = this.state;
    return { over, result, reason, check };
  }

  legalMoves() {
    return this.state.over ? [] : this.state.moves;
  }

  // Plays a move given in coordinate text. Returns the history entry, or
  // null when the move is not legal here.
  play(uci) {
    const move = this.legalMoves().find((m) => m.uci === uci);
    if (!move) return null;
    this.history.push(move);
    this.refresh();
    return move;
  }

  undo() {
    const entry = this.history.pop() ?? null;
    if (entry) this.refresh();
    return entry;
  }

  refresh() {
    this.state = this.engine.describe(
      this.startFen,
      this.history.map((h) => h.uci),
    );
  }

  // What stands where, read off the FEN: square name -> { letter, colour }.
  pieces() {
    const pieces = new Map();
    this.state.fen
      .split(' ')[0]
      .split('/')
      .forEach((row, i) => {
        let file = 0;
        for (const c of row) {
          if (c >= '1' && c <= '8') {
            file += Number(c);
            continue;
          }
          const colour = c === c.toUpperCase() ? 'white' : 'black';
          pieces.set('abcdefgh'[file] + (8 - i), { letter: c.toLowerCase(), colour });
          file++;
        }
      });
    return pieces;
  }
}
