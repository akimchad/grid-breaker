// GridManager — 8x8 tile data, BFS pathfinding, line of sight and board generation.
// All functions operate on a plain-data `state` object so the whole board can be
// cloned for the RESET TURN undo and for action previews.

export const SIZE = 8;
export const CORE_POS = { x: 3, y: 3 };

export const DIRS = [
  { x: 0, y: -1 }, // N
  { x: 1, y: 0 },  // E
  { x: 0, y: 1 },  // S
  { x: -1, y: 0 }, // W
];

export const NEIGHBORS8 = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 },                   { x: 1, y: 0 },
  { x: -1, y: 1 },  { x: 0, y: 1 },  { x: 1, y: 1 },
];

export const inBounds = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
export const key = (x, y) => y * SIZE + x;
export const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function rotateDir(d, quarterTurns) {
  let r = { x: d.x, y: d.y };
  const n = ((quarterTurns % 4) + 4) % 4;
  for (let i = 0; i < n; i++) r = { x: -r.y, y: r.x };
  return r;
}

export function dirBetween(a, b) {
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  if (dx !== 0 && dy !== 0) return null;
  if (dx === 0 && dy === 0) return null;
  return { x: dx, y: dy };
}

export function tileAt(state, x, y) {
  if (!inBounds(x, y)) return null;
  return state.tiles[key(x, y)];
}

export function entityAt(state, x, y) {
  for (const e of state.entities) {
    if (!e.dead && e.x === x && e.y === y) return e;
  }
  return null;
}

export function isFloor(state, x, y) {
  const t = tileAt(state, x, y);
  return !!t && t.type !== 'pit' && t.type !== 'pillar';
}

export function isHazard(state, x, y) {
  const t = tileAt(state, x, y);
  if (!t) return true;
  return t.type === 'pit' || t.type === 'conduit' || t.overload > 0;
}

// Breadth-first search for reachable tiles.
// opts.passTeam: team whose units may be walked through (but not stopped on)
// opts.avoidHazards: enemies refuse to path over conduits / overloaded tiles
export function bfs(state, start, range, opts = {}) {
  const { passTeam = null, avoidHazards = false } = opts;
  const dist = new Map();
  const prev = new Map();
  const startK = key(start.x, start.y);
  dist.set(startK, 0);
  const queue = [start];
  const result = [];
  while (queue.length) {
    const cur = queue.shift();
    const cd = dist.get(key(cur.x, cur.y));
    if (cd >= range) continue;
    for (const d of DIRS) {
      const nx = cur.x + d.x, ny = cur.y + d.y;
      if (!isFloor(state, nx, ny)) continue;
      const nk = key(nx, ny);
      if (dist.has(nk)) continue;
      if (avoidHazards && isHazard(state, nx, ny)) continue;
      const occ = entityAt(state, nx, ny);
      if (occ && !(passTeam && occ.team === passTeam)) continue;
      dist.set(nk, cd + 1);
      prev.set(nk, key(cur.x, cur.y));
      queue.push({ x: nx, y: ny });
      if (!occ) result.push({ x: nx, y: ny, d: cd + 1 });
    }
  }
  return {
    tiles: result,
    pathTo(x, y) {
      const path = [];
      let k = key(x, y);
      if (!dist.has(k)) return null;
      while (k !== startK) {
        path.unshift({ x: k % SIZE, y: Math.floor(k / SIZE) });
        k = prev.get(k);
      }
      return path;
    },
  };
}

