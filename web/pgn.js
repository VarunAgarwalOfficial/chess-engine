// PGN out and in. Which moves are legal, and how they are written, comes
// from the engine: importing matches each word against the legal moves'
// notation.

import { Game, START_FEN } from './game.js';

const RESULTS = { white: '1-0', black: '0-1', draw: '1/2-1/2' };

// headers: an object of extra tags, e.g. { White: 'You', Black: 'Engine' }.
export function toPgn(game, headers = {}) {
  const status = game.status();
  const result = status.over ? RESULTS[status.result] : '*';
  const tags = { Event: 'Casual game', Site: '?', Date: '????.??.??', Round: '-' };
  Object.assign(tags, { White: '?', Black: '?' }, headers, { Result: result });
  if (game.startFen !== START_FEN) Object.assign(tags, { SetUp: '1', FEN: game.startFen });

  const fields = game.startFen.split(' ');
  let number = Number(fields[5]) || 1;
  let white = fields[1] === 'w';
  const words = [];
  game.sans().forEach((san, i) => {
    if (white) words.push(`${number}.`);
    else if (i === 0) words.push(`${number}...`);
    words.push(san);
    if (!white) number++;
    white = !white;
  });
  words.push(result);

  const lines = [''];
  for (const word of words) {
    if (lines.at(-1).length + word.length + 1 > 80) lines.push('');
    lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
  }
  const quote = (text) => String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const head = Object.entries(tags).map(([name, value]) => `[${name} "${quote(value)}"]`);
  return `${head.join('\n')}\n\n${lines.join('\n')}\n`;
}

// The first game in the text: { headers, words }, words being the moves of
// the main line as written. Comments, variations and annotations are dropped.
export function parsePgn(text) {
  const headers = {};
  let body = '';
  // Tags pasted on one line are put back on lines of their own.
  for (const line of text.replace(/"\]\s*(?=\[|\d)/g, '"]\n').split(/\r?\n/)) {
    const tag = line.match(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/);
    if (tag) {
      if (body.trim()) break; // the next game starts here
      headers[tag[1]] = tag[2].replace(/\\(.)/g, '$1');
    } else if (!line.startsWith('%')) {
      body += `${line.replace(/;.*$/, '')}\n`;
    }
  }
  body = body.replace(/\{[^}]*\}/g, ' ');
  for (let before = ''; before !== body;) {
    before = body;
    body = body.replace(/\([^()]*\)/g, ' ');
  }
  const words = body
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.+/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !/^(1-0|0-1|1\/2-1\/2|\*|e\.p\.)$/.test(word));
  return { headers, words };
}

// Notation with the parts writers disagree on removed.
const plain = (san) => san.replace(/0/g, 'O').replace(/[+#!?=]/g, '');

// Builds the game the text describes. Throws on a move that is not legal.
export function gameFromPgn(engine, text) {
  const { headers, words } = parsePgn(text);
  const game = new Game(engine, headers.FEN || START_FEN);
  words.forEach((word, i) => {
    const move = game.legalMoves().find((m) => plain(m.san) === plain(word));
    if (!move) throw new Error(`Move ${Math.floor(i / 2) + 1} (${word}) is not legal`);
    game.play(move.uci);
  });
  const result = Object.keys(RESULTS).find((key) => RESULTS[key] === headers.Result);
  if (result && !game.status().over) game.ending = { result, reason: 'result' };
  return { game, headers };
}
