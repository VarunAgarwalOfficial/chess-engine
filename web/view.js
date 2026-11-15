// Drawing: everything on the page that follows from the state. Nothing
// here changes the game; clicks are wired up in app.js.

import { analysisKind, analysisOn, reviewResult, syncAnalysis } from './analysis.js';
import { formatClock } from './clock.js';
import { findOpening } from './eco.js';
import { renderEditor } from './editor.js';
import { START_FEN, parseBoard } from './game.js';
import { LEVELS, timeLabel } from './levels.js';
import { MARKS, formatScore, winChance } from './review.js';
import { $, atEnd, board, cap, human, make, other, playerName, settings, state } from './state.js';
import { listGames } from './store.js';
import {
  describeOutcome,
  describeScore,
  describeStatus,
  material,
  numberMoves,
  plainMove,
} from './text.js';

let drawnCursor = 0;
let noteTimer = 0;

// A short message beside the status that goes away by itself.
export function note(text, time = 3000) {
  $('note').textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(clearNote, time);
}

export function clearNote() {
  clearTimeout(noteTimer);
  $('note').textContent = '';
}

// Lists that are rebuilt on every draw, and what in each takes the focus
// back when the element that had it is gone.
const REBUILT = {
  moves: '[tabindex="0"]',
  'ep-options': 'input:checked',
  'review-comment': 'button',
};

export function render(animate = true) {
  const focused = document.activeElement?.closest('#moves, #ep-options, #review-comment')?.id;
  draw(animate);
  if (!focused || $(focused).contains(document.activeElement)) return;
  const next = $(focused).querySelector(REBUILT[focused]) ?? $('review-graph');
  next.focus({ preventScroll: true });
}

function draw(animate) {
  const editing = Boolean(state.editor);
  document.body.classList.toggle('editing', editing);
  $('play-panel').hidden = editing;
  $('editor-panel').hidden = !editing;
  $('open-editor').setAttribute('aria-pressed', String(editing));
  if (editing) {
    $('player-top').replaceChildren();
    $('player-bottom').replaceChildren();
    renderEditor();
    renderAnalysis();
    return;
  }
  renderBoard(animate && Math.abs(state.cursor - drawnCursor) <= 1);
  drawnCursor = state.cursor;
  renderPlayers();
  renderStatus();
  renderMoves();
  renderActions();
  renderReview();
  syncAnalysis(renderAnalysis);
  renderAnalysis();
  showCurrentMove();
}

function renderBoard(animate) {
  const { game, cursor, setup } = state;
  const position = game.stateAt(cursor);
  const over = game.status().over;
  const pieces = parseBoard(position.fen);
  const live = atEnd() && !over && !state.reviewing;
  const explore = !atEnd() && !state.reviewing && (over || setup.side === 'both') && !position.over;
  const mine = (live && human(position.turn)) || explore;
  const last = cursor ? game.plies[cursor - 1].uci : null;
  const king = [...pieces].find(([, code]) => code === `${position.turn[0]}k`)?.[0];
  board.set({
    pieces,
    orientation: state.flipped ? 'black' : 'white',
    legal: mine ? position.moves : [],
    movable: mine ? position.turn[0] : null,
    premovable: live && !human(position.turn) ? setup.side[0] : null,
    lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : null,
    check: position.check ? king : null,
    edit: false,
    animate,
  });
  board.setArrows([state.hintArrow, state.betterArrow].filter(Boolean));
}

