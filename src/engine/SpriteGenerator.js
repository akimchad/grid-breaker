// SpriteGenerator — hard-coded 32x32 pixel matrices rendered onto offscreen
// canvases, auto-outlined, split into colour + emissive (glow) layers and wrapped
// in NearestFilter CanvasTextures so pixels stay razor sharp in 3D.
import * as THREE from 'three';

const S = 32;
const OUTLINE = '#06070d';

// Shared palette keys. Uppercase/lowercase pairs are light/dark variants.
// Emissive keys glow through bloom: c p r y o e (cyan, magenta, red, yellow, orange, white-hot)
const BASE_PALETTE = {
  k: OUTLINE,
  b: '#11141f',
  d: '#232a3b',
  m: '#3a455c',
  l: '#5d6b86',
  w: '#9fb0cc',
  G: '#2b2f3a',
  g: '#4d5465',
  s: '#e0a986',
  S: '#b07a5e',
  h: '#1d1b2e',
  c: '#3cf6ff',
  p: '#ff3cf0',
  r: '#ff2a4a',
  y: '#ffd23c',
  o: '#ff8a1c',
  e: '#ffffff',
};
const EMISSIVE = new Set(['c', 'p', 'r', 'y', 'o', 'e']);

// --- Sprite definitions --------------------------------------------------
// `half`: left 16 columns, mirrored to form a symmetric 32-wide body.
// `overlay`: [row, col, string] asymmetric details drawn on top (' ' / '.' = skip).
const SPRITES = {
  breacher: {
    palette: { a: '#b2531b', A: '#ff9a3c', u: '#c46a2a' },
    portrait: { x: 8, y: 1 },
    half: [
      '................',
      '................',
      '...........mmmmm',
      '..........mlllll',
      '..........mlwwll',
      '..........mddddd',
      '..........dccccc',
      '..........dceccc',
      '..........dddddd',
      '...........mgdgd',
      '.....aaaa...mmmm',
      '....aAAAAa.kdddd',
      '...aAwAAAAakmlll',
      '...aAAAAAAakmlwl',
      '...aaaaaaaakmdyy',
      '....dmmmmd.kmddd',
      '....dmllmd.kmmmm',
      '....dmmmmd.kdddd',
      '....GddddG.kGaGG',
      '....GmmmmG.kdmmm',
      '.....GGGG..kdmmm',
      '...........kmmmk',
      '..........kmllmk',
      '..........kmmmmk',
      '..........kmdmm.',
      '.........kaAAAa.',
      '.........kaaaaa.',
      '........kGGGGGG.',
      '........kbbbbbb.',
    ],
    overlay: [
      [19, 4, 'oooooo'],
    ],
  },
  netrunner: {
    palette: { u: '#3a1f4d', U: '#6a3a86', d: '#1f1a2e', m: '#34294a', l: '#54406e' },
    portrait: { x: 8, y: 1 },
    half: [
      '................',
      '................',
      '............uuuu',
      '...........uUUUU',
      '..........uUuuuu',
      '..........uussss',
      '..........uppppp',
      '..........upeppS',
      '..........uusssS',
      '..........uuSsss',
      '...........uuSSS',
      '..........uuuuuu',
      '.........umddddd',
      '........umdmmmmp',
      '........umdlmmmd',
      '.......umdmmmmmp',
      '.......umdmmmmmd',
      '.......sscccccce',
      '.......usceccccc',
      '.......umddmmmmp',
      '........umdmmmmd',
      '........umddmmmd',
      '.........umddkdd',
      '.........dmmk.dd',
      '..........dmk...',
      '..........hmk...',
      '..........hhk...',
      '.........hhhk...',
    ],
    overlay: [
      [16, 6, 'p'],
      [16, 25, 'p'],
      [0, 22, 'p'],
      [1, 21, 'k'],
    ],
  },
  sniper: {
    palette: { a: '#1c5a66', A: '#2fb2c4', d: '#1d2533', m: '#2f3b4f', l: '#4a5a73' },
    portrait: { x: 8, y: 1 },
    half: [
      '................',
      '................',
      '............mmmm',
      '...........mllll',
      '...........mlwll',
      '...........mdddd',
      '...........dbcce',
      '...........mdddd',
      '............mggg',
      '..........aaaaaa',
      '.........aAAmmmm',
      '........aAAmllll',
      '........aAmmlmmm',
      '........amddmmmc',
      '........amdmmmmm',
      '........amddddmm',
      '.........mdmmmmd',
      '.........mdddddd',
      '..........dmmmmm',
      '..........dmm.mm',
      '..........dmm.mm',
      '..........dmd.dm',
      '..........aAa.aA',
      '..........aaa.aa',
      '.........GGGG.GG',
      '.........bbbb.bb',
    ],
    overlay: [
      [13, 4, 'ddGGGGGGGGGGGGGGGGGGGGGGGGk'],
      [14, 4, 'dGGcccccccccccccccccccGGGGe'],
      [15, 5, 'GG.......GG.....gg'],
      [12, 20, 'GGG'],
      [11, 21, 'cG'],
    ],
  },
  enforcer: {
    palette: { d: '#2a1a24', m: '#4a2c3c', l: '#73445a', w: '#b06f8c' },
    portrait: { x: 8, y: 3 },
    half: [
      '................',
      '................',
      '..............r.',
      '..............d.',
      '...........mmmmm',
      '.........mmlllll',
      '........mllwwlll',
      '.......mlldddddd',
      '.......mldbbbbbb',
      '.......mldbbrrre',
      '.......mldbbbbbb',
      '.......mmlddddmm',
      '........mmmmmmmm',
      '.....GG..dmmmmmm',
      '...oGGGG.kdddddd',
      '..ooGddG..kmmmmm',
      '.oo..GG....kdddd',
      'oo..........kGGG',
      '.............GGr',
      '..............ro',
      '...............o',
    ],
  },
  artillery: {
    palette: { d: '#2c2516', m: '#4c4126', l: '#776a3e', w: '#b8a970' },
    portrait: { x: 8, y: 4 },
    half: [
      '................',
      '.............GGG',
      '.............GrG',
      '.............GGG',
      '.............GgG',
      '.............GgG',
      '...........kGGGG',
      '..........dddddd',
      '........ddmmmmmm',
      '.......dmmllllll',
      '.......dmlykykyk',
      '.......dmmmmmmmm',
      '.......dmdbbrrbb',
      '.......dmdbbbbbb',
      '.......dmmmmmmmm',
      '......Gdddddddmm',
      '.....GgGG...dddd',
      '.....GmG......Gg',
      '....GmlG......Gg',
      '....GmmG.......G',
      '...GGmmGG.......',
      '..GgggggG.......',
      '..GGGGGGG.......',
    ],
  },
  spider: {
    palette: { d: '#241826', m: '#3d2a40', l: '#5f4563' },
    portrait: { x: 8, y: 10 },
    half: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.......G........',
      '......G.G.......',
      '.....G...G......',
      '....G.....dddddd',
      '...G.....dmmmmmm',
      '..G..GG.dmllllll',
      '.G..G..GdmlwrrrR',
      '.G.G....dmlrrerr',
      'G..G....dmmlrrrr',
      'G.G......ddmmmmm',
      '..G.......Gddddd',
      '.G.......G..GG..',
      '.G......G..G....',
      'G......G...G....',
    ],
    palette2: { R: '#ff2a4a' },
  },
  barrel: {
    palette: { d: '#123040', m: '#1d4b63', l: '#2f7290', w: '#6fb9d6' },
    portrait: { x: 8, y: 8 },
    half: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '..........GGGGGG',
      '.........Ggggggg',
      '........Gmmmmmmm',
      '........dmlllllw',
      '........dmlwllll',
      '........ykykykyk',
      '........kykykyky',
      '........dmlllllm',
      '........dmlbccce',
      '........dmlbcccc',
      '........dmlbcccc',
      '........dmlllllm',
      '........ykykykyk',
      '........kykykyky',
      '........dmmmmmmm',
      '.........ddddddd',
      '..........GGGGGG',
    ],
  },
};

