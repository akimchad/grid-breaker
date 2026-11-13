// CombatResolver — deterministic rules engine. Every operation mutates the plain
// `state` and appends visual events to `ev`, which the renderer replays with juice.
import {
  SIZE, DIRS, NEIGHBORS8, CORE_POS, inBounds, tileAt, entityAt, dirBetween, makeRng, generateBoard, edgeTiles,
  rotateDir,
} from './GridManager.js';
import {
  UNIT_DEFS, createEntity, intentTiles, planEnemy, chooseSpawnTiles,
} from './Entities.js';

export const TOTAL_WAVES = 5;
export const WAVE_TURNS = 3;

export const WAVES = [
  ['enforcer', 'enforcer', 'spider'],
  ['enforcer', 'artillery', 'spider'],
  ['enforcer', 'enforcer', 'artillery', 'spider'],
  ['enforcer', 'artillery', 'spider', 'spider', 'enforcer'],
  ['enforcer', 'enforcer', 'artillery', 'artillery', 'spider', 'spider'],
];
const MAX_ENEMIES = 8;

// RNG whose position lives in the state, so undo / previews stay deterministic.
export function stateRng(state) {
  const r = makeRng(state.rngState);
  const wrap = () => {
    const v = r();
    state.rngState = (state.rngState * 1664525 + 1013904223 + Math.floor(v * 1e6)) >>> 0;
    return v;
  };
  wrap.int = (n) => Math.floor(wrap() * n);
  wrap.pick = (a) => a[Math.floor(wrap() * a.length)];
  wrap.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(wrap() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return wrap;
}

export function newRun(seed = (Math.random() * 1e9) | 0) {
  const rng = makeRng(seed);
  const squadStart = [
    { kind: 'breacher', x: 4, y: 4 },
    { kind: 'netrunner', x: 2, y: 4 },
    { kind: 'sniper', x: 4, y: 2 },
  ];
  const { tiles, barrels } = generateBoard(rng, squadStart);
  const state = {
    seed,
    rngState: (seed ^ 0x9e3779b9) >>> 0,
    tiles,
    entities: [],
    nextId: 1,
    nextOrder: 1,
    wave: 1,
    turnInWave: 1,
    turn: 1,
    resetAvailable: true,
    pendingSpawns: [],
    over: null,
    stats: { kills: 0, damageTaken: 0 },
  };
  createEntity(state, 'core', CORE_POS.x, CORE_POS.y);
  for (const s of squadStart) createEntity(state, s.kind, s.x, s.y);
  for (const b of barrels) createEntity(state, 'barrel', b.x, b.y);
  return state;
}

export const getCore = (state) => state.entities.find((e) => e.kind === 'core');
export const livingEnemies = (state) => state.entities.filter((e) => !e.dead && e.team === 'enemy').sort((a, b) => a.order - b.order);
export const livingSquad = (state) => state.entities.filter((e) => !e.dead && e.team === 'player');

// ---------------------------------------------------------------------------
// Damage, death & chain reactions
export function damage(state, ent, amount, ev, label = null) {
  if (!ent || ent.dead || amount <= 0) return;
  ent.hp = Math.max(0, ent.hp - amount);
  if (ent.team === 'player' || ent.kind === 'core') state.stats.damageTaken += amount;
  ev.push({ t: 'damage', id: ent.id, amount, x: ent.x, y: ent.y, hp: ent.hp, label });
  if (ent.kind === 'core') {
    ev.push({ t: 'core', hp: ent.hp });
    if (ent.hp <= 0) state.over = 'lose';
    return;
  }
  if (ent.hp <= 0) kill(state, ent, 'destroyed', ev);
}

export function kill(state, ent, cause, ev) {
  if (ent.dead) return;
  if (ent.kind === 'core') { damage(state, ent, ent.hp, ev); return; }
  ent.dead = true;
  ent.intent = null;
  ent.hp = 0;
  if (ent.team === 'enemy') state.stats.kills++;
  ev.push({ t: 'death', id: ent.id, cause, x: ent.x, y: ent.y, kind: ent.kind });
  if (ent.kind === 'spider' && cause !== 'void') explodeSpider(state, ent.x, ent.y, ev);
  if (ent.kind === 'barrel' && cause !== 'void' && cause !== 'pit') explodeBarrel(state, ent.x, ent.y, ev);
  if (ent.team === 'player' && livingSquad(state).length === 0) state.over = 'lose';
}

function explodeSpider(state, x, y, ev) {
  const tiles = NEIGHBORS8.map((n) => ({ x: x + n.x, y: y + n.y })).filter((t) => inBounds(t.x, t.y));
  ev.push({ t: 'explode', x, y, kind: 'spider', tiles });
  for (const t of tiles) {
    const e = entityAt(state, t.x, t.y);
    if (e) damage(state, e, 2, ev);
  }
}

function explodeBarrel(state, x, y, ev) {
  const tiles = DIRS.map((d) => ({ x: x + d.x, y: y + d.y })).filter((t) => inBounds(t.x, t.y));
  ev.push({ t: 'explode', x, y, kind: 'barrel', tiles });
  for (const d of DIRS) {
    const e = entityAt(state, x + d.x, y + d.y);
    if (!e) continue;
    damage(state, e, 2, ev);
    if (!e.dead) push(state, e, d, 1, ev);
  }
}

// Effects of a unit arriving on a tile (walking or knocked).
function enterTile(state, ent, ev, walking) {
  const t = tileAt(state, ent.x, ent.y);
  if (!t || ent.dead) return;
  if (t.type === 'pit') {
    kill(state, ent, 'pit', ev);
    return;
  }
  if (t.type === 'conduit') {
    ev.push({ t: 'zap', x: ent.x, y: ent.y, color: 'yellow' });
    if (ent.team === 'enemy' && !walking) {
      ev.push({ t: 'text', x: ent.x, y: ent.y, text: 'FRIED!', color: 'yellow' });
      kill(state, ent, 'conduit', ev);
      return;
    }
    if (ent.team === 'player' || ent.team === 'enemy') damage(state, ent, 1, ev, 'ZAP');
    else if (ent.kind === 'barrel') damage(state, ent, 1, ev);
  }
  if (!ent.dead && t.overload > 0) {
    ev.push({ t: 'zap', x: ent.x, y: ent.y, color: 'magenta' });
    damage(state, ent, 2, ev, 'OVERLOAD');
    if (!ent.dead && ent.kind !== 'barrel') {
      ent.stunned = true;
      if (ent.team === 'enemy') ent.intent = null;
      if (ent.team === 'player' && state.phase === 'player') { ent.acted = true; ent.moved = true; }
      ev.push({ t: 'text', x: ent.x, y: ent.y, text: 'STUNNED!', color: 'magenta' });
    }
  }
}

export function push(state, ent, dir, dist, ev) {
  if (!ent || ent.dead) return;
  if (UNIT_DEFS[ent.kind].immovable) {
    ev.push({ t: 'text', x: ent.x, y: ent.y, text: 'IMMOVABLE', color: 'cyan' });
    return;
  }
  for (let i = 0; i < dist; i++) {
    const nx = ent.x + dir.x, ny = ent.y + dir.y;
    const from = { x: ent.x, y: ent.y };
    if (!inBounds(nx, ny)) {
      ev.push({ t: 'push', id: ent.id, from, to: { x: nx, y: ny } });
      ent.x = nx; ent.y = ny;
      ev.push({ t: 'text', x: from.x, y: from.y, text: 'INTO THE VOID', color: 'magenta' });
      kill(state, ent, 'void', ev);
      return;
    }
    const tile = tileAt(state, nx, ny);
    const occ = entityAt(state, nx, ny);
    if (tile.type === 'pillar' || occ) {
      ev.push({ t: 'bump', id: ent.id, dir, x: ent.x, y: ent.y });
      ev.push({ t: 'text', x: ent.x, y: ent.y, text: 'COLLISION!', color: 'orange' });
      ev.push({ t: 'shake', amount: 0.5 });
      damage(state, ent, 1, ev);
      if (occ) damage(state, occ, 1, ev);
      return;
    }
    ent.x = nx; ent.y = ny;
    ev.push({ t: 'push', id: ent.id, from, to: { x: nx, y: ny } });
    enterTile(state, ent, ev, false);
    if (ent.dead) return;
  }
}

// ---------------------------------------------------------------------------
// Player actions
export function moveUnit(state, unit, path, ev) {
  if (!path || !path.length) return;
  ev.push({ t: 'move', id: unit.id, path: path.map((p) => ({ x: p.x, y: p.y })) });
  const last = path[path.length - 1];
  unit.x = last.x; unit.y = last.y;
  unit.moved = true;
  enterTile(state, unit, ev, true);
}

export function executeAbility(state, unit, ability, target, opt, ev) {
  unit.acted = true;
  if (ability === 'slam') {
    const dir = dirBetween(unit, target);
    const e = entityAt(state, target.x, target.y);
    ev.push({ t: 'slam', id: unit.id, dir, x: target.x, y: target.y });
    if (!e) return;
    damage(state, e, 1, ev);
    if (!e.dead) push(state, e, dir, 2, ev);
  } else if (ability === 'emp') {
    ev.push({ t: 'emp', id: unit.id, x: unit.x, y: unit.y });
    const hit = [];
    for (const d of DIRS) {
      const e = entityAt(state, unit.x + d.x, unit.y + d.y);
      if (!e) continue;
      if (e.team === 'enemy' && e.intent) {
        e.intent = null;
        ev.push({ t: 'text', x: e.x, y: e.y, text: 'JAMMED!', color: 'magenta' });
      }
      hit.push({ e, d });
    }
    for (const { e, d } of hit) push(state, e, d, 1, ev);
  } else if (ability === 'hijack') {
    const e = entityAt(state, target.x, target.y);
    if (!e || !e.intent) return;
    const q = opt.q;
    e.intent = { ...e.intent, dir: rotateDir(e.intent.dir, q) };
    if (e.intent.perp) e.intent.perp = rotateDir(e.intent.perp, q);
    e.hijacked = true;
    ev.push({ t: 'hijack', id: unit.id, target: e.id, x: e.x, y: e.y });
    ev.push({ t: 'text', x: e.x, y: e.y, text: 'HIJACKED!', color: 'magenta' });
  } else if (ability === 'overload') {
    const t = tileAt(state, target.x, target.y);
    t.overload = 2;
    ev.push({ t: 'overload', id: unit.id, x: target.x, y: target.y });
  } else if (ability === 'railgun') {
    const dir = dirBetween(unit, target);
    let x = unit.x + dir.x, y = unit.y + dir.y;
    let end = null, hit = null;
    while (inBounds(x, y)) {
      const t = tileAt(state, x, y);
      if (t.type === 'pillar') { end = { x, y }; break; }
      const e = entityAt(state, x, y);
      if (e) { end = { x, y }; hit = e; break; }
      x += dir.x; y += dir.y;
    }
    if (!end) end = { x, y }; // off board — beam leaves the grid
    ev.push({ t: 'beam', id: unit.id, from: { x: unit.x, y: unit.y }, to: end, hit: !!hit });
    if (hit) {
      damage(state, hit, 2, ev);
      if (!hit.dead) push(state, hit, dir, 1, ev);
    }
  } else if (ability === 'grapple') {
    const from = { x: unit.x, y: unit.y };
    unit.x = target.x; unit.y = target.y;
    ev.push({ t: 'grapple', id: unit.id, from, to: { x: target.x, y: target.y } });
  }
}

// ---------------------------------------------------------------------------
// Enemy phase: move + telegraph
export function enemyPhase(state, ev) {
  const rng = stateRng(state);
  for (const e of livingEnemies(state)) {
    if (e.dead) continue;
    const wasStunned = e.stunned;
    const plan = planEnemy(state, e, rng);
    e.stunned = false;
    if (plan.path.length) {
      ev.push({ t: 'move', id: e.id, path: plan.path });
      const last = plan.path[plan.path.length - 1];
      e.x = last.x; e.y = last.y;
    }
    e.intent = plan.intent ? JSON.parse(JSON.stringify(plan.intent)) : null;
    e.hijacked = false;
    ev.push({ t: 'intent', id: e.id, tiles: intentTiles(e), kind: e.intent && e.intent.kind, stunned: wasStunned });
  }
}

// Resolution: execute telegraphed attacks in order.
export function resolveEnemies(state, ev) {
  for (const e of livingEnemies(state)) {
    if (state.over) break;
    if (e.dead || !e.intent) continue;
    const tiles = intentTiles(e);
    ev.push({ t: 'focus', id: e.id, tiles, kind: e.intent.kind, order: e.order });
    const def = UNIT_DEFS[e.kind];
    if (e.intent.kind === 'melee') {
      const tt = tiles[0];
      ev.push({ t: 'slash', id: e.id, x: tt ? tt.x : e.x, y: tt ? tt.y : e.y, dir: e.intent.dir });
      if (tt) {
        const victim = entityAt(state, tt.x, tt.y);
        if (victim) damage(state, victim, def.damage, ev);
        else ev.push({ t: 'text', x: tt.x, y: tt.y, text: 'MISS', color: 'dim' });
      }
    } else if (e.intent.kind === 'artillery') {
      ev.push({ t: 'shell', id: e.id, from: { x: e.x, y: e.y }, tiles });
      const victims = new Set();
      for (const tt of tiles) {
        const v = entityAt(state, tt.x, tt.y);
        if (v) victims.add(v);
      }
      if (!victims.size) ev.push({ t: 'text', x: tiles[0]?.x ?? e.x, y: tiles[0]?.y ?? e.y, text: 'MISS', color: 'dim' });
      for (const v of victims) damage(state, v, def.damage, ev);
    } else if (e.intent.kind === 'explode') {
      ev.push({ t: 'text', x: e.x, y: e.y, text: 'DETONATE!', color: 'red' });
      kill(state, e, 'explode', ev);
    }
    if (!e.dead) e.intent = null;
  }
  // hazards tick down
  for (let i = 0; i < state.tiles.length; i++) {
    const t = state.tiles[i];
    if (t.overload > 0) {
      t.overload--;
      if (t.overload === 0) ev.push({ t: 'overloadEnd', x: i % SIZE, y: Math.floor(i / SIZE) });
    }
  }
}

// ---------------------------------------------------------------------------
// Waves
export function planSpawns(state) {
  const rng = stateRng(state);
  const kinds = WAVES[Math.min(state.wave, TOTAL_WAVES - 1)] || WAVES[TOTAL_WAVES - 1];
  const room = Math.max(1, MAX_ENEMIES - livingEnemies(state).length);
  const list = kinds.slice(0, room);
  const tiles = chooseSpawnTiles(state, rng, list.length, edgeTiles());
  state.pendingSpawns = tiles.map((p, i) => ({ x: p.x, y: p.y, kind: list[i] }));
}

export function planInitialSpawns(state) {
  const rng = stateRng(state);
  const kinds = WAVES[0];
  const tiles = chooseSpawnTiles(state, rng, kinds.length, edgeTiles());
  state.pendingSpawns = tiles.map((p, i) => ({ x: p.x, y: p.y, kind: kinds[i] }));
}

export function spawnPending(state, ev) {
  for (const s of state.pendingSpawns) {
    const occ = entityAt(state, s.x, s.y);
    if (occ) {
      ev.push({ t: 'text', x: s.x, y: s.y, text: 'SPAWN BLOCKED', color: 'cyan' });
      damage(state, occ, 1, ev);
      continue;
    }
    const e = createEntity(state, s.kind, s.x, s.y);
    ev.push({ t: 'spawn', id: e.id, x: s.x, y: s.y, kind: s.kind });
  }
  state.pendingSpawns = [];
}

export function healSquad(state, ev) {
  for (const u of livingSquad(state)) {
    if (u.hp < u.maxHp) {
      u.hp++;
      ev.push({ t: 'heal', id: u.id, x: u.x, y: u.y, hp: u.hp });
    }
  }
}

export function startPlayerPhase(state, ev) {
  state.phase = 'player';
  for (const u of livingSquad(state)) {
    u.moved = false;
    u.acted = false;
    if (u.stunned) {
      u.stunned = false;
      u.acted = true;
      ev.push({ t: 'text', x: u.x, y: u.y, text: 'STUNNED — NO ACTION', color: 'magenta' });
    }
  }
}

export function cleanupDead(state) {
  state.entities = state.entities.filter((e) => !e.dead || e.team === 'player');
}
