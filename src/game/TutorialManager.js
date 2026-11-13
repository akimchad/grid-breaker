// TutorialManager — "BOOT CAMP": a scripted 4-step playable mission.
// Owns the tutorial board, decides which unit / ability / tile is allowed at
// each step (everything else is locked) and where the guidance beacon goes.
import { SIZE, entityAt } from './GridManager.js';
import { createEntity, intentTiles } from './Entities.js';

export const TUTORIAL_KEY = 'gridbreaker_tutorial_done';

export function tutorialDone() {
  try { return localStorage.getItem(TUTORIAL_KEY) === 'true'; } catch { return true; }
}
export function markTutorialDone() {
  try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch { /* storage blocked: ignore */ }
}

// Board layout (x, y). Core sits at [4,4].
const L = {
  core: { x: 4, y: 4 },
  breacher: { x: 5, y: 1 },
  breacherTarget: { x: 5, y: 3 },
  netrunner: { x: 2, y: 5 },
  sniper: { x: 1, y: 2 },
  drone1: { x: 5, y: 4 },   // slashes the core, gets slammed south onto the grate
  grate: { x: 5, y: 6 },
  drone2: { x: 3, y: 4 },   // aims at the core, gets hijacked
  drone3: { x: 3, y: 5 },   // damaged drone in front of it, aiming at the netrunner
};

export function createTutorialState() {
  const tiles = [];
  for (let i = 0; i < SIZE * SIZE; i++) tiles.push({ type: 'floor', overload: 0, variant: (i * 7 + (i >> 3)) % 4 });
  const set = (p, type) => { tiles[p.y * SIZE + p.x].type = type; };
  set(L.grate, 'conduit');
  set({ x: 1, y: 6 }, 'conduit');
  set({ x: 6, y: 6 }, 'pillar');
  set({ x: 1, y: 0 }, 'pillar');
  set({ x: 7, y: 0 }, 'pit');
  const state = {
    seed: 'BOOT-CAMP',
    rngState: 12345,
    tiles,
    entities: [],
    nextId: 1,
    nextOrder: 1,
    wave: 1,
    turnInWave: 1,
    turn: 1,
    resetAvailable: false,
    pendingSpawns: [],
    over: null,
    stats: { kills: 0, damageTaken: 0 },
    phase: 'player',
    tutorial: true,
  };
  createEntity(state, 'core', L.core.x, L.core.y);
  createEntity(state, 'breacher', L.breacher.x, L.breacher.y);
  const net = createEntity(state, 'netrunner', L.netrunner.x, L.netrunner.y);
  const sn = createEntity(state, 'sniper', L.sniper.x, L.sniper.y);
  // the sniper sits this one out
  sn.moved = true; sn.acted = true;
  net.moved = false; net.acted = false;
  const d1 = createEntity(state, 'enforcer', L.drone1.x, L.drone1.y);
  d1.intent = { kind: 'melee', dir: { x: -1, y: 0 } };
  return state;
}

// Spawns the two step-3 drones; returns render events.
export function spawnHijackDrones(state, ev) {
  const d2 = createEntity(state, 'enforcer', L.drone2.x, L.drone2.y);
  const d3 = createEntity(state, 'enforcer', L.drone3.x, L.drone3.y);
  d3.hp = 1;
  ev.push({ t: 'spawn', id: d2.id, x: d2.x, y: d2.y, kind: 'enforcer' });
  ev.push({ t: 'spawn', id: d3.id, x: d3.x, y: d3.y, kind: 'enforcer' });
  d2.intent = { kind: 'melee', dir: { x: 1, y: 0 } };
  d3.intent = { kind: 'melee', dir: { x: -1, y: 0 } };
  ev.push({ t: 'intent', id: d2.id, tiles: intentTiles(d2), kind: 'melee' });
  ev.push({ t: 'intent', id: d3.id, tiles: intentTiles(d3), kind: 'melee' });
}

