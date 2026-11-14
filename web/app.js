// The page: draws the board, takes clicks, and asks the engine worker for
// replies. All chess rules live in the Rust engine (engine.wasm); nothing here
// decides what is legal.

import { loadEngine } from './engine.js';
import { Game, START_FEN } from './game.js';
import { PIECE_NAMES, pieceSvg } from './pieces.js';
import { describeScore, describeStatus, moveRows } from './format.js';

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const statusEl = $('status');
const infoEl = $('engine-info');
const movesEl = $('moves');
const fenInput = $('fen');
const fenError = $('fen-error');
const sideSelect = $('side');
const timeSelect = $('time');
const undoButton = $('undo');
const promotionDialog = $('promotion');

const params = new URLSearchParams(location.search);
if (['white', 'black', 'both'].includes(params.get('side'))) sideSelect.value = params.get('side');

// One copy of the engine answers questions about the rules here; a second
// one, in the worker, does the thinking.
const rules = await loadEngine(new URL('./engine.wasm', import.meta.url));

let game = new Game(rules);
let flipped = sideSelect.value === 'black';
let selected = ''; // name of the selected square, e.g. "e2"
let worker = null;
let requestId = 0;
let thinking = false;

const humanPlays = (turn) => sideSelect.value === 'both' || sideSelect.value === turn;

// ----- engine -----

function cancelEngine() {
  if (thinking && worker) {
    // A search cannot be interrupted from outside, so replace the worker.
    worker.terminate();
    worker = null;
  }
  thinking = false;
  requestId++;
}

function askEngine() {
  if (game.status().over || humanPlays(game.turn)) return;
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onEngineReply;
  }
  thinking = true;
  worker.postMessage({
    id: ++requestId,
    fen: game.startFen,
    moves: game.history.map((h) => h.uci),
    milliseconds: Number(timeSelect.value),
  });
  render();
}

function onEngineReply({ data }) {
  if (data.id !== requestId) return;
  thinking = false;
  if (data.error || !data.result.best) {
    infoEl.textContent = data.error ? `Engine error: ${data.error}` : '';
    render();
    return;
  }
  const moverIsWhite = game.turn === 'white';
  game.play(data.result.best);
  infoEl.textContent = `Engine: depth ${data.result.depth}, ${describeScore(data.result, moverIsWhite)}`;
  render();
  askEngine(); // nothing happens unless it is still the engine's turn
}

// ----- moves -----

function commit(move) {
  selected = '';
  game.play(move);
  render();
  askEngine();
}

function choosePromotion(candidates) {
  const form = promotionDialog.querySelector('form');
  form.replaceChildren();
  for (const move of candidates) {
    const letter = move.uci[4];
    const button = document.createElement('button');
    button.type = 'submit';
    button.value = move.uci;
    button.dataset.piece = PIECE_NAMES[letter];
    button.setAttribute('aria-label', PIECE_NAMES[letter]);
    button.innerHTML = pieceSvg(letter, game.turn);
    form.append(button);
  }
  promotionDialog.returnValue = '';
  promotionDialog.showModal();
}

promotionDialog.addEventListener('close', () => {
  const move = promotionDialog.returnValue;
  if (move) commit(move);
  else {
    selected = '';
    render();
  }
});

function onSquareClick(sq) {
  if (thinking || game.status().over || !humanPlays(game.turn)) return;
  const legal = game.legalMoves();
  const candidates = selected ? legal.filter((m) => m.uci.startsWith(selected + sq)) : [];
  if (candidates.length > 1) {
    choosePromotion(candidates);
    return;
  }
  if (candidates.length === 1) {
    commit(candidates[0].uci);
    return;
  }
  selected = sq !== selected && legal.some((m) => m.uci.startsWith(sq)) ? sq : '';
  render();
}

// ----- drawing -----