function renderPlayers() {
  const { game, cursor, clock } = state;
  const position = game.stateAt(cursor);
  const { whiteLost, blackLost, balance } = material(
    parseBoard(position.fen),
    parseBoard(game.startFen),
  );
  const over = game.status().over;
  const top = state.flipped ? 'white' : 'black';
  for (const [id, side] of [
    ['player-top', top],
    ['player-bottom', other(top)],
  ]) {
    const el = $(id);
    el.replaceChildren();
    const name = make('span', 'name', seatName(side));
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
    if (state.thinking && atEnd() && position.turn === side && !human(side)) {
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

// Who sits on a side, with the colour named: "Black: the engine, level 5 of 8".
function seatName(side) {
  const { setup } = state;
  if (setup.names) return `${cap(side)}: ${setup.names[side]}`;
  if (setup.side === 'both') return cap(side);
  if (setup.side === side) return `${cap(side)}: you`;
  return `${cap(side)}: the engine, level ${setup.level} of ${LEVELS.length}`;
}

// Who made a move on `side`, for the line under the board.
function actor(side) {
  const { setup } = state;
  if (setup.names) return `${setup.names[side]} (${cap(side)})`;
  if (setup.side === 'both') return cap(side);
  return setup.side === side ? `You (${cap(side)})` : `The engine (${cap(side)})`;
}

// The clocks alone, between full redraws.
export function renderClocks() {
  for (const el of document.querySelectorAll('.clock')) {
    const left = state.clock.remaining(el.dataset.side);
    el.textContent = formatClock(left);
    el.classList.toggle('low', left < 20000);
  }
}

function renderStatus() {
  const { game, cursor } = state;
  $('status').textContent = describeStatus(game.status(), game.turn);
  const opening = findOpening(game.sans(cursor));
  $('opening').textContent = opening ? `Opening: ${opening.name}` : '';
  renderHappened();
}

// What the move shown did, in words, and how the game ended.
function renderHappened() {
  const { game, cursor } = state;
  if (game.length === 0) return; // the welcome says what is set up
  let text;
  if (cursor === 0) {
    text = 'The start of the game, before any move. Forward steps through the moves.';
  } else {
    const ply = game.plies[cursor - 1];
    const side = game.stateAt(cursor - 1).turn;
    text = `${actor(side)} ${plainMove(ply.san, ply.uci)}, written ${moveLabel(cursor)}.`;
    if (atEnd() && cursor >= 2 && !human(side) && human(game.stateAt(cursor - 2).turn)) {
      const mine = game.plies[cursor - 2];
      const by = actor(game.stateAt(cursor - 2).turn);
      text = `${by} ${plainMove(mine.san, mine.uci)}, written ${moveLabel(cursor - 1)}. ${actor(side)} replied: it ${plainMove(ply.san, ply.uci)}, written ${moveLabel(cursor)}.`;
    }
    if (!atEnd()) text = `Looking back at move ${cursor} of ${game.length}. ${text}`;
  }
  const status = game.status();
  if (atEnd() && status.over) {
    const { title, detail } = describeOutcome(status, state.setup.side);
    text += ` ${title}. ${detail}`;
  } else if (atEnd() && state.thinking) {
    text += ' The engine is thinking about its reply.';
  }
  $('happened').textContent = text;
}

// A saved game as a button: who played, how it went, when.
export function gameButton(record) {
  const { white, black, result, moves, opening } = record.summary;
  const results = { white: '1-0', black: '0-1', draw: '½-½' };
  const button = make('button', 'game');
  button.type = 'button';
  button.dataset.open = record.id;
  button.append(make('span', 'title', `${white} – ${black}`));
  const when = new Date(record.updated).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
  const facts = [
    result ? results[result] : 'In progress',
    `${moves} ${moves === 1 ? 'move' : 'moves'}`,
    when,
    opening,
  ];
  button.append(make('span', 'facts', facts.filter(Boolean).join(' · ')));
  if (record.id === state.gameId) button.setAttribute('aria-current', 'true');
  return button;
}

// Before the first move the panel says what is set up and offers the
// games played before.
function renderWelcome() {
  const { setup, game } = state;
  const level = LEVELS[setup.level - 1].name;
  const clock = setup.time ? `a ${timeLabel(setup.time)} clock` : 'no clock';
  const engine = `the engine at level ${setup.level} of ${LEVELS.length} (${level.toLowerCase()})`;
  let text;
  if (setup.side === 'both') {
    text = 'You move both sides here: two players at one board, or a position to study.';
  } else if (setup.side === 'white') {
    text = `You have White against ${engine}, with ${clock}. Move a piece to start.`;
  } else {
    text = `You have Black against ${engine}, with ${clock}. The engine moves first.`;
  }
  $('welcome-title').textContent =
    game.startFen === START_FEN ? 'New game' : 'New game from a set-up position';
  $('happened').textContent = `Nothing has been played yet. ${text}`;
  const recent = listGames()
    .filter((record) => record.id !== state.gameId)
    .slice(0, 3);
  $('recent-title').hidden = $('recent').hidden = !recent.length;
  $('recent').replaceChildren(
    ...recent.map((record) => {
      const item = make('li');
      item.append(gameButton(record));
      return item;
    }),
  );
}

function renderMoves() {
  const { game, cursor } = state;
  const list = $('moves');
  const empty = game.length === 0;
  $('welcome').hidden = !empty;
  list.hidden = empty;
  if (empty) {
    renderWelcome();
    return;
  }
  const marks = reviewResult()?.moves;
  const fields = game.startFen.split(' ');
  let number = Number(fields[5]) || 1;
  let white = fields[1] === 'w';
  list.replaceChildren();
  game.plies.forEach((ply, i) => {
    if (white || i === 0) list.append(make('span', 'number', `${number}.`));
    if (!white && i === 0) list.append(make('span', 'move blank', '…'));
    const button = make('button', 'move', ply.san);
    button.type = 'button';
    button.dataset.ply = i + 1;
    const mark = marks?.[i].mark;
    if (mark) {
      button.append(make('span', `mark-sign ${mark}`, MARKS[mark].sign));
      button.title = mark[0].toUpperCase() + mark.slice(1);
    }
    // One stop for the Tab key: the move shown. The arrow keys do the rest.
    button.tabIndex = i + 1 === Math.max(1, cursor) ? 0 : -1;
    if (i + 1 === cursor) {
      button.classList.add('current');
      button.setAttribute('aria-current', 'true');
    }
    list.append(button);
    if (!white) number++;
    white = !white;
  });
}

// Brings the current move into view, scrolling only the list, never the
// page. Done last, when everything around the list has its final size.
function showCurrentMove() {
  const list = $('moves');
  const current = list.querySelector('.current');
  if (!current) {
    list.scrollTop = 0;
    return;
  }
  const [top, bottom] = [current.offsetTop, current.offsetTop + current.offsetHeight];
  if (top < list.scrollTop) list.scrollTop = top - 4;
  else if (bottom > list.scrollTop + list.clientHeight)
    list.scrollTop = bottom - list.clientHeight + 4;
}

function renderActions() {
  const { game, cursor, setup, review, reviewing } = state;
  const over = game.status().over;
  const live = !over && atEnd() && !reviewing;
  const myTurn = live && human(game.turn);
  const show = (id, visible, enabled = true) => {
    $(id).hidden = !visible;
    $(id).disabled = !enabled;
  };
  const started = game.length > 0;
  show('takeback', started, !reviewing);
  show('hint', !over, myTurn);
  show('draw', !over && started, myTurn && game.length > 1);
  show('resign', !over && started, live);
  document.querySelector('.nav').hidden = !started;
  show('review-run', game.length > 0 && (over || setup.side === 'both') && !review, !reviewing);
  show('rematch', over);
  $('resign').textContent = state.resignArmed ? 'Confirm' : 'Resign';
  $('resign').classList.toggle('armed', state.resignArmed);
  $('first').disabled = $('prev').disabled = cursor === 0;
  $('next').disabled = $('last').disabled = atEnd();
  $('sound').setAttribute('aria-pressed', String(settings.sound));
  $('sound').textContent = settings.sound ? 'Sound: on' : 'Sound: off';
  $('mark').setAttribute('aria-pressed', String(board.markMode));
  $('mark').textContent = board.markMode ? 'Draw arrows: on' : 'Draw arrows: off';
}

export function renderAnalysis() {
  const { analysis, review, cursor, game } = state;
  const on = analysisOn();
  $('analysis-on').checked = on;
  document.body.classList.toggle('no-analysis', !on);
  // Until the engine reports on this position, show the review's score
  // for it, or keep the last one.
  const fresh = on && analysis?.key === state.analysisKey;
  const cp = fresh ? analysis.cp : (review?.evals[cursor] ?? analysis?.cp ?? 0);
  const bar = $('evalbar');
  bar.querySelector('.fill').style.setProperty('--white', `${winChance(cp)}%`);
  bar.classList.toggle('flipped', state.flipped);
  bar.setAttribute('aria-label', on ? `Evaluation ${formatScore(cp)}` : 'Evaluation hidden');
  // A finished game has a result, not a score.
  const ended = game.stateAt(cursor);
  const result = { white: '1-0', black: '0-1', draw: '½-½' }[ended.result];
  $('score').textContent = on ? (ended.over ? result : formatScore(cp)) : '';
  $('score').classList.toggle('stale', !fresh);
  let words = '';
  if (!on) {
    if (!state.editor && analysisKind() === 'playAnalysis') {
      words =
        "Hidden while you play, so that it cannot give moves away. Switch it on to see the engine's score and a bar above the board.";
    } else if (!state.editor) words = 'Switched off.';
  } else if (ended.over) {
    words = 'The game is over, so this is the result: 1-0 means White won, 0-1 Black, ½-½ a draw.';
  } else {
    words = describeScore(cp);
    if (fresh && analysis.depth) words += ` It looked ${analysis.depth} half-moves ahead.`;
    words +=
      " The bar above the board shows the same: the light part is White's share of the winning chances.";
  }
  $('depth').textContent = words;
  $('line').textContent =
    fresh && analysis.san.length
      ? `Best moves it sees from here: ${numberMoves(analysis.san, game.fen(cursor)).join(' ')}`
      : '';
}

// Which move a pointer on the evaluation graph is over.
export function graphPly(event) {
  const box = $('review-graph').getBoundingClientRect();
  const count = state.game.length;
  return Math.round(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * count);
}

function moveLabel(ply) {
  const { game } = state;
  const fields = game.startFen.split(' ');
  const whiteFirst = fields[1] === 'w';
  const number = (Number(fields[5]) || 1) + Math.floor((ply - 1 + (whiteFirst ? 0 : 1)) / 2);
  const white = (ply % 2 === 1) === whiteFirst;
  return `${number}${white ? '.' : '...'} ${game.plies[ply - 1].san}`;
}

export function renderReview() {
  const { reviewing, review, cursor, game } = state;
  const result = reviewResult();
  $('review').hidden = !reviewing && !result;
  $('review-progress').hidden = !reviewing;
  $('review-body').hidden = !result || Boolean(reviewing);
  const comment = $('review-comment');
  if (reviewing) {
    const share = (reviewing.done / reviewing.total) * 100;
    $('review-progress').firstElementChild.style.width = `${share}%`;
    comment.textContent = `Reviewing position ${reviewing.done} of ${reviewing.total}`;
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
      if (!i) cell.scope = 'row';
      cell.textContent = text;
    });
  }

  // White's winning chance through the game, as an area, with a dot on
  // every marked move.
  const graph = $('review-graph');
  const count = review.evals.length - 1;
  const width = Math.max(1, count);
  const y = (i) => (100 - winChance(review.evals[i])).toFixed(1);
  const points = review.evals.map((_, i) => `${i},${y(i)}`);
  const dots = result.moves
    .map((move, i) =>
      move.mark
        ? `<line class="dot ${move.mark}" x1="${i + 1}" y1="${y(i + 1)}" x2="${i + 1}" y2="${y(i + 1)}" />`
        : '',
    )
    .join('');
  graph.setAttribute('viewBox', `0 0 ${width} 100`);
  graph.innerHTML =
    `<polygon class="area" points="0,100 ${points.join(' ')} ${width},100" />` +
    `<line class="middle" x1="0" y1="50" x2="${width}" y2="50" />${dots}` +
    `<line class="cursor" x1="${cursor}" y1="0" x2="${cursor}" y2="100" />`;
  graph.setAttribute('aria-valuemax', count);
  graph.setAttribute('aria-valuenow', cursor);
  graph.setAttribute(
    'aria-valuetext',
    `${cursor ? moveLabel(cursor) : 'Start'}, ${formatScore(review.evals[cursor])}`,
  );

  comment.replaceChildren();
  if (state.betterArrow) {
    comment.textContent = `Better here: ${review.best[cursor].san}, shown by the green arrow.`;
    return;
  }
  if (!cursor) {
    comment.textContent = 'Step through the moves, or click the graph to jump.';
    return;
  }
  const move = result.moves[cursor - 1];
  const best = review.best[cursor - 1];
  const label = moveLabel(cursor);
  if (move.mark && best) {
    const article = move.mark === 'inaccuracy' ? 'an' : 'a';
    comment.append(
      `${label} is ${article} `,
      make('strong', `mark-sign ${move.mark}`, move.mark),
      '. Better was ',
    );
    const show = make('button', 'link', best.san);
    show.type = 'button';
    show.dataset.better = cursor - 1;
    show.title = 'Show on the board';
    comment.append(show, '.');
  } else if (best && best.uci === game.plies[cursor - 1].uci) {
    comment.textContent = `${label} is the engine's choice.`;
  } else {
    comment.textContent = `${label}. Evaluation ${formatScore(review.evals[cursor])}.`;
  }
}