const STEPS = [
  {
    title: 'SELECT & MOVE',
    text: '<r>ENEMY INTENT:</r> that drone is about to hit the Core! Click your <b>BREACHER</b> (or press <b>TAB</b>) and move to the pulsing <c>cyan</c> tile.',
  },
  {
    title: 'KNOCKBACK',
    text: '<o>PUSH TO KILL:</o> press <b>[2]</b> for <b>SLAM</b> and click the drone to knock it onto the <y>yellow electric grate</y>!',
  },
  {
    title: 'HIJACK',
    text: '<m>HIJACK:</m> select your <b>NETRUNNER</b>, press <b>[2]</b> for <b>HIJACK</b>, click the aiming drone, then click the <m>magenta arrow</m> to make it shoot its own teammate!',
  },
  {
    title: 'SHOWTIME',
    text: '<c>SHOWTIME:</c> press <b>[SPACE]</b> to end your turn and watch your plan play out!',
  },
];

export class TutorialManager {
  constructor() {
    this.step = 0;
    this.layout = L;
  }

  get info() { return { ...STEPS[this.step], index: this.step, total: STEPS.length }; }

  unit(state, kind) { return state.entities.find((e) => e.kind === kind && !e.dead); }
  droneAt(state, p) { const e = entityAt(state, p.x, p.y); return e && e.team === 'enemy' ? e : null; }

  // --- locks ---------------------------------------------------------------
  requiredUnitKind() { return ['breacher', 'breacher', 'netrunner', null][this.step]; }
  requiredAction() { return ['move', 'slam', 'hijack', null][this.step]; }

  canSelect(state, id) {
    const e = state.entities.find((q) => q.id === id);
    return !!e && e.kind === this.requiredUnitKind();
  }

  canUseAction(ab) { return ab === this.requiredAction(); }

  canEndTurn() { return this.step === 3; }

  // Restrict the highlighted / clickable targets to the one the script wants.
  filterTargets(state, action, targets, hijackTarget) {
    let want = null;
    if (this.step === 0 && action === 'move') want = L.breacherTarget;
    if (this.step === 1 && action === 'slam') want = L.drone1;
    if (this.step === 2 && action === 'hijack') want = hijackTarget ? L.drone3 : L.drone2;
    if (!want) return [];
    return targets.filter((t) => t.x === want.x && t.y === want.y);
  }

  // --- progression -----------------------------------------------------------
  // Called after every completed player action; returns true when the step advanced.
  check(state) {
    if (this.step === 0) {
      const b = this.unit(state, 'breacher');
      if (b && b.x === L.breacherTarget.x && b.y === L.breacherTarget.y) { this.step = 1; return true; }
    } else if (this.step === 1) {
      if (!this.droneAt(state, L.drone1) && state.stats.kills >= 1) { this.step = 2; return true; }
    } else if (this.step === 2) {
      const d2 = this.droneAt(state, L.drone2);
      if (d2 && d2.hijacked) { this.step = 3; return true; }
    }
    return false;
  }

  // --- guidance: where the beacon goes and which HUD button pulses ----------
  guide(game) {
    const s = game.state;
    const sel = game.selectedUnit();
    const out = { tiles: [], button: null };
    if (this.step === 0) {
      const b = this.unit(s, 'breacher');
      if (!sel || sel.kind !== 'breacher') out.tiles.push({ x: b.x, y: b.y, color: 'cyan' });
      else out.tiles.push({ ...L.breacherTarget, color: 'cyan' });
    } else if (this.step === 1) {
      const d = this.droneAt(s, L.drone1);
      if (game.action !== 'slam') out.button = 1;
      if (d) out.tiles.push({ x: d.x, y: d.y, color: 'orange' });
    } else if (this.step === 2) {
      const n = this.unit(s, 'netrunner');
      if (!sel || sel.kind !== 'netrunner') out.tiles.push({ x: n.x, y: n.y, color: 'magenta' });
      else if (game.action !== 'hijack') { out.button = 1; out.tiles.push({ x: n.x, y: n.y, color: 'magenta' }); }
      else if (!game.hijackTarget) out.tiles.push({ ...L.drone2, color: 'magenta' });
      else out.tiles.push({ ...L.drone3, color: 'magenta' });
    } else if (this.step === 3) {
      out.button = 'end';
    }
    return out;
  }
}
