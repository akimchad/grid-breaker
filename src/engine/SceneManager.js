// SceneManager — renderer, orthographic iso camera (parallax / pan / zoom /
// spring shake), bloom post-processing, fixed point-light pool, neon city
// backdrop and the scaled game clock used for hit-stop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SpriteGenerator } from './SpriteGenerator.js';

const BASE_OFFSET = new THREE.Vector3(12, 12, 12);
const VIEW_SIZE = 10.5;

export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outQuad: (t) => 1 - (1 - t) * (1 - t),
};

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090f);
    this.scene.fog = new THREE.FogExp2(0x07090f, 0.035);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.OrthographicCamera(
      (-VIEW_SIZE * aspect) / 2, (VIEW_SIZE * aspect) / 2, VIEW_SIZE / 2, -VIEW_SIZE / 2, 0.1, 200,
    );
    this.camTarget = new THREE.Vector3(0, 0, 0);
    this.panTarget = new THREE.Vector3(0, 0, 0);
    this.zoom = 1;
    this.zoomTarget = 1;
    this.parallax = new THREE.Vector2();
    this.parallaxTarget = new THREE.Vector2();
    this.shakePos = new THREE.Vector2();
    this.shakeVel = new THREE.Vector2();
    this.camera.position.copy(BASE_OFFSET);
    this.camera.lookAt(0, 0, 0);

    // game clock with hit-stop
    this.time = 0;
    this.realTime = 0;
    this.freezeUntil = 0;
    this.tweens = [];

    this.setupLights();
    this.setupEnvironment();
    this.setupBackdrop();
    this.setupPost();

    window.addEventListener('resize', () => this.onResize());
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0x5a6fb0, 0x2a0c30, 0.9);
    this.scene.add(hemi);
    this.scene.add(new THREE.AmbientLight(0x404a70, 0.6));

    const moon = new THREE.DirectionalLight(0xa8c0ff, 1.6);
    moon.position.set(-3, 11, 7);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 30;
    moon.shadow.bias = -0.0008;
    moon.shadow.normalBias = 0.02;
    moon.shadow.radius = 3;
    this.scene.add(moon);
    this.scene.add(moon.target);
    this.moon = moon;

    // Magenta rim light from behind the board for the neon-noir split lighting.
    const rim = new THREE.DirectionalLight(0xff3cc8, 0.7);
    rim.position.set(-8, 4, -8);
    this.scene.add(rim);

    // Fixed pool of 6 point lights — never created / destroyed mid-combat.
    this.lightPool = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 2);
      l.position.set(0, -50, 0);
      this.scene.add(l);
      this.lightPool.push({ light: l, life: 0, maxLife: 1, peak: 0, reserved: i === 0 });
    }
    this.coreLight = this.lightPool[0].light;
    this.coreLight.color.set(0x3cf6ff);
    this.coreLight.distance = 7;
  }

  // Neon environment map so the metallic tiles reflect cyan / magenta glow.
  setupEnvironment() {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x05060a);
    const panel = (color, intensity, pos, size, rot) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0], size[1]),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
      );
      m.position.set(...pos);
      if (rot) m.rotation.set(...rot);
      env.add(m);
    };
    panel(0x3cf6ff, 3, [0, 6, -8], [14, 2], null);
    panel(0xff3cf0, 3, [-8, 5, 2], [2, 10], [0, Math.PI / 2, 0]);
    panel(0xff8a1c, 1.5, [8, 3, 4], [1, 8], [0, -Math.PI / 2, 0]);
    panel(0x6a7cff, 1.2, [0, 10, 0], [10, 10], [Math.PI / 2, 0, 0]);
    panel(0x3cf6ff, 2, [5, 7, 8], [6, 1], null);
    // Big neon sky panel in the mirror direction of the iso camera: every wet
    // tile top picks up a cyan/magenta sheen.
    const sky = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 10),
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'varying vec2 vUv; void main(){ vec3 a = vec3(0.24,1.0,1.1); vec3 b = vec3(1.1,0.24,1.0); vec3 c = mix(b, a, vUv.x); float band = 0.55 + 0.45*step(0.5, fract(vUv.y*6.0)); gl_FragColor = vec4(c*band*0.9, 1.0); }',
      }),
    );
    sky.position.set(-7, 7, -7);
    sky.lookAt(0, 0, 0);
    env.add(sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(env, 0.04).texture;
    this.scene.environmentIntensity = 0.9;
    pmrem.dispose();
  }

  // Distant neon skyscrapers, vertical pipes and a deep abyss glow below the platform.
  setupBackdrop() {
    const g = new THREE.Group();
    let seed = 1337;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const hues = [185, 300, 25, 200, 320];
    const winTex = [];
    for (let i = 0; i < 10; i++) winTex.push(SpriteGenerator.windowTexture(1000 + i * 77, hues[i % hues.length]));
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 110; i++) {
      const ang = rand() * Math.PI * 2;
      const r = 8 + rand() * 18;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      // projected "nearness" to the camera: near side buildings stay low.
      const near = (x + z) / Math.SQRT2;
      const top = near > 2 ? -4 - rand() * 6 : -2 + rand() * (near < -6 ? 9 : 4);
      const h = 14 + rand() * 30;
      const w = 1 + rand() * 2.5, d = 1 + rand() * 2.5;
      const tex = winTex[(rand() * winTex.length) | 0].clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(Math.max(1, Math.round(w)), Math.max(1, Math.round(h / 8)));
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color().setHSL(0.6, 0.3, 0.55 + rand() * 0.5) });
      const b = new THREE.Mesh(boxGeo, mat);
      b.scale.set(w, h, d);
      b.position.set(x, top - h / 2, z);
      g.add(b);
      if (rand() < 0.25) {
        // neon rooftop sign strip
        const sign = new THREE.Mesh(
          boxGeo,
          new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hues[(rand() * 5) | 0] / 360, 1, 0.5).multiplyScalar(2.5), toneMapped: false }),
        );
        sign.scale.set(w * 1.02, 0.15, d * 1.02);
        sign.position.set(x, top - 0.6, z);
        g.add(sign);
      }
    }
    // vertical neon pipes dropping into the abyss
    const pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 40, 6);
    for (let i = 0; i < 26; i++) {
      const ang = rand() * Math.PI * 2;
      const r = 6.5 + rand() * 10;
      const col = new THREE.Color().setHSL(hues[(rand() * 5) | 0] / 360, 1, 0.55).multiplyScalar(1.6);
      const p = new THREE.Mesh(pipeGeo, new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
      p.position.set(Math.cos(ang) * r, -22 - rand() * 4, Math.sin(ang) * r);
      g.add(p);
    }
    // abyss glow
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshBasicMaterial({ color: 0x2a0838, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -30;
    g.add(glow);
    this.scene.add(g);
    this.backdrop = g;
  }

  setupPost() {
    const w = window.innerWidth, h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.4, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    const aspect = w / h;
    // keep the board fully visible on portrait / narrow screens
    const vs = aspect < 1 ? VIEW_SIZE / aspect * 0.85 : VIEW_SIZE;
    this.camera.left = (-vs * aspect) / 2;
    this.camera.right = (vs * aspect) / 2;
    this.camera.top = vs / 2;
    this.camera.bottom = -vs / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  // ---- light pool ------------------------------------------------------
  flashLight(pos, color, intensity = 20, duration = 0.4, distance = 5) {
    let best = null;
    for (const s of this.lightPool) {
      if (s.reserved) continue;
      if (!best || s.life < best.life) best = s;
    }
    best.light.position.copy(pos);
    best.light.color.set(color);
    best.light.distance = distance;
    best.peak = intensity;
    best.life = duration;
    best.maxLife = duration;
    best.light.intensity = intensity;
    return best;
  }

  // Attach a light from the pool to a moving projectile; caller updates position.
  borrowLight(color, intensity, distance = 4) {
    const s = this.flashLight(new THREE.Vector3(0, -50, 0), color, intensity, 9999, distance);
    s.sticky = true;
    return {
      set: (p) => s.light.position.copy(p),
      release: (fade = 0.25) => { s.life = fade; s.maxLife = fade; s.sticky = false; },
    };
  }

  // ---- juice -------------------------------------------------------------
  addShake(amount = 0.5) {
    const a = Math.random() * Math.PI * 2;
    this.shakeVel.x += Math.cos(a) * amount * 14;
    this.shakeVel.y += Math.sin(a) * amount * 14;
  }

  hitstop(ms = 60) {
    this.freezeUntil = Math.max(this.freezeUntil, this.realTime + ms / 1000);
  }

  get frozen() { return this.realTime < this.freezeUntil; }

  // ---- tweening on the game clock --------------------------------------
  tween(duration, fn, easing = ease.linear) {
    return new Promise((resolve) => {
      this.tweens.push({ t: 0, duration: Math.max(0.0001, duration), fn, easing, resolve });
    });
  }

  wait(seconds) {
    return this.tween(seconds, () => {});
  }

  // ---- camera controls ---------------------------------------------------
  setPointer(nx, ny) {
    this.parallaxTarget.set(nx, ny);
  }

  zoomBy(delta) {
    this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * (delta > 0 ? 0.9 : 1.1), 0.65, 2.2);
  }

  panBy(dx, dz) {
    this.panTarget.x = THREE.MathUtils.clamp(this.panTarget.x + dx, -5, 5);
    this.panTarget.z = THREE.MathUtils.clamp(this.panTarget.z + dz, -5, 5);
  }

  resetView() {
    this.panTarget.set(0, 0, 0);
    this.zoomTarget = 1;
  }

  // Unit vector pointing from the board towards the camera (for billboarding).
  get viewAzimuth() {
    const o = this.camera.position.clone().sub(this.camTarget);
    return Math.atan2(o.x, o.z);
  }

  project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, z: p.z };
  }

  update(realDt) {
    this.realTime += realDt;
    const dt = this.frozen ? 0 : realDt * (this.speed || 1);
    this.time += dt;

    // tweens
    if (dt > 0) {
      for (let i = this.tweens.length - 1; i >= 0; i--) {
        const tw = this.tweens[i];
        tw.t += dt;
        const k = Math.min(1, tw.t / tw.duration);
        tw.fn(tw.easing(k), k);
        if (k >= 1) {
          this.tweens.splice(i, 1);
          tw.resolve();
        }
      }
    }

    // light pool decay
    for (const s of this.lightPool) {
      if (s.reserved || s.sticky) continue;
      if (s.life > 0) {
        s.life = Math.max(0, s.life - dt);
        s.light.intensity = s.peak * (s.life / s.maxLife) ** 2;
      } else {
        s.light.intensity = 0;
      }
    }

    // camera: lerp pan / zoom / parallax, spring-damped shake (real time)
    const L = 1 - Math.exp(-realDt * 6);
    this.camTarget.lerp(this.panTarget, L);
    this.zoom += (this.zoomTarget - this.zoom) * L;
    this.parallax.lerp(this.parallaxTarget, 1 - Math.exp(-realDt * 3));

    const k = 220, c = 16;
    this.shakeVel.x += (-k * this.shakePos.x - c * this.shakeVel.x) * realDt;
    this.shakeVel.y += (-k * this.shakePos.y - c * this.shakeVel.y) * realDt;
    this.shakePos.x += this.shakeVel.x * realDt;
    this.shakePos.y += this.shakeVel.y * realDt;

    const off = BASE_OFFSET.clone();
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.parallax.x * 0.07);
    off.y += this.parallax.y * 1.2;
    this.camera.position.copy(this.camTarget).add(off);
    this.camera.lookAt(this.camTarget);
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.camera.position.addScaledVector(right, this.shakePos.x * 0.06).addScaledVector(up, this.shakePos.y * 0.06);
    if (this.camera.zoom !== this.zoom) {
      this.camera.zoom = this.zoom;
      this.camera.updateProjectionMatrix();
    }
    return dt;
  }

  render() {
    this.composer.render();
  }
}
