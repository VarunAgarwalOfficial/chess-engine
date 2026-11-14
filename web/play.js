// Playing: starting, saving and reopening games, making moves, and what
// the engine is asked while a game is on. Which moves are legal and when
// the game is over come from the engine.

import { reviewGame, stopAnalysis } from './analysis.js';
import { Clock } from './clock.js';
import { findOpening } from './eco.js';
import { Game, START_FEN, cannotMate } from './game.js';
import { LEVELS } from './levels.js';
import { playSound } from './sound.js';
import {
  atEnd,
  board,
  human,
  newId,
  other,
  player,
  playerName,
  rules,
  settings,
  state,
} from './state.js';
import { saveGame, saveSettings } from './store.js';
import { pickMove } from './text.js';
import { clearNote, note, render, renderClocks, renderReview } from './view.js';

let resignTimer = 0;
let whenOver = () => {};

// `callback` runs each time a game ends while it is being played.
export const onGameOver = (callback) => (whenOver = callback);

function disarmResign() {
  clearTimeout(resignTimer);
  state.resignArmed = false;
}

function clearBoardNotes() {
  state.premove = state.hintArrow = state.betterArrow = null;
  board.clearPremove();
}

export function stopEngines() {
  state.playToken++;
  state.reviewToken++;
  state.thinking = false;
  state.reviewing = null;
  disarmResign();
  clearNote();
  player.cancel();
  stopAnalysis();
}

// ----- starting, saving and reopening games -----

export function startGame(options = {}) {
  const { setup } = state;
  const { fen = START_FEN, side = setup.side, level = setup.level, time = setup.time } = options;
  const fresh = new Game(rules, fen); // throws on a bad FEN, leaving the game as it was
  stopEngines();
  state.game = fresh;
  state.gameId = newId();
  state.setup = { side, level, time, names: null, date: new Date().toISOString().slice(0, 10) };
  state.clock = time ? new Clock(time[0] * 60000, time[1] * 1000) : null;
  state.cursor = 0;
  state.flipped = side === 'black';
  state.review = null;
  clearBoardNotes();
  Object.assign(settings, { last: { side, level, time }, current: state.gameId });
  saveSettings(settings);
  render(false);
  engineTurn();
}

export function persist() {
  const { game, clock } = state;
  if (!game?.length) return;
  const status = game.status();
  saveGame({
    id: state.gameId,
    ...game.toJSON(),
    setup: state.setup,
    clock: clock?.snapshot() ?? null,
    review: state.review,
    summary: {
      white: playerName('white'),
      black: playerName('black'),
      result: status.over ? status.result : null,
      moves: Math.ceil(game.length / 2),
      opening: findOpening(game.sans())?.name ?? '',
    },
  });
}

export function openRecord(record) {
  const opened = Game.fromJSON(rules, record); // throws on a record that cannot be replayed
  stopEngines();
  state.game = opened;
  state.gameId = record.id;
  state.setup = { side: 'white', level: 5, time: null, names: null, date: '', ...record.setup };
  state.clock = null;
  if (state.setup.time && record.clock) {
    state.clock = new Clock(0, state.setup.time[1] * 1000);
    state.clock.restore(record.clock);
    if (!opened.status().over && opened.length) state.clock.start(opened.turn);
  }
  state.cursor = opened.length;
  state.flipped = state.setup.side === 'black';
  state.review = record.review ?? null;
  clearBoardNotes();
  settings.current = state.gameId;
  saveSettings(settings);
  render(false);
  engineTurn();
}

// ----- moves -----

export async function userMove(from, to) {
  const { game, cursor, setup } = state;
  const position = game.stateAt(cursor);
  const candidates = position.moves.filter((m) => m.uci.startsWith(from + to));
  if (!candidates.length) return render();
  let uci = candidates[0].uci;
  if (candidates.length > 1) {
    const letter = await board.askPromotion(to, position.turn[0]);
    if (!letter) return render();
    uci = from + to + letter;
  }
  if (!atEnd()) {
    if (setup.side === 'both' && !game.ending) game.truncate(cursor);
    else branch();
  }
  commit(uci);
}

// A move made while looking back at a finished game starts a new game,
// for both sides, from that point. The finished one stays saved.
function branch() {
  const moves = state.game.ucis(state.cursor);
  const fen = state.game.startFen;
  persist();
  stopEngines();
  state.game = new Game(rules, fen);
  for (const uci of moves) state.game.play(uci);
  state.gameId = newId();
  state.setup = { ...state.setup, side: 'both', time: null, names: null };
  state.clock = null;
  state.review = null;
  settings.current = state.gameId;
  saveSettings(settings);
}

function commit(uci) {
  const { game, clock } = state;
  const mover = game.turn;
  const before = clock?.snapshot();
  const ply = game.play(uci);
  if (!ply) return;
  ply.clock = before;
  clock?.press(mover);
  state.cursor = game.length;
  state.hintArrow = state.betterArrow = null;
  if (state.review || state.reviewing) {
    state.reviewToken++;
    state.review = state.reviewing = null;
  }
  const status = game.status();
  playSound(status.check ? 'check' : ply.capture ? 'capture' : 'move');
  if (status.over) finish();
  persist();
  render();
  if (status.over) return;
  if (human(game.turn)) playPremove();
  else engineTurn();
}

function finish() {
  clearNote();
  disarmResign();
  state.clock?.stop();
  state.playToken++;
  state.thinking = false;
  player.cancel();
  state.premove = null;
  board.clearPremove();
  setTimeout(() => playSound('end'), 250);
  whenOver();
}

