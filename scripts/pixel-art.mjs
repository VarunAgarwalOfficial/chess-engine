// Draws the board's pixel art on a 16 by 16 grid: the twelve pieces, to
// web/pieces/<colour><piece>.svg, and the wood grain of the squares and the
// dither masks a taken piece leaves through, to web/art/. Each square on the
// board is 16 art pixels, so all of it fits a square at any whole-number scale.
//
// Usage: node scripts/pixel-art.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// o outline, h lit edge, f face, s shade, d deep shade, e eye, n nostril,
// a gold, j jewel, x cast shadow, . empty. The light comes from the top left.
const SPRITES = {
  p: [
    '................',
    '................',
    '................',
    '......oooo......',
    '.....ohhffo.....',
    '.....ohfffo.....',
    '.....offfso.....',
    '......ofso......',
    '....oooooooo....',
    '.....ohfsso.....',
    '......ofso......',
    '.....ohffso.....',
    '....ohfffsdo....',
    '...ohffffssdo...',
    '...oooooooooox..',
    '....xxxxxxxxx...',
  ],
  r: [
    '................',
    '..ooo.oooo.ooo..',
    '..ohfoohfooffo..',
    '..ohffffffffso..',
    '..oooooooooooo..',
    '...ohffffssdo...',
    '...ohfoofssdo...',
    '...ohffffssdo...',
    '...ohffoossdo...',
    '...ohffffssdo...',
    '...ohfoofssdo...',
    '..oooooooooooo..',
    '..ohffffffssdo..',
    '.ohffffffffssdo.',
    '.oooooooooooooox',
    '..xxxxxxxxxxxxx.',
  ],
  n: [
    '................',
    '......o.o.......',
    '.....oaoao......',
    '....ohffffoo....',
    '...ohfeoffsoo...',
    '..ohffffffsdoo..',
    '.ohffffffffsdo..',
    '.ofnffooffssdo..',
    '..oooo.ohfssdo..',
    '......ohffsdo...',
    '.....ohfffsdo...',
    '....oooooooooo..',
    '....ohfffssdo...',
    '...ohffffffsdo..',
    '...oooooooooooox',
    '....xxxxxxxxxxx.',
  ],
  b: [
    '.......oo.......',
    '......oaao......',
    '......ohfo......',
    '.....ohffso.....',
    '....ohffoosd....',
    '....ohfoofsdo...',
    '....ohffffsdo...',
    '.....ohffsdo....',
    '....ooaaaaoo....',
    '.....ohfsdo.....',
    '.....ohfsdo.....',
    '....ohffssdo....',
    '...ohffffssdo...',
    '..ohffffffssdo..',
    '..oooooooooooox.',
    '...xxxxxxxxxxx..',
  ],
  q: [
    '..o....oo....o..',
    '.oao..ojjo..oao.',
    '..o...oaao...o..',
    '..oo.ohffso.oo..',
    '..ofoohffsoofo..',
    '..ohffffffffso..',
    '..ojfjfjfjfjdo..',
    '...ohffffssdo...',
    '....ohfffsdo....',
    '....oooooooo....',
    '.....ohfsdo.....',
    '....ohffssdo....',
    '...ohffffssdo...',
    '..ohffffffssdo..',
    '..oooooooooooox.',
    '...xxxxxxxxxxx..',
  ],
  k: [
    '.......oo.......',
    '......oaao......',
    '.....oaaaao.....',
    '......oaao......',
    '...oooooooooo...',
    '..ohffffffssdo..',
    '..ohfjffffjsdo..',
    '..ohffffffssdo..',
    '...ohffffssdo...',
    '...oaaaaaaaao...',
    '....ohfffsdo....',
    '....ohfffsdo....',
    '...ohffffssdo...',
    '..ohffffffssdo..',
    '..oooooooooooox.',
    '...xxxxxxxxxxx..',
  ],
};

// The pastel palette: cream pieces and brown pieces, both outlined in ink.
const COLOURS = {
  w: {
    o: '#3b2a1a',
    h: '#fffdf2',
    f: '#fff6df',
    s: '#f0cf9c',
    d: '#c98f55',
    e: '#3b2a1a',
    n: '#c98f55',
    a: '#f7c234',
    j: '#f49ab4',
    x: 'rgb(36 24 12 / 0.35)',
  },
  b: {
    o: '#140c05',
    h: '#9a6d44',
    f: '#4f3622',
    s: '#3b2a1a',
    d: '#24180c',
    e: '#ffd23f',
    n: '#24180c',
    a: '#f2a922',
    j: '#f49ab4',
    x: 'rgb(36 24 12 / 0.35)',
  },
};

// Grain: g a darker streak, l a lighter one, over the square's own colour.
const GRAIN = {
  'light-1': [
    '................',
    '..gggg..........',
    '........llll....',
    '................',
    '.........ggggg..',
    'gg..............',
    '....lll.........',
    '...........gggg.',
    '................',
    '.gggggg.........',
    '..........lll...',
    '................',
    '......ggggg.....',
    '..ll............',
    '............ggg.',
    '................',
  ],
  'light-2': [
    '................',
    '.........ggggg..',
    '..lll...........',
    '................',
    'ggg.......ggg...',
    '................',
    '.......llll.....',
    '..gggg..........',
    '................',
    '..........ggggg.',
    '.lll............',
    '................',
    '....gggggg......',
    '...........ll...',
    'g..........gggg.',
    '................',
  ],
};
GRAIN['dark-1'] = GRAIN['light-2'];
GRAIN['dark-2'] = GRAIN['light-1'];
const GRAIN_INK = {
  light: { g: 'rgb(168 112 63 / 0.22)', l: 'rgb(255 253 242 / 0.45)' },
  dark: { g: 'rgb(36 24 12 / 0.2)', l: 'rgb(240 207 156 / 0.25)' },
};

// Dither masks, 4 by 4: half the pixels, then a quarter.
const DITHER = {
  half: ['m.m.', '.m.m', 'm.m.', '.m.m'],
  quarter: ['m...', '..m.', 'm...', '..m.'],
};

const svg = (rows, ink) => {
  let rects = '';
  const size = rows.length;
  rows.forEach((row, y) => {
    if (row.length !== size) throw new Error(`row ${y} is ${row.length} wide: ${row}`);
    // One rect per run of the same colour, so the files stay small.
    for (let x = 0; x < size;) {
      const c = row[x];
      let end = x + 1;
      while (end < size && row[end] === c) end++;
      if (c === 'x') {
        for (let i = x; i < end; i++)
          if ((i + y) % 2 === 0)
            rects += `<rect x="${i}" y="${y}" width="1" height="1" fill="${ink.x}"/>`;
      } else if (ink[c])
        rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${ink[c]}"/>`;
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${rects}</svg>\n`;
};

const out = fileURLToPath(new URL('../web/pieces/', import.meta.url));
const art = fileURLToPath(new URL('../web/art/', import.meta.url));
for (const [name, rows] of Object.entries(GRAIN)) {
  writeFileSync(`${art}grain-${name}.svg`, svg(rows, GRAIN_INK[name.split('-')[0]]));
}
for (const [name, rows] of Object.entries(DITHER)) {
  writeFileSync(`${art}dither-${name}.svg`, svg(rows, { m: '#000' }));
}
for (const [colour, ink] of Object.entries(COLOURS)) {
  for (const [piece, rows] of Object.entries(SPRITES)) {
    if (rows.length !== 16) throw new Error(`${piece} has ${rows.length} rows`);
    writeFileSync(`${out}${colour}${piece}.svg`, svg(rows, ink));
  }
}
