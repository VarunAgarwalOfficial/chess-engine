// Board state, FEN, make/unmake and attack detection.
//
// The board is a 0x88 array: square = rank * 16 + file, so a1 = 0, h1 = 7,
// a8 = 112. A square index is on the board exactly when (sq & 0x88) === 0,
// which makes stepping off an edge a single test.

import * as Z from './zobrist.js';

export const WHITE = 0;
export const BLACK = 1;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

// A piece is its type plus the colour in bit 3.
export const makePiece = (colour, type) => (colour << 3) | type;
export const pieceType = (piece) => piece & 7;
export const pieceColour = (piece) => piece >> 3;

// Castling rights bits.
export const WK = 1;
export const WQ = 2;
export const BK = 4;
export const BQ = 8;

// Move flags.
export const CAPTURE = 1;
export const EN_PASSANT = 2;
export const CASTLE = 4;
export const DOUBLE_PUSH = 8;

// A move is one integer:
//   bits 0-6 from, 7-13 to, 14-16 promotion type, 17-20 flags,
//   21-23 captured type, 24-26 moving piece type.
export const encodeMove = (from, to, piece, captured = 0, promotion = 0, flags = 0) =>
  from | (to << 7) | (promotion << 14) | (flags << 17) | (captured << 21) | (piece << 24);
export const moveFrom = (m) => m & 127;
export const moveTo = (m) => (m >> 7) & 127;
export const movePromotion = (m) => (m >> 14) & 7;
export const moveFlags = (m) => (m >> 17) & 15;
export const moveCaptured = (m) => (m >> 21) & 7;
export const movePiece = (m) => (m >> 24) & 7;

export const KNIGHT_STEPS = [33, 31, 18, 14, -14, -18, -31, -33];
// The first four are rook directions, the last four bishop directions.
export const RAY_STEPS = [16, -16, 1, -1, 17, 15, -15, -17];

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const PIECE_LETTERS = '.PNBRQK..pnbrqk';

export const fileOf = (sq) => sq & 7;
export const rankOf = (sq) => sq >> 4;
export const squareName = (sq) => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);

