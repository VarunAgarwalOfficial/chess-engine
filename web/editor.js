// The board editor: set up any position the engine accepts. Whether a
// position can be played, which castling rights it can carry and where an
// en passant capture is possible are all asked of the engine.

import { pieceName } from './board.js';
import { boardField, parseBoard } from './game.js';
import { $, board, cap, make, rules, sentence, state } from './state.js';

const CASTLES = {
  K: 'White cannot castle kingside: its king must be on e1 and a rook on h1.',
  Q: 'White cannot castle queenside: its king must be on e1 and a rook on a1.',
  k: 'Black cannot castle kingside: its king must be on e8 and a rook on h8.',
  q: 'Black cannot castle queenside: its king must be on e8 and a rook on a8.',
};

export function loadEditor(fen) {
  const fields = fen.split(' ');
  const editor = (state.editor ??= { tool: 'move' });
  editor.pieces = parseBoard(fen);
  editor.turn = fields[1] === 'b' ? 'b' : 'w';
  editor.castling = new Set((fields[2] ?? '').replace('-', ''));
  editor.ep = fields[3] ?? '-';
}

function fenWith(castling, ep) {
  const { pieces, turn } = state.editor;
  return `${boardField(pieces)} ${turn} ${castling || '-'} ${ep} 0 1`;
}

export function editorFen() {
  const { castling, ep } = state.editor;
  return fenWith([...'KQkq'].filter((c) => castling.has(c)).join(''), ep);
}

// What the engine keeps of every castling right and en passant square
// offered to it: { castling: Set, ep: [squares] }, or null when it rejects
// the board.
function allowed() {
  try {
    const castling = new Set(rules.describe(fenWith('KQkq', '-')).fen.split(' ')[2]);
    const rank = state.editor.turn === 'w' ? 6 : 3;
    const ep = [...'abcdefgh']
      .map((file) => file + rank)
      .filter((square) => rules.describe(fenWith('', square)).fen.split(' ')[3] === square);
    return { castling, ep };
  } catch {
    return null;
  }
}

const sides = { w: 'white', b: 'black' };

// The engine's refusal, with what on this board caused it.
function explain(error) {
  const { pieces, turn } = state.editor;
  const codes = [...pieces.values()];
  if (error.message.includes('one king')) {
    const count = (code) => codes.filter((c) => c === code).length;
    return `Each side needs exactly one king: White has ${count('wk')}, Black has ${count('bk')}.`;
  }
  if (error.message.includes('pawns cannot')) {
    const squares = [...pieces].filter(([sq, code]) => code[1] === 'p' && /[18]/.test(sq[1]));
    return `Pawns cannot stand on the first or last rank: move the one on ${squares
      .map(([sq]) => sq)
      .join(', ')}.`;
  }
  if (error.message.includes('not to move is in check')) {
    const mover = cap(sides[turn]);
    const waiting = cap(sides[turn === 'w' ? 'b' : 'w']);
    return `${waiting} is in check, so it cannot be ${mover} to move. Change the side to move, or block the check.`;
  }
  return sentence(error);
}

// Why the position cannot be played, or '' when it can.
export function editorProblem() {
  let position;
  try {
    position = rules.describe(editorFen());
  } catch (error) {
    return explain(error);
  }
  if (!position.over) return '';
  const mover = cap(position.turn);
  if (position.reason === 'checkmate') return `${mover} is already checkmated here.`;
  if (position.reason === 'stalemate') return `${mover} has no legal move here: stalemate.`;
  return 'Neither side has enough pieces to give mate, so this is already a draw.';
}

// Takes a FEN typed in. Returns what the engine dropped from it, as
// sentences; throws when the text is not a position at all.
export function typeFen(text) {
  const typed = text.trim().split(/\s+/);
  let kept;
  try {
    kept = rules.describe(typed.join(' ')).fen;
  } catch (error) {
    // A board that can be shown is shown, with what is wrong with it.
    if (!/king|pawns cannot|in check/.test(error.message)) throw error;
    loadEditor(typed.join(' '));
    return [];
  }
  const fields = kept.split(' ');
  const notes = [];
  for (const right of (typed[2] ?? '').replace('-', '')) {
    if (!fields[2].includes(right)) notes.push(CASTLES[right]);
  }
  if (typed[3] && typed[3] !== '-' && fields[3] === '-') {
    notes.push(`No pawn can capture en passant on ${typed[3]}, so that square was dropped.`);
  }
  loadEditor(kept);
  return notes;
}

export function editorDrag(from, to) {
  const { pieces } = state.editor;
  const piece = pieces.get(from);
  pieces.delete(from);
  if (to && piece) pieces.set(to, piece);
}

export function editorClick(square) {
  const { tool, pieces } = state.editor;
  if (tool === 'move') return;
  if (tool === 'erase' || pieces.get(square) === tool) pieces.delete(square);
  else pieces.set(square, tool);
}

export function renderEditor() {
  const { editor } = state;
  // Rights and squares the position can no longer carry are let go. A
  // board the engine rejects keeps what it had until it is put right.
  const answer = allowed();
  const can = answer ?? { castling: new Set('KQkq'), ep: [editor.ep].filter((sq) => sq !== '-') };
  editor.castling = new Set([...editor.castling].filter((right) => can.castling.has(right)));
  if (!can.ep.includes(editor.ep)) editor.ep = '-';

  board.set({
    pieces: editor.pieces,
    orientation: state.flipped ? 'black' : 'white',
    legal: [],
    movable: null,
    premovable: null,
    lastMove: null,
    check: null,
    edit: true,
    animate: false,
  });
  board.setArrows([]);
  for (const button of $('palette').children) {
    button.setAttribute('aria-pressed', String(button.dataset.tool === editor.tool));
  }
  for (const radio of document.getElementsByName('editor-turn')) {
    radio.checked = radio.value === editor.turn;
  }
  for (const box of document.querySelectorAll('[data-castle]')) {
    const right = box.dataset.castle;
    box.checked = editor.castling.has(right);
    box.disabled = !can.castling.has(right);
    box.parentElement.title = box.disabled ? CASTLES[right] : '';
  }

  const options = $('ep-options');
  options.replaceChildren();
  for (const square of ['-', ...can.ep]) {
    const label = make('label');
    const radio = make('input');
    radio.type = 'radio';
    radio.name = 'editor-ep';
    radio.value = square;
    radio.checked = square === editor.ep;
    label.append(radio, make('span', '', square === '-' ? 'None' : square));
    options.append(label);
  }
  $('ep-help').textContent =
    can.ep.length || !answer
      ? ''
      : `Not possible here: no ${cap(sides[editor.turn])} pawn stands beside a pawn that could just have moved two squares.`;

  if (document.activeElement !== $('editor-fen')) $('editor-fen').value = editorFen();
  const problem = editorProblem();
  $('editor-error').textContent = problem;
  $('editor-play').disabled = $('editor-analyse').disabled = Boolean(problem);
}

export function buildPalette() {
  // White pieces in one row and black in the next.
  const row = (colour) => [...'kqrbnp'].map((letter) => colour + letter);
  for (const tool of ['move', ...row('w'), 'erase', ...row('b')]) {
    const button = make('button', tool.length === 2 ? `piece ${tool}` : 'word');
    button.type = 'button';
    button.dataset.tool = tool;
    if (tool.length === 2) button.setAttribute('aria-label', pieceName(tool));
    else button.textContent = tool === 'move' ? 'Move' : 'Erase';
    $('palette').append(button);
  }
}
