// Text for the side panel. Pure functions, no DOM.

// Groups SAN moves into numbered rows: [{ number, white, black }]. When the
// game starts with Black to move, the first row has no white move.
export function moveRows(sans, startFen) {
  const fields = startFen.split(' ');
  const blackStarts = fields[1] === 'b';
  let number = Number(fields[5]) || 1;
  const rows = [];
  let i = 0;
  if (blackStarts && sans.length) {
    rows.push({ number, white: '…', black: sans[0] });
    number++;
    i = 1;
  }
  for (; i < sans.length; i += 2) {
    rows.push({ number, white: sans[i], black: sans[i + 1] ?? '' });
    number++;
  }
  return rows;
}

// The engine's reply as White-relative text. `score` is in centipawns for
// the side that moved; `mate` is moves to mate, negative when it is being
// mated, or null.
export function describeScore({ score, mate }, moverIsWhite) {
  if (mate !== null) {
    const winnerIsWhite = mate > 0 === moverIsWhite;
    return `${winnerIsWhite ? 'White' : 'Black'} mates in ${Math.abs(mate)}`;
  }
  const pawns = (moverIsWhite ? score : -score) / 100;
  return `evaluation ${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export function describeStatus(status, turn) {
  if (status.over) {
    if (status.reason === 'checkmate') {
      return `Checkmate. ${status.result === 'white' ? 'White' : 'Black'} wins.`;
    }
    return `Draw by ${status.reason}.`;
  }
  const side = turn === 'white' ? 'White' : 'Black';
  return status.check ? `${side} to move. Check.` : `${side} to move.`;
}
