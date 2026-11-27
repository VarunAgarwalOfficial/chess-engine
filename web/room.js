// The room round the board: a lamp-lit table across the page, window light
// falling on it, the carved frame the board sits in, and a few things on the
// table (a candle, a cup of tea, books, a plant) with small idle motion.
// It is all pixel art at the board's own scale: the board is 128 art pixels
// wide, so one art pixel is a whole number of screen pixels.
//
// It only draws; the board and the game know nothing about it.

import { PALETTE as C, dithered, setupCanvas, sprite, ticker } from './pixel.js';

const FRAME = 12; // the carved frame, in art pixels
const TABLE = 10; // table showing above and below the frame
const EDGE = FRAME + TABLE;
const WOOD = [C.wood1, C.wood2, C.wood3, C.wood4, C.wood5, C.wood6];

const room = document.querySelector('.room');
const board = document.getElementById('board');

// A small seeded random source, so the grain is the same on every visit.
const random = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ----- sprites, lit from the top left -----

const INK = { o: C.ink };

const CANDLE = sprite(
  [
    '.....o.....',
    '...ooooo...',
    '..owwwwwo..',
    '..oWwwwso..',
    '..oWwwwso..',
    '..oWwwwso..',
    '.ooWwwwsoo.',
    '.owWwwwso..',
    '..oWwwwso..',
    '..oWwwwso..',
    '..oWwwwso..',
    '.ooooooooo.',
    'oGGggggggdo',
    'oGggggggddo',
    '.oddddddoo.',
    '..ooooooo..',
  ],
  { ...INK, w: C.paper, W: C.plate, s: C.wood1, G: C.sunflower, g: C.frameLine, d: C.frameDrop },
);

const FLAMES = [
  ['..y..', '.yby.', '.ybby', 'ybwby', 'ybwby', '.ybb.', '..y..'],
  ['.y...', '.yby.', 'ybby.', 'ybwby', 'ybwby', '.ybb.', '..y..'],
  ['.....', '..y..', '.yby.', 'ybwby', 'ybwby', '.ybb.', '..y..'],
].map((rows) => sprite(rows, { y: C.frameLine, b: C.sunflower, w: C.plate }));

const CUP = sprite(
  [
    '....oooooooo......',
    '...oWWWWWWWWo.....',
    '..oWttttttttWo....',
    '..oWtTTtttttWoooo.',
    '..oppppppppppo..o.',
    '..opPPPPPPPMMo..o.',
    '..opPPPPPPPMMoooo.',
    '..opPPPPPPMMMo....',
    '...opPPPPPMMo.....',
    '.ooooooooooooooo..',
    'oSWWWWWWWWWWWWsso.',
    '.oossssssssssoo...',
    '...ooooooooooo....',
  ],
  {
    ...INK,
    W: C.plate,
    t: C.wood4,
    T: C.wood3,
    p: C.blushSoft,
    P: C.blush,
    M: C.blushMid,
    S: C.paper,
    s: C.stone2,
  },
);

const BOOKS = sprite(
  [
    '....oooooooooooooooooooo..',
    '...oMMMMMMMMMMMMMMMMMMMMo.',
    '...omMMMMMMMMMMMMMMMMMMdo.',
    '...omMMMMMMMoooMMMMMMMMdo.',
    '...omMMMMMMMoGoMMMMMMMMdo.',
    '...omMMMMMMMoooMMMMMMMMdo.',
    '...oddddddddddddddddddddo.',
    '...owwwwwwwwwwwwwwwwwwwwo.',
    '.oooooooooooooooooooooooooo',
    'oPPPPPPPPPPPPPPPPPPPPPPPPPo',
    'opPPPPPPPPPPPPPPPPPPPPPPPEo',
    'oEEEEEEEEEEEEEEEEEEEEEEEEEo',
    'owwwwwwwwwwwwwwwwwwwwwwwwwo',
    '.ooooooooooooooooooooooooo.',
  ],
  {
    ...INK,
    M: C.mint,
    m: C.mintSoft,
    d: C.mintMid,
    G: C.sunflower,
    w: C.paper,
    P: C.peach,
    p: C.peachSoft,
    E: C.peachMid,
  },
);

