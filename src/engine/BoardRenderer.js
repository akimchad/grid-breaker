// BoardRenderer — the 3D diorama: beveled metal tiles, hazards, the Power Core,
// billboarded pixel sprites, telegraph overlays and the event animator that
// replays CombatResolver output with hit-stop, shake, lights and particles.
import * as THREE from 'three';
import { SpriteGenerator } from './SpriteGenerator.js';
import { SoundFX } from './SoundFX.js';
import { ease } from './SceneManager.js';
import { SIZE, CORE_POS, inBounds } from '../game/GridManager.js';
import { intentTiles } from '../game/Entities.js';

export const wp = (x, y, h = 0) => new THREE.Vector3(x - (SIZE - 1) / 2, h, y - (SIZE - 1) / 2);

const HDR = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
const COLORS = {
  cyan: HDR(0x3cf6ff, 1.3),
  orange: HDR(0xff8a1c, 1.4),
  magenta: HDR(0xff3cf0, 1.3),
  red: HDR(0xff2a4a, 1.6),
  white: HDR(0xffffff, 1.0),
  yellow: HDR(0xffd23c, 1.3),
  green: HDR(0x5cff8a, 1.2),
};

const SPRITE_W = 1.0;
const SPRITE_STRETCH = 1.22; // compensates iso foreshortening so pixels read square
const HOVERERS = new Set(['enforcer']);

class HighlightLayer {
  constructor(parent, texture, { y = 0.012, additive = true, size = 0.94 } = {}) {
    this.parent = parent;
    this.texture = texture;
    this.y = y;
    this.additive = additive;
    this.size = size;
    this.meshes = [];
    this.geo = new THREE.PlaneGeometry(size, size);
    this.pulse = 0;
  }

  set(tiles, color, opacity = 0.8, opts = {}) {
    while (this.meshes.length < tiles.length) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
        map: this.texture, transparent: true, depthWrite: false, toneMapped: false, fog: false,
        blending: this.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 2;
      this.parent.add(m);
      this.meshes.push(m);
    }
    this.meshes.forEach((m, i) => {
      const t = tiles[i];
      if (!t) { m.visible = false; return; }
      m.visible = true;
      m.position.copy(wp(t.x, t.y, this.y + (opts.lift || 0)));
      const c = t.color || color;
      m.material.color.copy(c instanceof THREE.Color ? c : COLORS[c] || COLORS.white);
      m.material.opacity = t.opacity ?? opacity;
      m.userData.baseOpacity = m.material.opacity;
      m.rotation.z = t.rot || 0;
      const s = t.scale || 1;
      m.scale.set(s, s, s);
    });
  }

  clear() { this.set([], COLORS.white); }

  update(time, speed = 4, depth = 0.35) {
    for (const m of this.meshes) {
      if (!m.visible) continue;
      m.material.opacity = m.userData.baseOpacity * (1 - depth + depth * (0.5 + 0.5 * Math.sin(time * speed)));
    }
  }
}

