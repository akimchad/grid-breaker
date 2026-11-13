// SoundFX — procedural retro-synth sound effects via the Web Audio API.
// Zero audio files: oscillators, filtered noise and envelopes only.

class SoundFXImpl {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuf = null;
    this.ambient = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    // 2 seconds of white noise, reused by every noise voice
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbient();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  get now() { return this.ctx.currentTime; }

  osc(type, f0, f1, dur, vol = 0.3, delay = 0, dest = this.master) {
    if (!this.ctx) return;
    const t = this.now + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise(dur, vol = 0.3, filterType = 'lowpass', f0 = 2000, f1 = 200, delay = 0, q = 1) {
    if (!this.ctx) return;
    const t = this.now + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  // --- Named effects -----------------------------------------------------
  click() { this.osc('square', 1400, 900, 0.04, 0.08); }
  hover() { this.osc('sine', 2200, 2400, 0.025, 0.03); }
  select() { this.osc('square', 660, 660, 0.05, 0.08); this.osc('square', 990, 990, 0.06, 0.07, 0.05); }
  error() { this.osc('square', 180, 120, 0.15, 0.12); }
  step() { this.noise(0.05, 0.08, 'bandpass', 900, 600, 0, 3); this.osc('triangle', 120, 70, 0.06, 0.12); }

  laser() {
    this.osc('sawtooth', 2400, 120, 0.35, 0.22);
    this.osc('square', 1200, 60, 0.3, 0.12, 0.01);
    this.noise(0.25, 0.15, 'highpass', 6000, 1500);
  }

  charge() { this.osc('sawtooth', 200, 1800, 0.25, 0.1); }

  slam() {
    this.osc('square', 140, 40, 0.25, 0.35);
    this.osc('triangle', 90, 30, 0.35, 0.4);
    this.noise(0.18, 0.35, 'lowpass', 3000, 200);
    this.osc('square', 3200, 2400, 0.05, 0.05, 0.01); // metallic ping
  }

  collision() {
    this.osc('square', 220, 50, 0.2, 0.3);
    this.noise(0.12, 0.3, 'bandpass', 2500, 400, 0, 2);
    this.osc('sine', 1800, 1700, 0.25, 0.07, 0.02);
    this.osc('sine', 2700, 2650, 0.2, 0.05, 0.02);
  }

  zap() {
    for (let i = 0; i < 6; i++) this.osc('square', 300 + Math.random() * 1800, 80 + Math.random() * 300, 0.05, 0.08, i * 0.03);
    this.noise(0.2, 0.15, 'highpass', 4000, 2000);
  }

  explosion(big = false) {
    this.osc('sine', big ? 120 : 160, 28, big ? 0.9 : 0.6, 0.6);
    this.osc('triangle', 70, 25, big ? 1.0 : 0.7, 0.4);
    this.noise(big ? 1.0 : 0.6, 0.5, 'lowpass', 4000, 60);
  }

  hijack() {
    [880, 1320, 660, 1760].forEach((f, i) => this.osc('square', f, f * 0.98, 0.06, 0.08, i * 0.05));
    this.osc('sawtooth', 300, 900, 0.3, 0.06, 0.05);
  }

  overload() {
    this.osc('sawtooth', 80, 400, 0.4, 0.12);
    this.zap();
  }

  grapple() {
    this.osc('square', 600, 2400, 0.12, 0.1);
    this.noise(0.15, 0.12, 'bandpass', 3000, 6000, 0, 4);
    this.osc('square', 300, 200, 0.06, 0.15, 0.15);
  }

  emp() {
    this.osc('sine', 60, 600, 0.4, 0.4);
    this.osc('sawtooth', 1200, 40, 0.5, 0.15);
    this.noise(0.4, 0.2, 'bandpass', 500, 4000, 0, 2);
  }

  slash() {
    this.noise(0.15, 0.25, 'bandpass', 1500, 6000, 0, 3);
    this.osc('sawtooth', 900, 300, 0.12, 0.1);
  }

  shellLaunch() { this.osc('square', 140, 600, 0.25, 0.12); this.noise(0.15, 0.2, 'lowpass', 1500, 400); }
  shellWhistle() { this.osc('sine', 2000, 700, 0.45, 0.06); }

  hurt() { this.osc('square', 420, 110, 0.18, 0.2); }
  coreHit() {
    this.osc('sawtooth', 200, 60, 0.6, 0.25);
    [0, 0.18, 0.36].forEach((d) => this.osc('square', 880, 860, 0.1, 0.1, d));
  }
  alarm() { [0, 0.22].forEach((d) => { this.osc('square', 520, 520, 0.12, 0.08, d); this.osc('square', 390, 390, 0.12, 0.08, d + 0.11); }); }
  spawn() { this.osc('sawtooth', 100, 1200, 0.4, 0.1); this.osc('sine', 1600, 400, 0.4, 0.08, 0.1); }
  heal() { [523, 659, 784].forEach((f, i) => this.osc('triangle', f, f, 0.12, 0.1, i * 0.07)); }
  fall() { this.osc('sine', 800, 60, 0.9, 0.15); }

  victory() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.osc('square', f, f, 0.18, 0.1, i * 0.12));
  }
  defeat() {
    [392, 330, 262, 196].forEach((f, i) => this.osc('sawtooth', f, f * 0.97, 0.35, 0.12, i * 0.25));
    this.explosion(true);
  }

  // Low cyberpunk drone + rain hiss bed.
  startAmbient() {
    if (!this.ctx || this.ambient) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    g.connect(this.master);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    f.connect(g);
    for (const freq of [55, 55.4, 82.4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.connect(f);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(f.frequency);
    lfo.start();
    // rain hiss
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuf;
    rain.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 3500;
    const rg = ctx.createGain();
    rg.gain.value = 0.35;
    rain.connect(rf).connect(rg).connect(g);
    rain.start();
    this.ambient = g;
  }
}

export const SoundFX = new SoundFXImpl();