const PENCIL = sprite(
  [
    '.oooooooooooooooooo....',
    'oBBgSSSSSSSSSSSSSSswo..',
    'oBBgsssssssssssssswwkoo',
    '.oooooooooooooooooo....',
  ],
  { ...INK, B: C.blushMid, g: C.stone3, S: C.sunflower, s: C.frameLine, w: C.wood1, k: C.ink },
);

const leaves = (tip) =>
  sprite(
    [
      tip ? '.....oo.......' : '......oo......',
      tip ? '....oLlo..oo..' : '.....oLlo.oo..',
      '..oo.oLlooLlo.',
      '.oLlooLLloLlo.',
      '.oLLloLLlLLo..',
      '..oLLlLLLLlooo',
      'oo.oLLLLLLlLLo',
      'oLloLLLLLLLLo.',
      '.oLLLLLLLLLo..',
      '..ooooooooo...',
    ],
    { ...INK, L: C.meadowMid, l: C.leaf },
  );
const PLANT_LEAVES = [leaves(false), leaves(true)];
const POT = sprite(
  [
    '..ooooooooo...',
    '.oQqqqqqqqqo..',
    '.oooooooooooo.',
    '..oQqqqqqqDo..',
    '..oQqqqqqqDo..',
    '...oQqqqqDo...',
    '...oQqqqqDo...',
    '....ooooooo...',
  ],
  { ...INK, Q: C.peach, q: C.peachMid, D: C.peachDeep },
);

// A carved rose for the corners of the frame, gold at the heart.
const ROSE = sprite(
  ['...oo...', '..o33o..', '.oo32oo.', 'o32gg44o', 'o33gg44o', '.oo44oo.', '..o44o..', '...oo...'],
  { o: C.wood6, 2: C.wood2, 3: C.wood3, 4: C.wood4, g: C.sunflower },
);

// ----- drawing -----

let stop = null;

function draw() {
  const scale = board.offsetWidth / 128;
  if (!scale || !Number.isInteger(scale)) return;
  // Art pixels must sit on screen pixels: take up any half pixel the
  // centred column leaves.
  room.style.translate = '';
  const before = board.getBoundingClientRect();
  const nudgeX = before.left - Math.round(before.left);
  const nudgeY = before.top + scrollY - Math.round(before.top + scrollY);
  room.style.translate = `${-nudgeX}px ${-nudgeY}px`;
  const roomBox = room.getBoundingClientRect();
  const boardBox = board.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const left = Math.ceil(boardBox.left / scale);
  const right = Math.ceil((width - boardBox.right) / scale);
  const W = left + 128 + right;
  const H = 128 + 2 * EDGE;
  const bx = left;
  const by = EDGE;

  let [still, moving] = room.querySelectorAll('canvas');
  if (!still) {
    still = document.createElement('canvas');
    moving = document.createElement('canvas');
    for (const c of [still, moving]) {
      c.className = 'room-art';
      c.setAttribute('aria-hidden', 'true');
      room.prepend(c);
    }
  }
  const offset = `${boardBox.left - roomBox.left - left * scale}px`;
  const g = setupCanvas(still, W, H, scale);
  const m = setupCanvas(moving, W, H, scale);
  still.style.left = moving.style.left = offset;

  const props = { left: left >= 64, right: right >= 56 };
  const windowLight = paintTable(g, W, H, bx, by, props);
  const spots = paintProps(g, bx, by, props);
  paintFrame(g, bx, by);

  stop?.();
  stop = ticker(10, (frame) => {
    m.clearRect(0, 0, W, H);
    paintIdle(m, frame, spots, windowLight);
  });
}