// --- Ability icons (12x12, single glyph colour) -------------------------
const ICONS = {
  move: [
    '.....##.....',
    '....####....',
    '...##..##...',
    '.....##.....',
    '.#...##...#.',
    '############',
    '############',
    '.#...##...#.',
    '.....##.....',
    '...##..##...',
    '....####....',
    '.....##.....',
  ],
  slam: [
    '............',
    '..#####.....',
    '.#######..#.',
    '.#######.#..',
    '.#######....',
    '.#######.###',
    '..######....',
    '..#####..#..',
    '..#####...#.',
    '..#####.....',
    '...###......',
    '............',
  ],
  emp: [
    '....####....',
    '..##....##..',
    '.#..####..#.',
    '.#.#....#.#.',
    '#.#..##..#.#',
    '#.#.####.#.#',
    '#.#.####.#.#',
    '#.#..##..#.#',
    '.#.#....#.#.',
    '.#..####..#.',
    '..##....##..',
    '....####....',
  ],
  hijack: [
    '....#####...',
    '...#.....#..',
    '..#.......#.',
    '..#......###',
    '..#.......#.',
    '............',
    '.#..........',
    '###......#..',
    '.#.......#..',
    '..#.....#...',
    '...#####....',
    '............',
  ],
  overload: [
    '.......####.',
    '......####..',
    '.....####...',
    '....####....',
    '...#######..',
    '..#######...',
    '.....###....',
    '....###.....',
    '...###......',
    '..##........',
    '.#..........',
    '............',
  ],
  railgun: [
    '.....##.....',
    '.....##.....',
    '...######...',
    '..#..##..#..',
    '.#...##...#.',
    '#####..#####',
    '#####..#####',
    '.#...##...#.',
    '..#..##..#..',
    '...######...',
    '.....##.....',
    '.....##.....',
  ],
  grapple: [
    '.......####.',
    '......#....#',
    '......#....#',
    '.......#..#.',
    '........##..',
    '.......#....',
    '......#.....',
    '.....#......',
    '..#.#.......',
    '..##........',
    '..###.......',
    '............',
  ],
  end: [
    '............',
    '.##.........',
    '.####.......',
    '.######.....',
    '.########...',
    '.##########.',
    '.##########.',
    '.########...',
    '.######.....',
    '.####.......',
    '.##.........',
    '............',
  ],
};

