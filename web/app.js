// The page: holds the game, draws it, and asks the engine workers for
// moves and analysis. All chess rules live in the Rust engine (engine.wasm);
// nothing here decides what is legal.

import { loadEngine } from './engine.js';
import { EngineClient } from './client.js';
import { Game, START_FEN, parseBoard, boardField } from './game.js';
import { Board, pieceName } from './board.js';
import { Clock, formatClock } from './clock.js';
import { findOpening } from './eco.js';
import { toPgn, gameFromPgn } from './pgn.js';
import { MARKS, finalCp, formatScore, reviewMoves, whiteCp, winChance } from './review.js';
import { playSound, setSound, unlockSound } from './sound.js';
import { deleteGame, listGames, loadSettings, saveGame, saveSettings } from './store.js';
import { describeStatus, material, numberMoves, pickMove } from './text.js';

const $ = (id) => document.getElementById(id);
const make = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const cap = (side) => (side === 'white' ? 'White' : 'Black');
const other = (side) => (side === 'white' ? 'black' : 'white');

// Weaker levels look a move or a few ahead and choose with some noise;
// stronger ones search to a fixed depth; the last has only the clock.
const LEVELS = [
  { name: 'Beginner', depth: 1, noise: 300 },
  { name: 'Novice', depth: 1, noise: 140 },
  { name: 'Casual', depth: 2, noise: 70 },
  { name: 'Improver', depth: 3, noise: 30 },
  { name: 'Club', go: 'depth 5' },
  { name: 'Strong', go: 'depth 8' },
  { name: 'Expert', go: 'depth 11' },
  { name: 'Full strength', go: '' },
];
// Minutes and seconds added per move; null is no clock.
const TIMES = [
  { label: 'No clock', time: null },
  { label: '1 min', time: [1, 0] },
  { label: '3 min', time: [3, 0] },
  { label: '3 + 2', time: [3, 2] },
  { label: '5 min', time: [5, 0] },
  { label: '10 min', time: [10, 0] },
  { label: '15 + 10', time: [15, 10] },
  { label: '30 min', time: [30, 0] },
];

// One copy of the engine answers questions about the rules here; two more,
// in workers, play and analyse.
const rules = await loadEngine(new URL('./engine.wasm', import.meta.url));
const player = new EngineClient();
const analyst = new EngineClient();

const settings = loadSettings();
let game = null;
let gameId = '';
let setup = { side: 'white', level: 5, time: null, names: null, date: '' };
let clock = null;
let cursor = 0; // how many moves into the game the board is showing
let flipped = false;
let thinking = false;
let playToken = 0;
let premove = null;
let analysis = null; // { key, cp, depth, san }
let analysisKey = '';
let analysisTimer = 0;
let review = null; // { evals, best }
let reviewing = null; // { done, total } while a review runs
let reviewToken = 0;
let hintArrow = null;
let betterArrow = null;
let editor = null; // { pieces, turn, castling, tool } while editing
let pendingFen = null; // a set-up position waiting for the new game dialog
let drawnCursor = 0;

const board = new Board($('board'), {
  onMove: userMove,
  onPremove: (from, to) => (premove = from ? [from, to] : null),
  onEdit: editorDrag,
  onEditClick: editorClick,
});

const human = (turn) => setup.side === 'both' || setup.side === turn;
const atEnd = () => cursor === game.length;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ----- starting, saving and reopening games -----

function stopEngines() {
  playToken++;
  reviewToken++;
  thinking = false;
  reviewing = null;
  player.cancel();
  analyst.cancel();
  analysisKey = '';
}

function startGame({ fen = START_FEN, side = setup.side, level = setup.level, time = setup.time }) {
  const fresh = new Game(rules, fen); // throws on a bad FEN, leaving the game as it was
  stopEngines();
  game = fresh;
  gameId = newId();
  setup = { side, level, time, names: null, date: new Date().toISOString().slice(0, 10) };
  clock = time ? new Clock(time[0] * 60000, time[1] * 1000) : null;
  cursor = 0;
  flipped = side === 'black';
  review = null;
  premove = hintArrow = betterArrow = null;
  board.clearPremove();
  Object.assign(settings, { last: { side, level, time }, current: gameId });
  saveSettings(settings);
  render(false);
  engineTurn();
}

