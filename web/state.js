// What the page is holding: the game, where the board is in it, and the
// engines. Every other module reads and changes it here.

import { Board } from './board.js';
import { EngineClient } from './client.js';
import { loadEngine } from './engine.js';
import { LEVELS } from './levels.js';
import { loadSettings } from './store.js';

export const $ = (id) => document.getElementById(id);
export const make = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
export const cap = (side) => (side === 'white' ? 'White' : 'Black');
export const other = (side) => (side === 'white' ? 'black' : 'white');
// The engine's messages start in lower case.
export const sentence = (error) =>
  `${error.message[0].toUpperCase()}${error.message.slice(1)}.`.replace(/\.\.$/, '.');

// One copy of the engine answers questions about the rules here; two more,
// in workers, play and analyse.
export const rules = await loadEngine(new URL('./engine.wasm', import.meta.url));
export const player = new EngineClient();
export const analyst = new EngineClient();

export const settings = loadSettings();

// What the board asks for (a move, a premove, an edit); app.js fills it in.
export const handlers = {};
export const board = new Board($('board'), handlers);

export const state = {
  game: null,
  gameId: '',
  setup: { side: 'white', level: 5, time: null, names: null, date: '' },
  clock: null,
  cursor: 0, // how many moves into the game the board is showing
  flipped: false,
  thinking: false,
  playToken: 0, // changes whenever what the engine was asked no longer matters
  premove: null,
  analysis: null, // { key, cp, depth, san }
  analysisKey: '',
  review: null, // { evals, best }
  reviewing: null, // { done, total } while a review runs
  reviewToken: 0,
  hintArrow: null,
  betterArrow: null,
  resignArmed: false,
  editor: null, // { pieces, turn, castling, ep, tool } while editing
  pendingFen: null, // a set-up position waiting for the new game dialog
};

export const human = (turn) => state.setup.side === 'both' || state.setup.side === turn;
export const atEnd = () => state.cursor === state.game.length;
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
// A live game against the engine, as opposed to analysis or a finished game.
export const playing = () => state.setup.side !== 'both' && !state.game.status().over;

export function playerName(side) {
  const { setup } = state;
  if (setup.names) return setup.names[side];
  if (setup.side === 'both') return cap(side);
  return setup.side === side ? 'You' : `Engine, ${LEVELS[setup.level - 1].name.toLowerCase()}`;
}
