// Settings and saved games in localStorage. Failures (private windows, a
// full store) are ignored: the page works without it.

const SETTINGS = 'chess.settings';
const GAMES = 'chess.games';
const LIMIT = 60;

export const DEFAULTS = {
  mode: 'auto', // auto, light, dark
  board: 'walnut',
  sound: true,
  coordinates: true,
  dots: true,
  analysis: true, // when looking at a finished game or analysing
  playAnalysis: false, // while playing the engine
};

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do: the game goes on unsaved.
  }
}

export const loadSettings = () => ({ ...DEFAULTS, ...read(SETTINGS, {}) });
export const saveSettings = (settings) => write(SETTINGS, settings);

// Saved games, newest first. Each: { id, updated, fen, moves, ending,
// setup, clock, review }.
export const listGames = () => read(GAMES, []);

export function saveGame(record) {
  const games = listGames().filter((g) => g.id !== record.id);
  games.unshift({ ...record, updated: Date.now() });
  write(GAMES, games.slice(0, LIMIT));
}

export function deleteGame(id) {
  write(
    GAMES,
    listGames().filter((g) => g.id !== id),
  );
}