// The table: planks with grain, seams and knots, in tones of wood. A pool of
// lamp light on the board, darker to the sides, window light from the left,
// and the board's shadow, each a shift of tone by ordered dither.
function paintTable(g, W, H, bx, by, props) {
  const next = random(7);
  const tone = new Float32Array(W * H).fill(1);
  const set = (x, y, t) => {
    if (x >= 0 && y >= 0 && x < W && y < H) tone[y * W + x] = t;
  };
  for (let y0 = -4; y0 < H; y0 += 9) {
    for (let x = 0; x < W; x++) set(x, y0, 3);
    for (let x = 0; x < W; x++) if (x % 2) set(x, y0 + 1, 0);
    // Long boards: an end joint every 160 to 300 art pixels.
    let seam = Math.floor(next() * 200);
    while (seam < W) {
      for (let y = y0 + 1; y < y0 + 9; y++) set(seam, y, 3);
      seam += 160 + Math.floor(next() * 140);
    }
    for (let k = 0; k < W / 4; k++) {
      const x = Math.floor(next() * W);
      const y = y0 + 2 + Math.floor(next() * 6);
      const long = 3 + Math.floor(next() * 12);
      const light = next() < 0.3;
      for (let i = 0; i < long; i++) set(x + i, y, light ? 0 : 2);
    }
    if (next() < 0.5) {
      const x = Math.floor(next() * W);
      for (const [dx, dy, t] of [
        [0, 4, 3],
        [1, 4, 4],
        [2, 4, 3],
        [-1, 4, 2],
        [3, 4, 2],
        [1, 3, 2],
        [1, 5, 2],
      ])
        set(x + dx, y0 + dy, t);
    }
  }

  const cx = bx + 64;
  const cy = by + 64;
  const panes = props.left ? windowPanes(bx) : [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot((x - cx) * 0.75, (y - cy) * 1.5);
      let shift = r < 70 ? -(70 - r) / 90 : (r - 70) / 120;
      if (panes.some((p) => inPane(p, x, y))) shift -= 1.5;
      const shadow =
        x >= bx - FRAME + 3 &&
        x < bx + 128 + FRAME + 3 &&
        y >= by - FRAME + 3 &&
        y < by + 128 + FRAME + 3;
      if (shadow) shift += 1.6;
      const whole = Math.floor(shift);
      const t = tone[y * W + x] + whole + (dithered(x, y, shift - whole) ? 1 : 0);
      tone[y * W + x] = Math.min(5, Math.max(0, t));
    }
  }

  const image = g.createImageData(W, H);
  const rgb = WOOD.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  for (let i = 0; i < tone.length; i++) {
    const [r, gr, b] = rgb[tone[i]];
    image.data.set([r, gr, b, 255], i * 4);
  }
  g.putImageData(image, 0, 0);

  // The table's edges, top and bottom.
  g.fillStyle = C.ink;
  g.fillRect(0, 0, W, 1);
  g.fillRect(0, H - 1, W, 1);
  g.fillStyle = C.wood6;
  g.fillRect(0, H - 3, W, 2);
  g.fillStyle = C.wood1;
  g.fillRect(0, 1, W, 1);
  return panes;
}

// Four panes of window light, slanting down to the right, left of the board.
function windowPanes(bx) {
  const x0 = bx - FRAME - 64;
  const panes = [];
  for (const [dx, dy] of [
    [0, 8],
    [26, 8],
    [0, 80],
    [26, 80],
  ])
    panes.push({ x: x0 + dx, y: dy, w: 22, h: 66 });
  return panes;
}

const inPane = (p, x, y) => {
  const slant = Math.floor((y - p.y) / 2);
  return y >= p.y && y < p.y + p.h && x >= p.x + slant && x < p.x + p.w + slant;
};

