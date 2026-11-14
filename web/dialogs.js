// The dialogs: new game, saved games, position (FEN and PGN), settings,
// and the one shown when a game ends.

import { editorFen } from './editor.js';
import { START_FEN } from './game.js';
import { LEVELS, TIMES } from './levels.js';
import { gameFromPgn, toPgn } from './pgn.js';
import { openRecord, persist, runReview, startGame } from './play.js';
import { setSound } from './sound.js';
import { $, board, make, newId, playerName, rules, sentence, settings, state } from './state.js';
import { deleteGame, listGames, saveSettings } from './store.js';
import { describeOutcome } from './text.js';
import { gameButton, note, render } from './view.js';

// ----- new game -----

export function openNewGame() {
  const last = { side: 'white', level: 5, time: null, ...settings.last };
  for (const radio of document.getElementsByName('side')) radio.checked = radio.value === last.side;
  $('level').value = last.level;
  for (const radio of document.getElementsByName('time')) {
    radio.checked = radio.value === JSON.stringify(last.time);
  }
  $('from-position').hidden = !state.pendingFen;
  $('use-position').checked = true;
  syncNewGame();
  // Escape and a click outside leave the last value in place.
  $('new-dialog').returnValue = '';
  $('new-dialog').showModal();
}

function syncNewGame() {
  const side = document.querySelector('input[name=side]:checked')?.value;
  const level = LEVELS[$('level').value - 1];
  $('level-name').textContent = level.name;
  $('level-about').textContent = level.about;
  $('level').setAttribute('aria-valuetext', level.name);
  $('level').disabled = side === 'both';
  $('level-field').classList.toggle('disabled', side === 'both');
}

function startFromDialog() {
  let side = document.querySelector('input[name=side]:checked')?.value ?? 'white';
  if (side === 'random') side = Math.random() < 0.5 ? 'white' : 'black';
  const time = JSON.parse(document.querySelector('input[name=time]:checked')?.value ?? 'null');
  const fen = state.pendingFen && $('use-position').checked ? state.pendingFen : START_FEN;
  state.pendingFen = null;
  state.editor = null;
  persist();
  startGame({ fen, side, level: Number($('level').value), time });
}

// ----- saved games -----

export function openGame(id) {
  const record = listGames().find((game) => game.id === id);
  if (!record) return;
  state.editor = null;
  persist();
  try {
    openRecord(record);
  } catch (error) {
    note(sentence(error));
  }
}

function renderGames() {
  const games = listGames();
  const list = $('games-list');
  list.replaceChildren();
  $('games-empty').hidden = games.length > 0;
  for (const record of games) {
    const item = make('li');
    const remove = make('button', 'quiet', 'Delete');
    remove.type = 'button';
    remove.dataset.remove = record.id;
    remove.setAttribute('aria-label', `Delete ${record.summary.white} – ${record.summary.black}`);
    item.append(gameButton(record), remove);
    list.append(item);
  }
}

// ----- position -----

function headers() {
  const { setup } = state;
  const tags = {
    Date: (setup.date || '????.??.??').replace(/-/g, '.'),
    White: playerName('white'),
    Black: playerName('black'),
  };
  if (setup.time) tags.TimeControl = `${setup.time[0] * 60}+${setup.time[1]}`;
  return tags;
}

const currentPgn = () => toPgn(state.game, headers());

// Puts text on the clipboard and says so in `where`.
async function copy(text, what, where) {
  try {
    await navigator.clipboard.writeText(text);
    where.textContent = `${what} copied.`;
  } catch {
    where.textContent = 'Could not reach the clipboard. Open Position and copy the text there.';
  }
}

function loadFen() {
  try {
    const position = rules.describe($('fen').value.trim());
    if (position.over) throw new Error('The game is already over in this position.');
    state.pendingFen = position.fen;
    $('position-dialog').close();
    openNewGame();
  } catch (error) {
    $('position-error').textContent = sentence(error);
  }
}

