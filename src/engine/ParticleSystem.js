// ParticleSystem — pooled square "pixel" sparks, falling rain streaks, laser
// beams, expanding shock rings and jagged lightning bolts.
import * as THREE from 'three';

const MAX = 3000;

export class ParticleSystem {
  constructor(sm) {
    this.sm = sm;
    this.scene = sm.scene;
    this.setupSparks();
    this.setupRain();
    this.beams = [];
    this.rings = [];
    this.bolts = [];
  }

  setupSparks() {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -999;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: window.devicePixelRatio || 1 } },
      vertexShader: /* glsl */`
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main(){
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main(){
          if (vAlpha <= 0.01) discard;
          gl_FragColor = vec4(vColor * vAlpha, vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.cursor = 0;
  }

  setupRain() {
    const N = 900;
    this.rainN = N;
    this.rainPos = new Float32Array(N * 6);
    this.rainSpeed = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    for (let i = 0; i < N; i++) this.resetDrop(i, true);
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0x6f9cff).multiplyScalar(0.9),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  resetDrop(i, randomY = false) {
    const x = (Math.random() - 0.5) * 30;
    const z = (Math.random() - 0.5) * 30;
    const y = randomY ? -12 + Math.random() * 28 : 16 + Math.random() * 4;
    const len = 0.35 + Math.random() * 0.4;
    const p = this.rainPos;
    p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
    p[i * 6 + 3] = x + 0.04; p[i * 6 + 4] = y - len; p[i * 6 + 5] = z + 0.02;
    this.rainSpeed[i] = 14 + Math.random() * 8;
  }

  // ---- sparks ---------------------------------------------------------------
  emit(origin, opts = {}) {
    const {
      count = 20, color = 0x3cf6ff, colors = null, speed = 3, spread = 1, up = 1.5, life = 0.6,
      gravity = -9, size = 5, drag = 1.5, radius = 0.05, dir = null,
    } = opts;
    const c = new THREE.Color();
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      c.set(colors ? colors[(Math.random() * colors.length) | 0] : color);
      const boost = 1.5 + Math.random() * 2;
      this.col[i * 3] = c.r * boost; this.col[i * 3 + 1] = c.g * boost; this.col[i * 3 + 2] = c.b * boost;
      this.pos[i * 3] = origin.x + (Math.random() - 0.5) * radius * 2;
      this.pos[i * 3 + 1] = origin.y + (Math.random() - 0.5) * radius * 2;
      this.pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * radius * 2;
      let vx = (Math.random() - 0.5) * 2 * spread, vy = Math.random() * up, vz = (Math.random() - 0.5) * 2 * spread;
      if (dir) { vx += dir.x; vy += dir.y; vz += dir.z; }
      const s = speed * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = vx * s; this.vel[i * 3 + 1] = vy * s; this.vel[i * 3 + 2] = vz * s;
      const l = life * (0.5 + Math.random() * 0.8);
      this.life[i] = l; this.maxLife[i] = l;
      this.grav[i] = gravity;
      this.drag[i] = drag;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.alpha[i] = 1;
    }
  }

  explosion(p, big = false) {
    this.emit(p, { count: big ? 140 : 80, colors: [0xffd23c, 0xff8a1c, 0xff2a4a, 0xffffff], speed: big ? 6 : 4.5, spread: 1, up: 1.4, life: 0.8, size: 7 });
    this.emit(p, { count: 40, colors: [0x2a2f3a, 0x4d5465], speed: 2, spread: 0.8, up: 1.5, life: 1.3, gravity: 1.2, size: 9, drag: 2.5 });
  }

  zap(p, color = 0xffd23c) {
    this.emit(p, { count: 26, colors: [color, 0xffffff], speed: 4, spread: 1, up: 1.2, life: 0.35, gravity: -4, size: 4 });
  }

  // ---- beams ------------------------------------------------------------------
  beam(from, to, color, width = 0.08, duration = 0.35) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const group = new THREE.Group();
    const geo = new THREE.BoxGeometry(width, width, len);
    const inner = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3), toneMapped: false, transparent: true }));
    const outer = new THREE.Mesh(
      new THREE.BoxGeometry(width * 3, width * 3, len),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), toneMapped: false, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    group.add(inner, outer);
    group.position.copy(from).add(to).multiplyScalar(0.5);
    group.lookAt(to);
    this.scene.add(group);
    const b = { group, life: duration, max: duration, width };
    this.beams.push(b);
    return b;
  }

  ring(p, color, maxScale = 2.5, duration = 0.5) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), toneMapped: false, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(p);
    this.scene.add(m);
    this.rings.push({ m, life: duration, max: duration, maxScale });
  }

  bolt(from, to, color, duration = 0.25, segments = 8) {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const p = from.clone().lerp(to, t);
      if (i > 0 && i < segments) {
        p.x += (Math.random() - 0.5) * 0.25;
        p.y += (Math.random() - 0.5) * 0.25;
        p.z += (Math.random() - 0.5) * 0.25;
      }
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), toneMapped: false, transparent: true }));
    this.scene.add(line);
    this.bolts.push({ line, life: duration, max: duration });
  }

  update(dt, realDt) {
    // sparks
    if (dt > 0) {
      for (let i = 0; i < MAX; i++) {
        if (this.life[i] <= 0) continue;
        this.life[i] -= dt;
        if (this.life[i] <= 0) { this.alpha[i] = 0; this.pos[i * 3 + 1] = -999; continue; }
        const dr = Math.exp(-this.drag[i] * dt);
        this.vel[i * 3] *= dr; this.vel[i * 3 + 2] *= dr;
        this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr + this.grav[i] * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        // bounce on the floor plane of the board
        if (this.pos[i * 3 + 1] < 0.02 && Math.abs(this.pos[i * 3]) < 4 && Math.abs(this.pos[i * 3 + 2]) < 4 && this.vel[i * 3 + 1] < 0) {
          this.pos[i * 3 + 1] = 0.02;
          this.vel[i * 3 + 1] *= -0.35;
        }
        this.alpha[i] = Math.min(1, (this.life[i] / this.maxLife[i]) * 1.6);
      }
      const g = this.points.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.alpha.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.attributes.size.needsUpdate = true;
    }

    // rain keeps falling in real time so the world never looks dead
    const rd = realDt * (dt > 0 ? 1 : 0.15);
    const p = this.rainPos;
    for (let i = 0; i < this.rainN; i++) {
      const dy = this.rainSpeed[i] * rd;
      p[i * 6 + 1] -= dy; p[i * 6 + 4] -= dy;
      p[i * 6] -= dy * 0.08; p[i * 6 + 3] -= dy * 0.08;
      if (p[i * 6 + 4] < -14 || (p[i * 6 + 4] < 0.02 && Math.abs(p[i * 6]) < 4 && Math.abs(p[i * 6 + 2]) < 4)) {
        if (p[i * 6 + 4] > -1 && Math.random() < 0.15) {
          this.emit(new THREE.Vector3(p[i * 6], 0.03, p[i * 6 + 2]), { count: 2, color: 0x6f9cff, speed: 0.8, spread: 0.6, up: 0.8, life: 0.18, gravity: -6, size: 2.5 });
        }
        this.resetDrop(i);
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;

    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      const k = Math.max(0, b.life / b.max);
      b.group.children.forEach((c) => { c.material.opacity = k * (c === b.group.children[1] ? 0.6 : 1); });
      b.group.scale.x = b.group.scale.y = 0.3 + k * 0.7;
      if (b.life <= 0) {
        this.scene.remove(b.group);
        b.group.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
        this.beams.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - Math.max(0, r.life / r.max);
      const s = 0.3 + k * r.maxScale;
      r.m.scale.set(s, s, s);
      r.m.material.opacity = 1 - k;
      if (r.life <= 0) {
        this.scene.remove(r.m);
        r.m.geometry.dispose(); r.m.material.dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      b.line.material.opacity = Math.max(0, b.life / b.max) * (Math.random() < 0.3 ? 0.3 : 1);
      if (b.life <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose(); b.line.material.dispose();
        this.bolts.splice(i, 1);
      }
    }
  }
}