function buildMatrix(spec) {
  const grid = Array.from({ length: S }, () => new Array(S).fill('.'));
  const rows = spec.half;
  const offY = S - 1 - rows.length; // bottom aligned, 1px margin
  rows.forEach((raw, r) => {
    const line = raw.padEnd(16, '.').slice(0, 16);
    const full = line + line.split('').reverse().join('');
    for (let c = 0; c < S; c++) grid[r + offY][c] = full[c];
  });
  for (const [r, c, str] of spec.overlay || []) {
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === ' ' || ch === '.') continue;
      const rr = r + offY, cc = c + i;
      if (rr >= 0 && rr < S && cc >= 0 && cc < S) grid[rr][cc] = ch;
    }
  }
  // Auto outline: transparent pixels touching a coloured pixel become outline.
  const out = grid.map((row) => row.slice());
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (grid[y][x] !== '.') continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const v = grid[y + dy] && grid[y + dy][x + dx];
        return v && v !== '.' && v !== 'k';
      });
      if (n) out[y][x] = 'k';
    }
  }
  return out;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function paint(matrix, palette, emissiveOnly = false) {
  const h = matrix.length, w = matrix[0].length;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (emissiveOnly) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = matrix[y][x];
      if (ch === '.') continue;
      const glow = EMISSIVE.has(ch) || ch === 'R';
      let col = palette[ch] || '#ff00ff';
      // Emissive layer: glowing pixels at full strength, the rest as a dim
      // self-illumination so pixel art stays readable in the dark diorama.
      if (emissiveOnly && !glow) col = scaleHex(col, 0.5);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function scaleHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

function toTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map();

export const SpriteGenerator = {
  get(kind) {
    if (cache.has(kind)) return cache.get(kind);
    const spec = SPRITES[kind];
    const palette = { ...BASE_PALETTE, ...(spec.palette || {}), ...(spec.palette2 || {}) };
    const matrix = buildMatrix(spec);
    const canvas = paint(matrix, palette);
    const emissiveCanvas = paint(matrix, palette, true);
    const entry = {
      canvas,
      emissiveCanvas,
      texture: toTexture(canvas),
      emissiveTexture: toTexture(emissiveCanvas),
      portrait: null,
    };
    entry.portrait = makePortrait(canvas, spec.portrait, kind);
    cache.set(kind, entry);
    return entry;
  },

  // 32x32 portrait: crop a 16x16 head region, scale x2, frame it with scanlines.
  portraitURL(kind) {
    return this.get(kind).portrait;
  },

  iconURL(name, color = '#3cf6ff') {
    const k = `icon:${name}:${color}`;
    if (cache.has(k)) return cache.get(k);
    const m = ICONS[name];
    const c = makeCanvas(12, 12);
    const ctx = c.getContext('2d');
    // outline pass
    ctx.fillStyle = OUTLINE;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
      if (m[y][x] !== '#') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ctx.fillRect(x + dx, y + dy, 1, 1);
    }
    ctx.fillStyle = color;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (m[y][x] === '#') ctx.fillRect(x, y, 1, 1);
    const url = c.toDataURL();
    cache.set(k, url);
    return url;
  },

  // Tile frame textures used by grid highlights / telegraph overlays.
  frameTexture(style = 'solid') {
    const k = `frame:${style}`;
    if (cache.has(k)) return cache.get(k);
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    if (style === 'solid') {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(2, 2, 28, 28);
      ctx.fillStyle = '#fff';
      ctx.fillRect(1, 1, 30, 2); ctx.fillRect(1, 29, 30, 2);
      ctx.fillRect(1, 1, 2, 30); ctx.fillRect(29, 1, 2, 30);
      // corner brackets
      ctx.fillRect(0, 0, 7, 1); ctx.fillRect(0, 0, 1, 7);
      ctx.fillRect(25, 0, 7, 1); ctx.fillRect(31, 0, 1, 7);
      ctx.fillRect(0, 31, 7, 1); ctx.fillRect(0, 25, 1, 7);
      ctx.fillRect(25, 31, 7, 1); ctx.fillRect(31, 25, 1, 7);
    } else if (style === 'danger') {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = -32; i < 64; i += 6) {
        for (let y = 0; y < 32; y++) {
          const x = i + y;
          if (x >= 0 && x < 32) ctx.fillRect(x, y, 2, 1);
        }
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 32, 2); ctx.fillRect(0, 30, 32, 2);
      ctx.fillRect(0, 0, 2, 32); ctx.fillRect(30, 0, 2, 32);
    } else if (style === 'hover') {
      ctx.fillStyle = '#fff';
      const L = 9;
      ctx.fillRect(0, 0, L, 2); ctx.fillRect(0, 0, 2, L);
      ctx.fillRect(32 - L, 0, L, 2); ctx.fillRect(30, 0, 2, L);
      ctx.fillRect(0, 30, L, 2); ctx.fillRect(0, 32 - L, 2, L);
      ctx.fillRect(32 - L, 30, L, 2); ctx.fillRect(30, 32 - L, 2, L);
    } else if (style === 'teleporter') {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(16, 16, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(16, 16, 7, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.fillRect(16 + Math.cos(a) * 14 - 1, 16 + Math.sin(a) * 14 - 1, 2, 2);
      }
    } else if (style === 'arrow') {
      // arrow pointing towards -Y in texture space (north)
      ctx.fillStyle = '#fff';
      const pts = ['.......##.......', '......####......', '.....######.....', '....########....',
        '...##########...', '..####.##.####..', '......####......', '......####......', '......####......'];
      pts.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') ctx.fillRect(x * 2, 6 + y * 2, 2, 2); }));
    }
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    cache.set(k, t);
    return t;
  },

  // Metallic tile top texture with panel seams, rivets and wet puddle streaks.
  tileTextures(variant) {
    const k = `tile:${variant}`;
    if (cache.has(k)) return cache.get(k);
    const c = makeCanvas(64, 64);
    const r = makeCanvas(64, 64);
    const ctx = c.getContext('2d');
    const rtx = r.getContext('2d');
    let seed = variant * 9301 + 49297;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    ctx.fillStyle = '#4a5468';
    ctx.fillRect(0, 0, 64, 64);
    rtx.fillStyle = '#555';
    rtx.fillRect(0, 0, 64, 64);
    // noise
    for (let i = 0; i < 400; i++) {
      const v = 60 + rand() * 30;
      ctx.fillStyle = `rgb(${v},${v + 8},${v + 22})`;
      ctx.fillRect((rand() * 64) | 0, (rand() * 64) | 0, 2, 2);
    }
    // panel seams
    ctx.fillStyle = '#1b2030';
    ctx.fillRect(0, 0, 64, 2); ctx.fillRect(0, 0, 2, 64);
    ctx.fillStyle = '#7a879f';
    ctx.fillRect(2, 2, 62, 1); ctx.fillRect(2, 2, 1, 62);
    if (variant % 2 === 0) { ctx.fillStyle = '#20263a'; ctx.fillRect(32, 2, 1, 62); }
    if (variant === 1) { ctx.fillStyle = '#20263a'; ctx.fillRect(2, 32, 62, 1); }
    if (variant === 3) {
      ctx.fillStyle = '#2a3145';
      for (let i = 0; i < 6; i++) ctx.fillRect(14 + i * 6, 20, 3, 24);
    }
    // rivets
    ctx.fillStyle = '#8f9bb3';
    for (const [x, y] of [[6, 6], [58, 6], [6, 58], [58, 58]]) ctx.fillRect(x, y, 2, 2);
    // wet puddles: low roughness streaks
    for (let i = 0; i < 3; i++) {
      const px = rand() * 50, py = rand() * 50, pw = 8 + rand() * 18, ph = 3 + rand() * 6;
      rtx.fillStyle = '#111';
      rtx.fillRect(px, py, pw, ph);
      ctx.fillStyle = 'rgba(20,26,40,0.5)';
      ctx.fillRect(px, py, pw, ph);
    }
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    const rough = new THREE.CanvasTexture(r);
    rough.magFilter = THREE.NearestFilter;
    rough.minFilter = THREE.NearestFilter;
    rough.generateMipmaps = false;
    const entry = { map, rough };
    cache.set(k, entry);
    return entry;
  },

  conduitTexture() {
    const k = 'conduit';
    if (cache.has(k)) return cache.get(k);
    const c = makeCanvas(32, 32);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#ffd23c';
    for (let i = 3; i < 32; i += 5) ctx.fillRect(3, i, 26, 2);
    ctx.fillStyle = '#3cf6ff';
    ctx.fillRect(1, 1, 30, 1); ctx.fillRect(1, 30, 30, 1);
    ctx.fillRect(1, 1, 1, 30); ctx.fillRect(30, 1, 1, 30);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    cache.set(k, t);
    return t;
  },

  windowTexture(seed, hue) {
    const c = makeCanvas(32, 128);
    const ctx = c.getContext('2d');
    let s = seed;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 32, 128);
    for (let y = 2; y < 126; y += 4) {
      for (let x = 2; x < 30; x += 4) {
        if (rand() < 0.35) {
          const l = 40 + rand() * 40;
          ctx.fillStyle = `hsl(${hue + rand() * 30 - 15},90%,${l}%)`;
          ctx.fillRect(x, y, 2, 2);
        }
      }
    }
    if (rand() < 0.6) {
      ctx.fillStyle = `hsl(${hue},100%,60%)`;
      ctx.fillRect(0, (rand() * 100) | 0, 32, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  },

  // Debug helper: a sprite sheet of every character as a data URL.
  sheetURL() {
    const kinds = Object.keys(SPRITES);
    const c = makeCanvas(S * kinds.length * 4, S * 4);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1a2030';
    ctx.fillRect(0, 0, c.width, c.height);
    kinds.forEach((k, i) => ctx.drawImage(this.get(k).canvas, i * S * 4, 0, S * 4, S * 4));
    return c.toDataURL();
  },
};

const PORTRAIT_BG = {
  breacher: ['#2a1708', '#ff9a3c'],
  netrunner: ['#220a26', '#ff3cf0'],
  sniper: ['#08202a', '#3cf6ff'],
  enforcer: ['#2a0810', '#ff2a4a'],
  artillery: ['#2a2208', '#ffd23c'],
  spider: ['#2a0810', '#ff2a4a'],
  barrel: ['#082030', '#3cf6ff'],
};

function makePortrait(src, crop, kind) {
  const c = makeCanvas(32, 32);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const [bg, accent] = PORTRAIT_BG[kind] || ['#101420', '#3cf6ff'];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.18;
  for (let y = 0; y < 32; y += 2) ctx.fillRect(0, y, 32, 1);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, 26, 32, 6);
  ctx.globalAlpha = 1;
  const { x, y } = crop || { x: 8, y: 0 };
  ctx.drawImage(src, x, y, 16, 16, 0, 0, 32, 32);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 32, 1); ctx.fillRect(0, 31, 32, 1);
  ctx.fillRect(0, 0, 1, 32); ctx.fillRect(31, 0, 1, 32);
  return c.toDataURL();
}
