// Entities — unit / enemy / prop definitions, ability targeting, enemy AI & intents.
import {
  SIZE, DIRS, NEIGHBORS8, CORE_POS, inBounds, tileAt, entityAt, isFloor, bfs,
  distanceField, lineOfSight, manhattan, rotateDir, key,
} from './GridManager.js';

export const UNIT_DEFS = {
  breacher: {
    name: 'BREACHER', role: 'HEAVY // TANK', team: 'player', hp: 4, move: 3,
    abilities: ['slam', 'emp'], accent: '#ff9a3c',
  },
  netrunner: {
    name: 'NETRUNNER', role: 'HACKER // CONTROL', team: 'player', hp: 2, move: 4,
    abilities: ['hijack', 'overload'], accent: '#ff4ff0',
  },
  sniper: {
    name: 'SNIPER', role: 'LONG-RANGE // PRECISION', team: 'player', hp: 2, move: 3,
    abilities: ['railgun', 'grapple'], accent: '#3cf0ff',
  },
  enforcer: {
    name: 'ENFORCER DRONE', team: 'enemy', hp: 2, move: 3, attack: 'melee', damage: 1,
    blurb: 'Telegraphs a 1-tile plasma slash (1 DMG).',
  },
  artillery: {
    name: 'ARTILLERY MECH', team: 'enemy', hp: 3, move: 2, attack: 'artillery', damage: 1,
    blurb: 'Lobs a 2x2 bombardment 3 tiles away (1 DMG per tile).',
  },
  spider: {
    name: 'KAMIKAZE SPIDER-BOT', team: 'enemy', hp: 1, move: 4, attack: 'explode', damage: 2,
    blurb: 'Rushes the Core. Explodes on death or attack: 2 DMG to all 8 adjacent tiles.',
  },
  barrel: {
    name: 'COOLANT BARREL', team: 'object', hp: 1,
    blurb: 'Detonates in a cross when hit: 2 DMG and pushes adjacent units outward.',
  },
  core: {
    name: 'UNSTABLE POWER CORE', team: 'core', hp: 5, immovable: true,
    blurb: 'Protect it. If its integrity hits zero, the grid falls.',
  },
};

export const TILE_INFO = {
  floor: null,
  conduit: { name: 'HIGH-VOLTAGE CONDUIT', blurb: 'Enemies knocked onto it are fried instantly. Player units take 1 DMG.' },
  pit: { name: 'ABYSS PIT', blurb: 'Missing floor. Any unit knocked in falls to its death.' },
  pillar: { name: 'SERVER PILLAR', blurb: 'Solid wall. Units slammed into it take +1 collision DMG.' },
  overload: { name: 'OVERLOADED TILE', blurb: 'Electrified. Units entering take 2 DMG and are STUNNED.' },
};

export const ABILITIES = {
  move: {
    name: 'MOVE', short: 'MOVE', key: '1', color: 'cyan',
    desc: 'Move up to the unit\'s MOVE range. Can pass through allies. Ending on a conduit deals 1 DMG; on an overloaded tile 2 DMG + STUN.',
  },
  slam: {
    name: 'KINETIC SLAM', short: 'SLAM', color: 'orange',
    desc: 'Melee (1 tile). 1 DMG and knocks the target back 2 tiles. Hitting a wall, unit or the Core: +1 collision DMG to both. Into a conduit (enemy), pit or off the edge: instant kill.',
  },
  emp: {
    name: 'EMP SHOCKWAVE', short: 'EMP', color: 'magenta',
    desc: 'Self AoE. Pushes every adjacent unit (friend or foe) 1 tile away and JAMS adjacent enemy attacks for this turn.',
  },
  hijack: {
    name: 'HIJACK PROTOCOL', short: 'HIJACK', color: 'magenta',
    desc: 'Range 4, line of sight. Seize an enemy\'s telegraphed attack and rotate it 90° or 180° — then pick its new firing direction.',
  },
  overload: {
    name: 'OVERLOAD TILE', short: 'OVERLOAD', color: 'magenta',
    desc: 'Range 4. Electrifies an empty floor tile for 2 turns. Units pushed or walking onto it take 2 DMG and are STUNNED (attack cancelled).',
  },
  railgun: {
    name: 'RAILGUN PIERCE', short: 'RAILGUN', color: 'orange',
    desc: 'Straight line, infinite range. Piercing beam deals 2 DMG to the first target and pushes it back 1 tile. Pillars block the shot.',
  },
  grapple: {
    name: 'GRAPPLE DASH', short: 'GRAPPLE', color: 'cyan',
    desc: 'Range 3, straight line. Zip to an empty tile, flying over pits and hazards without triggering them.',
  },
};

