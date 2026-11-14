// Scores, and judging the moves of a finished game. Pure functions.

// A search result as centipawns for White. Mates count as a very large
// score, larger the sooner the mate.
export function whiteCp({ score, mate }, whiteToMove) {
  const cp = mate === null ? score : Math.sign(mate || score) * (10000 - Math.abs(mate));
  return whiteToMove ? cp : -cp;
}

// A position where the game has ended, as centipawns for White.
export function finalCp(result) {
  return result === 'white' ? 10000 : result === 'black' ? -10000 : 0;
}

// White's chance of winning, 0 to 100, from centipawns. The curve is the
// one Lichess fitted to its games.
export function winChance(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// "+0.34", "-1.20", "M3", "-M2": the score as White sees it.
export function formatScore(cp) {
  if (Math.abs(cp) >= 9000) return `${cp < 0 ? '-' : ''}M${10000 - Math.abs(cp)}`;
  return `${cp > 0 ? '+' : cp < 0 ? '-' : ''}${(Math.abs(cp) / 100).toFixed(2)}`;
}

export const MARKS = {
  inaccuracy: { sign: '?!', loss: 10 },
  mistake: { sign: '?', loss: 20 },
  blunder: { sign: '??', loss: 30 },
};

// How much winning chance the mover gave up, as a mark or null.
export function judge(loss) {
  if (loss >= MARKS.blunder.loss) return 'blunder';
  if (loss >= MARKS.mistake.loss) return 'mistake';
  if (loss >= MARKS.inaccuracy.loss) return 'inaccuracy';
  return null;
}

// evals[i] is the score for White before move i (so there is one more than
// there are moves); best[i] is the engine's move there; played[i] the move
// made; whiteFirst says who made move 0. Returns, for each move, the
// winning chance lost and its mark, and per side the counts and an accuracy.
export function reviewMoves(evals, best, played, whiteFirst = true) {
  const moves = played.map((uci, i) => {
    const white = (i % 2 === 0) === whiteFirst;
    const [before, after] = [winChance(evals[i]), winChance(evals[i + 1])];
    const loss = uci === best[i] ? 0 : Math.max(0, white ? before - after : after - before);
    return { white, loss, mark: judge(loss) };
  });
  const side = (white) => {
    const own = moves.filter((m) => m.white === white);
    const count = (mark) => own.filter((m) => m.mark === mark).length;
    // Accuracy of one move from the chance it lost, again after Lichess.
    const accuracy = own.map((m) => 103.1668 * Math.exp(-0.04354 * m.loss) - 3.1669);
    return {
      inaccuracy: count('inaccuracy'),
      mistake: count('mistake'),
      blunder: count('blunder'),
      accuracy: own.length
        ? Math.round(Math.min(100, Math.max(0, accuracy.reduce((a, b) => a + b, 0) / own.length)))
        : null,
    };
  };
  return { moves, white: side(true), black: side(false) };
}
