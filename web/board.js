// The board: draws a position and turns pointer and key input into
// requests ("move from e2 to e4"). It knows nothing about the rules; the
// legal moves are handed to it.

const FILES = 'abcdefgh';
const SVG = 'http://www.w3.org/2000/svg';
const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
// Art pixels in a square, and the time a drawn frame stays: 12 a second.
const ART = 16;
const FRAME = 83;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');

const element = (tag, className, parent) => {
  const el = document.createElement(tag);
  el.className = className;
  parent?.append(el);
  return el;
};

export const pieceName = (code) => `${code[0] === 'w' ? 'white' : 'black'} ${NAMES[code[1]]}`;

export class Board {
  // handlers: onMove(from, to), onPremove(from, to) (nulls when cancelled),
  // onEdit(from, to) (to is null when dragged off) and onEditClick(square).
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
    this.orientation = 'white';
    this.pieces = new Map();
    this.legal = [];
    this.movable = null; // 'w', 'b', 'both' or null: who may move now
    this.premovable = null; // 'w' or 'b': who may line up a move
    this.lastMove = null;
    this.check = null;
    this.edit = false;
    this.options = { dots: true, coordinates: true };

    this.selected = null;
    this.premove = null;
    this.cursor = null; // the keyboard's square
    this.marks = new Map(); // drawn by the player with the right button
    this.arrows = []; // drawn by the page: hint, better move
    this.drag = null;
    this.marking = null; // an arrow or mark being drawn: { from, to, colour, primary }
    this.markMode = false; // the main button draws instead of moving
    this.press = null; // a finger held down, which may become a long press
    this.elements = new Map(); // square -> piece element

    root.tabIndex = 0;
    root.setAttribute('role', 'application');
    root.setAttribute(
      'aria-label',
      'Chess board. Arrow keys move between squares, Enter picks up and puts down.',
    );
    this.squaresEl = element('div', 'squares', root);
    this.marksEl = document.createElementNS(SVG, 'svg');
    this.marksEl.setAttribute('class', 'marks');
    this.marksEl.setAttribute('viewBox', '0 0 8 8');
    root.append(this.marksEl);
    this.piecesEl = element('div', 'pieces', root);
    this.promotionEl = element('div', 'promotion', root);
    this.promotionEl.hidden = true;
    this.live = element('div', 'visually-hidden', root);
    this.live.setAttribute('aria-live', 'polite');
    this.buildSquares();

    root.addEventListener('pointerdown', (e) => this.onDown(e));
    root.addEventListener('pointermove', (e) => this.onMove(e));
    root.addEventListener('pointerup', (e) => this.onUp(e));
    root.addEventListener('pointercancel', () => {
      this.endPress();
      this.marking = null;
      this.endDrag(null);
      this.drawMarks();
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('keydown', (e) => this.onKey(e));
    root.addEventListener('focus', () => {
      if (root.matches(':focus-visible') && !this.cursor) this.setCursor(this.homeSquare());
    });
    root.addEventListener('blur', () => this.setCursor(null));
  }

  // ----- geometry -----

  // Column and row on screen, from the top left.
  place(square) {
    const file = FILES.indexOf(square[0]);
    const rank = Number(square[1]) - 1;
    return this.orientation === 'white' ? [file, 7 - rank] : [7 - file, rank];
  }

  squareOf(col, row) {
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return this.orientation === 'white' ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
  }

  squareAt(event) {
    const box = this.root.getBoundingClientRect();
    const col = Math.floor(((event.clientX - box.left) / box.width) * 8);
    const row = Math.floor(((event.clientY - box.top) / box.height) * 8);
    return this.squareOf(col, row);
  }

  homeSquare() {
    return this.orientation === 'white' ? 'e2' : 'e7';
  }

  // ----- drawing -----

  buildSquares() {
    this.squaresEl.replaceChildren();
    this.squareEls = new Map();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const square = this.squareOf(col, row);
        const dark = (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 1;
        const el = element('div', `square ${dark ? 'dark' : 'light'}`, this.squaresEl);
        if (col === 0) element('span', 'coordinate rank', el).textContent = square[1];
        if (row === 7) element('span', 'coordinate file', el).textContent = square[0];
        this.squareEls.set(square, el);
      }
    }
  }

