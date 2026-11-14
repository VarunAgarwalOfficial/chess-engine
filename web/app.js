// The page: connects the controls to the modules and starts the first
// game. All chess rules live in the Rust engine (engine.wasm); nothing
// here decides what is legal.

import { analysisKind } from './analysis.js';
import { announceGameOver, applySettings, initDialogs, openGame, openNewGame } from './dialogs.js';
import { buildPalette, editorClick, editorDrag, editorFen, loadEditor, typeFen } from './editor.js';
import { START_FEN } from './game.js';
import {
  engineTurn,
  flip,
  goTo,
  hint,
  offerDraw,
  onGameOver,
  openRecord,
  persist,
  resign,
  runReview,
  showBetter,
  startGame,
  stopEngines,
  takeback,
  tick,
  userMove,
} from './play.js';
import { setSound, unlockSound } from './sound.js';
import { $, board, handlers, rules, sentence, settings, state } from './state.js';
import { listGames, saveSettings } from './store.js';
import { graphPly, note, render } from './view.js';

// ----- board -----

Object.assign(handlers, {
  onMove: userMove,
  onPremove: (from, to) => (state.premove = from ? [from, to] : null),
  onEdit: (from, to) => editorChanged(() => editorDrag(from, to)),
  onEditClick: (square) => editorChanged(() => editorClick(square)),
});

// ----- editor -----

function editorChanged(change) {
  change();
  $('editor-note').textContent = '';
  render();
}

function openEditor() {
  stopEngines();
  loadEditor(state.game.fen(state.cursor));
  board.setMarkMode(false);
  render();
}

function closeEditor() {
  state.editor = null;
  render(false);
  engineTurn();
}

$('open-editor').addEventListener('click', () => (state.editor ? closeEditor() : openEditor()));
$('editor-cancel').addEventListener('click', closeEditor);
$('editor-start').addEventListener('click', () => editorChanged(() => loadEditor(START_FEN)));
$('editor-clear').addEventListener('click', () =>
  editorChanged(() => loadEditor('8/8/8/8/8/8/8/8 w - - 0 1')),
);
$('palette').addEventListener('click', (event) => {
  const tool = event.target.closest('[data-tool]')?.dataset.tool;
  if (tool) editorChanged(() => (state.editor.tool = tool));
});
$('editor-fen').addEventListener('change', () => {
  let notes;
  try {
    notes = typeFen($('editor-fen').value);
  } catch (error) {
    $('editor-note').textContent = '';
    $('editor-error').textContent = `That FEN cannot be used. ${sentence(error)}`;
    return;
  }
  $('editor-fen').blur();
  render();
  $('editor-note').textContent = notes.join(' ');
});
$('editor-panel').addEventListener('change', (event) => {
  const { name, value, checked, dataset, id } = event.target;
  if (id === 'editor-fen') return;
  editorChanged(() => {
    if (name === 'editor-turn') state.editor.turn = value;
    if (name === 'editor-ep') state.editor.ep = value;
    if (dataset.castle) state.editor.castling[checked ? 'add' : 'delete'](dataset.castle);
  });
});
$('editor-analyse').addEventListener('click', () => {
  const fen = editorFen();
  state.editor = null;
  persist();
  startGame({ fen, side: 'both', time: null });
});
$('editor-play').addEventListener('click', () => {
  state.pendingFen = rules.describe(editorFen()).fen;
  openNewGame();
});

// ----- panel -----

function newGame() {
  state.pendingFen = null;
  openNewGame();
}

function toggleSound() {
  settings.sound = !settings.sound;
  setSound(settings.sound);
  saveSettings(settings);
  render(false);
}

function toggleMarking() {
  board.setMarkMode(!board.markMode);
  if (board.markMode) note('Drag on the board to draw; tap to mark.', 4000);
  render(false);
}

const buttons = {
  'open-new': newGame,
  'welcome-new': newGame,
  first: () => goTo(0),
  prev: () => goTo(state.cursor - 1),
  next: () => goTo(state.cursor + 1),
  last: () => goTo(state.game.length),
  flip,
  mark: toggleMarking,
  sound: toggleSound,
  takeback,
  hint,
  draw: offerDraw,
  resign,
  'review-run': runReview,
  rematch: () => {
    persist();
    startGame({ fen: state.game.startFen });
  },
};
for (const [id, action] of Object.entries(buttons)) $(id).addEventListener('click', action);

$('moves').addEventListener('click', (event) => {
  const ply = event.target.closest('[data-ply]')?.dataset.ply;
  if (ply) goTo(Number(ply));
});
$('recent').addEventListener('click', (event) => {
  const id = event.target.closest('[data-open]')?.dataset.open;
  if (id) openGame(id);
});
$('review-comment').addEventListener('click', (event) => {
  const index = event.target.closest('[data-better]')?.dataset.better;
  if (index !== undefined) showBetter(Number(index));
});
$('analysis-on').addEventListener('change', (event) => {
  settings[analysisKind()] = event.target.checked;
  saveSettings(settings);
  render(false);
});

// The graph is a slider: click or drag to jump, arrow keys to step.
const graph = $('review-graph');
graph.addEventListener('pointerdown', (event) => {
  graph.setPointerCapture(event.pointerId);
  goTo(graphPly(event));
});
graph.addEventListener('pointermove', (event) => {
  if (graph.hasPointerCapture(event.pointerId)) goTo(graphPly(event));
});

document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea, select, dialog') || state.editor) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const keys = {
    ArrowLeft: () => goTo(state.cursor - 1),
    ArrowRight: () => goTo(state.cursor + 1),
    ArrowUp: () => goTo(0),
    ArrowDown: () => goTo(state.game.length),
    Home: () => goTo(0),
    End: () => goTo(state.game.length),
    f: flip,
    m: toggleSound,
  };
  if (!(event.key in keys)) return;
  event.preventDefault();
  keys[event.key]();
});
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(type, unlockSound, { once: true, capture: true });
}

// The game is saved as the page is left, so that the clocks come back as
// they were.
window.addEventListener('pagehide', persist);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
});

setInterval(tick, 100);
onGameOver(announceGameOver);

// ----- start -----

buildPalette();
initDialogs();
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
  note(sentence(error), 6000);
}
document.body.classList.add('ready');