export function createEntity(state, kind, x, y) {
  const def = UNIT_DEFS[kind];
  const e = {
    id: state.nextId++,
    kind,
    team: def.team,
    x, y,
    hp: def.hp,
    maxHp: def.hp,
    moved: false,
    acted: false,
    stunned: false,
    dead: false,
    intent: null,
    hijacked: false,
    order: def.team === 'enemy' ? state.nextOrder++ : 0,
  };
  state.entities.push(e);
  return e;
}

export const isEnemy = (e) => e && e.team === 'enemy';
export const isPlayer = (e) => e && e.team === 'player';

// ---------------------------------------------------------------------------
// Intents are stored relative to the attacker (direction based), so pushing an
// enemy drags its attack along with it — exactly like a telegraph should.
export function intentTiles(e, intent = e.intent) {
  if (!intent) return [];
  if (intent.kind === 'melee') {
    return clip([{ x: e.x + intent.dir.x, y: e.y + intent.dir.y }]);
  }
  if (intent.kind === 'artillery') {
    const a = { x: e.x + intent.dir.x * 3, y: e.y + intent.dir.y * 3 };
    const p = intent.perp, d = intent.dir;
    return clip([
      a,
      { x: a.x + p.x, y: a.y + p.y },
      { x: a.x + d.x, y: a.y + d.y },
      { x: a.x + d.x + p.x, y: a.y + d.y + p.y },
    ]);
  }
  if (intent.kind === 'explode') {
    return clip(NEIGHBORS8.map((n) => ({ x: e.x + n.x, y: e.y + n.y })));
  }
  return [];
}
const clip = (tiles) => tiles.filter((t) => inBounds(t.x, t.y));

export function describeIntent(e) {
  if (!e.intent) return e.stunned ? 'STUNNED — no attack' : 'No attack queued';
  const def = UNIT_DEFS[e.kind];
  if (e.intent.kind === 'melee') return `PLASMA SLASH → ${def.damage} DMG`;
  if (e.intent.kind === 'artillery') return `BOMBARDMENT 2x2 → ${def.damage} DMG each`;
  if (e.intent.kind === 'explode') return `DETONATE → ${def.damage} DMG to all adjacent`;
  return '';
}

// ---------------------------------------------------------------------------
// Ability targeting. Returns { targets: [{x,y}], area: [{x,y}] }.
export function abilityTargets(state, unit, ability) {
  const targets = [];
  const area = [];
  if (ability === 'move') {
    if (unit.moved) return { targets, area };
    const r = bfs(state, unit, UNIT_DEFS[unit.kind].move, { passTeam: 'player' });
    return { targets: r.tiles, area };
  }
  if (unit.acted) return { targets, area };

  if (ability === 'slam') {
    for (const d of DIRS) {
      const x = unit.x + d.x, y = unit.y + d.y;
      if (!inBounds(x, y)) continue;
      const e = entityAt(state, x, y);
      if (e && e.kind !== 'core') targets.push({ x, y });
      else if (tileAt(state, x, y).type !== 'pillar') area.push({ x, y });
    }
  } else if (ability === 'emp') {
    targets.push({ x: unit.x, y: unit.y });
    for (const d of DIRS) {
      const x = unit.x + d.x, y = unit.y + d.y;
      if (inBounds(x, y)) targets.push({ x, y });
    }
  } else if (ability === 'hijack') {
    for (const e of state.entities) {
      if (e.dead || e.team !== 'enemy') continue;
      if (manhattan(unit, e) > 4) continue;
      if (!lineOfSight(state, unit, e)) continue;
      if (e.intent && (e.intent.kind === 'melee' || e.intent.kind === 'artillery')) targets.push({ x: e.x, y: e.y });
      else area.push({ x: e.x, y: e.y });
    }
  } else if (ability === 'overload') {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (manhattan(unit, { x, y }) > 4 || (x === unit.x && y === unit.y)) continue;
        const t = tileAt(state, x, y);
        if (t.type !== 'floor' || t.overload > 0) continue;
        if (entityAt(state, x, y)) continue;
        targets.push({ x, y });
      }
    }
  } else if (ability === 'railgun') {
    for (const d of DIRS) {
      let x = unit.x + d.x, y = unit.y + d.y;
      while (inBounds(x, y)) {
        const t = tileAt(state, x, y);
        if (t.type === 'pillar') break;
        targets.push({ x, y });
        if (entityAt(state, x, y)) break;
        x += d.x; y += d.y;
      }
    }
  } else if (ability === 'grapple') {
    for (const d of DIRS) {
      for (let i = 1; i <= 3; i++) {
        const x = unit.x + d.x * i, y = unit.y + d.y * i;
        if (!inBounds(x, y)) break;
        const t = tileAt(state, x, y);
        if (t.type === 'pillar' || entityAt(state, x, y)) break;
        if (t.type === 'pit') { area.push({ x, y }); continue; }
        targets.push({ x, y });
      }
    }
  }
  return { targets, area };
}

