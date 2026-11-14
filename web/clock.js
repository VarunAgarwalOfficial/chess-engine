// A chess clock. Time is read from the function given, so it can be tested.

export class Clock {
  constructor(base, increment = 0, now = () => performance.now()) {
    this.left = { white: base, black: base };
    this.increment = increment;
    this.now = now;
    this.running = null;
    this.since = 0;
  }

  remaining(side) {
    const spent = this.running === side ? this.now() - this.since : 0;
    return Math.max(0, this.left[side] - spent);
  }

  start(side) {
    this.stop();
    this.running = side;
    this.since = this.now();
  }

  stop() {
    if (this.running) this.left[this.running] = this.remaining(this.running);
    this.running = null;
  }

  // The side that moved gets its increment and the other clock starts.
  press(side) {
    this.stop();
    if (this.left[side] > 0) this.left[side] += this.increment;
    this.start(side === 'white' ? 'black' : 'white');
  }

  // The side whose time has run out, or null.
  flagged() {
    return ['white', 'black'].find((side) => this.remaining(side) <= 0) ?? null;
  }

  snapshot() {
    return { white: this.remaining('white'), black: this.remaining('black') };
  }

  restore(snapshot) {
    this.running = null;
    this.left = { white: snapshot.white, black: snapshot.black };
  }
}

// "5:00", "0:09.4" under ten seconds, "1:02:03" from an hour up.
export function formatClock(ms) {
  const total = Math.ceil(ms / 100) / 10;
  const pad = (n) => String(n).padStart(2, '0');
  if (total < 10) return `0:0${total.toFixed(1)}`;
  const seconds = Math.ceil(ms / 1000);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
