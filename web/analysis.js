// The analyst: a running evaluation of the position on the board, and the
// review of a whole game.

import { finalCp, reviewMoves, whiteCp } from './review.js';
import { analyst, playing, settings, state } from './state.js';

let timer = 0;

// Analysis is a separate choice while playing the engine, where it would
// give the game away, and is off there unless asked for.
export const analysisKind = () => (playing() ? 'playAnalysis' : 'analysis');
export const analysisOn = () => !state.editor && settings[analysisKind()];

// Points the analyst at the position shown, if it is not there already.
// `onUpdate` is called each time a deeper result arrives.
export function syncAnalysis(onUpdate) {
  const { game, cursor } = state;
  const key = analysisOn() && !state.reviewing ? `${state.gameId} ${cursor} ${game.length}` : '';
  if (key === state.analysisKey) return;
  state.analysisKey = key;
  clearTimeout(timer);
  if (!state.reviewing) analyst.cancel();
  if (!key) return;
  const position = game.stateAt(cursor);
  if (position.over) {
    state.analysis = { key, cp: finalCp(position.result), depth: 0, san: [] };
    return;
  }
  const request = { kind: 'analyse', fen: game.startFen, moves: game.ucis(cursor) };
  // A short wait, so that stepping quickly through a game stays smooth.
  timer = setTimeout(() => {
    analyst.run({ ...request, maxDepth: 24, budget: 4000 }, (result) => {
      if (!result.best || key !== state.analysisKey) return;
      const cp = whiteCp(result, position.turn === 'white');
      state.analysis = { key, cp, depth: result.depth, san: result.san };
      onUpdate();
    });
  }, 90);
}

export function stopAnalysis() {
  clearTimeout(timer);
  analyst.cancel();
  state.analysisKey = '';
}

// Searches every position of the game once. `onProgress` is called after
// each. Returns true when the review was finished and stored.
export async function reviewGame(onProgress) {
  const { game } = state;
  const token = ++state.reviewToken;
  stopAnalysis();
  state.reviewing = { done: 0, total: game.length + 1 };
  onProgress();
  const evals = [];
  const best = [];
  for (let i = 0; i <= game.length; i++) {
    const position = game.stateAt(i);
    if (position.over) {
      evals.push(finalCp(position.result));
      best.push(null);
    } else {
      const request = { kind: 'go', fen: game.startFen, moves: game.ucis(i) };
      const result = await analyst.run({ ...request, go: 'depth 13 movetime 500' });
      if (token !== state.reviewToken) return false;
      if (!result) break;
      evals.push(whiteCp(result, position.turn === 'white'));
      best.push({ uci: result.best, san: result.san[0] });
    }
    state.reviewing.done = i + 1;
    onProgress();
  }
  state.reviewing = null;
  const complete = evals.length === game.length + 1;
  if (complete) state.review = { evals, best };
  return complete;
}

// The stored review judged move by move, or null when there is none.
export function reviewResult() {
  const { review, game } = state;
  if (!review) return null;
  const best = review.best.map((b) => b?.uci ?? null);
  return reviewMoves(review.evals, best, game.ucis(), game.start.turn === 'white');
}