// The three new firing directions offered after picking a hijack target.
export function hijackOptions(state, enemy) {
  const out = [];
  for (const q of [1, 2, 3]) {
    const d = rotateDir(enemy.intent.dir, q);
    const x = enemy.x + d.x, y = enemy.y + d.y;
    out.push({ x, y, q, dir: d, onBoard: inBounds(x, y) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Enemy AI: evaluate every reachable tile x every attack option and pick the
// most damaging plan. Falls back to closing distance on the Core.
function scoreTiles(state, self, tiles) {
  let s = 0;
  for (const t of tiles) {
    const e = entityAt(state, t.x, t.y);
    if (!e || e === self) continue;
    if (e.kind === 'core') s += 10;
    else if (e.team === 'player') s += 7;
    else if (e.kind === 'barrel') s += 1;
    else if (e.team === 'enemy') s -= 6;
  }
  return s;
}

function attackOptions(kind) {
  if (kind === 'melee') return DIRS.map((d) => ({ kind: 'melee', dir: d }));
  if (kind === 'artillery') {
    const out = [];
    for (const d of DIRS) for (const q of [1, 3]) out.push({ kind: 'artillery', dir: d, perp: rotateDir(d, q) });
    return out;
  }
  if (kind === 'explode') return [{ kind: 'explode' }];
  return [];
}

export function planEnemy(state, e, rng) {
  const def = UNIT_DEFS[e.kind];
  const goals = [];
  if (def.attack === 'artillery') {
    for (const tgt of [CORE_POS, ...state.entities.filter((u) => !u.dead && u.team === 'player')]) {
      for (const d of DIRS) goals.push({ x: tgt.x - d.x * 3, y: tgt.y - d.y * 3 });
    }
  } else if (def.attack === 'explode') {
    for (const n of NEIGHBORS8) goals.push({ x: CORE_POS.x + n.x, y: CORE_POS.y + n.y });
  } else {
    for (const tgt of [CORE_POS, ...state.entities.filter((u) => !u.dead && u.team === 'player')]) {
      for (const d of DIRS) goals.push({ x: tgt.x + d.x, y: tgt.y + d.y });
    }
  }
  const field = distanceField(state, goals);

  let candidates = [{ x: e.x, y: e.y, d: 0 }];
  let reach = null;
  if (!e.stunned) {
    reach = bfs(state, e, def.move, { passTeam: 'enemy', avoidHazards: true });
    candidates = candidates.concat(reach.tiles);
  }

  const opts = attackOptions(def.attack);
  let best = null;
  const ox = e.x, oy = e.y;
  for (const c of candidates) {
    // temporarily move to evaluate
    e.x = c.x; e.y = c.y;
    const fd = field[key(c.x, c.y)];
    const approach = Number.isFinite(fd) ? -fd * 0.6 : -8;
    for (const o of opts) {
      const tiles = intentTiles(e, o);
      if (o.kind === 'artillery' && tiles.length < 2) continue;
      const atk = scoreTiles(state, e, tiles);
      const total = (atk > 0 ? atk * 2 : -1) + approach + rng() * 0.8;
      if (!best || total > best.total) best = { total, atk, c, o };
    }
    if (!opts.length) {
      const total = approach + rng() * 0.5;
      if (!best || total > best.total) best = { total, atk: 0, c, o: null };
    }
  }
  e.x = ox; e.y = oy;

  const dest = best.c;
  const path = reach && (dest.x !== e.x || dest.y !== e.y) ? reach.pathTo(dest.x, dest.y) || [] : [];
  let intent = best.atk > 0 ? best.o : null;
  // Melee drones always threaten *something* adjacent when idle: face the core.
  if (!intent && def.attack === 'melee') {
    for (const d of DIRS) {
      if (dest.x + d.x === CORE_POS.x && dest.y + d.y === CORE_POS.y) intent = { kind: 'melee', dir: d };
    }
  }
  return { path, intent };
}

// Pick spread-out spawn tiles along the edges for the next wave.
export function chooseSpawnTiles(state, rng, count, edgeList) {
  const pending = new Set((state.pendingSpawns || []).map((p) => key(p.x, p.y)));
  const options = edgeList.filter((p) => {
    const t = tileAt(state, p.x, p.y);
    return t && t.type === 'floor' && t.overload === 0 && !entityAt(state, p.x, p.y) && !pending.has(key(p.x, p.y));
  });
  rng.shuffle(options);
  const chosen = [];
  for (const p of options) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => manhattan(c, p) < 3)) continue;
    chosen.push(p);
  }
  for (const p of options) {
    if (chosen.length >= count) break;
    if (!chosen.includes(p)) chosen.push(p);
  }
  return chosen;
}

export { isFloor };