function loadPgn() {
  try {
    const { game, headers: tags } = gameFromPgn(rules, $('pgn').value);
    const record = {
      id: newId(),
      ...game.toJSON(),
      setup: {
        side: 'both',
        level: state.setup.level,
        time: null,
        names: { white: tags.White || 'White', black: tags.Black || 'Black' },
        date: /^\d{4}\.\d\d\.\d\d$/.test(tags.Date ?? '') ? tags.Date.replace(/\./g, '-') : '',
      },
    };
    state.editor = null;
    persist();
    openRecord(record);
    persist();
    $('position-dialog').close();
  } catch (error) {
    $('position-error').textContent = sentence(error);
  }
}

// ----- settings -----

export function applySettings() {
  const root = document.documentElement;
  if (settings.mode === 'auto') delete root.dataset.mode;
  else root.dataset.mode = settings.mode;
  root.dataset.board = settings.board;
  setSound(settings.sound);
  board.setOptions({ dots: settings.dots, coordinates: settings.coordinates });
  saveSettings(settings);
}

function openSettings() {
  for (const radio of document.querySelectorAll('input[name=mode], input[name=board]')) {
    radio.checked = settings[radio.name] === radio.value;
  }
  for (const box of document.querySelectorAll('[data-setting]')) {
    box.checked = settings[box.dataset.setting];
  }
  $('settings-dialog').showModal();
}

// ----- game over -----

// Shown a moment after the last move, so that the move is seen first.
export function announceGameOver() {
  const { game, gameId } = state;
  setTimeout(() => {
    const status = game.status();
    if (state.game !== game || state.gameId !== gameId || !status.over || state.editor) return;
    const { title, detail } = describeOutcome(status, state.setup.side);
    $('over-title').textContent = title;
    $('over-detail').textContent = detail;
    $('over-note').textContent = '';
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    $('over-dialog').showModal();
  }, 700);
}

// ----- wiring -----

export function initDialogs() {
  for (const { label, time } of TIMES) {
    const wrap = make('label');
    const radio = make('input');
    radio.type = 'radio';
    radio.name = 'time';
    radio.value = JSON.stringify(time);
    wrap.append(radio, make('span', '', label));
    $('time-options').append(wrap);
  }

  $('level').addEventListener('input', syncNewGame);
  $('new-dialog').addEventListener('change', syncNewGame);
  $('new-dialog').addEventListener('close', () => {
    if ($('new-dialog').returnValue === 'start') startFromDialog();
  });

  $('open-games').addEventListener('click', () => {
    persist();
    renderGames();
    $('games-dialog').showModal();
  });
  $('games-list').addEventListener('click', (event) => {
    const open = event.target.closest('[data-open]');
    const remove = event.target.closest('[data-remove]');
    if (open) {
      $('games-dialog').close();
      openGame(open.dataset.open);
    } else if (remove) {
      deleteGame(remove.dataset.remove);
      renderGames();
      render(false);
    }
  });

  $('open-position').addEventListener('click', () => {
    $('fen').value = state.editor ? editorFen() : state.game.fen(state.cursor);
    $('pgn').value = currentPgn();
    $('position-error').textContent = '';
    $('position-dialog').showModal();
  });
  $('fen-copy').addEventListener('click', () => copy($('fen').value, 'FEN', $('position-error')));
  $('pgn-copy').addEventListener('click', () => copy($('pgn').value, 'PGN', $('position-error')));
  $('fen-load').addEventListener('click', loadFen);
  $('pgn-load').addEventListener('click', loadPgn);

  $('open-settings').addEventListener('click', openSettings);
  $('settings-dialog').addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset.setting) settings[input.dataset.setting] = input.checked;
    else if (input.checked) settings[input.name] = input.value;
    applySettings();
    render(false);
  });

  $('over-rematch').addEventListener('click', () => {
    $('over-dialog').close();
    persist();
    startGame({ fen: state.game.startFen });
  });
  $('over-review').addEventListener('click', () => {
    $('over-dialog').close();
    runReview();
  });
  $('over-copy').addEventListener('click', () => copy(currentPgn(), 'PGN', $('over-note')));

  // Dialogs close on a click outside them.
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
}
