// The page: draws the board, takes clicks, and asks the engine worker for
// replies. All chess rules live in src/engine; nothing here decides what is
// legal.

import {
  Game,
  START_FEN,
  CAPTURE,
  KING,
  WHITE,
  moveFlags,
  moveFrom,
  movePromotion,
  moveTo,
  pieceColour,
  pieceType,
  squareName,
} from '../src/engine/index.js';
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

let game = new Game();
let flipped = sideSelect.value === 'black';
let selected = -1; // square index of the selected piece
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
  const job = {
    fen: game.startFen,
    moves: game.history.map((h) => h.uci),
    limits: { moveTime: Number(timeSelect.value) },
  };
  worker.postMessage({ id: ++requestId, job });
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
  const { best, depth, score } = data.result;
  const moverIsWhite = game.turn === 'white';
  game.play(best);
  infoEl.textContent = `Engine: depth ${depth}, ${describeScore(score, moverIsWhite)}`;
  render();
  askEngine(); // nothing happens unless it is still the engine's turn
}

// ----- moves -----

function commit(move) {
  selected = -1;
  game.play(move);
  render();
  askEngine();
}

function choosePromotion(candidates) {
  const form = promotionDialog.querySelector('form');
  form.replaceChildren();
  for (const move of candidates) {
    const type = movePromotion(move);
    const button = document.createElement('button');
    button.type = 'submit';
    button.value = String(move);
    button.dataset.piece = PIECE_NAMES[type];
    button.setAttribute('aria-label', PIECE_NAMES[type]);
    button.innerHTML = pieceSvg(type, game.turn);
    form.append(button);
  }
  promotionDialog.returnValue = '';
  promotionDialog.showModal();
}

promotionDialog.addEventListener('close', () => {
  const move = Number(promotionDialog.returnValue);
  if (move) commit(move);
  else {
    selected = -1;
    render();
  }
});

function onSquareClick(sq) {
  if (thinking || game.status().over || !humanPlays(game.turn)) return;
  const legal = game.legalMoves();
  const candidates = legal.filter((m) => moveFrom(m) === selected && moveTo(m) === sq);
  if (candidates.length > 1) {
    choosePromotion(candidates);
    return;
  }
  if (candidates.length === 1) {
    commit(candidates[0]);
    return;
  }
  selected = sq !== selected && legal.some((m) => moveFrom(m) === sq) ? sq : -1;
  render();
}

// ----- drawing -----

function buildBoard() {
  boardEl.replaceChildren();
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = flipped ? row : 7 - row;
      const file = flipped ? 7 - col : col;
      const sq = rank * 16 + file;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `square ${(rank + file) % 2 ? 'light' : 'dark'}`;
      button.dataset.square = squareName(sq);
      if (row === 7) button.dataset.file = 'abcdefgh'[file];
      if (col === 0) button.dataset.rank = String(rank + 1);
      button.addEventListener('click', () => onSquareClick(sq));
      boardEl.append(button);
    }
  }
}

function render() {
  const pos = game.pos;
  const status = game.status();
  const canMove = !thinking && !status.over && humanPlays(game.turn);
  const legal = canMove ? game.legalMoves() : [];
  const targets = new Map();
  for (const m of legal) if (moveFrom(m) === selected) targets.set(moveTo(m), m);
  const last = game.history.at(-1)?.move;
  const checkedKing = status.check ? pos.kingSq[pos.side] : -1;

  for (const button of boardEl.children) {
    const name = button.dataset.square;
    const sq = (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
    const piece = pos.board[sq];
    const colour = pieceColour(piece) === WHITE ? 'white' : 'black';
    let html = button.dataset.rank ? `<span class="rank">${button.dataset.rank}</span>` : '';
    if (piece) html += pieceSvg(pieceType(piece), colour);
    if (button.dataset.drawn !== html) {
      button.innerHTML = html;
      button.dataset.drawn = html;
    }
    button.dataset.piece = piece ? `${colour} ${PIECE_NAMES[pieceType(piece)]}` : '';
    button.setAttribute('aria-label', piece ? `${name}, ${button.dataset.piece}` : name);

    const target = targets.get(sq);
    button.classList.toggle('selected', sq === selected);
    button.classList.toggle('target', target !== undefined);
    button.classList.toggle(
      'capture',
      target !== undefined && Boolean(moveFlags(target) & CAPTURE),
    );
    button.classList.toggle(
      'movable',
      legal.some((m) => moveFrom(m) === sq),
    );
    button.classList.toggle(
      'last',
      last !== undefined && (sq === moveFrom(last) || sq === moveTo(last)),
    );
    button.classList.toggle('check', sq === checkedKing && pieceType(piece) === KING);
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
  const fresh = new Game(fen); // throws on a bad FEN, leaving the game as it was
  cancelEngine();
  game = fresh;
  selected = -1;
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
  selected = -1;
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
  selected = -1;
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