function playerName(side) {
  if (setup.names) return setup.names[side];
  if (setup.side === 'both') return cap(side);
  return setup.side === side ? 'You' : `Engine, ${LEVELS[setup.level - 1].name.toLowerCase()}`;
}

function persist() {
  if (!game.length) return;
  const status = game.status();
  saveGame({
    id: gameId,
    ...game.toJSON(),
    setup,
    clock: clock?.snapshot() ?? null,
    review,
    summary: {
      white: playerName('white'),
      black: playerName('black'),
      result: status.over ? status.result : null,
      moves: Math.ceil(game.length / 2),
      opening: findOpening(game.sans())?.name ?? '',
    },
  });
}

function openRecord(record) {
  const opened = Game.fromJSON(rules, record);
  stopEngines();
  game = opened;
  gameId = record.id;
  setup = { side: 'white', level: 5, time: null, names: null, date: '', ...record.setup };
  clock = null;
  if (setup.time && record.clock) {
    clock = new Clock(0, setup.time[1] * 1000);
    clock.restore(record.clock);
    if (!game.status().over) clock.start(game.turn);
  }
  cursor = game.length;
  flipped = setup.side === 'black';
  review = record.review ?? null;
  premove = hintArrow = betterArrow = null;
  board.clearPremove();
  settings.current = gameId;
  saveSettings(settings);
  render(false);
  engineTurn();
}

function headers() {
  const tags = {
    Date: (setup.date || '????.??.??').replace(/-/g, '.'),
    White: playerName('white'),
    Black: playerName('black'),
  };
  if (setup.time) tags.TimeControl = `${setup.time[0] * 60}+${setup.time[1]}`;
  return tags;
}

// ----- moves -----

