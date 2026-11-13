// GRID-BREAKER: NEON SIEGE — entry point, game loop and turn state machine.
import './style.css';
import * as THREE from 'three';
import { SceneManager } from './engine/SceneManager.js';
import { ParticleSystem } from './engine/ParticleSystem.js';
import { BoardRenderer, wp } from './engine/BoardRenderer.js';
import { SoundFX } from './engine/SoundFX.js';
import { HUDManager } from './ui/HUDManager.js';
import { SIZE, inBounds, bfs, entityAt, tileAt, key } from './game/GridManager.js';
import { UNIT_DEFS, ABILITIES, abilityTargets, hijackOptions, intentTiles } from './game/Entities.js';
import {
  newRun, planInitialSpawns, spawnPending, enemyPhase, startPlayerPhase, resolveEnemies, planSpawns,
  healSquad, cleanupDead, moveUnit, executeAbility, livingEnemies, livingSquad, getCore,
  TOTAL_WAVES, WAVE_TURNS,
} from './game/CombatResolver.js';

const HINTS = {
  none: 'Select a mercenary — click it or press <b>TAB</b>.',
  move: 'Click a <c>cyan</c> tile to move. <b>2</b>/<b>3</b> pick abilities · <b>ESC</b> cancel.',
  slam: 'Click an adjacent target to <o>SLAM</o> it 2 tiles back.',
  emp: 'Click the Breacher (or any adjacent tile) to fire the <m>EMP</m>.',
  hijack: 'Pick an enemy with a telegraphed attack in range to <m>HIJACK</m>.',
  hijack2: 'Choose the attack\'s <m>new firing direction</m> (arrows).',
  overload: 'Click an empty floor tile to <m>OVERLOAD</m> it for 2 turns.',
  railgun: 'Click any tile in a line to fire the <o>RAILGUN</o>.',
  grapple: 'Click a <c>cyan</c> tile to <c>GRAPPLE DASH</c> there.',
  done: 'All orders spent. Press <b>SPACE</b> to END TURN.',
};

class Game {
  constructor() {
    this.sm = new SceneManager(document.getElementById('app'));
    this.fx = new ParticleSystem(this.sm);
    this.hud = new HUDManager(this.sm);
    this.board = new BoardRenderer(this.sm, this.fx, this.hud);
    this.mode = 'title';
    this.selectedId = null;
    this.action = null;
    this.hijackTarget = null;
    this.hoverTile = null;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.clock = new THREE.Clock();
    this.endConfirmUntil = 0;

    this.hud.on('start', () => this.start());
    this.hud.on('restart', () => this.start());
    this.hud.on('reset', () => this.resetTurn());
    this.hud.on('endTurn', () => this.endTurn());
    this.hud.on('action', (slot) => this.setAction(slot));
    this.hud.on('selectUnit', (id) => this.select(id));
    this.hud.on('mute', () => this.toggleMute());

    // Attract-mode board behind the title screen
    this.state = newRun();
    this.board.buildBoard(this.state);
    this.hud.refresh(this);

    this.bindInput();
    this.lastTick = performance.now();
    this.loop();
    this.startWatchdog();
    window.__game = this;
  }

  // ---------------------------------------------------------------------------
  loop() {
    requestAnimationFrame(() => this.loop());
    this.tick();
  }

  // Background tabs throttle rAF to zero; a slow watchdog keeps turn flow alive.
  startWatchdog() {
    setInterval(() => { if (performance.now() - this.lastTick > 250) this.tick(); }, 100);
  }