export class BoardRenderer {
  constructor(sm, particles, hud) {
    this.sm = sm;
    this.scene = sm.scene;
    this.fx = particles;
    this.hud = hud;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.views = new Map();
    this.spriteGeo = new THREE.PlaneGeometry(SPRITE_W, SPRITE_W);
    this.alphaCache = new Map();
    this.overlayRoot = new THREE.Group();
    this.scene.add(this.overlayRoot);
    this.intentGroup = new THREE.Group();
    this.scene.add(this.intentGroup);

    const frame = SpriteGenerator.frameTexture('solid');
    this.layers = {
      range: new HighlightLayer(this.overlayRoot, frame, { y: 0.012 }),
      area: new HighlightLayer(this.overlayRoot, frame, { y: 0.011 }),
      danger: new HighlightLayer(this.overlayRoot, SpriteGenerator.frameTexture('danger'), { y: 0.014 }),
      arrows: new HighlightLayer(this.overlayRoot, SpriteGenerator.frameTexture('arrow'), { y: 0.02, size: 0.7 }),
      optArrows: new HighlightLayer(this.overlayRoot, SpriteGenerator.frameTexture('arrow'), { y: 0.03, size: 0.85 }),
      hover: new HighlightLayer(this.overlayRoot, SpriteGenerator.frameTexture('hover'), { y: 0.03, size: 1.0 }),
      select: new HighlightLayer(this.overlayRoot, frame, { y: 0.016 }),
      spawn: new HighlightLayer(this.overlayRoot, SpriteGenerator.frameTexture('teleporter'), { y: 0.018, size: 0.9 }),
      overload: new HighlightLayer(this.overlayRoot, SpriteGenerator.frameTexture('danger'), { y: 0.013 }),
      preview: new HighlightLayer(this.overlayRoot, frame, { y: 0.017, size: 0.7 }),
      flash: new HighlightLayer(this.overlayRoot, frame, { y: 0.025 }),
      focus: new HighlightLayer(this.overlayRoot, SpriteGenerator.frameTexture('danger'), { y: 0.022 }),
    };
    this.buildPlatform();
    this.shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: HDR(0xffd23c, 4), toneMapped: false }),
    );
    this.shell.visible = false;
    this.scene.add(this.shell);
  }

  // ---------------------------------------------------------------------------
  buildPlatform() {
    const base = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x151a26, roughness: 0.35, metalness: 0.85 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(SIZE + 0.5, 0.7, SIZE + 0.5), metal);
    slab.position.y = -0.75;
    slab.receiveShadow = true;
    base.add(slab);
    const trimMat = (c) => new THREE.MeshBasicMaterial({ color: HDR(c, 2.2), toneMapped: false });
    const half = (SIZE + 0.5) / 2;
    const trims = [
      [0, -half, SIZE + 0.5, 0.05, 0x3cf6ff], [0, half, SIZE + 0.5, 0.05, 0xff3cf0],
    ];
    for (const [x, z, w, d, c] of trims) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), trimMat(c));
      t.position.set(x, -0.42, z);
      base.add(t);
    }
    for (const [x, c] of [[-half, 0xff3cf0], [half, 0x3cf6ff]]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, SIZE + 0.5), trimMat(c));
      t.position.set(x, -0.42, 0);
      base.add(t);
    }
    // underside strut and glowing reactor rings descending into the abyss
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 0.6, 7, 8, 1, true), metal);
    strut.position.y = -4.6;
    base.add(strut);
    for (const [y, r, c] of [[-2.2, 2.4, 0x3cf6ff], [-3.8, 1.6, 0xff3cf0], [-5.4, 1.0, 0x3cf6ff]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.04, 6, 48), trimMat(c));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      base.add(ring);
    }
    this.root.add(base);
    this.boardGroup = new THREE.Group();
    this.root.add(this.boardGroup);
  }

  buildBoard(state) {
    // clear old board / views
    for (const v of this.views.values()) this.removeView(v);
    this.views.clear();
    this.boardGroup.clear();
    this.conduitMats = [];
    this.tileMeshes = [];
    const tileGeo = new THREE.BoxGeometry(0.95, 0.4, 0.95);
    const mats = [];
    for (let v = 0; v < 4; v++) {
      const { map, rough } = SpriteGenerator.tileTextures(v);
      mats.push(new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 0.75, metalness: 0.8, color: 0xb4c0dc }));
    }
    const condTex = SpriteGenerator.conduitTexture();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const t = state.tiles[y * SIZE + x];
        const p = wp(x, y);
        if (t.type === 'pit') {
          const hole = new THREE.Mesh(
            new THREE.BoxGeometry(0.95, 0.1, 0.95),
            new THREE.MeshBasicMaterial({ color: 0x050308 }),
          );
          hole.position.set(p.x, -0.38, p.z);
          this.boardGroup.add(hole);
          const glow = new THREE.Mesh(
            new THREE.PlaneGeometry(0.7, 0.7),
            new THREE.MeshBasicMaterial({ color: HDR(0xff3cf0, 0.5), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
          );
          glow.rotation.x = -Math.PI / 2;
          glow.position.set(p.x, -0.32, p.z);
          this.boardGroup.add(glow);
          const rim = new THREE.Mesh(
            new THREE.PlaneGeometry(0.98, 0.98),
            new THREE.MeshBasicMaterial({ map: SpriteGenerator.frameTexture('danger'), color: HDR(0xff3cf0, 0.5), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending }),
          );
          rim.rotation.x = -Math.PI / 2;
          rim.position.set(p.x, 0.005, p.z);
          this.boardGroup.add(rim);
          continue;
        }
        let mat = mats[t.variant % 4];
        if (t.type === 'conduit') {
          mat = new THREE.MeshStandardMaterial({
            map: mats[0].map, roughnessMap: mats[0].roughnessMap, roughness: 0.6, metalness: 0.8, color: 0x606a80,
            emissive: 0xffffff, emissiveMap: condTex, emissiveIntensity: 2.0,
          });
          this.conduitMats.push(mat);
        }
        const m = new THREE.Mesh(tileGeo, mat);
        m.position.set(p.x, -0.2, p.z);
        m.receiveShadow = true;
        this.boardGroup.add(m);
        this.tileMeshes.push(m);
        if (t.type === 'pillar') this.buildPillar(p);
      }
    }
    this.buildCore();
    this.sync(state);
  }

  buildPillar(p) {
    const g = new THREE.Group();
    const tex = SpriteGenerator.windowTexture(4242 + ((p.x * 7 + p.z * 13) | 0), 190);
    const side = new THREE.MeshStandardMaterial({ color: 0x1b2232, roughness: 0.3, metalness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 });
    const top = new THREE.MeshStandardMaterial({ color: 0x141a28, roughness: 0.25, metalness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.72), [side, side, top, top, side, side]);
    body.position.y = 0.425;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.05, 0.78),
      new THREE.MeshBasicMaterial({ color: HDR(0x3cf6ff, 0.9), toneMapped: false, wireframe: true }),
    );
    cap.position.y = 0.88;
    g.add(cap);
    g.position.set(p.x, 0, p.z);
    this.boardGroup.add(g);
  }

  buildCore() {
    const g = new THREE.Group();
    const p = wp(CORE_POS.x, CORE_POS.y);
    g.position.copy(p);
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.44, 0.18, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.3, metalness: 0.9 }),
    );
    ped.position.y = 0.09;
    ped.castShadow = true;
    g.add(ped);
    const pedRing = new THREE.Mesh(new THREE.TorusGeometry(0.39, 0.025, 6, 32), new THREE.MeshBasicMaterial({ color: HDR(0x3cf6ff, 2.5), toneMapped: false }));
    pedRing.rotation.x = Math.PI / 2;
    pedRing.position.y = 0.19;
    g.add(pedRing);
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x0a3a44, emissive: 0x3cf6ff, emissiveIntensity: 2.6, roughness: 0.1, metalness: 0.2, flatShading: true });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), crystalMat);
    crystal.scale.y = 1.7;
    crystal.position.y = 0.78;
    crystal.castShadow = true;
    g.add(crystal);
    const wireMat = new THREE.MeshBasicMaterial({ color: HDR(0x3cf6ff, 2.0), wireframe: true, toneMapped: false, transparent: true, opacity: 0.8 });
    const wire = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), wireMat);
    wire.scale.y = 1.5;
    wire.position.y = 0.78;
    g.add(wire);
    const rings = [];
    for (const [r, tilt] of [[0.5, 0.4], [0.58, -0.7]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 4, 48), wireMat);
      ring.rotation.x = Math.PI / 2 + tilt;
      ring.position.y = 0.78;
      g.add(ring);
      rings.push(ring);
    }
    const shards = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.05), crystalMat);
      g.add(s);
      shards.push(s);
    }
    this.boardGroup.add(g);
    this.core = { g, crystal, crystalMat, wire, wireMat, rings, shards, pedRing, hp: 5, maxHp: 5, hit: 0 };
    this.sm.coreLight.position.copy(p).add(new THREE.Vector3(0, 0.9, 0));
    this.sm.coreLight.intensity = 10;
  }

  // ---------------------------------------------------------------------------
  // Entity views
  ensureView(e) {
    let v = this.views.get(e.id);
    if (v) return v;
    if (e.kind === 'core') {
      v = { id: e.id, kind: 'core', holder: this.core.g, mesh: this.core.crystal, isCore: true, ex: e.x, ey: e.y };
      v.tag = this.hud.createTag(e);
      this.views.set(e.id, v);
      return v;
    }
    const sp = SpriteGenerator.get(e.kind);
    const mat = new THREE.MeshStandardMaterial({
      map: sp.texture,
      emissiveMap: sp.emissiveTexture,
      emissive: 0xffffff,
      emissiveIntensity: 1.6,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0.1,
      fog: false,
    });
    const mesh = new THREE.Mesh(this.spriteGeo, mat);
    mesh.castShadow = true;
    mesh.scale.y = SPRITE_STRETCH;
    const lift = HOVERERS.has(e.kind) ? 0.12 : 0;
    mesh.position.y = (SPRITE_W * SPRITE_STRETCH) / 2 + lift - 0.02;
    mesh.userData.entityId = e.id;
    const bill = new THREE.Group();
    bill.add(mesh);
    const holder = new THREE.Group();
    holder.add(bill);
    holder.position.copy(wp(e.x, e.y));
    this.root.add(holder);
    v = {
      id: e.id, kind: e.kind, holder, bill, mesh, mat, sp, lift,
      baseY: mesh.position.y, flash: 0, flashColor: new THREE.Color(1, 1, 1), phase: Math.random() * 10,
      ex: e.x, ey: e.y,
    };
    v.tag = this.hud.createTag(e);
    this.views.set(e.id, v);
    return v;
  }

  removeView(v) {
    if (!v.isCore) {
      this.root.remove(v.holder);
      v.mat.dispose();
    }
    this.hud.removeTag(v.tag);
  }

  spriteMeshes() {
    const out = [];
    for (const v of this.views.values()) if (!v.isCore && v.holder.visible) out.push(v.mesh);
    return out;
  }

  // Is the sprite pixel at this uv opaque? (precise picking through transparent margins)
  opaqueAt(kind, uv) {
    let data = this.alphaCache.get(kind);
    if (!data) {
      const c = SpriteGenerator.get(kind).canvas;
      data = c.getContext('2d').getImageData(0, 0, 32, 32).data;
      this.alphaCache.set(kind, data);
    }
    const x = Math.min(31, Math.max(0, Math.floor(uv.x * 32)));
    const y = Math.min(31, Math.max(0, Math.floor((1 - uv.y) * 32)));
    return data[(y * 32 + x) * 4 + 3] > 128;
  }

  flashView(v, color = 0xffffff, dur = 0.14) {
    if (!v) return;
    if (v.isCore) { this.core.hit = 0.5; return; }
    v.flash = dur;
    v.flashColor.set(color);
  }

  // Snap every visual to the authoritative state.
  sync(state) {
    this.state = state;
    const alive = new Set();
    for (const e of state.entities) {
      if (e.dead) continue;
      alive.add(e.id);
      const v = this.ensureView(e);
      v.ex = e.x; v.ey = e.y;
      if (!v.isCore) {
        v.holder.position.copy(wp(e.x, e.y));
        v.holder.scale.set(1, 1, 1);
        v.holder.visible = true;
        v.bill.rotation.z = 0;
      }
      this.hud.updateTag(v.tag, e, state);
    }
    for (const [id, v] of this.views) {
      if (!alive.has(id)) { this.removeView(v); this.views.delete(id); }
    }
    const core = state.entities.find((e) => e.kind === 'core');
    if (core) { this.core.hp = core.hp; this.core.maxHp = core.maxHp; }

    const over = [];
    state.tiles.forEach((t, i) => { if (t.overload > 0) over.push({ x: i % SIZE, y: Math.floor(i / SIZE) }); });
    this.layers.overload.set(over, COLORS.magenta, 0.9);
    this.layers.spawn.set(state.pendingSpawns.map((s) => ({ x: s.x, y: s.y })), COLORS.magenta, 0.9);
    this.hud.setSpawnMarkers(state.pendingSpawns.map((s) => ({ ...s, pos: wp(s.x, s.y, 0.2) })));
    this.refreshIntents(state);
  }

  refreshIntents(state, focusId = null) {
    for (const c of [...this.intentGroup.children]) {
      this.intentGroup.remove(c);
      c.geometry.dispose();
      c.material.dispose();
    }
    const danger = [];
    const arrows = [];
    for (const e of state.entities) {
      if (e.dead || e.team !== 'enemy' || !e.intent) continue;
      if (this.hiddenIntents && this.hiddenIntents.has(e.id)) continue;
      const tiles = intentTiles(e);
      const col = e.hijacked ? COLORS.magenta : COLORS.red;
      const dim = focusId && focusId !== e.id ? 0.35 : 1;
      for (const t of tiles) danger.push({ ...t, color: col, opacity: 0.85 * dim });
      const from = wp(e.x, e.y, 0.45);
      if (e.intent.kind === 'melee') {
        const t = tiles[0];
        if (!t) continue;
        const to = wp(t.x, t.y, 0.12);
        this.intentGroup.add(this.laserLine(from, to, col, 0.035, dim));
        arrows.push({ x: t.x, y: t.y, rot: Math.atan2(-e.intent.dir.x, -e.intent.dir.y), color: col, opacity: 0.95 * dim });
      } else if (e.intent.kind === 'artillery') {
        if (!tiles.length) continue;
        const c = new THREE.Vector3();
        tiles.forEach((t) => c.add(wp(t.x, t.y, 0.05)));
        c.multiplyScalar(1 / tiles.length);
        const mid = from.clone().lerp(c, 0.5);
        mid.y += 2.2;
        const curve = new THREE.QuadraticBezierCurve3(from.clone().add(new THREE.Vector3(0, 0.2, 0)), mid, c);
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 32, 0.022, 5, false),
          new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2), transparent: true, opacity: 0.8 * dim, toneMapped: false, depthWrite: false, fog: false }),
        );
        this.intentGroup.add(tube);
      }
    }
    this.layers.danger.set(danger, COLORS.red);
    this.layers.arrows.set(arrows, COLORS.red);
  }

  laserLine(from, to, color, width = 0.03, dim = 1) {
    const len = from.distanceTo(to);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(width, width, len),
      new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), transparent: true, opacity: 0.85 * dim, toneMapped: false, depthWrite: false, fog: false }),
    );
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.lookAt(to);
    return m;
  }

  // ---------------------------------------------------------------------------
  update(dt, time) {
    const az = this.sm.viewAzimuth;
    for (const v of this.views.values()) {
      if (v.isCore) continue;
      v.bill.rotation.y = az;
      if (HOVERERS.has(v.kind)) v.mesh.position.y = v.baseY + Math.sin(time * 2.5 + v.phase) * 0.05;
      else if (v.kind !== 'barrel') v.mesh.position.y = v.baseY + Math.max(0, Math.sin(time * 3 + v.phase)) * 0.008;
      if (v.flash > 0) {
        v.flash -= dt;
        v.mat.emissiveMap = v.sp.texture;
        v.mat.emissive.copy(v.flashColor);
        v.mat.emissiveIntensity = 2.2;
      } else if (v.mat.emissiveMap !== v.sp.emissiveTexture) {
        v.mat.emissiveMap = v.sp.emissiveTexture;
        v.mat.emissive.set(0xffffff);
        v.mat.emissiveIntensity = 1.6;
      }
      if (v.stunFx === undefined) v.stunFx = 0;
    }
    // core pulse
    if (this.core) {
      const c = this.core;
      const hpK = c.hp / c.maxHp;
      const pulse = 0.5 + 0.5 * Math.sin(time * (2 + (1 - hpK) * 6));
      const danger = new THREE.Color(0x3cf6ff).lerp(new THREE.Color(0xff2a4a), 1 - hpK);
      c.crystalMat.emissive.copy(danger);
      c.crystalMat.emissiveIntensity = 1.8 + pulse * 1.6 + c.hit * 6;
      c.wireMat.color.copy(danger).multiplyScalar(1.6 + pulse);
      c.crystal.rotation.y = time * 0.8;
      c.crystal.position.y = 0.78 + Math.sin(time * 1.6) * 0.04;
      c.wire.rotation.y = -time * 0.5;
      c.rings[0].rotation.z = time * 0.9;
      c.rings[1].rotation.z = -time * 0.7;
      c.shards.forEach((s, i) => {
        const a = time * 1.2 + (i * Math.PI) / 2;
        s.position.set(Math.cos(a) * 0.45, 0.6 + Math.sin(time * 2 + i) * 0.15, Math.sin(a) * 0.45);
        s.rotation.x = time * 2 + i;
      });
      const flick = hpK < 0.45 && Math.random() < 0.06 ? 0.3 : 1;
      this.sm.coreLight.color.copy(danger);
      this.sm.coreLight.intensity = (7 + pulse * 5 + c.hit * 25) * flick;
      c.hit = Math.max(0, c.hit - dt * 2);
    }
    for (const m of this.conduitMats || []) m.emissiveIntensity = 1.4 + Math.random() * 0.4 + Math.sin(time * 9) * 0.3 + (Math.random() < 0.02 ? 2 : 0);

    this.layers.range.update(time, 4, 0.3);
    this.layers.danger.update(time, 6, 0.45);
    this.layers.arrows.update(time, 6, 0.3);
    this.layers.select.update(time, 5, 0.4);
    this.layers.spawn.update(time, 3, 0.5);
    this.layers.overload.update(time * 2, 13, 0.6);
    this.layers.preview.update(time, 7, 0.4);
    this.layers.focus.update(time, 18, 0.5);
    this.layers.optArrows.update(time, 8, 0.4);
    this.layers.spawn.meshes.forEach((m) => { m.rotation.z = time * 1.5; });

    // ambient sparks on overloaded tiles and conduits
    if (this.state && dt > 0 && Math.random() < 0.25) {
      const i = (Math.random() * SIZE * SIZE) | 0;
      const t = this.state.tiles[i];
      if (t.overload > 0 || (t.type === 'conduit' && Math.random() < 0.4)) {
        const p = wp(i % SIZE, Math.floor(i / SIZE), 0.03);
        p.x += (Math.random() - 0.5) * 0.7;
        p.z += (Math.random() - 0.5) * 0.7;
        this.fx.emit(p, { count: 3, colors: t.overload > 0 ? [0xff3cf0, 0xffffff] : [0xffd23c, 0x3cf6ff], speed: 1.5, spread: 0.7, up: 1.5, life: 0.25, size: 3 });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Event animator
  async play(events, state) {
    if (state) this.state = state;
    for (const ev of events) {
      const fn = this['ev_' + ev.t];
      if (fn) await fn.call(this, ev);
    }
  }

  view(id) { return this.views.get(id); }
  tw(d, f, e) { return this.sm.tween(d, f, e); }
  wait(s) { return this.sm.wait(s); }

  async ev_move(ev) {
    const v = this.view(ev.id);
    if (!v) return;
    for (const p of ev.path) {
      const from = v.holder.position.clone();
      const to = wp(p.x, p.y);
      SoundFX.step();
      await this.tw(0.11, (k) => {
        v.holder.position.lerpVectors(from, to, k);
        v.holder.position.y = Math.sin(k * Math.PI) * 0.1;
      }, ease.inOutQuad);
      v.ex = p.x; v.ey = p.y;
    }
  }

  async ev_push(ev) {
    const v = this.view(ev.id);
    if (!v) return;
    const from = v.holder.position.clone();
    const to = wp(ev.to.x, ev.to.y);
    SoundFX.slam();
    await this.tw(0.13, (k) => {
      v.holder.position.lerpVectors(from, to, k);
      if (Math.random() < 0.6) this.fx.emit(v.holder.position.clone().add(new THREE.Vector3(0, 0.05, 0)), { count: 1, colors: [0xffd23c, 0xff8a1c], speed: 1, spread: 0.5, up: 0.5, life: 0.3, size: 3 });
    }, ease.outCubic);
    v.ex = ev.to.x; v.ey = ev.to.y;
  }

  async ev_bump(ev) {
    const v = this.view(ev.id);
    if (!v) return;
    const base = wp(ev.x, ev.y);
    const d = new THREE.Vector3(ev.dir.x, 0, ev.dir.y);
    await this.tw(0.06, (k) => v.holder.position.copy(base).addScaledVector(d, 0.32 * k), ease.inCubic);
    const contact = base.clone().addScaledVector(d, 0.5).add(new THREE.Vector3(0, 0.35, 0));
    this.fx.emit(contact, { count: 40, colors: [0xffffff, 0xffd23c, 0xff8a1c], speed: 4, spread: 1, up: 1.2, life: 0.4, size: 4 });
    this.sm.flashLight(contact, 0xff8a1c, 25, 0.25, 4);
    SoundFX.collision();
    this.sm.hitstop(60);
    this.sm.addShake(0.7);
    await this.tw(0.14, (k) => v.holder.position.copy(base).addScaledVector(d, 0.32 * (1 - k)), ease.outCubic);
  }

  async ev_damage(ev) {
    const v = this.view(ev.id);
    const pos = v ? v.holder.position.clone() : wp(ev.x, ev.y);
    this.flashView(v, 0xffffff);
    this.hud.popup(pos.clone().add(new THREE.Vector3(0, 1.0, 0)), `-${ev.amount} HP`, 'dmg');
    if (ev.label) this.hud.popup(pos.clone().add(new THREE.Vector3(0, 1.35, 0)), ev.label, 'status');
    this.fx.emit(pos.clone().add(new THREE.Vector3(0, 0.45, 0)), { count: 14, colors: [0xffffff, 0xff2a4a], speed: 2.5, spread: 1, up: 1.4, life: 0.35, size: 3.5 });
    if (v) this.hud.setTagHp(v.tag, ev.hp);
    if (v && v.isCore) {
      SoundFX.coreHit();
      this.sm.addShake(0.9);
      this.sm.hitstop(80);
      this.hud.flashCore(ev.hp);
      this.core.hp = ev.hp;
    } else {
      SoundFX.hurt();
      this.sm.addShake(0.25);
    }
    await this.wait(0.12);
  }

  async ev_heal(ev) {
    const v = this.view(ev.id);
    if (!v) return;
    this.flashView(v, 0x5cff8a, 0.3);
    this.hud.popup(v.holder.position.clone().add(new THREE.Vector3(0, 1.0, 0)), '+1 HP', 'heal');
    this.fx.emit(v.holder.position.clone().add(new THREE.Vector3(0, 0.3, 0)), { count: 20, colors: [0x5cff8a, 0xffffff], speed: 1.2, spread: 0.4, up: 2, life: 0.7, gravity: 2, size: 3 });
    this.hud.setTagHp(v.tag, ev.hp);
    SoundFX.heal();
    await this.wait(0.15);
  }

  async ev_death(ev) {
    const v = this.view(ev.id);
    if (!v) return;
    this.hud.removeTag(v.tag);
    const start = v.holder.position.clone();
    if (ev.kind && ['breacher', 'netrunner', 'sniper'].includes(ev.kind)) {
      this.hud.popup(start.clone().add(new THREE.Vector3(0, 1.4, 0)), 'K.I.A.', 'status');
    }
    if (ev.cause === 'pit' || ev.cause === 'void') {
      SoundFX.fall();
      const depth = ev.cause === 'pit' ? 3 : 9;
      await this.tw(ev.cause === 'pit' ? 0.55 : 0.8, (k) => {
        v.holder.position.y = start.y - depth * k * k;
        v.bill.rotation.z = k * (ev.cause === 'void' ? 2.5 : 0.6);
        const s = 1 - k * 0.6;
        v.holder.scale.set(s, s, s);
      }, ease.linear);
    } else if (ev.cause === 'conduit') {
      for (let i = 0; i < 3; i++) {
        this.fx.bolt(start.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2, 0)), start.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xffd23c, 0.2);
      }
      this.fx.zap(start.clone().add(new THREE.Vector3(0, 0.4, 0)));
      SoundFX.zap();
      this.flashView(v, 0xffd23c, 0.3);
      this.sm.hitstop(60);
      await this.tw(0.35, (k) => { v.holder.scale.set(1 - k, 1 + k * 0.5, 1 - k); });
    } else {
      this.fx.explosion(start.clone().add(new THREE.Vector3(0, 0.4, 0)), false);
      this.sm.flashLight(start.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xff8a1c, 18, 0.3);
      if (ev.cause !== 'explode') SoundFX.explosion(false);
      await this.tw(0.12, (k) => { v.holder.scale.set(1 + k * 0.3, 1 - k, 1 + k * 0.3); });
    }
    v.holder.visible = false;
    this.removeView(v);
    this.views.delete(ev.id);
  }

  async ev_explode(ev) {
    const p = wp(ev.x, ev.y, 0.4);
    this.fx.explosion(p, true);
    this.fx.ring(wp(ev.x, ev.y, 0.05), ev.kind === 'barrel' ? 0x3cf6ff : 0xff8a1c, 2.2, 0.45);
    this.sm.flashLight(p.clone().add(new THREE.Vector3(0, 0.4, 0)), ev.kind === 'barrel' ? 0x3cf6ff : 0xff8a1c, 45, 0.5, 6);
    this.layers.flash.set(ev.tiles.map((t) => ({ ...t })), ev.kind === 'barrel' ? COLORS.cyan : COLORS.orange, 1);
    SoundFX.explosion(true);
    this.sm.hitstop(60);
    this.sm.addShake(1.2);
    this.hud.popup(p.clone().add(new THREE.Vector3(0, 0.9, 0)), ev.kind === 'barrel' ? 'COOLANT BLAST!' : 'BOOM!', 'crit');
    await this.wait(0.22);
    this.layers.flash.clear();
  }

  async ev_slam(ev) {
    const v = this.view(ev.id);
    if (!v) return;
    const base = v.holder.position.clone();
    const d = new THREE.Vector3(ev.dir.x, 0, ev.dir.y);
    await this.tw(0.12, (k) => v.holder.position.copy(base).addScaledVector(d, -0.12 * k), ease.outQuad);
    await this.tw(0.06, (k) => v.holder.position.copy(base).addScaledVector(d, -0.12 + 0.5 * k), ease.inCubic);
    const hit = wp(ev.x, ev.y, 0.4);
    this.fx.emit(hit, { count: 50, colors: [0xff9a3c, 0xffffff, 0xffd23c], speed: 5, spread: 1, up: 1, life: 0.4, size: 5, dir: d.clone().multiplyScalar(1.5) });
    this.fx.ring(wp(ev.x, ev.y, 0.05), 0xff8a1c, 1.4, 0.3);
    this.sm.flashLight(hit, 0xff8a1c, 30, 0.3);
    SoundFX.slam();
    this.sm.hitstop(60);
    this.sm.addShake(0.8);
    await this.tw(0.16, (k) => v.holder.position.copy(base).addScaledVector(d, 0.38 * (1 - k)), ease.outCubic);
  }

  async ev_emp(ev) {
    const p = wp(ev.x, ev.y, 0.1);
    this.fx.ring(p, 0xff3cf0, 2.6, 0.5);
    this.fx.ring(p.clone().add(new THREE.Vector3(0, 0.3, 0)), 0x3cf6ff, 2.0, 0.4);
    this.fx.emit(p.clone().add(new THREE.Vector3(0, 0.4, 0)), { count: 80, colors: [0xff3cf0, 0x3cf6ff, 0xffffff], speed: 5, spread: 1.2, up: 0.4, life: 0.4, gravity: 0, size: 4 });
    this.sm.flashLight(p.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xff3cf0, 35, 0.4);
    SoundFX.emp();
    this.sm.addShake(0.6);
    this.sm.hitstop(50);
    await this.wait(0.25);
  }

  async ev_hijack(ev) {
    const v = this.view(ev.id), t = this.view(ev.target);
    if (!v || !t) return;
    const a = v.holder.position.clone().add(new THREE.Vector3(0, 0.55, 0));
    const b = t.holder.position.clone().add(new THREE.Vector3(0, 0.5, 0));
    SoundFX.hijack();
    for (let i = 0; i < 4; i++) {
      this.fx.bolt(a, b, i % 2 ? 0xff3cf0 : 0x3cf6ff, 0.35, 10);
      await this.wait(0.05);
    }
    this.flashView(t, 0xff3cf0, 0.4);
    this.fx.emit(b, { count: 30, colors: [0xff3cf0, 0xffffff], speed: 2.5, spread: 1, up: 1, life: 0.5, gravity: 0, size: 3 });
    this.sm.flashLight(b, 0xff3cf0, 18, 0.35);
    await this.wait(0.2);
  }

  async ev_overload(ev) {
    const v = this.view(ev.id);
    const b = wp(ev.x, ev.y, 0.05);
    if (v) {
      const a = v.holder.position.clone().add(new THREE.Vector3(0, 0.55, 0));
      for (let i = 0; i < 3; i++) this.fx.bolt(a, b, 0xff3cf0, 0.35, 10);
    }
    this.fx.zap(b.clone().add(new THREE.Vector3(0, 0.1, 0)), 0xff3cf0);
    this.layers.overload.set([...this.layers.overload.meshes.filter((m) => m.visible).map((m) => ({ x: Math.round(m.position.x + 3.5), y: Math.round(m.position.z + 3.5) })), { x: ev.x, y: ev.y }], COLORS.magenta, 0.9);
    this.sm.flashLight(b.clone().add(new THREE.Vector3(0, 0.4, 0)), 0xff3cf0, 22, 0.4);
    SoundFX.overload();
    await this.wait(0.3);
  }

  async ev_beam(ev) {
    const v = this.view(ev.id);
    const from = wp(ev.from.x, ev.from.y, 0.5);
    let to = wp(ev.to.x, ev.to.y, 0.45);
    if (!inBounds(ev.to.x, ev.to.y) && !ev.hit) {
      const d = to.clone().sub(from).normalize();
      to = to.clone().addScaledVector(d, 4);
    }
    if (v) this.flashView(v, 0x3cf6ff, 0.2);
    SoundFX.charge();
    this.fx.emit(from, { count: 20, color: 0x3cf6ff, speed: 1, spread: 1, up: 0.5, life: 0.2, gravity: 0, size: 3 });
    await this.wait(0.16);
    SoundFX.laser();
    this.fx.beam(from, to, 0x3cf6ff, 0.07, 0.4);
    const mid = from.clone().lerp(to, 0.5);
    this.sm.flashLight(mid, 0x3cf6ff, 30, 0.35, 7);
    this.sm.addShake(0.5);
    if (ev.hit) {
      this.fx.emit(to, { count: 50, colors: [0x3cf6ff, 0xffffff], speed: 5, spread: 1, up: 1, life: 0.4, size: 4 });
      this.sm.hitstop(60);
    }
    await this.wait(0.15);
  }

  async ev_grapple(ev) {
    const v = this.view(ev.id);
    if (!v) return;
    const from = wp(ev.from.x, ev.from.y);
    const to = wp(ev.to.x, ev.to.y);
    SoundFX.grapple();
    this.fx.bolt(from.clone().add(new THREE.Vector3(0, 0.5, 0)), to.clone().add(new THREE.Vector3(0, 0.3, 0)), 0x3cf6ff, 0.25, 3);
    await this.wait(0.08);
    await this.tw(0.18, (k) => {
      v.holder.position.lerpVectors(from, to, k);
      v.holder.position.y = Math.sin(k * Math.PI) * 0.35;
    }, ease.inOutQuad);
    this.fx.emit(to.clone().add(new THREE.Vector3(0, 0.05, 0)), { count: 16, color: 0x3cf6ff, speed: 1.5, spread: 1, up: 0.5, life: 0.3, size: 3 });
    v.ex = ev.to.x; v.ey = ev.to.y;
  }

  async ev_intent(ev) {
    const v = this.view(ev.id);
    if (!v || !ev.tiles.length) return;
    // Show this freshly-declared telegraph immediately (full refresh happens after the phase).
    const cur = this.layers.focus.meshes.filter((m) => m.visible).map((m) => ({ x: Math.round(m.position.x + 3.5), y: Math.round(m.position.z + 3.5) }));
    this.layers.focus.set([...cur, ...ev.tiles], COLORS.red, 0.6);
    this.flashView(v, 0xff2a4a, 0.12);
    SoundFX.osc && SoundFX.osc('square', 300, 280, 0.05, 0.05);
    await this.wait(0.12);
  }

  async ev_focus(ev) {
    const v = this.view(ev.id);
    this.layers.focus.set(ev.tiles, COLORS.red, 1);
    if (v) {
      this.flashView(v, 0xff2a4a, 0.2);
      this.hud.pulseTag(v.tag);
    }
    await this.wait(0.32);
    this.layers.focus.clear();
  }

  async ev_slash(ev) {
    const v = this.view(ev.id);
    const target = wp(ev.x, ev.y, 0.4);
    if (v) {
      const base = v.holder.position.clone();
      const d = new THREE.Vector3(ev.dir.x, 0, ev.dir.y);
      await this.tw(0.07, (k) => v.holder.position.copy(base).addScaledVector(d, 0.35 * k), ease.inCubic);
      SoundFX.slash();
      for (let i = 0; i < 12; i++) {
        const a = -1.2 + (i / 11) * 2.4;
        const side = new THREE.Vector3(-d.z, 0, d.x);
        const p = target.clone().addScaledVector(side, Math.sin(a) * 0.35).add(new THREE.Vector3(0, Math.cos(a) * 0.3, 0));
        this.fx.emit(p, { count: 3, colors: [0xff2a4a, 0xff8a1c, 0xffffff], speed: 1.2, spread: 0.5, up: 0.3, life: 0.3, gravity: 0, size: 4 });
      }
      this.sm.flashLight(target, 0xff2a4a, 20, 0.25);
      this.sm.addShake(0.35);
      await this.tw(0.13, (k) => v.holder.position.copy(base).addScaledVector(d, 0.35 * (1 - k)), ease.outCubic);
    }
  }

  async ev_shell(ev) {
    if (!ev.tiles.length) return;
    const from = wp(ev.from.x, ev.from.y, 0.9);
    const c = new THREE.Vector3();
    ev.tiles.forEach((t) => c.add(wp(t.x, t.y, 0.05)));
    c.multiplyScalar(1 / ev.tiles.length);
    const mid = from.clone().lerp(c, 0.5);
    mid.y += 2.4;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, c);
    SoundFX.shellLaunch();
    SoundFX.shellWhistle();
    this.fx.emit(from, { count: 20, colors: [0xffd23c, 0xffffff], speed: 2, spread: 0.5, up: 2, life: 0.3, size: 4 });
    const light = this.sm.borrowLight(0xffd23c, 12, 4);
    this.shell.visible = true;
    await this.tw(0.5, (k) => {
      const p = curve.getPoint(k);
      this.shell.position.copy(p);
      light.set(p);
      this.fx.emit(p, { count: 1, colors: [0xff8a1c, 0xffd23c], speed: 0.3, spread: 0.3, up: 0.3, life: 0.4, gravity: 0, size: 4 });
    }, ease.linear);
    this.shell.visible = false;
    light.release();
    for (const t of ev.tiles) this.fx.explosion(wp(t.x, t.y, 0.2), false);
    this.layers.flash.set(ev.tiles.map((t) => ({ ...t })), COLORS.orange, 1);
    this.sm.flashLight(c.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xff8a1c, 40, 0.45, 6);
    SoundFX.explosion(false);
    this.sm.addShake(0.9);
    this.sm.hitstop(60);
    await this.wait(0.2);
    this.layers.flash.clear();
  }

  async ev_zap(ev) {
    const p = wp(ev.x, ev.y, 0.3);
    const col = ev.color === 'magenta' ? 0xff3cf0 : 0xffd23c;
    this.fx.zap(p, col);
    this.fx.bolt(p.clone().add(new THREE.Vector3(0, 1, 0)), p, col, 0.2, 6);
    SoundFX.zap();
    await this.wait(0.1);
  }

  async ev_text(ev) {
    this.hud.popup(wp(ev.x, ev.y, 1.25), ev.text, ev.color === 'dim' ? 'miss' : 'status', ev.color);
    await this.wait(0.05);
  }

  async ev_shake(ev) { this.sm.addShake(ev.amount); }

  async ev_spawn(ev) {
    const e = this.state && this.state.entities.find((x) => x.id === ev.id);
    const v = this.ensureView(e || { id: ev.id, kind: ev.kind, x: ev.x, y: ev.y, hp: 1, maxHp: 1, team: 'enemy' });
    if (!v || v.isCore) return;
    const p = wp(ev.x, ev.y);
    v.holder.position.copy(p);
    v.holder.scale.set(0.01, 0.01, 0.01);
    this.fx.beam(p.clone().add(new THREE.Vector3(0, 6, 0)), p, 0xff3cf0, 0.12, 0.5);
    this.fx.ring(p.clone().add(new THREE.Vector3(0, 0.05, 0)), 0xff3cf0, 1.6, 0.5);
    this.sm.flashLight(p.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xff3cf0, 20, 0.5);
    SoundFX.spawn();
    await this.tw(0.3, (k) => v.holder.scale.set(k, k, k), ease.outBack);
  }

  async ev_core() {}
  async ev_overloadEnd() {}
}