  // Takes any of: pieces, orientation, legal, movable, premovable,
  // lastMove, check, edit, animate.
  set(next) {
    const flipped = next.orientation && next.orientation !== this.orientation;
    const { animate = true, ...rest } = next;
    Object.assign(this, rest);
    if (flipped) {
      this.buildSquares();
      this.clearPieces();
    }
    if (next.pieces) this.drawPieces(animate && !flipped);
    const held = this.selected && this.pieces.get(this.selected);
    if (this.selected && !(held && this.canPick(held))) this.selected = null;
    this.paint();
    this.drawMarks();
  }

  setOptions(options) {
    Object.assign(this.options, options);
    this.root.classList.toggle('no-coordinates', !this.options.coordinates);
    this.paint();
  }

  setArrows(arrows) {
    this.arrows = arrows;
    this.drawMarks();
  }

  // In mark mode the main button, or a finger, draws arrows and marks.
  setMarkMode(on) {
    this.markMode = on;
    this.root.classList.toggle('marking', on);
    if (!on) return;
    this.selected = null;
    this.cancelPremove();
    this.paint();
  }

  clearPieces() {
    this.piecesEl.replaceChildren();
    this.elements.clear();
  }

  // Moves a piece in drawn frames, a whole art pixel at a time: a square is
  // 16 art pixels, and the board is a whole number of them. Still, or under
  // reduced motion, it jumps.
  position(el, square, still = false) {
    const [col, row] = this.place(square);
    const to = [col * ART, row * ART];
    clearTimeout(el.stepTimer);
    const from = el.artAt;
    if (still || !from || REDUCED.matches) {
      this.placeArt(el, to);
      return;
    }
    const far = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) / ART;
    const frames = Math.min(4, Math.max(2, Math.ceil(far)));
    const path = [];
    for (let k = 1; k <= frames; k++) {
      const t = 1 - (1 - k / frames) ** 2;
      path.push(from.map((v, i) => Math.round(v + (to[i] - v) * t)));
    }
    const next = () => {
      this.placeArt(el, path.shift());
      if (path.length) el.stepTimer = setTimeout(next, FRAME);
    };
    next();
  }

  // Art pixels from the board's top left; a piece is 16 wide.
  placeArt(el, [x, y]) {
    el.artAt = [x, y];
    el.style.transform = `translate(${(x / ART) * 100}%, ${(y / ART) * 100}%)`;
  }

  // Moves the piece elements from the old position to the new one. Pieces
  // that stay keep their element; a piece that left one square and one of
  // the same kind that appeared on another are taken to be the same piece,
  // which is what makes moves, castling and takebacks slide.
  drawPieces(animate) {
    const wanted = new Map(this.pieces);
    const old = this.elements;
    const next = new Map();
    const keep = (el, square) => {
      next.set(square, el);
      wanted.delete(square);
      if (el !== this.drag?.el) this.position(el, square, !animate);
    };
    for (const [square, el] of [...old]) {
      if (wanted.get(square) === el.dataset.piece) {
        old.delete(square);
        keep(el, square);
      }
    }
    // A pawn that promoted: the piece on the last move's target is new,
    // and the one that left its origin becomes it.
    const [from, to] = this.lastMove ?? [];
    if (from && old.has(from) && wanted.has(to) && !this.pieces.has(from)) {
      const el = old.get(from);
      old.delete(from);
      this.dress(el, wanted.get(to));
      keep(el, to);
    }
    for (const [square, code] of [...wanted]) {
      const [col, row] = this.place(square);
      let best = null;
      for (const [origin, el] of old) {
        if (el.dataset.piece !== code) continue;
        const [c, r] = this.place(origin);
        const distance = Math.abs(c - col) + Math.abs(r - row);
        if (!best || distance < best.distance) best = { origin, el, distance };
      }
      if (best) {
        old.delete(best.origin);
        keep(best.el, square);
      } else {
        const el = element('div', 'piece', this.piecesEl);
        this.dress(el, code);
        this.position(el, square, true);
        next.set(square, el);
      }
    }
    for (const el of old.values()) {
      if (animate) {
        el.classList.add('gone');
        setTimeout(() => el.remove(), 200);
      } else el.remove();
    }
    this.elements = next;
  }

  dress(el, code) {
    el.dataset.piece = code;
    el.className = `piece ${code}`;
  }

  paint() {
    const targets = new Map();
    if (this.selected && !this.selectionIsPremove() && this.options.dots) {
      for (const move of this.legal) {
        if (move.uci.startsWith(this.selected)) targets.set(move.uci.slice(2, 4), move);
      }
    }
    for (const [square, el] of this.squareEls) {
      const target = targets.get(square);
      const on = (name, value) => el.classList.toggle(name, Boolean(value));
      on('last', this.lastMove?.includes(square));
      on('selected', square === this.selected);
      on('check', square === this.check);
      on('target', target && !target.capture && !this.pieces.has(square));
      on('ring', target && (target.capture || this.pieces.has(square)));
      on('premove', this.premove?.includes(square));
      on('over', square === this.drag?.over);
      on('cursor', square === this.cursor);
    }
  }

  drawMarks() {
    const centre = (square) => this.place(square).map((n) => n + 0.5);
    const add = (tag, attributes) => {
      const el = document.createElementNS(SVG, tag);
      for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
      this.marksEl.append(el);
    };
    this.marksEl.replaceChildren();
    const drawing = this.marking?.to ? [this.marking] : [];
    for (const { from, to, colour } of [...this.marks.values(), ...this.arrows, ...drawing]) {
      if (from === to) {
        add('circle', {
          class: `mark ${colour}`,
          cx: centre(from)[0],
          cy: centre(from)[1],
          r: 0.44,
        });
        continue;
      }
      const [x1, y1] = centre(from);
      if (!to) {
        add('circle', { class: `mark ${colour}`, cx: x1, cy: y1, r: 0.44 });
        continue;
      }
      const [x2, y2] = centre(to);
      const length = Math.hypot(x2 - x1, y2 - y1);
      const [dx, dy] = [(x2 - x1) / length, (y2 - y1) / length];
      const [bx, by] = [x2 - dx * 0.42, y2 - dy * 0.42]; // base of the head
      add('line', {
        class: `mark ${colour}`,
        x1: x1 + dx * 0.32,
        y1: y1 + dy * 0.32,
        x2: bx,
        y2: by,
      });
      const points = [
        [x2 - dx * 0.08, y2 - dy * 0.08],
        [bx - dy * 0.2, by + dx * 0.2],
        [bx + dy * 0.2, by - dx * 0.2],
      ];
      add('polygon', { class: `mark head ${colour}`, points: points.join(' ') });
    }
  }

  // ----- picking up and putting down -----

  canPick(piece) {
    if (this.edit || this.movable === 'both') return true;
    return piece[0] === this.movable || piece[0] === this.premovable;
  }

  selectionIsPremove() {
    const piece = this.pieces.get(this.selected);
    return !this.edit && piece && this.movable !== 'both' && piece[0] !== this.movable;
  }

  // Asks for the move if it can be one. True when the request was made.
  tryMove(from, to) {
    if (from === to) return false;
    if (this.selectionIsPremove()) {
      this.selected = null;
      this.premove = [from, to];
      this.handlers.onPremove(from, to);
      this.paint();
      return true;
    }
    if (!this.legal.some((move) => move.uci.startsWith(from + to))) return false;
    this.selected = null;
    this.handlers.onMove(from, to);
    return true;
  }

  cancelPremove() {
    if (!this.premove) return;
    this.premove = null;
    this.handlers.onPremove(null, null);
  }

  clearPremove() {
    this.premove = null;
    this.paint();
  }

  // What a click or Enter on a square does.
  act(square) {
    const piece = this.pieces.get(square);
    const wasSelected = this.selected === square;
    if (this.selected && this.tryMove(this.selected, square)) return false;
    this.cancelPremove();
    this.selected = piece && this.canPick(piece) && !wasSelected ? square : null;
    this.paint();
    return this.selected !== null;
  }

  onDown(event) {
    if (!this.promotionEl.hidden) return;
    const square = this.squareAt(event);
    if (!square) return;
    this.setCursor(null);
    if (event.button === 2) {
      if (this.drag || this.selected || this.premove) {
        this.endDrag(null);
        this.selected = null;
        this.cancelPremove();
        this.paint();
        return;
      }
      const colour = event.shiftKey
        ? 'red'
        : event.altKey
          ? 'blue'
          : event.ctrlKey
            ? 'amber'
            : 'green';
      this.marking = { from: square, to: square, colour };
      return;
    }
    if (event.button !== 0) return;
    const touch = event.pointerType !== 'mouse';
    if (this.markMode && !this.edit) {
      const colour = event.shiftKey ? 'red' : event.altKey ? 'blue' : 'green';
      this.startMarking(square, colour, event);
      return;
    }
    // A mouse click clears what was drawn at once; a finger may be about
    // to draw more, so that waits until it lifts.
    if (!touch) this.clearMarks();
    const piece = this.pieces.get(square);
    if (this.edit) {
      this.drag = { from: square, el: piece && this.elements.get(square), event, moved: false };
      return;
    }
    const wasSelected = this.selected === square;
    if (this.selected && !wasSelected && this.tryMove(this.selected, square)) {
      this.clearMarks();
      return;
    }
    if (!piece || !this.canPick(piece)) {
      if (touch) this.startPress(square, event);
      this.selected = null;
      this.cancelPremove();
      this.paint();
      return;
    }
    this.cancelPremove();
    this.selected = square;
    this.drag = { from: square, el: this.elements.get(square), event, moved: false, wasSelected };
    this.paint();
  }

  onMove(event) {
    if (this.marking) {
      const to = this.squareAt(event) ?? this.marking.from;
      if (to !== this.marking.to) {
        this.marking.to = to;
        this.drawMarks();
      }
      return;
    }
    if (this.press) {
      const far = Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y);
      if (far >= 8) this.endPress();
    }
    const drag = this.drag;
    if (!drag?.el) return;
    if (!drag.moved) {
      const slack = event.pointerType === 'mouse' ? 3 : 8;
      const far = Math.hypot(
        event.clientX - drag.event.clientX,
        event.clientY - drag.event.clientY,
      );
      if (far < slack) return;
      drag.moved = true;
      try {
        this.root.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is already gone; the drag simply ends at the edge.
      }
      drag.el.classList.add('dragging');
    }
    const box = this.root.getBoundingClientRect();
    const size = box.width / 8;
    // Under a finger the piece is lifted so it can be seen.
    const lift = event.pointerType === 'mouse' ? 0 : size * 0.7;
    // Held on the art grid, a whole art pixel at a time.
    const art = size / ART;
    const x = Math.round((event.clientX - box.left - size / 2) / art);
    const y = Math.round((event.clientY - box.top - size / 2 - lift) / art);
    clearTimeout(drag.el.stepTimer);
    this.placeArt(drag.el, [x, y]);
    const over = this.squareAt(event);
    if (over !== drag.over) {
      drag.over = over;
      this.paint();
    }
  }

  onUp(event) {
    this.endPress();
    if (this.marking && (event.button === 2 || this.marking.primary)) {
      const { from, colour } = this.marking;
      const to = this.squareAt(event);
      this.marking = null;
      if (to) {
        const key = from === to ? from : from + to;
        if (this.marks.get(key)?.colour === colour) this.marks.delete(key);
        else this.marks.set(key, { from, to: from === to ? null : to, colour });
      }
      this.drawMarks();
      return;
    }
    if (event.pointerType !== 'mouse' && event.button === 0) this.clearMarks();
    if (this.drag) this.endDrag(this.squareAt(event));
  }

  clearMarks() {
    if (!this.marks.size) return;
    this.marks.clear();
    this.drawMarks();
  }

  // ----- drawing with the main button or a finger -----

  startMarking(square, colour, event) {
    this.marking = { from: square, to: square, colour, primary: true };
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone; the mark ends where it started.
    }
    this.drawMarks();
  }

  // A finger held still for a moment starts drawing. Only on squares with
  // nothing to pick up, so that holding a piece never loses a move.
  startPress(square, event) {
    this.endPress();
    const { clientX: x, clientY: y } = event;
    const timer = setTimeout(() => {
      this.press = null;
      navigator.vibrate?.(12);
      this.startMarking(square, 'green', event);
    }, 450);
    this.press = { x, y, timer };
  }

  endPress() {
    if (!this.press) return;
    clearTimeout(this.press.timer);
    this.press = null;
  }

  endDrag(target) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.el?.classList.remove('dragging');
    if (this.edit) {
      if (!drag.moved) this.handlers.onEditClick(drag.from);
      else if (target !== drag.from) this.handlers.onEdit(drag.from, target);
      else this.position(drag.el, drag.from);
      return;
    }
    if (!drag.moved) {
      if (drag.wasSelected) this.selected = null;
    } else if (target && target !== drag.from) {
      const premove = this.selectionIsPremove();
      // Dropped on its square, the piece is already there: no slide.
      if (!premove && this.legal.some((m) => m.uci.startsWith(drag.from + target))) {
        this.position(drag.el, target, true);
      } else this.position(drag.el, drag.from);
      if (!this.tryMove(drag.from, target)) this.selected = null;
    } else {
      this.position(drag.el, drag.from);
      if (!target) this.selected = null;
    }
    this.paint();
  }

  // ----- keyboard -----

  setCursor(square) {
    if (this.cursor === square) return;
    this.cursor = square;
    if (square) {
      const piece = this.pieces.get(square);
      this.live.textContent = piece ? `${square}, ${pieceName(piece)}` : square;
    }
    this.paint();
  }

  onKey(event) {
    if (!this.promotionEl.hidden) return;
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!this.cursor) {
        this.setCursor(this.selected ?? this.homeSquare());
        return;
      }
      if (this.edit) this.handlers.onEditClick(this.cursor);
      else if (this.act(this.cursor)) this.live.textContent = `${this.cursor} picked up`;
    } else if (event.key in steps && this.cursor) {
      event.preventDefault();
      event.stopPropagation();
      const [col, row] = this.place(this.cursor);
      const [dc, dr] = steps[event.key];
      this.setCursor(this.squareOf(col + dc, row + dr) ?? this.cursor);
    } else if (event.key === 'Escape' && (this.cursor || this.selected || this.premove)) {
      this.selected = null;
      this.cancelPremove();
      this.setCursor(null);
      this.paint();
    }
  }

  // ----- promotion -----

  // Shows the four pieces on the promotion square's file. Resolves with
  // the letter chosen, or null when dismissed.
  askPromotion(square, colour) {
    return new Promise((resolve) => {
      const [col, row] = this.place(square);
      const panel = this.promotionEl;
      const finish = (letter) => {
        panel.hidden = true;
        panel.replaceChildren();
        this.root.focus({ preventScroll: true });
        resolve(letter);
      };
      panel.replaceChildren();
      panel.hidden = false;
      panel.onclick = () => finish(null);
      panel.onkeydown = (event) => {
        if (event.key === 'Escape') finish(null);
        event.stopPropagation();
      };
      const choices = element('div', 'choices', panel);
      choices.style.left = `${col * 12.5}%`;
      choices.style[row === 0 ? 'top' : 'bottom'] = '0';
      const letters = row === 0 ? 'qnrb' : 'brnq';
      for (const letter of letters) {
        const button = element('button', `piece ${colour}${letter}`, choices);
        button.type = 'button';
        button.setAttribute('aria-label', `Promote to ${NAMES[letter]}`);
        button.onclick = (event) => {
          event.stopPropagation();
          finish(letter);
        };
      }
      choices.querySelector(row === 0 ? 'button' : 'button:last-child').focus();
    });
  }
}
