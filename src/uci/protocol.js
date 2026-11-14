// The Universal Chess Interface, as text in and text out. This module knows
// nothing about processes or threads: it is given a `send` function for
// output lines and a `backend` that runs searches, so it can be driven by a
// test as easily as by a chess GUI.

import { START_FEN, WHITE } from '../engine/board.js';
import { positionFromMoves } from '../engine/game.js';
import { MATE, MATE_BOUND } from '../engine/search.js';

export const ENGINE_NAME = 'Chess 1.0';
export const ENGINE_AUTHOR = 'Varun Agarwal';

// "position startpos moves e2e4" or "position fen <six fields> moves ...".
export function parsePosition(tokens) {
  const movesAt = tokens.indexOf('moves');
  const head = movesAt < 0 ? tokens : tokens.slice(0, movesAt);
  const moves = movesAt < 0 ? [] : tokens.slice(movesAt + 1);
  if (head[0] === 'startpos') return { fen: START_FEN, moves };
  if (head[0] === 'fen' && head.length > 1) return { fen: head.slice(1).join(' '), moves };
  throw new Error('expected "startpos" or "fen"');
}

const GO_NUMBERS = ['depth', 'nodes', 'movetime', 'wtime', 'btime', 'winc', 'binc', 'movestogo'];

export function parseGo(tokens) {
  const go = { infinite: tokens.includes('infinite') };
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!GO_NUMBERS.includes(tokens[i])) continue;
    const value = Number(tokens[i + 1]);
    if (Number.isFinite(value)) go[tokens[i]] = Math.max(0, Math.trunc(value));
  }
  return go;
}

// Turns "go" parameters into limits for the searcher. With a clock, aim to
// spend an even share of the remaining time plus most of the increment, and
// never more than a fraction of what is left.
export function searchLimits(go, side) {
  const limits = {};
  if (go.depth) limits.depth = go.depth;
  if (go.nodes) limits.nodes = go.nodes;
  if (go.movetime !== undefined) limits.moveTime = go.movetime;
  const clock = side === WHITE ? go.wtime : go.btime;
  if (clock !== undefined && !go.infinite && go.movetime === undefined) {
    const increment = (side === WHITE ? go.winc : go.binc) ?? 0;
    const share = clock / (go.movestogo || 30) + increment * 0.75;
    const ceiling = Math.max(1, clock - 50);
    // Each iteration costs a few times the last, so stop starting new ones
    // at half the share; the hard limit only catches a slow final iteration.
    limits.softTime = Math.min(share / 2, ceiling);
    limits.moveTime = Math.min(share * 2.5, ceiling / 2, ceiling);
  }
  return limits;
}

export function formatScore(score) {
  if (score >= MATE_BOUND) return `mate ${Math.ceil((MATE - score) / 2)}`;
  if (score <= -MATE_BOUND) return `mate ${-Math.ceil((MATE + score) / 2)}`;
  return `cp ${score}`;
}

export function formatInfo({ depth, score, nodes, time, pv }) {
  const nps = Math.round((nodes * 1000) / Math.max(1, time));
  const line = `info depth ${depth} score ${formatScore(score)} nodes ${nodes} nps ${nps} time ${time}`;
  return pv.length ? `${line} pv ${pv.join(' ')}` : line;
}

// backend:
//   go({ fen, moves, limits }, onInfo) -> Promise<{ best }>   (best: text or null)
//   stop()      ask the running search to finish now
//   newGame()   forget everything learned so far
export class UciSession {
  constructor({ send, backend }) {
    this.send = send;
    this.backend = backend;
    this.fen = START_FEN;
    this.moves = [];
    this.side = WHITE;
    this.running = null; // promise of the search in progress
    this.release = null; // lets an infinite search announce its move
  }

  // Handles one input line. Returns false when the engine should exit.
  handle(line) {
    const tokens = line.trim().split(/\s+/);
    const command = tokens[0];
    const rest = tokens.slice(1);
    switch (command) {
      case 'uci':
        this.send(`id name ${ENGINE_NAME}`);
        this.send(`id author ${ENGINE_AUTHOR}`);
        this.send('uciok');
        break;
      case 'isready':
        this.send('readyok');
        break;
      case 'ucinewgame':
        if (!this.running) this.backend.newGame();
        this.setPosition({ fen: START_FEN, moves: [] });
        break;
      case 'position':
        try {
          this.setPosition(parsePosition(rest));
        } catch (error) {
          this.send(`info string ${error.message}`);
        }
        break;
      case 'go':
        this.go(parseGo(rest));
        break;
      case 'stop':
        this.stop();
        break;
      case 'quit':
        this.stop();
        return false;
      default:
        // The protocol says to ignore anything unknown.
        break;
    }
    return true;
  }

  setPosition({ fen, moves }) {
    const pos = positionFromMoves(fen, moves); // throws on bad input
    this.fen = fen;
    this.moves = moves;
    this.side = pos.side;
  }

  stop() {
    this.backend.stop();
    if (this.release) this.release();
  }

  go(go) {
    if (this.running) {
      this.send('info string search already running');
      return;
    }
    const job = { fen: this.fen, moves: this.moves, limits: searchLimits(go, this.side) };
    // "go infinite" may not answer until told to stop, even if the search
    // itself has nothing left to do (a forced mate, for instance).
    const mayAnswer = go.infinite
      ? new Promise((resolve) => {
          this.release = resolve;
        })
      : Promise.resolve();
    const done = this.backend
      .go(job, (info) => this.send(formatInfo(info)))
      .then(async ({ best }) => {
        await mayAnswer;
        this.send(`bestmove ${best ?? '0000'}`);
      })
      .catch((error) => this.send(`info string ${error.message}`))
      .finally(() => {
        this.running = null;
        this.release = null;
      });
    this.running = done;
  }
}