function buildBoard() {
  boardEl.replaceChildren();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = flipped ? row : 7 - row;
      const file = flipped ? 7 - col : col;
      const sq = 'abcdefgh'[file] + (rank + 1);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `square ${(rank + file) % 2 ? 'light' : 'dark'}`;
      button.dataset.square = sq;
      if (row === 7) button.dataset.file = 'abcdefgh'[file];
      if (col === 0) button.dataset.rank = String(rank + 1);
      button.addEventListener('click', () => onSquareClick(sq));
      boardEl.append(button);
    }
  }
}

function render() {
  const status = game.status();
  const canMove = !thinking && !status.over && humanPlays(game.turn);
  const legal = canMove ? game.legalMoves() : [];
  const targets = new Map();
  for (const m of legal) if (m.uci.startsWith(selected)) targets.set(m.uci.slice(2, 4), m);
  const last = game.history.at(-1)?.uci ?? '';
  const pieces = game.pieces();

  for (const button of boardEl.children) {
    const sq = button.dataset.square;
    const piece = pieces.get(sq);
    let html = button.dataset.rank ? `<span class="rank">${button.dataset.rank}</span>` : '';
    if (piece) html += pieceSvg(piece.letter, piece.colour);
    if (button.dataset.drawn !== html) {
      button.innerHTML = html;
      button.dataset.drawn = html;
    }
    button.dataset.piece = piece ? `${piece.colour} ${PIECE_NAMES[piece.letter]}` : '';
    button.setAttribute('aria-label', piece ? `${sq}, ${button.dataset.piece}` : sq);

    const target = selected ? targets.get(sq) : undefined;
    button.classList.toggle('selected', sq === selected);
    button.classList.toggle('target', target !== undefined);
    button.classList.toggle('capture', target !== undefined && target.capture);
    button.classList.toggle(
      'movable',
      legal.some((m) => m.uci.startsWith(sq)),
    );
    button.classList.toggle('last', last.slice(0, 2) === sq || last.slice(2, 4) === sq);
    button.classList.toggle(
      'check',
      status.check && piece?.letter === 'k' && piece.colour === game.turn,
    );
  }

  statusEl.textContent =
    thinking && !status.over ? 'Engine is thinking…' : describeStatus(status, game.turn);
  undoButton.disabled = game.history.length === 0;
  if (document.activeElement !== fenInput) fenInput.value = game.fen();

  movesEl.replaceChildren();
  const rows = moveRows(
    game.history.map((h) => h.san),
    game.startFen,
  );
  for (const row of rows) {
    const li = document.createElement('li');
    for (const [className, text] of [
      ['number', `${row.number}.`],
      ['white', row.white],
      ['black', row.black],
    ]) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      li.append(span);
    }
    movesEl.append(li);
  }
  movesEl.scrollTop = movesEl.scrollHeight;
}

// ----- controls -----

function startGame(fen = START_FEN) {
  const fresh = new Game(rules, fen); // throws on a bad FEN, leaving the game as it was
  cancelEngine();
  game = fresh;
  selected = '';
  infoEl.textContent = '';
  fenError.textContent = '';
  fenInput.blur();
  render();
  askEngine();
}

$('new').addEventListener('click', () => startGame());

undoButton.addEventListener('click', () => {
  cancelEngine();
  // Take back the engine's reply too, so it is the player's turn again.
  game.undo();
  if (sideSelect.value !== 'both' && !humanPlays(game.turn)) game.undo();
  selected = '';
  infoEl.textContent = '';
  render();
  askEngine();
});

$('flip').addEventListener('click', () => {
  flipped = !flipped;
  buildBoard();
  render();
});

sideSelect.addEventListener('change', () => {
  cancelEngine();
  flipped = sideSelect.value === 'black';
  selected = '';
  buildBoard();
  render();
  askEngine();
});

$('fen-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    startGame(fenInput.value);
  } catch (error) {
    fenError.textContent = error.message;
  }
});

buildBoard();
try {
  startGame(params.get('fen') || START_FEN);
} catch (error) {
  startGame();
  fenError.textContent = error.message;
}