  tick() {
    this.lastTick = performance.now();
    const dt = Math.min(0.05, this.clock.getDelta());
    const pan = 7 * dt / this.sm.zoom;
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) this.sm.panBy(-pan * 0.7, -pan * 0.7);
    if (k.has('s') || k.has('arrowdown')) this.sm.panBy(pan * 0.7, pan * 0.7);
    if (k.has('a') || k.has('arrowleft')) this.sm.panBy(-pan * 0.7, pan * 0.7);
    if (k.has('d') || k.has('arrowright')) this.sm.panBy(pan * 0.7, -pan * 0.7);
    if (this.mode === 'title') this.sm.panTarget.set(Math.sin(this.sm.realTime * 0.2) * 0.6, 0, Math.cos(this.sm.realTime * 0.17) * 0.6);
    const gdt = this.sm.update(dt);
    this.fx.update(gdt, dt);
    this.board.update(gdt, this.sm.time);
    this.hud.update(this.board);
    this.sm.render();
  }

  // ---------------------------------------------------------------------------
  // Flow
  async start() {
    SoundFX.init();
    SoundFX.select();
    this.hud.showScreen(null);
    this.ended = false;
    this.mode = 'busy';
    this.selectedId = null;
    this.action = null;
    this.state = newRun();
    this.board.buildBoard(this.state);
    this.sm.resetView();
    planInitialSpawns(this.state);
    this.board.sync(this.state);
    this.phaseLabel = 'DEPLOYMENT';
    this.refresh();
    this.hud.banner(`WAVE 1 / ${TOTAL_WAVES}`, 'Corporate Security drones inbound', 'red');
    SoundFX.alarm();
    await this.sm.wait(1.3);
    await this.run((ev) => spawnPending(this.state, ev));
    await this.enemyFlow();
  }

  async run(fn) {
    const ev = [];
    fn(ev);
    await this.board.play(ev, this.state);
    cleanupDead(this.state);
    this.board.sync(this.state);
    this.refresh();
    if (this.state.over && !this.ended) await this.finish();
  }

  async enemyFlow() {
    if (this.ended) return;
    this.mode = 'busy';
    this.phaseLabel = 'ENEMY INTENT';
    this.clearOverlays();
    this.refresh();
    this.hud.banner('ENEMY INTENT PHASE', 'Hostiles reposition and telegraph attacks', 'red');
    await this.sm.wait(0.7);
    await this.run((ev) => enemyPhase(this.state, ev));
    if (this.ended) return;
    if (this.state.turnInWave === WAVE_TURNS && this.state.wave < TOTAL_WAVES) {
      planSpawns(this.state);
      this.board.sync(this.state);
      SoundFX.alarm();
      this.hud.banner('WARP SIGNATURES DETECTED', 'Next wave lands after this turn — stand on a warp to block it', 'magenta');
      await this.sm.wait(0.9);
    }
    await this.playerFlow();
  }

  async playerFlow() {
    await this.run((ev) => startPlayerPhase(this.state, ev));
    if (this.ended) return;
    this.snapshot = structuredClone(this.state);
    this.mode = 'player';
    this.phaseLabel = 'PLAYER PHASE';
    this.hud.banner('PLAYER PHASE', `Turn ${this.state.turnInWave}/${WAVE_TURNS} of wave ${this.state.wave} — outthink the telegraphs`, 'cyan');
    SoundFX.select();
    const first = livingSquad(this.state).find((u) => !u.acted || !u.moved) || livingSquad(this.state)[0];
    this.select(first ? first.id : null, true);
  }

  async endTurn() {
    if (this.mode !== 'player') return;
    const pending = livingSquad(this.state).some((u) => !u.moved || !u.acted);
    if (pending && performance.now() > this.endConfirmUntil) {
      this.endConfirmUntil = performance.now() + 2500;
      this.hint = '<o>Units still have orders.</o> Press <b>SPACE</b> again to end the turn anyway.';
      SoundFX.error();
      this.refresh();
      return;
    }
    this.endConfirmUntil = 0;
    SoundFX.click();
    this.mode = 'busy';
    this.selectedId = null;
    this.action = null;
    this.hijackTarget = null;
    this.clearOverlays();
    this.hud.setPreview([]);
    this.phaseLabel = 'RESOLUTION';
    this.state.phase = 'resolve';
    this.refresh();
    this.hud.banner('RESOLUTION', 'Telegraphed attacks execute in order', 'orange');
    await this.sm.wait(0.7);
    await this.run((ev) => resolveEnemies(this.state, ev));
    if (this.ended) return;

    const s = this.state;
    s.turnInWave++;
    s.turn++;
    const cleared = livingEnemies(s).length === 0;
    if (s.turnInWave > WAVE_TURNS || cleared) {
      if (s.wave >= TOTAL_WAVES) {
        s.over = 'win';
        await this.finish();
        return;
      }
      if (!s.pendingSpawns.length) planSpawns(s);
      s.wave++;
      s.turnInWave = 1;
      this.refresh();
      this.hud.banner(`WAVE ${s.wave} / ${TOTAL_WAVES}`, cleared ? 'Sector cleared — reinforcements inbound · squad +1 HP' : 'Reinforcements warping in · squad +1 HP', 'red');
      SoundFX.alarm();
      await this.sm.wait(1.1);
      await this.run((ev) => { healSquad(s, ev); spawnPending(s, ev); });
      if (this.ended) return;
    }
    await this.enemyFlow();
  }

  async finish() {
    if (this.ended) return;
    this.ended = true;
    this.mode = 'over';
    this.clearOverlays();
    const s = this.state;
    const win = s.over === 'win';
    const core = getCore(s);
    await this.sm.wait(0.6);
    if (win) SoundFX.victory(); else SoundFX.defeat();
    if (!win) this.sm.addShake(1.5);
    this.hud.showScreen('end-screen', {
      win,
      reason: core.hp <= 0 ? 'The Unstable Power Core went critical. The grid is dark.' : 'Your squad has been wiped out. The Core is defenceless.',
      wave: s.wave, turn: s.turn, kills: s.stats.kills, core: `${core.hp}/${core.maxHp}`, seed: s.seed,
    });
  }

  resetTurn() {
    if (this.mode !== 'player' || !this.state.resetAvailable || !this.snapshot) {
      SoundFX.error();
      return;
    }
    this.state = structuredClone(this.snapshot);
    this.state.resetAvailable = false;
    this.snapshot.resetAvailable = false;
    this.action = null;
    this.hijackTarget = null;
    this.board.sync(this.state);
    this.hud.banner('TURN RESET', 'Timeline rewound — no more resets this battle', 'cyan');
    SoundFX.hijack();
    this.sm.addShake(0.3);
    const first = livingSquad(this.state)[0];
    this.select(first ? first.id : null, true);
  }

  toggleMute() {
    SoundFX.init();
    SoundFX.setMuted(!SoundFX.muted);
    document.getElementById('mute-btn').textContent = SoundFX.muted ? '♪ OFF' : '♪ ON';
  }

  // ---------------------------------------------------------------------------
  // Selection & actions
  selectedUnit() {
    if (!this.state) return null;
    return this.state.entities.find((e) => e.id === this.selectedId && !e.dead) || null;
  }

  select(id, silent = false) {
    if (this.mode !== 'player') return;
    this.selectedId = id;
    this.hijackTarget = null;
    const u = this.selectedUnit();
    this.action = u && !u.moved ? 'move' : null;
    if (!silent && u) SoundFX.select();
    this.updateOverlays();
    this.refresh();
  }

  cycleUnit() {
    const squad = livingSquad(this.state);
    if (!squad.length) return;
    const i = squad.findIndex((u) => u.id === this.selectedId);
    this.select(squad[(i + 1) % squad.length].id);
  }

  setAction(slot) {
    if (this.mode !== 'player') return;
    let u = this.selectedUnit();
    if (!u) { this.cycleUnit(); u = this.selectedUnit(); }
    if (!u) return;
    const ab = ['move', ...UNIT_DEFS[u.kind].abilities][slot];
    const used = ab === 'move' ? u.moved : u.acted;
    if (used) { SoundFX.error(); return; }
    this.action = this.action === ab ? null : ab;
    this.hijackTarget = null;
    SoundFX.click();
    this.updateOverlays();
    this.refresh();
  }

  cancel() {
    if (this.mode !== 'player') return;
    if (this.hijackTarget) this.hijackTarget = null;
    else if (this.action) this.action = null;
    else this.selectedId = null;
    SoundFX.click();
    this.updateOverlays();
    this.refresh();
  }

  currentTargets() {
    const u = this.selectedUnit();
    if (!u || !this.action) return { targets: [], area: [] };
    if (this.action === 'hijack' && this.hijackTarget) {
      const e = entityAt(this.state, this.hijackTarget.x, this.hijackTarget.y);
      if (!e || !e.intent) return { targets: [], area: [] };
      const opts = hijackOptions(this.state, e).filter((o) => o.onBoard);
      return { targets: opts, area: [], options: opts };
    }
    return abilityTargets(this.state, u, this.action);
  }

  async clickTile(x, y) {
    if (this.mode !== 'player') return;
    const u = this.selectedUnit();
    const ent = entityAt(this.state, x, y);
    if (u && this.action) {
      const { targets, options } = this.currentTargets();
      const hit = targets.find((t) => t.x === x && t.y === y);
      if (hit) {
        if (this.action === 'hijack' && !this.hijackTarget) {
          this.hijackTarget = { x, y };
          SoundFX.hijack();
          this.updateOverlays();
          this.refresh();
          return;
        }
        await this.perform(u, x, y, options ? hit : null);
        return;
      }
      // switching hijack target while choosing direction
      if (this.action === 'hijack' && this.hijackTarget) {
        const base = abilityTargets(this.state, u, 'hijack').targets.find((t) => t.x === x && t.y === y);
        if (base) { this.hijackTarget = { x, y }; SoundFX.hijack(); this.updateOverlays(); this.refresh(); return; }
      }
    }
    if (ent && ent.team === 'player') {
      if (ent.id !== this.selectedId) this.select(ent.id);
      else if (this.action !== 'move' && !ent.moved) { this.action = 'move'; this.updateOverlays(); this.refresh(); }
      return;
    }
    if (u && this.action) SoundFX.error();
  }

  async perform(u, x, y, option) {
    this.mode = 'busy';
    this.clearOverlays();
    this.hud.setPreview([]);
    const s = this.state;
    const action = this.action;
    if (action === 'move') {
      const path = bfs(s, u, UNIT_DEFS[u.kind].move, { passTeam: 'player' }).pathTo(x, y);
      await this.run((ev) => moveUnit(s, u, path, ev));
    } else if (action === 'hijack') {
      const tgt = this.hijackTarget;
      await this.run((ev) => executeAbility(s, u, 'hijack', tgt, { q: option.q }, ev));
    } else {
      await this.run((ev) => executeAbility(s, u, action, { x, y }, {}, ev));
    }
    if (this.ended) return;
    this.mode = 'player';
    this.hijackTarget = null;
    const cur = this.selectedUnit();
    if (!cur) {
      const next = livingSquad(s).find((q) => !q.moved || !q.acted);
      this.select(next ? next.id : null, true);
      return;
    }
    this.action = !cur.moved ? 'move' : null;
    if (cur.moved && cur.acted) {
      const next = livingSquad(s).find((q) => !q.moved || !q.acted);
      if (next) { this.select(next.id, true); return; }
    }
    this.updateOverlays();
    this.refresh();
  }

  // ---------------------------------------------------------------------------
  // Overlays, hover inspection and outcome previews
  clearOverlays() {
    const L = this.board.layers;
    for (const k of ['range', 'area', 'select', 'preview', 'hover', 'optArrows']) L[k].clear();
    this.hud.setPreview([]);
  }

  updateOverlays() {
    const L = this.board.layers;
    const u = this.selectedUnit();
    L.select.set(u ? [{ x: u.x, y: u.y }] : [], 'white', 0.9);
    const col = this.action ? ABILITIES[this.action].color : 'cyan';
    const { targets, area, options } = this.currentTargets();
    if (options) {
      L.range.set([this.hijackTarget], 'magenta', 1);
      L.optArrows.set(options.map((o) => ({ x: o.x, y: o.y, rot: Math.atan2(-o.dir.x, -o.dir.y) })), 'magenta', 1);
      L.area.clear();
    } else {
      L.range.set(targets, col, 0.85);
      L.area.set(area, col, 0.22);
      L.optArrows.clear();
    }
    this.updateHover();
  }

  refresh() {
    const u = this.selectedUnit();
    if (this.mode === 'player' && !(performance.now() < this.endConfirmUntil)) {
      const allDone = livingSquad(this.state).every((q) => q.moved && q.acted);
      if (allDone) this.hint = HINTS.done;
      else if (!u) this.hint = HINTS.none;
      else if (this.action === 'hijack' && this.hijackTarget) this.hint = HINTS.hijack2;
      else if (this.action) this.hint = HINTS[this.action];
      else this.hint = u.moved && !u.acted ? 'Move spent — press <b>2</b> or <b>3</b> to use an ability.' : HINTS.none;
    } else if (this.mode !== 'player') {
      this.hint = this.mode === 'busy' ? '<i>…processing…</i>' : '';
    }
    this.hud.refresh(this);
  }

  dangerSet() {
    const set = new Set();
    for (const e of livingEnemies(this.state)) for (const t of intentTiles(e)) set.add(key(t.x, t.y));
    return set;
  }

  updateHover() {
    const L = this.board.layers;
    const h = this.hoverTile;
    if (!h || !this.state || this.mode === 'title') {
      L.hover.clear();
      L.preview.clear();
      this.hud.setPreview([]);
      this.hud.showInspect(null);
      return;
    }
    L.hover.set([h], 'white', 0.9);
    const s = this.state;
    const ent = entityAt(s, h.x, h.y);
    const tile = tileAt(s, h.x, h.y);
    const live = livingEnemies(s);
    const spawn = s.pendingSpawns.find((p) => p.x === h.x && p.y === h.y);
    this.hud.showInspect({
      x: h.x, y: h.y,
      entity: ent,
      orderIndex: ent ? live.indexOf(ent) + 1 : 0,
      tile: tile ? (tile.overload > 0 ? 'overload' : tile.type) : null,
      spawn: spawn && spawn.kind,
      danger: this.dangerSet().has(key(h.x, h.y)),
    });
    this.showPreview(h);
  }

  // Simulate the hovered action on a cloned state and show the predicted outcome.
  showPreview(h) {
    const L = this.board.layers;
    L.preview.clear();
    const u = this.selectedUnit();
    if (this.mode !== 'player' || !u || !this.action) { this.hud.setPreview([]); return; }
    const { targets, options } = this.currentTargets();
    const hit = targets.find((t) => t.x === h.x && t.y === h.y);
    if (!hit || (this.action === 'hijack' && !this.hijackTarget)) { this.hud.setPreview([]); return; }

    const sim = structuredClone(this.state);
    sim.phase = 'player';
    const su = sim.entities.find((e) => e.id === u.id);
    const ev = [];
    if (this.action === 'move') {
      const path = bfs(sim, su, UNIT_DEFS[su.kind].move, { passTeam: 'player' }).pathTo(h.x, h.y);
      moveUnit(sim, su, path, ev);
    } else if (this.action === 'hijack') {
      executeAbility(sim, su, 'hijack', this.hijackTarget, { q: hit.q }, ev);
    } else {
      executeAbility(sim, su, this.action, { x: h.x, y: h.y }, {}, ev);
    }

    const tags = [];
    const ghost = [];
    for (const e of this.state.entities) {
      if (e.dead) continue;
      const se = sim.entities.find((q) => q.id === e.id);
      const moved = se && (se.x !== e.x || se.y !== e.y);
      if (!se || se.dead) {
        const where = se && inBounds(se.x, se.y) ? se : e;
        tags.push({ pos: wp(where.x, where.y, 1.45), text: '☠ KILL', cls: 'kill' });
        continue;
      }
      if (se.hp < e.hp) tags.push({ pos: wp(se.x, se.y, 1.45), text: `-${e.hp - se.hp}`, cls: 'dmg' });
      if (moved && e.id !== u.id) ghost.push({ x: se.x, y: se.y, color: 'white', opacity: 0.8 });
      if (se.stunned && !e.stunned) tags.push({ pos: wp(se.x, se.y, 1.75), text: 'STUN', cls: 'status' });
      if (e.team === 'enemy') {
        const before = intentTiles(e).map((t) => key(t.x, t.y)).join();
        const after = intentTiles(se).map((t) => key(t.x, t.y)).join();
        if (before !== after) {
          for (const t of intentTiles(se)) ghost.push({ x: t.x, y: t.y, color: 'magenta', opacity: 0.9, scale: 1.25 });
          if (!se.intent && e.intent) tags.push({ pos: wp(se.x, se.y, 1.75), text: 'JAMMED', cls: 'status' });
        }
      }
    }
    if (this.action === 'move') {
      const danger = this.dangerSet();
      if (danger.has(key(h.x, h.y))) tags.push({ pos: wp(h.x, h.y, 1.75), text: '⚠ TARGETED', cls: 'warn' });
      const path = bfs(this.state, u, UNIT_DEFS[u.kind].move, { passTeam: 'player' }).pathTo(h.x, h.y) || [];
      for (const p of path.slice(0, -1)) ghost.push({ x: p.x, y: p.y, color: 'cyan', opacity: 0.5, scale: 0.4 });
    }
    L.preview.set(ghost, 'white', 0.8);
    this.hud.setPreview(tags);
  }

  // ---------------------------------------------------------------------------
  // Input
  pick(cx, cy) {
    const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.sm.camera);
    const hits = this.raycaster.intersectObjects(this.board.spriteMeshes(), false);
    for (const hHit of hits) {
      const v = this.board.views.get(hHit.object.userData.entityId);
      if (v && hHit.uv && this.board.opaqueAt(v.kind, hHit.uv)) return { x: v.ex, y: v.ey };
    }
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, p)) return null;
    const x = Math.floor(p.x + SIZE / 2), y = Math.floor(p.z + SIZE / 2);
    return inBounds(x, y) ? { x, y } : null;
  }

  bindInput() {
    const cv = this.sm.renderer.domElement;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    });
    window.addEventListener('pointermove', (e) => {
      this.sm.setPointer((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
      if (this.down) {
        const dx = e.clientX - this.down.x, dy = e.clientY - this.down.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) this.down.moved = true;
        if (this.down.moved && this.down.button !== 0) {
          const s = (this.sm.camera.top - this.sm.camera.bottom) / this.sm.zoom / window.innerHeight;
          const mx = e.movementX * s, my = e.movementY * s * 1.6;
          this.sm.panBy((-mx - my) * 0.7071, (mx - my) * 0.7071);
        }
      }
      if (e.target !== cv) return;
      const t = this.pick(e.clientX, e.clientY);
      const same = (t && this.hoverTile && t.x === this.hoverTile.x && t.y === this.hoverTile.y) || (!t && !this.hoverTile);
      if (!same) {
        this.hoverTile = t;
        if (t && this.mode === 'player') SoundFX.hover();
        this.updateHover();
      }
    });
    window.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.moved || e.target !== cv) return;
      if (d.button === 0) {
        const t = this.pick(e.clientX, e.clientY);
        if (t) this.clickTile(t.x, t.y);
      } else if (d.button === 2) this.cancel();
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.sm.zoomBy(e.deltaY); }, { passive: false });
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) this.keys.add(k);
      if (this.mode === 'title' && (k === 'enter' || k === ' ')) { e.preventDefault(); this.start(); return; }
      if (k === '1' || k === '2' || k === '3') this.setAction(Number(k) - 1);
      else if (k === ' ') { e.preventDefault(); this.endTurn(); }
      else if (k === 'tab') { e.preventDefault(); if (this.mode === 'player') this.cycleUnit(); }
      else if (k === 'escape') this.cancel();
      else if (k === 'm') this.toggleMute();
      else if (k === 'f') this.sm.resetView();
      else if (k === 'h' || k === '?') document.getElementById('help').classList.toggle('show');
      else if (k === 'backspace') this.resetTurn();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }
}

new Game();