export function parseSquare(name) {
  if (!/^[a-h][1-8]$/.test(name)) return -1;
  return (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
}

// Rights that survive a move touching each square.
const CASTLE_KEEP = new Uint8Array(128).fill(15);
CASTLE_KEEP[0] = 15 & ~WQ;
CASTLE_KEEP[4] = 15 & ~(WK | WQ);
CASTLE_KEEP[7] = 15 & ~WK;
CASTLE_KEEP[112] = 15 & ~BQ;
CASTLE_KEEP[116] = 15 & ~(BK | BQ);
CASTLE_KEEP[119] = 15 & ~BK;

export class Position {
  constructor(fen = START_FEN) {
    this.board = new Uint8Array(128);
    this.kingSq = [0, 0];
    this.side = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.hashLo = 0;
    this.hashHi = 0;
    // Undo information, one entry per move made. The hash stacks double as
    // the position history used for repetition detection.
    this.keysLo = [];
    this.keysHi = [];
    this.undoState = [];
    this.setFen(fen);
  }

  setFen(fen) {
    const fields = String(fen).trim().split(/\s+/);
    if (fields.length < 2) throw new Error('FEN needs at least a board and a side to move');
    const [placement, side, castling = '-', ep = '-', halfmove = '0', fullmove = '1'] = fields;

    const board = new Uint8Array(128);
    const kings = [[], []];
    const ranks = placement.split('/');
    if (ranks.length !== 8) throw new Error('FEN board must have 8 ranks');
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of ranks[i]) {
        if (ch >= '1' && ch <= '8') {
          file += Number(ch);
          continue;
        }
        const piece = PIECE_LETTERS.indexOf(ch);
        if (piece < 1 || ch === '.' || file > 7) throw new Error(`Bad FEN rank: ${ranks[i]}`);
        const sq = rank * 16 + file;
        if (pieceType(piece) === PAWN && (rank === 0 || rank === 7)) {
          throw new Error('FEN has a pawn on the first or last rank');
        }
        if (pieceType(piece) === KING) kings[pieceColour(piece)].push(sq);
        board[sq] = piece;
        file++;
      }
      if (file !== 8) throw new Error(`Bad FEN rank: ${ranks[i]}`);
    }
    if (kings[WHITE].length !== 1 || kings[BLACK].length !== 1) {
      throw new Error('FEN must have exactly one king per side');
    }
    if (side !== 'w' && side !== 'b') throw new Error('FEN side to move must be w or b');
    if (!/^(-|[KQkq]{1,4})$/.test(castling)) throw new Error('Bad FEN castling field');
    if (ep !== '-' && !/^[a-h][36]$/.test(ep)) throw new Error('Bad FEN en passant field');
    if (!/^\d+$/.test(halfmove) || !/^\d+$/.test(fullmove)) throw new Error('Bad FEN counters');

    this.board = board;
    this.kingSq = [kings[WHITE][0], kings[BLACK][0]];
    this.side = side === 'w' ? WHITE : BLACK;

    // Keep only rights whose king and rook are still at home.
    const at = (sq, colour, type) => board[sq] === makePiece(colour, type);
    let rights = 0;
    if (at(4, WHITE, KING)) {
      if (castling.includes('K') && at(7, WHITE, ROOK)) rights |= WK;
      if (castling.includes('Q') && at(0, WHITE, ROOK)) rights |= WQ;
    }
    if (at(116, BLACK, KING)) {
      if (castling.includes('k') && at(119, BLACK, ROOK)) rights |= BK;
      if (castling.includes('q') && at(112, BLACK, ROOK)) rights |= BQ;
    }
    this.castling = rights;

    this.ep = -1;
    if (ep !== '-') {
      const sq = parseSquare(ep);
      const mover = this.side ^ 1;
      const pawnSq = sq + (mover === WHITE ? 16 : -16);
      const rightRank = rankOf(sq) === (mover === WHITE ? 2 : 5);
      if (rightRank && at(pawnSq, mover, PAWN) && this.pawnCanTakeOn(pawnSq, this.side)) {
        this.ep = sq;
      }
    }

    this.halfmove = Number(halfmove);
    this.fullmove = Math.max(1, Number(fullmove));
    this.keysLo = [];
    this.keysHi = [];
    this.undoState = [];
    const [lo, hi] = this.computeHash();
    this.hashLo = lo;
    this.hashHi = hi;

    if (this.isAttacked(this.kingSq[this.side ^ 1], this.side)) {
      throw new Error('FEN is illegal: the side not to move is in check');
    }
    return this;
  }

  // True when a pawn of `colour` stands beside `pawnSq`, so it could capture
  // en passant. The en passant square is only recorded in that case, which
  // keeps repetition detection exact.
  pawnCanTakeOn(pawnSq, colour) {
    const pawn = makePiece(colour, PAWN);
    const left = pawnSq - 1;
    const right = pawnSq + 1;
    return (
      (!(left & 0x88) && this.board[left] === pawn) ||
      (!(right & 0x88) && this.board[right] === pawn)
    );
  }

  fen() {
    const ranks = [];
    for (let rank = 7; rank >= 0; rank--) {
      let row = '';
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = this.board[rank * 16 + file];
        if (!piece) {
          empty++;
          continue;
        }
        if (empty) row += empty;
        empty = 0;
        row += PIECE_LETTERS[piece];
      }
      if (empty) row += empty;
      ranks.push(row);
    }
    let rights = '';
    if (this.castling & WK) rights += 'K';
    if (this.castling & WQ) rights += 'Q';
    if (this.castling & BK) rights += 'k';
    if (this.castling & BQ) rights += 'q';
    return [
      ranks.join('/'),
      this.side === WHITE ? 'w' : 'b',
      rights || '-',
      this.ep >= 0 ? squareName(this.ep) : '-',
      this.halfmove,
      this.fullmove,
    ].join(' ');
  }

  // Hash from scratch. make() keeps the same value incrementally.
  computeHash() {
    let lo = 0;
    let hi = 0;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) continue;
      const piece = this.board[sq];
      if (!piece) continue;
      lo ^= Z.PIECE_LO[piece * 128 + sq];
      hi ^= Z.PIECE_HI[piece * 128 + sq];
    }
    lo ^= Z.CASTLE_LO[this.castling];
    hi ^= Z.CASTLE_HI[this.castling];
    if (this.ep >= 0) {
      lo ^= Z.EP_LO[this.ep & 7];
      hi ^= Z.EP_HI[this.ep & 7];
    }
    if (this.side === BLACK) {
      lo ^= Z.SIDE_LO;
      hi ^= Z.SIDE_HI;
    }
    return [lo, hi];
  }

  isAttacked(sq, by) {
    const board = this.board;
    let s;

    const pawn = makePiece(by, PAWN);
    const back = by === WHITE ? -16 : 16;
    s = sq + back - 1;
    if (!(s & 0x88) && board[s] === pawn) return true;
    s = sq + back + 1;
    if (!(s & 0x88) && board[s] === pawn) return true;

    const knight = makePiece(by, KNIGHT);
    for (let i = 0; i < 8; i++) {
      s = sq + KNIGHT_STEPS[i];
      if (!(s & 0x88) && board[s] === knight) return true;
    }

    const king = makePiece(by, KING);
    const queen = makePiece(by, QUEEN);
    for (let i = 0; i < 8; i++) {
      const step = RAY_STEPS[i];
      const slider = makePiece(by, i < 4 ? ROOK : BISHOP);
      s = sq + step;
      if (!(s & 0x88) && board[s] === king) return true;
      while (!(s & 0x88)) {
        const piece = board[s];
        if (piece) {
          if (piece === slider || piece === queen) return true;
          break;
        }
        s += step;
      }
    }
    return false;
  }

  inCheck() {
    return this.isAttacked(this.kingSq[this.side], this.side ^ 1);
  }

  make(m) {
    const board = this.board;
    const from = m & 127;
    const to = (m >> 7) & 127;
    const promotion = (m >> 14) & 7;
    const flags = (m >> 17) & 15;
    const us = this.side;
    const them = us ^ 1;
    const piece = board[from];

    this.keysLo.push(this.hashLo);
    this.keysHi.push(this.hashHi);
    this.undoState.push(this.castling | ((this.ep + 1) << 4) | (this.halfmove << 12));

    let lo = this.hashLo ^ Z.CASTLE_LO[this.castling];
    let hi = this.hashHi ^ Z.CASTLE_HI[this.castling];
    if (this.ep >= 0) {
      lo ^= Z.EP_LO[this.ep & 7];
      hi ^= Z.EP_HI[this.ep & 7];
    }

    this.halfmove++;
    if (flags & CAPTURE) {
      const capSq = flags & EN_PASSANT ? to + (us === WHITE ? -16 : 16) : to;
      const captured = board[capSq];
      board[capSq] = 0;
      lo ^= Z.PIECE_LO[captured * 128 + capSq];
      hi ^= Z.PIECE_HI[captured * 128 + capSq];
      this.halfmove = 0;
    }

    const placed = promotion ? makePiece(us, promotion) : piece;
    board[from] = 0;
    board[to] = placed;
    lo ^= Z.PIECE_LO[piece * 128 + from] ^ Z.PIECE_LO[placed * 128 + to];
    hi ^= Z.PIECE_HI[piece * 128 + from] ^ Z.PIECE_HI[placed * 128 + to];

    const type = piece & 7;
    if (type === PAWN) this.halfmove = 0;
    else if (type === KING) this.kingSq[us] = to;

    if (flags & CASTLE) {
      const kingside = (to & 7) === 6;
      const rookFrom = kingside ? to + 1 : to - 2;
      const rookTo = kingside ? to - 1 : to + 1;
      const rook = board[rookFrom];
      board[rookFrom] = 0;
      board[rookTo] = rook;
      lo ^= Z.PIECE_LO[rook * 128 + rookFrom] ^ Z.PIECE_LO[rook * 128 + rookTo];
      hi ^= Z.PIECE_HI[rook * 128 + rookFrom] ^ Z.PIECE_HI[rook * 128 + rookTo];
    }

    this.castling &= CASTLE_KEEP[from] & CASTLE_KEEP[to];
    lo ^= Z.CASTLE_LO[this.castling];
    hi ^= Z.CASTLE_HI[this.castling];

    this.ep = -1;
    if (flags & DOUBLE_PUSH && this.pawnCanTakeOn(to, them)) {
      this.ep = (from + to) >> 1;
      lo ^= Z.EP_LO[this.ep & 7];
      hi ^= Z.EP_HI[this.ep & 7];
    }

    this.side = them;
    if (us === BLACK) this.fullmove++;
    this.hashLo = lo ^ Z.SIDE_LO;
    this.hashHi = hi ^ Z.SIDE_HI;
  }

  unmake(m) {
    const board = this.board;
    const from = m & 127;
    const to = (m >> 7) & 127;
    const flags = (m >> 17) & 15;
    const them = this.side;
    const us = them ^ 1;

    this.side = us;
    if (us === BLACK) this.fullmove--;
    const state = this.undoState.pop();
    this.castling = state & 15;
    this.ep = ((state >> 4) & 255) - 1;
    this.halfmove = state >> 12;
    this.hashLo = this.keysLo.pop();
    this.hashHi = this.keysHi.pop();

    const piece = makePiece(us, (m >> 24) & 7);
    board[to] = 0;
    board[from] = piece;
    if ((piece & 7) === KING) this.kingSq[us] = from;

    if (flags & CAPTURE) {
      const capSq = flags & EN_PASSANT ? to + (us === WHITE ? -16 : 16) : to;
      board[capSq] = makePiece(them, (m >> 21) & 7);
    }
    if (flags & CASTLE) {
      const kingside = (to & 7) === 6;
      const rookFrom = kingside ? to + 1 : to - 2;
      const rookTo = kingside ? to - 1 : to + 1;
      board[rookFrom] = board[rookTo];
      board[rookTo] = 0;
    }
  }

  // A null move passes the turn. The search uses it for pruning.
  makeNull() {
    this.keysLo.push(this.hashLo);
    this.keysHi.push(this.hashHi);
    this.undoState.push(this.castling | ((this.ep + 1) << 4) | (this.halfmove << 12));
    if (this.ep >= 0) {
      this.hashLo ^= Z.EP_LO[this.ep & 7];
      this.hashHi ^= Z.EP_HI[this.ep & 7];
      this.ep = -1;
    }
    this.halfmove = 0;
    this.side ^= 1;
    this.hashLo ^= Z.SIDE_LO;
    this.hashHi ^= Z.SIDE_HI;
  }

  unmakeNull() {
    this.side ^= 1;
    const state = this.undoState.pop();
    this.ep = ((state >> 4) & 255) - 1;
    this.halfmove = state >> 12;
    this.hashLo = this.keysLo.pop();
    this.hashHi = this.keysHi.pop();
  }

  // How many times the current position has occurred, counting now. Only
  // positions since the last capture or pawn move can match.
  repetitionCount() {
    let count = 1;
    const n = this.keysLo.length;
    const first = Math.max(0, n - this.halfmove);
    for (let i = n - 2; i >= first; i -= 2) {
      if (this.keysLo[i] === this.hashLo && this.keysHi[i] === this.hashHi) count++;
    }
    return count;
  }

  // Neither side can possibly mate: bare kings, a single minor piece, or
  // only bishops that all stand on the same colour of square.
  insufficientMaterial() {
    let knights = 0;
    let lightBishops = 0;
    let darkBishops = 0;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) continue;
      const type = this.board[sq] & 7;
      if (type === 0 || type === KING) continue;
      if (type === KNIGHT) knights++;
      else if (type === BISHOP) {
        if (((sq >> 4) + (sq & 7)) & 1) lightBishops++;
        else darkBishops++;
      } else return false;
    }
    if (knights === 0) return lightBishops === 0 || darkBishops === 0;
    return knights === 1 && lightBishops + darkBishops === 0;
  }
}