// The frame: walnut, mitred at the corners, bevelled to the light, a gold
// inlay round the board, carved studs at the square lines and roses at the
// corners.
function paintFrame(g, bx, by) {
  const fx = bx - FRAME;
  const fy = by - FRAME;
  const size = 128 + 2 * FRAME;
  const rect = (x, y, w, h, colour) => {
    g.fillStyle = colour;
    g.fillRect(x, y, w, h);
  };
  rect(fx, fy, size, size, C.wood5);

  // Grain along each side.
  const next = random(3);
  for (let k = 0; k < 60; k++) {
    const along = Math.floor(next() * size);
    const across = 2 + Math.floor(next() * (FRAME - 4));
    const long = 4 + Math.floor(next() * 10);
    const side = k % 4;
    g.fillStyle = next() < 0.35 ? C.wood4 : C.wood6;
    if (side === 0) g.fillRect(fx + along, fy + across, long, 1);
    if (side === 1) g.fillRect(fx + along, by + 128 + FRAME - 1 - across, long, 1);
    if (side === 2) g.fillRect(fx + across, fy + along, 1, long);
    if (side === 3) g.fillRect(bx + 128 + FRAME - 1 - across, fy + along, 1, long);
  }
  rect(bx, by, 128, 128, C.wood5); // grain stays on the frame

  // Mitres.
  g.fillStyle = C.wood6;
  for (let i = 0; i < FRAME; i++) {
    g.fillRect(fx + i, fy + i, 1, 1);
    g.fillRect(fx + size - 1 - i, fy + i, 1, 1);
    g.fillRect(fx + i, fy + size - 1 - i, 1, 1);
    g.fillRect(fx + size - 1 - i, fy + size - 1 - i, 1, 1);
  }

  // Outer bevel: lit top and left, dark bottom and right, then the outline.
  rect(fx + 1, fy + 1, size - 2, 1, C.wood3);
  rect(fx + 1, fy + 1, 1, size - 2, C.wood3);
  rect(fx + 1, fy + size - 2, size - 2, 1, C.wood6);
  rect(fx + size - 2, fy + 1, 1, size - 2, C.wood6);
  g.strokeStyle = C.ink;
  outline(g, fx, fy, size, size, C.ink);

  // Inner bevel slopes down to the board: dark top and left, lit bottom and right.
  rect(bx - 2, by - 2, 130, 1, C.wood6);
  rect(bx - 2, by - 2, 1, 130, C.wood6);
  rect(bx - 2, by + 129, 132, 1, C.wood3);
  rect(bx + 129, by - 2, 1, 132, C.wood3);
  outline(g, bx - 1, by - 1, 130, 130, C.ink);

  // Gold inlay, lit on its top and left.
  outline(g, bx - 4, by - 4, 136, 136, C.frameLine);
  rect(bx - 4, by - 4, 136, 1, C.sunflower);
  rect(bx - 4, by - 4, 1, 136, C.sunflower);
  outline(g, fx + 3, fy + 3, size - 6, size - 6, C.wood4);

  // Studs at the square lines, across the middle of each side.
  const mid = Math.floor(FRAME / 2) + 1;
  for (let i = 1; i < 8; i++) {
    const at = i * 16;
    for (const [x, y] of [
      [bx + at, fy + mid],
      [bx + at, by + 128 + FRAME - mid - 1],
      [fx + mid, by + at],
      [bx + 128 + FRAME - mid - 1, by + at],
    ]) {
      rect(x - 1, y, 3, 1, C.wood6);
      rect(x, y - 1, 1, 3, C.wood6);
      rect(x, y, 1, 1, C.wood3);
      rect(x - 1, y - 1, 1, 1, C.wood4);
    }
  }

  // Roses at the corners.
  for (const [x, y] of [
    [fx + 2, fy + 2],
    [fx + size - 10, fy + 2],
    [fx + 2, fy + size - 10],
    [fx + size - 10, fy + size - 10],
  ])
    g.drawImage(ROSE, x, y);
}