// Distance field from a set of goal tiles (used by enemy AI to approach targets).
export function distanceField(state, goals, opts = {}) {
  const { ignoreEntities = true, avoidHazards = true } = opts;
  const field = new Array(SIZE * SIZE).fill(Infinity);
  const queue = [];
  for (const g of goals) {
    if (!inBounds(g.x, g.y)) continue;
    field[key(g.x, g.y)] = 0;
    queue.push(g);
  }
  while (queue.length) {
    const cur = queue.shift();
    const cd = field[key(cur.x, cur.y)];
    for (const d of DIRS) {
      const nx = cur.x + d.x, ny = cur.y + d.y;
      if (!isFloor(state, nx, ny)) continue;
      if (avoidHazards && isHazard(state, nx, ny)) continue;
      if (!ignoreEntities && entityAt(state, nx, ny)) continue;
      const nk = key(nx, ny);
      if (field[nk] <= cd + 1) continue;
      field[nk] = cd + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return field;
}

// Bresenham line of sight. Pillars and barrels block sight; units do not.
export function lineOfSight(state, a, b) {
  let x0 = a.x, y0 = a.y;
  const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
    if (x0 === x1 && y0 === y1) break;
    const t = tileAt(state, x0, y0);
    if (!t || t.type === 'pillar') return false;
    const e = entityAt(state, x0, y0);
    if (e && e.kind === 'barrel') return false;
  }
  return true;
}

// Walk a straight ray from `from` in `dir`, returning tiles until the board edge.
export function ray(from, dir, maxLen = SIZE) {
  const out = [];
  let x = from.x + dir.x, y = from.y + dir.y;
  while (inBounds(x, y) && out.length < maxLen) {
    out.push({ x, y });
    x += dir.x; y += dir.y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seeded RNG so every run is reproducible from its seed.
export function makeRng(seed) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return rng;
}

// Procedurally place hazards. Keeps the core's neighbourhood and the squad's
// start tiles clear, and verifies the floor stays fully connected.
export function generateBoard(rng, reserved) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const tiles = [];
    for (let i = 0; i < SIZE * SIZE; i++) tiles.push({ type: 'floor', overload: 0, variant: rng.int(4) });
    const blocked = new Set(reserved.map((p) => key(p.x, p.y)));
    for (const n of NEIGHBORS8) blocked.add(key(CORE_POS.x + n.x, CORE_POS.y + n.y));
    blocked.add(key(CORE_POS.x, CORE_POS.y));

    const free = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!blocked.has(key(x, y))) free.push({ x, y });
      }
    }
    rng.shuffle(free);
    const take = (filter) => {
      const i = free.findIndex(filter);
      if (i < 0) return null;
      return free.splice(i, 1)[0];
    };
    const isEdge = (p) => p.x === 0 || p.y === 0 || p.x === SIZE - 1 || p.y === SIZE - 1;
    const notEdge = (p) => !isEdge(p);

    const conduitCount = 2 + rng.int(2);
    for (let i = 0; i < conduitCount; i++) {
      const p = take(notEdge);
      if (p) tiles[key(p.x, p.y)].type = 'conduit';
    }
    for (let i = 0; i < 2; i++) {
      const p = take(() => true);
      if (p) tiles[key(p.x, p.y)].type = 'pit';
    }
    for (let i = 0; i < 2; i++) {
      const p = take(notEdge);
      if (p) tiles[key(p.x, p.y)].type = 'pillar';
    }
    const barrels = [];
    for (let i = 0; i < 2; i++) {
      const p = take(notEdge);
      if (p) barrels.push(p);
    }

    // connectivity check over non-pit / non-pillar floor
    const fake = { tiles, entities: [] };
    const reach = bfs(fake, CORE_POS, 99);
    const floorCount = tiles.filter((t) => t.type !== 'pit' && t.type !== 'pillar').length;
    if (reach.tiles.length + 1 === floorCount) return { tiles, barrels };
  }
  throw new Error('board generation failed');
}

export function edgeTiles() {
  const out = [];
  for (let i = 0; i < SIZE; i++) {
    out.push({ x: i, y: 0 }, { x: i, y: SIZE - 1 });
    if (i > 0 && i < SIZE - 1) out.push({ x: 0, y: i }, { x: SIZE - 1, y: i });
  }
  return out;
}
