// Runs one search request. Shared by the Node worker thread behind the UCI
// program and the Web Worker behind the browser board, so both speak in
// plain data: a start FEN, the moves played, limits in; move text out.

import { positionFromMoves } from './game.js';
import { moveToUci } from './notation.js';

const describe = (r) => ({
  depth: r.depth,
  score: r.score,
  nodes: r.nodes,
  time: r.time,
  pv: r.pv.map(moveToUci),
});

export function runSearchJob(
  searcher,
  { fen, moves, limits },
  { stop = null, onInfo = null } = {},
) {
  const pos = positionFromMoves(fen, moves);
  const result = searcher.search(pos, {
    ...limits,
    stop,
    onInfo: onInfo ? (info) => onInfo(describe(info)) : null,
  });
  return { best: result.move ? moveToUci(result.move) : null, ...describe(result) };
}