function outline(g, x, y, w, h, colour) {
  g.fillStyle = colour;
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillRect(x + w - 1, y, 1, h);
}

// A soft shadow under a thing on the table, down and to the right.
function shadow(g, x, y, w, h) {
  g.fillStyle = C.wood5;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dx = (i - w / 2) / (w / 2);
      const dy = (j - h / 2) / (h / 2);
      if (dx * dx + dy * dy <= 1 && (i + j) % 2 === 0) g.fillRect(x + i, y + j, 1, 1);
    }
  }
}

// A glow of light on the table round a flame, in rings of dither.
function glow(g, cx, cy, radius) {
  g.fillStyle = C.wood1;
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const r = Math.hypot(x - cx, (y - cy) * 1.3) / radius;
      if (r < 1 && dithered(x, y, (1 - r) * 0.7)) g.fillRect(x, y, 1, 1);
    }
  }
}

function paintProps(g, bx, by, props) {
  const spots = {};
  const rightX = bx + 128 + FRAME + 14;
  if (props.right) {
    glow(g, rightX + 5, by + 20, 26);
    shadow(g, rightX + 4, by + 32, 14, 6);
    g.drawImage(CANDLE, rightX, by + 18);
    spots.flame = [rightX + 3, by + 11];

    shadow(g, rightX + 2, by + 104, 20, 6);
    g.drawImage(CUP, rightX - 2, by + 92);
    spots.steam = [rightX + 4, by + 76];
  }
  if (props.left) {
    const leftX = bx - FRAME - 44;
    shadow(g, leftX + 4, by + 58, 30, 6);
    g.drawImage(BOOKS, leftX, by + 46);
    g.drawImage(PENCIL, leftX + 4, by + 64);

    shadow(g, leftX + 6, by + 112, 18, 5);
    g.drawImage(POT, leftX + 8, by + 106);
    spots.plant = [leftX + 8, by + 97];
  }
  return spots;
}

// The idle frames: the flame flickers, steam rises from the tea, a leaf nods,
// and dust drifts in the window light.
function paintIdle(m, frame, spots, panes) {
  if (spots.flame) {
    const pick = [0, 0, 1, 0, 2, 0, 1, 1][frame % 8];
    m.drawImage(FLAMES[pick], ...spots.flame);
  }
  if (spots.steam) {
    const [sx, sy] = spots.steam;
    m.fillStyle = C.plate;
    for (let wisp = 0; wisp < 3; wisp++) {
      const life = (frame + wisp * 4) % 12;
      const x = sx + wisp * 4 + [0, 1, 1, 0, -1, -1][Math.floor(life / 2) % 6];
      const y = sy + 14 - life;
      // Thinner as it rises: every pixel low down, every other one higher up.
      if (life < 6 || (life + wisp) % 2 === 0) m.fillRect(x, y, 1, 1);
      if (life < 4) m.fillRect(x, y + 1, 1, 1);
    }
  }
  if (spots.plant) {
    const tip = Math.floor(frame / 12) % 4 === 3;
    m.drawImage(PLANT_LEAVES[tip ? 1 : 0], ...spots.plant);
  }
  m.fillStyle = C.plate;
  for (const [k, p] of panes.entries()) {
    for (let d = 0; d < 2; d++) {
      const t = Math.floor(frame / 3) + k * 17 + d * 31;
      const y = p.y + (t % p.h);
      const x = p.x + Math.floor((y - p.y) / 2) + ((t * 7 + d * 11) % p.w);
      if (inPane(p, x, y) && Math.floor(t / 5) % 3 !== 0) m.fillRect(x, y, 1, 1);
    }
  }
}

let pending = 0;
const redraw = () => {
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(draw);
};
new ResizeObserver(redraw).observe(room);
addEventListener('resize', redraw);
redraw();