// Ends the game other than on the board. `extra` is kept with the ending.
function endGame(result, reason, extra = {}) {
  if (state.game.status().over) return;
  state.game.ending = { result, reason, ...extra };
  finish();
  persist();
  render();
}

function playPremove() {
  if (!state.premove) return;
  const [from, to] = state.premove;
  state.premove = null;
  board.clearPremove();
  const candidates = state.game.legalMoves().filter((m) => m.uci.startsWith(from + to));
  const move = candidates.find((m) => m.uci.endsWith('q')) ?? candidates[0];
  if (move) commit(move.uci);
}

function goParameters(level) {
  const { clock, game } = state;
  const mine = clock?.remaining(game.turn);
  if (level.go) {
    // A fixed depth, but never so long that the flag falls.
    return clock ? `${level.go} movetime ${Math.ceil(Math.max(50, mine / 20))}` : level.go;
  }
  if (!clock) return 'movetime 2000';
  const [white, black] = [clock.remaining('white'), clock.remaining('black')].map(Math.ceil);
  return `wtime ${white} btime ${black} winc ${clock.increment} binc ${clock.increment}`;
}

export async function engineTurn() {
  const { game, clock } = state;
  if (game.status().over || human(game.turn)) return;
  const token = ++state.playToken;
  const level = LEVELS[state.setup.level - 1];
  const started = performance.now();
  const request = { fen: game.startFen, moves: game.ucis() };
  state.thinking = true;
  render();
  let best;
  if (level.noise) {
    const candidates = game.legalMoves().map((m) => m.uci);
    const go = `depth ${level.depth}`;
    const scores = await player.run({ kind: 'scores', ...request, candidates, go });
    best = scores && pickMove(scores, level.noise);
  } else {
    const result = await player.run({ kind: 'go', ...request, go: goParameters(level) });
    best = result?.best;
  }
  // An instant reply is hard to follow; give it a moment.
  const pause = Math.min(350, (clock?.remaining(game.turn) ?? Infinity) / 40);
  const wait = pause - (performance.now() - started);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  if (token !== state.playToken) return;
  state.thinking = false;
  if (best) commit(best);
  else render();
}

export function takeback() {
  const { game, clock } = state;
  if (!game.length) return;
  stopEngines();
  let snapshot;
  do snapshot = game.undo().clock;
  while (game.length && !human(game.turn));
  if (clock && snapshot) {
    clock.restore(snapshot);
    if (game.length) clock.start(game.turn);
  }
  state.cursor = game.length;
  state.review = null;
  clearBoardNotes();
  persist();
  render();
  engineTurn();
}

// The first press asks; a second within three seconds resigns.
export function resign() {
  if (!state.resignArmed) {
    state.resignArmed = true;
    resignTimer = setTimeout(() => {
      disarmResign();
      render();
    }, 3000);
    render();
    return;
  }
  const loser = state.setup.side === 'both' ? state.game.turn : state.setup.side;
  endGame(other(loser), 'resignation');
}

export async function offerDraw() {
  const { game } = state;
  if (state.setup.side === 'both') return endGame('draw', 'agreement');
  const token = state.playToken;
  note('Draw offered.');
  const result = await player.run({
    kind: 'go',
    fen: game.startFen,
    moves: game.ucis(),
    go: 'depth 12 movetime 600',
  });
  if (!result || token !== state.playToken || game.status().over) return;
  // The score is the player's. The engine takes a draw when it stands
  // worse, or when a long game is dead level.
  const worse = result.mate === null ? result.score >= 50 : result.mate > 0;
  const level = result.mate === null && Math.abs(result.score) <= 15 && game.length >= 80;
  if (worse || level) endGame('draw', 'agreement');
  else note('Draw declined.');
}

export async function hint() {
  const { game } = state;
  const token = state.playToken;
  const at = state.cursor;
  const result = await player.run({
    kind: 'go',
    fen: game.startFen,
    moves: game.ucis(),
    go: 'depth 14 movetime 1000',
  });
  if (!result?.best || token !== state.playToken || at !== state.cursor) return;
  const [from, to] = [result.best.slice(0, 2), result.best.slice(2, 4)];
  state.hintArrow = { from, to, colour: 'blue' };
  note(`Hint: ${result.san[0]}`, 6000);
  render();
}

// ----- looking back -----

export function goTo(count) {
  const next = Math.max(0, Math.min(state.game.length, count));
  if (next === state.cursor) return;
  state.cursor = next;
  state.hintArrow = state.betterArrow = null;
  render();
}

export function flip() {
  state.flipped = !state.flipped;
  render(false);
}

export async function runReview() {
  if (state.reviewing || !state.game.length) return;
  // The first call redraws everything, since the board is locked meanwhile.
  let draw = render;
  const progress = () => {
    draw();
    draw = renderReview;
  };
  if (await reviewGame(progress)) persist();
  render();
}

// The better move the review found for move `index`, as an arrow on the
// position it was missed in.
export function showBetter(index) {
  const best = state.review?.best[index];
  if (!best) return;
  const [from, to] = [best.uci.slice(0, 2), best.uci.slice(2, 4)];
  state.cursor = index;
  state.hintArrow = null;
  state.betterArrow = { from, to, colour: 'green' };
  render();
}

// ----- clock -----

// When a flag falls the other side wins, unless it could never have
// given mate: then the game is drawn.
export function tick() {
  const { clock, game } = state;
  if (!clock || state.editor) return;
  renderClocks();
  const flagged = clock.running && clock.flagged();
  if (!flagged) return;
  if (cannotMate(rules, game.fen(), other(flagged))) endGame('draw', 'time', { side: flagged });
  else endGame(other(flagged), 'time');
}