async function userMove(from, to) {
  const state = game.stateAt(cursor);
  const candidates = state.moves.filter((m) => m.uci.startsWith(from + to));
  if (!candidates.length) return render();
  let uci = candidates[0].uci;
  if (candidates.length > 1) {
    const letter = await board.askPromotion(to, state.turn[0]);
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
  const moves = game.ucis(cursor);
  const fen = game.startFen;
  persist();
  stopEngines();
  game = new Game(rules, fen);
  for (const uci of moves) game.play(uci);
  gameId = newId();
  setup = { ...setup, side: 'both', time: null, names: null };
  clock = null;
  review = null;
  settings.current = gameId;
  saveSettings(settings);
}

function commit(uci) {
  const mover = game.turn;
  const before = clock?.snapshot();
  const ply = game.play(uci);
  if (!ply) return;
  ply.clock = before;
  clock?.press(mover);
  cursor = game.length;
  hintArrow = betterArrow = null;
  if (review || reviewing) {
    reviewToken++;
    review = reviewing = null;
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
  clock?.stop();
  playToken++;
  thinking = false;
  player.cancel();
  premove = null;
  board.clearPremove();
  setTimeout(() => playSound('end'), 250);
}

function endGame(result, reason) {
  if (game.status().over) return;
  game.ending = { result, reason };
  finish();
  persist();
  render();
}

function playPremove() {
  if (!premove) return;
  const [from, to] = premove;
  premove = null;
  board.clearPremove();
  const candidates = game.legalMoves().filter((m) => m.uci.startsWith(from + to));
  const move = candidates.find((m) => m.uci.endsWith('q')) ?? candidates[0];
  if (move) commit(move.uci);
}

function goParameters(level) {
  const mine = clock?.remaining(game.turn);
  if (level.go) {
    // A fixed depth, but never so long that the flag falls.
    return clock ? `${level.go} movetime ${Math.ceil(Math.max(50, mine / 20))}` : level.go;
  }
  if (!clock) return 'movetime 2000';
  const [white, black] = [clock.remaining('white'), clock.remaining('black')].map(Math.ceil);
  return `wtime ${white} btime ${black} winc ${clock.increment} binc ${clock.increment}`;
}

async function engineTurn() {
  if (game.status().over || human(game.turn)) return;
  const token = ++playToken;
  const level = LEVELS[setup.level - 1];
  const started = performance.now();
  const request = { fen: game.startFen, moves: game.ucis() };
  thinking = true;
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
  if (token !== playToken) return;
  thinking = false;
  if (best) commit(best);
  else render();
}

function takeback() {
  if (!game.length) return;
  stopEngines();
  let snapshot;
  do snapshot = game.undo().clock;
  while (game.length && !human(game.turn));
  if (clock && snapshot) {
    clock.restore(snapshot);
    if (game.length) clock.start(game.turn);
  }
  cursor = game.length;
  review = null;
  premove = hintArrow = betterArrow = null;
  board.clearPremove();
  persist();
  render();
  engineTurn();
}

let resignTimer = 0;
function resign() {
  const button = $('resign');
  if (!button.dataset.armed) {
    button.dataset.armed = 'yes';
    button.textContent = 'Confirm';
    resignTimer = setTimeout(disarmResign, 3000);
    return;
  }
  disarmResign();
  const loser = setup.side === 'both' ? game.turn : setup.side;
  endGame(other(loser), 'resignation');
}

function disarmResign() {
  clearTimeout(resignTimer);
  delete $('resign').dataset.armed;
  $('resign').textContent = 'Resign';
}

async function offerDraw() {
  if (setup.side === 'both') return endGame('draw', 'agreement');
  const token = playToken;
  note('Draw offered.');
  const result = await player.run({
    kind: 'go',
    fen: game.startFen,
    moves: game.ucis(),
    go: 'depth 12 movetime 600',
  });
  if (!result || token !== playToken || game.status().over) return;
  // The score is the player's. The engine takes a draw when it stands
  // worse, or when a long game is dead level.
  const worse = result.mate === null ? result.score >= 50 : result.mate > 0;
  const level = result.mate === null && Math.abs(result.score) <= 15 && game.length >= 80;
  if (worse || level) endGame('draw', 'agreement');
  else note('Draw declined.');
}

async function hint() {
  const token = playToken;
  const at = cursor;
  const result = await player.run({
    kind: 'go',
    fen: game.startFen,
    moves: game.ucis(),
    go: 'depth 14 movetime 1000',
  });
  if (!result?.best || token !== playToken || at !== cursor) return;
  hintArrow = { from: result.best.slice(0, 2), to: result.best.slice(2, 4), colour: 'blue' };
  note(`Hint: ${result.san[0]}`, 6000);
  render();
}

function goTo(count) {
  const next = Math.max(0, Math.min(game.length, count));
  if (next === cursor) return;
  cursor = next;
  hintArrow = betterArrow = null;
  render();
}

// ----- analysis and review -----

function syncAnalysis() {
  const key =
    settings.analysis && !editor && !reviewing ? `${gameId} ${cursor} ${game.length}` : '';
  if (key === analysisKey) return;
  analysisKey = key;
  clearTimeout(analysisTimer);
  if (!reviewing) analyst.cancel();
  if (!key) return;
  const state = game.stateAt(cursor);
  if (state.over) {
    analysis = { key, cp: finalCp(state.result), depth: 0, san: [] };
    return;
  }
  const request = { kind: 'analyse', fen: game.startFen, moves: game.ucis(cursor) };
  // A short wait, so that stepping quickly through a game stays smooth.
  analysisTimer = setTimeout(() => {
    analyst.run({ ...request, maxDepth: 24, budget: 4000 }, (result) => {
      if (!result.best || key !== analysisKey) return;
      const cp = whiteCp(result, state.turn === 'white');
      analysis = { key, cp, depth: result.depth, san: result.san };
      renderAnalysis();
    });
  }, 90);
}

async function runReview() {
  if (reviewing || !game.length) return;
  const token = ++reviewToken;
  analyst.cancel();
  clearTimeout(analysisTimer);
  reviewing = { done: 0, total: game.length + 1 };
  render();
  const evals = [];
  const best = [];
  for (let i = 0; i <= game.length; i++) {
    const state = game.stateAt(i);
    if (state.over) {
      evals.push(finalCp(state.result));
      best.push(null);
    } else {
      const request = { kind: 'go', fen: game.startFen, moves: game.ucis(i) };
      const result = await analyst.run({ ...request, go: 'depth 13 movetime 500' });
      if (token !== reviewToken) return;
      if (!result) break;
      evals.push(whiteCp(result, state.turn === 'white'));
      best.push({ uci: result.best, san: result.san[0] });
    }
    reviewing.done = i + 1;
    renderReview();
  }
  reviewing = null;
  if (evals.length === game.length + 1) {
    review = { evals, best };
    persist();
  }
  render();
}

function reviewResult() {
  if (!review) return null;
  const best = review.best.map((b) => b?.uci ?? null);
  return reviewMoves(review.evals, best, game.ucis(), game.start.turn === 'white');
}

// ----- drawing -----

function note(text, time = 3000) {
  $('note').textContent = text;
  clearTimeout(note.timer);
  note.timer = setTimeout(() => ($('note').textContent = ''), time);
}

function render(animate = true) {
  document.body.classList.toggle('editing', Boolean(editor));
  $('play-panel').hidden = Boolean(editor);
  $('editor-panel').hidden = !editor;
  if (editor) {
    renderEditor();
    return;
  }
  renderBoard(animate && Math.abs(cursor - drawnCursor) <= 1);
  drawnCursor = cursor;
  renderPlayers();
  renderStatus();
  renderMoves();
  renderActions();
  renderReview();
  syncAnalysis();
  renderAnalysis();
}

function renderBoard(animate) {
  const state = game.stateAt(cursor);
  const over = game.status().over;
  const pieces = parseBoard(state.fen);
  const live = atEnd() && !over && !reviewing;
  const explore = !atEnd() && !reviewing && (over || setup.side === 'both') && !state.over;
  const mine = (live && human(state.turn)) || explore;
  const last = cursor ? game.plies[cursor - 1].uci : null;
  const king = [...pieces].find(([, code]) => code === `${state.turn[0]}k`)?.[0];
  board.set({
    pieces,
    orientation: flipped ? 'black' : 'white',
    legal: mine ? state.moves : [],
    movable: mine ? state.turn[0] : null,
    premovable: live && !human(state.turn) ? setup.side[0] : null,
    lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : null,
    check: state.check ? king : null,
    edit: false,
    animate,
  });
  board.setArrows([hintArrow, betterArrow].filter(Boolean));
}

function renderPlayers() {
  const state = game.stateAt(cursor);
  const { whiteLost, blackLost, balance } = material(parseBoard(state.fen));
  const over = game.status().over;
  const top = flipped ? 'white' : 'black';
  for (const [id, side] of [
    ['player-top', top],
    ['player-bottom', other(top)],
  ]) {
    const el = $(id);
    el.replaceChildren();
    const name = make('span', 'name', playerName(side));
    name.prepend(make('span', `dot ${side}`));
    el.append(name);
    const taken = make('span', 'taken');
    const lost = side === 'white' ? blackLost : whiteLost;
    let previous = '';
    for (const letter of lost) {
      const piece = make('span', `piece ${side === 'white' ? 'b' : 'w'}${letter}`);
      if (letter !== previous) piece.classList.add('first');
      previous = letter;
      taken.append(piece);
    }
    const lead = side === 'white' ? balance : -balance;
    if (lead > 0) taken.append(make('span', 'lead', `+${lead}`));
    el.append(taken);
    if (thinking && atEnd() && state.turn === side && !human(side)) {
      el.append(make('span', 'thinking', 'thinking'));
    }
    if (clock) {
      const time = make('span', 'clock', formatClock(clock.remaining(side)));
      time.dataset.side = side;
      time.classList.toggle('running', clock.running === side && !over);
      time.classList.toggle('low', clock.remaining(side) < 20000);
      el.append(time);
    }
  }
}

function renderStatus() {
  const status = game.status();
  $('status').textContent = describeStatus(status, game.turn);
  const opening = findOpening(game.sans(cursor));
  $('opening').textContent = opening ? `${opening.eco} ${opening.name}` : '';
}

function renderMoves() {
  const list = $('moves');
  const marks = reviewResult()?.moves;
  const fields = game.startFen.split(' ');
  let number = Number(fields[5]) || 1;
  let white = fields[1] === 'w';
  list.replaceChildren();
  if (!game.length) list.append(make('p', 'help', 'No moves yet.'));
  game.plies.forEach((ply, i) => {
    if (white || i === 0) list.append(make('span', 'number', `${number}.`));
    if (!white && i === 0) list.append(make('span', 'move blank', '…'));
    const button = make('button', 'move', ply.san);
    button.type = 'button';
    const mark = marks?.[i].mark;
    if (mark) {
      button.append(make('span', `mark-sign ${mark}`, MARKS[mark].sign));
      button.title = mark;
    }
    if (i + 1 === cursor) {
      button.classList.add('current');
      button.setAttribute('aria-current', 'true');
    }
    button.addEventListener('click', () => goTo(i + 1));
    list.append(button);
    if (!white) number++;
    white = !white;
  });
  const current = list.querySelector('.current');
  if (current) {
    // Scroll only the list, never the page.
    const [top, bottom] = [current.offsetTop, current.offsetTop + current.offsetHeight];
    if (top < list.scrollTop) list.scrollTop = top - 4;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight + 4;
  } else list.scrollTop = 0;
}

function renderActions() {
  const over = game.status().over;
  const live = !over && atEnd() && !reviewing;
  const myTurn = live && human(game.turn);
  const show = (id, visible, enabled = true) => {
    $(id).hidden = !visible;
    $(id).disabled = !enabled;
  };
  show('takeback', true, game.length > 0 && !reviewing);
  show('hint', !over, myTurn);
  show('draw', !over, myTurn && game.length > 1);
  show('resign', !over, live && game.length > 0);
  show('review-run', game.length > 0 && (over || setup.side === 'both'), !reviewing && !review);
  show('rematch', over);
  $('first').disabled = $('prev').disabled = cursor === 0;
  $('next').disabled = $('last').disabled = atEnd();
  if (over) disarmResign();
}

function renderAnalysis() {
  const on = settings.analysis;
  $('analysis-on').checked = on;
  document.body.classList.toggle('no-analysis', !on);
  // Until the engine reports on this position, show the review's score
  // for it, or keep the last one.
  const fresh = analysis?.key === analysisKey;
  const cp = fresh ? analysis.cp : (review?.evals[cursor] ?? analysis?.cp ?? 0);
  const chance = winChance(cp);
  const bar = $('evalbar');
  bar.querySelector('.fill').style.setProperty('--white', `${chance}%`);
  bar.classList.toggle('flipped', flipped);
  bar.setAttribute('aria-label', `Evaluation ${formatScore(cp)}`);
  $('score').textContent = on ? formatScore(cp) : '';
  $('score').classList.toggle('stale', !fresh);
  $('depth').textContent = on && fresh && analysis.depth ? `depth ${analysis.depth}` : '';
  const line = on && fresh ? numberMoves(analysis.san, game.fen(cursor)).join(' ') : '';
  $('line').textContent = line;
}

function renderReview() {
  const section = $('review');
  const result = reviewResult();
  section.hidden = !reviewing && !result;
  $('review-progress').hidden = !reviewing;
  $('review-table').hidden = $('review-graph').hidden = !result;
  if (reviewing) {
    const share = (reviewing.done / reviewing.total) * 100;
    $('review-progress').firstElementChild.style.width = `${share}%`;
    $('review-comment').textContent = `Reviewing move ${reviewing.done} of ${reviewing.total}`;
    return;
  }
  if (!result) return;

  const body = $('review-table').tBodies[0];
  body.replaceChildren();
  for (const side of ['white', 'black']) {
    const row = body.insertRow();
    const cells = [
      playerName(side),
      result[side].accuracy === null ? '' : `${result[side].accuracy}%`,
      result[side].inaccuracy,
      result[side].mistake,
      result[side].blunder,
    ];
    cells.forEach((text, i) => {
      const cell = i ? row.insertCell() : row.appendChild(make('th'));
      cell.textContent = text;
    });
  }

  // White's winning chance through the game, as an area.
  const graph = $('review-graph');
  const count = review.evals.length - 1;
  const width = Math.max(1, count);
  const points = review.evals.map((cp, i) => `${i},${(100 - winChance(cp)).toFixed(1)}`);
  graph.setAttribute('viewBox', `0 0 ${width} 100`);
  graph.innerHTML =
    `<polygon class="area" points="0,100 ${points.join(' ')} ${width},100" />` +
    `<line class="middle" x1="0" y1="50" x2="${width}" y2="50" />` +
    `<line class="cursor" x1="${cursor}" y1="0" x2="${cursor}" y2="100" />`;
  graph.onclick = (event) => {
    const box = graph.getBoundingClientRect();
    goTo(Math.round(((event.clientX - box.left) / box.width) * width));
  };

  const comment = $('review-comment');
  comment.replaceChildren();
  if (!cursor) return;
  const move = result.moves[cursor - 1];
  const best = review.best[cursor - 1];
  const fields = game.startFen.split(' ');
  const whiteFirst = fields[1] === 'w';
  const number = (Number(fields[5]) || 1) + Math.floor((cursor - 1 + (whiteFirst ? 0 : 1)) / 2);
  const label = `${number}${move.white ? '.' : '...'} ${game.plies[cursor - 1].san}`;
  if (move.mark && best) {
    const article = move.mark === 'inaccuracy' ? 'an' : 'a';
    comment.append(`${label} is ${article} ${move.mark}. Better was `);
    const show = make('button', 'link', best.san);
    show.type = 'button';
    show.title = 'Show on the board';
    show.addEventListener('click', () => {
      const arrow = { from: best.uci.slice(0, 2), to: best.uci.slice(2, 4), colour: 'green' };
      cursor -= 1;
      hintArrow = null;
      betterArrow = arrow;
      render();
    });
    comment.append(show, '.');
  } else if (best && best.uci === game.plies[cursor - 1].uci) {
    comment.textContent = `${label} is the engine's choice.`;
  }
}

// ----- clock -----

setInterval(() => {
  if (!clock || editor) return;
  for (const el of document.querySelectorAll('.clock')) {
    const left = clock.remaining(el.dataset.side);
    el.textContent = formatClock(left);
    el.classList.toggle('low', left < 20000);
  }
  const flagged = clock.running && clock.flagged();
  if (flagged) endGame(other(flagged), 'time');
}, 100);

// ----- board editor -----

function openEditor() {
  stopEngines();
  const fields = game.fen(cursor).split(' ');
  editor = { tool: 'move' };
  loadEditor(fields.join(' '));
  render();
}

function loadEditor(fen) {
  const fields = fen.split(' ');
  editor.pieces = parseBoard(fen);
  editor.turn = fields[1] === 'b' ? 'b' : 'w';
  editor.castling = new Set((fields[2] ?? '').replace('-', ''));
}

function editorFen() {
  const castling = [...'KQkq'].filter((c) => editor.castling.has(c)).join('') || '-';
  return `${boardField(editor.pieces)} ${editor.turn} ${castling} - 0 1`;
}

// The engine decides whether the position can be played.
function editorCheck() {
  try {
    const state = rules.describe(editorFen());
    return state.over ? 'The game is already over in this position.' : '';
  } catch (error) {
    return error.message;
  }
}

function editorDrag(from, to) {
  const piece = editor.pieces.get(from);
  editor.pieces.delete(from);
  if (to && piece) editor.pieces.set(to, piece);
  render();
}

function editorClick(square) {
  const { tool, pieces } = editor;
  if (tool === 'move') return;
  if (tool === 'erase' || pieces.get(square) === tool) pieces.delete(square);
  else pieces.set(square, tool);
  render();
}

function renderEditor() {
  board.set({
    pieces: editor.pieces,
    orientation: flipped ? 'black' : 'white',
    legal: [],
    movable: null,
    premovable: null,
    lastMove: null,
    check: null,
    edit: true,
    animate: false,
  });
  board.setArrows([]);
  $('player-top').replaceChildren();
  $('player-bottom').replaceChildren();
  for (const button of $('palette').children) {
    button.setAttribute('aria-pressed', String(button.dataset.tool === editor.tool));
  }
  for (const radio of document.getElementsByName('editor-turn')) {
    radio.checked = radio.value === editor.turn;
  }
  for (const box of document.querySelectorAll('[data-castle]')) {
    box.checked = editor.castling.has(box.dataset.castle);
  }
  if (document.activeElement !== $('editor-fen')) $('editor-fen').value = editorFen();
  const error = editorCheck();
  $('editor-error').textContent = error;
  $('editor-play').disabled = $('editor-analyse').disabled = Boolean(error);
}

function closeEditor() {
  editor = null;
  render(false);
  engineTurn();
}

function buildPalette() {
  // White pieces in one row and black in the next.
  const row = (colour) => [...'kqrbnp'].map((letter) => colour + letter);
  for (const tool of ['move', ...row('w'), 'erase', ...row('b')]) {
    const button = make('button', tool.length === 2 ? `piece ${tool}` : 'word');
    button.type = 'button';
    button.dataset.tool = tool;
    if (tool.length === 2) button.setAttribute('aria-label', pieceName(tool));
    else button.textContent = tool === 'move' ? 'Move' : 'Erase';
    button.addEventListener('click', () => {
      editor.tool = tool;
      render();
    });
    $('palette').append(button);
  }
}

// ----- dialogs -----

function openNewGame() {
  const last = { side: 'white', level: 5, time: null, ...settings.last };
  for (const radio of document.getElementsByName('side')) radio.checked = radio.value === last.side;
  $('level').value = last.level;
  for (const radio of document.getElementsByName('time')) {
    radio.checked = radio.value === JSON.stringify(last.time);
  }
  $('from-position').hidden = !pendingFen;
  $('use-position').checked = true;
  syncNewGame();
  $('new-dialog').showModal();
}

function syncNewGame() {
  const side = document.querySelector('input[name=side]:checked')?.value;
  $('level-name').textContent = LEVELS[$('level').value - 1].name;
  $('level').disabled = side === 'both';
  $('level-field').classList.toggle('disabled', side === 'both');
}

function buildTimes() {
  for (const { label, time } of TIMES) {
    const wrap = make('label');
    const radio = make('input');
    radio.type = 'radio';
    radio.name = 'time';
    radio.value = JSON.stringify(time);
    wrap.append(radio, make('span', '', label));
    $('time-options').append(wrap);
  }
}

function renderGames() {
  const games = listGames();
  const list = $('games-list');
  list.replaceChildren();
  $('games-empty').hidden = games.length > 0;
  const results = { white: '1-0', black: '0-1', draw: '½-½' };
  for (const record of games) {
    const { white, black, result, moves, opening } = record.summary;
    const item = make('li');
    const open = make('button', 'game');
    open.type = 'button';
    open.append(make('span', 'title', `${white} – ${black}`));
    const when = new Date(record.updated).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });
    const facts = [result ? results[result] : 'In progress', `${moves} moves`, when, opening];
    open.append(make('span', 'facts', facts.filter(Boolean).join(' · ')));
    if (record.id === gameId) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => {
      $('games-dialog').close();
      editor = null;
      persist();
      try {
        openRecord(record);
      } catch (error) {
        note(error.message);
      }
    });
    const remove = make('button', 'quiet', 'Delete');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Delete ${white} – ${black}`);
    remove.addEventListener('click', () => {
      deleteGame(record.id);
      renderGames();
    });
    item.append(open, remove);
    list.append(item);
  }
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    $('position-error').textContent = `${what} copied.`;
  } catch {
    $('position-error').textContent = 'Could not reach the clipboard. Select the text and copy it.';
  }
}

function applySettings() {
  const root = document.documentElement;
  if (settings.mode === 'auto') delete root.dataset.mode;
  else root.dataset.mode = settings.mode;
  root.dataset.board = settings.board;
  setSound(settings.sound);
  board.setOptions({ dots: settings.dots, coordinates: settings.coordinates });
  saveSettings(settings);
}

// ----- wiring -----

$('open-new').addEventListener('click', () => {
  pendingFen = null;
  openNewGame();
});
$('level').addEventListener('input', syncNewGame);
$('new-dialog').addEventListener('change', syncNewGame);
$('new-dialog').addEventListener('close', () => {
  if ($('new-dialog').returnValue !== 'start') return;
  let side = document.querySelector('input[name=side]:checked')?.value ?? 'white';
  if (side === 'random') side = Math.random() < 0.5 ? 'white' : 'black';
  const time = JSON.parse(document.querySelector('input[name=time]:checked')?.value ?? 'null');
  const fen = pendingFen && $('use-position').checked ? pendingFen : START_FEN;
  pendingFen = null;
  editor = null;
  persist();
  startGame({ fen, side, level: Number($('level').value), time });
});

$('open-games').addEventListener('click', () => {
  persist();
  renderGames();
  $('games-dialog').showModal();
});

$('open-position').addEventListener('click', () => {
  $('fen').value = editor ? editorFen() : game.fen(cursor);
  $('pgn').value = toPgn(game, headers());
  $('position-error').textContent = '';
  $('position-dialog').showModal();
});
$('fen-copy').addEventListener('click', () => copy($('fen').value, 'FEN'));
$('pgn-copy').addEventListener('click', () => copy($('pgn').value, 'PGN'));
$('fen-load').addEventListener('click', () => {
  try {
    const state = rules.describe($('fen').value.trim());
    if (state.over) throw new Error('The game is already over in this position.');
    pendingFen = state.fen;
    $('position-dialog').close();
    openNewGame();
  } catch (error) {
    $('position-error').textContent = error.message;
  }
});
$('pgn-load').addEventListener('click', () => {
  try {
    const { game: loaded, headers: tags } = gameFromPgn(rules, $('pgn').value);
    const record = {
      id: newId(),
      ...loaded.toJSON(),
      setup: {
        side: 'both',
        level: setup.level,
        time: null,
        names: { white: tags.White || 'White', black: tags.Black || 'Black' },
        date: /^\d{4}\.\d\d\.\d\d$/.test(tags.Date ?? '') ? tags.Date.replace(/\./g, '-') : '',
      },
    };
    editor = null;
    persist();
    openRecord(record);
    persist();
    $('position-dialog').close();
  } catch (error) {
    $('position-error').textContent = error.message;
  }
});

$('open-editor').addEventListener('click', () => (editor ? closeEditor() : openEditor()));
$('editor-cancel').addEventListener('click', closeEditor);
$('editor-start').addEventListener('click', () => {
  loadEditor(START_FEN);
  render();
});
$('editor-clear').addEventListener('click', () => {
  loadEditor('8/8/8/8/8/8/8/8 w - - 0 1');
  render();
});
$('editor-fen').addEventListener('change', () => {
  try {
    loadEditor(rules.describe($('editor-fen').value.trim()).fen);
  } catch (error) {
    $('editor-error').textContent = error.message;
    return;
  }
  $('editor-fen').blur();
  render();
});
$('editor-panel').addEventListener('change', (event) => {
  if (event.target.name === 'editor-turn') editor.turn = event.target.value;
  const right = event.target.dataset.castle;
  if (right) editor.castling[event.target.checked ? 'add' : 'delete'](right);
  if (event.target.id !== 'editor-fen') render();
});
$('editor-analyse').addEventListener('click', () => {
  const fen = editorFen();
  editor = null;
  persist();
  startGame({ fen, side: 'both', time: null });
});
$('editor-play').addEventListener('click', () => {
  pendingFen = rules.describe(editorFen()).fen;
  openNewGame();
});

$('open-settings').addEventListener('click', () => {
  for (const radio of document.querySelectorAll('input[name=mode], input[name=board]')) {
    radio.checked = settings[radio.name] === radio.value;
  }
  for (const box of document.querySelectorAll('[data-setting]')) {
    box.checked = settings[box.dataset.setting];
  }
  $('settings-dialog').showModal();
});
$('settings-dialog').addEventListener('change', (event) => {
  const input = event.target;
  if (input.dataset.setting) settings[input.dataset.setting] = input.checked;
  else if (input.checked) settings[input.name] = input.value;
  applySettings();
});
$('analysis-on').addEventListener('change', (event) => {
  settings.analysis = event.target.checked;
  saveSettings(settings);
  render();
});

$('first').addEventListener('click', () => goTo(0));
$('prev').addEventListener('click', () => goTo(cursor - 1));
$('next').addEventListener('click', () => goTo(cursor + 1));
$('last').addEventListener('click', () => goTo(game.length));
$('flip').addEventListener('click', flip);
$('takeback').addEventListener('click', takeback);
$('hint').addEventListener('click', hint);
$('draw').addEventListener('click', offerDraw);
$('resign').addEventListener('click', resign);
$('review-run').addEventListener('click', runReview);
$('rematch').addEventListener('click', () => {
  persist();
  startGame({ fen: game.startFen });
});

function flip() {
  flipped = !flipped;
  render(false);
}

document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea, select, dialog') || editor) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const keys = {
    ArrowLeft: () => goTo(cursor - 1),
    ArrowRight: () => goTo(cursor + 1),
    ArrowUp: () => goTo(0),
    ArrowDown: () => goTo(game.length),
    Home: () => goTo(0),
    End: () => goTo(game.length),
    f: flip,
  };
  if (!(event.key in keys)) return;
  event.preventDefault();
  keys[event.key]();
});
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(type, unlockSound, { once: true, capture: true });
}
// Dialogs close on a click outside them.
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// ----- start -----

buildPalette();
buildTimes();
applySettings();

const params = new URLSearchParams(location.search);
const saved = listGames().find((record) => record.id === settings.current);
const first = { side: 'white', level: 5, time: null, ...settings.last };
if (['white', 'black', 'both'].includes(params.get('side'))) first.side = params.get('side');
try {
  if (params.get('fen')) startGame({ ...first, fen: params.get('fen') });
  else if (saved) openRecord(saved);
  else startGame(first);
} catch (error) {
  startGame(first);
  note(error.message, 6000);
}
