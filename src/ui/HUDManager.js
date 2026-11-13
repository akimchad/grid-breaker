// HUDManager — diegetic cyber-noir DOM HUD: unit panel, wave panel, action bar,
// roster, floating world tags / popups, tooltips, banners and end screens.
import * as THREE from 'three';
import { SpriteGenerator } from '../engine/SpriteGenerator.js';
import { UNIT_DEFS, ABILITIES, TILE_INFO, describeIntent } from '../game/Entities.js';
import { TOTAL_WAVES, WAVE_TURNS } from '../game/CombatResolver.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const pips = (hp, max, cls = '') => {
  let s = `<span class="pips ${cls}">`;
  for (let i = 0; i < max; i++) s += `<i class="${i < hp ? 'on' : ''}"></i>`;
  return s + '</span>';
};

export class HUDManager {
  constructor(sm) {
    this.sm = sm;
    this.world = $('#world-ui');
    this.popups = [];
    this.spawnTags = [];
    this.previewTags = [];
    this.handlers = {};
    this.buildActionBar();
    $('#reset-btn').addEventListener('click', () => this.emit('reset'));
    $('#mute-btn').addEventListener('click', () => this.emit('mute'));
    $('#start-btn').addEventListener('click', () => this.emit('start'));
    $('#again-btn').addEventListener('click', () => this.emit('restart'));
    $('#help-btn').addEventListener('click', () => $('#help').classList.toggle('show'));
    $('#help').addEventListener('click', () => $('#help').classList.remove('show'));
    // title screen sprite parade
    const parade = $('#parade');
    for (const k of ['breacher', 'netrunner', 'sniper', 'enforcer', 'artillery', 'spider']) {
      const img = el('img');
      img.src = SpriteGenerator.get(k).canvas.toDataURL();
      img.title = UNIT_DEFS[k].name;
      parade.appendChild(img);
    }
  }

  on(name, fn) { this.handlers[name] = fn; }
  emit(name, ...a) { if (this.handlers[name]) this.handlers[name](...a); }

  buildActionBar() {
    const bar = $('#action-bar');
    bar.innerHTML = '';
    this.buttons = [];
    const mk = (slot, keyLabel) => {
      const b = el('button', 'act-btn');
      b.innerHTML = `<span class="key">${keyLabel}</span><img class="icon"/><span class="label"></span><span class="sub"></span>`;
      b.addEventListener('click', () => this.emit('action', slot));
      b.addEventListener('mouseenter', () => this.showTooltip(b, slot));
      b.addEventListener('mouseleave', () => this.hideTooltip());
      bar.appendChild(b);
      this.buttons.push(b);
      return b;
    };
    mk(0, '1'); mk(1, '2'); mk(2, '3');
    const end = el('button', 'act-btn end-btn');
    end.innerHTML = `<span class="key">SPACE</span><img class="icon" src="${SpriteGenerator.iconURL('end', '#ff3cf0')}"/><span class="label">END TURN</span><span class="sub">resolve enemy attacks</span>`;
    end.addEventListener('click', () => this.emit('endTurn'));
    end.addEventListener('mouseenter', () => this.showTooltip(end, 'end'));
    end.addEventListener('mouseleave', () => this.hideTooltip());
    bar.appendChild(end);
    this.endBtn = end;
  }

  showTooltip(anchor, slot) {
    const tt = $('#tooltip');
    let html = '';
    if (slot === 'end') {
      html = `<h4>END TURN</h4><p>Enemy telegraphs resolve in numbered order (#1, #2…). Pushed enemies drag their attacks along; killed, jammed or stunned enemies don't fire.</p>`;
    } else {
      const ab = this.currentAbilities && this.currentAbilities[slot];
      if (!ab) return;
      const def = ABILITIES[ab];
      html = `<h4>${def.name}</h4><p>${def.desc}</p>`;
    }
    tt.innerHTML = html;
    tt.classList.add('show');
    const r = anchor.getBoundingClientRect();
    const w = tt.offsetWidth;
    tt.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tt.style.top = `${r.top - tt.offsetHeight - 10}px`;
  }
  hideTooltip() { $('#tooltip').classList.remove('show'); }

  // ---------------------------------------------------------------------------
  refresh(game) {
    const { state } = game;
    if (!state) return;
    const unit = game.selectedUnit();
    const core = state.entities.find((e) => e.kind === 'core');

    // wave panel
    $('#wave-val').textContent = `${state.wave}/${TOTAL_WAVES}`;
    $('#turn-val').textContent = `${state.turnInWave}/${WAVE_TURNS}`;
    $('#turn-total').textContent = state.turn;
    $('#enemy-val').textContent = state.entities.filter((e) => !e.dead && e.team === 'enemy').length;
    $('#reset-btn').disabled = !state.resetAvailable || game.mode !== 'player';
    $('#reset-btn').querySelector('.sub').textContent = state.resetAvailable ? '1 USE LEFT' : 'SPENT';
    const incoming = state.pendingSpawns.length;
    $('#incoming').textContent = incoming ? `⚠ ${incoming} HOSTILES WARPING IN` : '';
    $('#phase-val').textContent = game.phaseLabel || '';

    // core bar
    if (core) {
      const bar = $('#core-bar');
      bar.innerHTML = '';
      for (let i = 0; i < core.maxHp; i++) bar.appendChild(el('i', i < core.hp ? 'on' : ''));
      bar.classList.toggle('critical', core.hp <= 2);
      $('#core-val').textContent = `${core.hp}/${core.maxHp}`;
    }

    // unit panel
    const panel = $('#unit-panel');
    if (unit) {
      const def = UNIT_DEFS[unit.kind];
      panel.classList.remove('empty');
      panel.style.setProperty('--accent', def.accent);
      $('#portrait').src = SpriteGenerator.portraitURL(unit.kind);
      $('#unit-name').textContent = def.name;
      $('#unit-role').textContent = def.role;
      $('#unit-hp').innerHTML = `HP ${pips(unit.hp, unit.maxHp, 'big')}`;
      $('#unit-status').innerHTML = [
        `<span class="${unit.moved ? 'used' : 'ready'}">MOVE ${unit.moved ? 'USED' : `READY · ${def.move}`}</span>`,
        `<span class="${unit.acted ? 'used' : 'ready'}">ACTION ${unit.acted ? 'USED' : 'READY'}</span>`,
        unit.stunned ? '<span class="used">STUNNED</span>' : '',
      ].join('');
      this.currentAbilities = ['move', ...def.abilities];
    } else {
      panel.classList.add('empty');
      $('#portrait').src = SpriteGenerator.portraitURL('breacher');
      $('#unit-name').textContent = 'NO UNIT';
      $('#unit-role').textContent = 'Click a mercenary';
      $('#unit-hp').innerHTML = '';
      $('#unit-status').innerHTML = '';
      this.currentAbilities = null;
    }

    // action bar
    const colors = { cyan: '#3cf6ff', orange: '#ff9a3c', magenta: '#ff3cf0' };
    this.buttons.forEach((b, i) => {
      const ab = this.currentAbilities && this.currentAbilities[i];
      if (!ab) {
        b.classList.add('disabled');
        b.querySelector('.label').textContent = '---';
        b.querySelector('.sub').textContent = '';
        b.querySelector('.icon').removeAttribute('src');
        b.classList.remove('active');
        return;
      }
      const def = ABILITIES[ab];
      const used = ab === 'move' ? unit.moved : unit.acted;
      b.classList.toggle('disabled', used || game.mode !== 'player');
      b.classList.toggle('active', game.action === ab);
      b.style.setProperty('--c', colors[def.color]);
      b.querySelector('.label').textContent = def.short;
      b.querySelector('.sub').textContent = used ? 'USED' : (ab === 'move' ? `${UNIT_DEFS[unit.kind].move} tiles` : 'action');
      b.querySelector('.icon').src = SpriteGenerator.iconURL(ab, colors[def.color]);
    });
    this.endBtn.classList.toggle('disabled', game.mode !== 'player');
    const allDone = state.entities.filter((e) => e.team === 'player' && !e.dead).every((u) => u.moved && u.acted);
    this.endBtn.classList.toggle('ready', allDone && game.mode === 'player');

    // roster
    const roster = $('#roster');
    roster.innerHTML = '';
    for (const u of state.entities.filter((e) => e.team === 'player')) {
      const def = UNIT_DEFS[u.kind];
      const card = el('button', `roster-card ${u.dead ? 'dead' : ''} ${unit && unit.id === u.id ? 'sel' : ''}`);
      card.style.setProperty('--accent', def.accent);
      card.innerHTML = `<img src="${SpriteGenerator.portraitURL(u.kind)}"/><div><b>${def.name}</b>${u.dead ? '<em>K.I.A.</em>' : pips(u.hp, u.maxHp)}<small>${u.dead ? '' : `${u.moved ? '·' : 'M'} ${u.acted ? '·' : 'A'}`}</small></div>`;
      if (!u.dead) card.addEventListener('click', () => this.emit('selectUnit', u.id));
      roster.appendChild(card);
    }

    // hint line
    $('#hint').innerHTML = game.hint || '';
  }

  flashCore() {
    const p = $('#core-panel');
    p.classList.remove('hit');
    void p.offsetWidth;
    p.classList.add('hit');
  }

  banner(text, sub = '', cls = '') {
    const b = $('#banner');
    b.className = '';
    b.innerHTML = `<div class="b-main">${text}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
    void b.offsetWidth;
    b.className = `show ${cls}`;
  }

  // ---------------------------------------------------------------------------
  // Hover inspector
  showInspect(info) {
    const box = $('#inspect');
    if (!info) { box.classList.remove('show'); return; }
    const parts = [];
    if (info.entity) {
      const e = info.entity;
      const def = UNIT_DEFS[e.kind];
      const portrait = e.kind !== 'core' ? `<img src="${SpriteGenerator.portraitURL(e.kind)}"/>` : '';
      let body = `<b>${def.name}</b> ${pips(e.hp, e.maxHp)}`;
      if (e.team === 'enemy') {
        body += `<small>${def.blurb}</small><em class="${e.hijacked ? 'hij' : ''}">${e.order ? `#${info.orderIndex} · ` : ''}${e.hijacked ? 'HIJACKED · ' : ''}${describeIntent(e)}</em>`;
      } else if (def.blurb) body += `<small>${def.blurb}</small>`;
      else body += `<small>${def.role} · MOVE ${def.move}</small>`;
      parts.push(`<div class="ins-row">${portrait}<div>${body}</div></div>`);
    }
    if (info.tile) {
      const ti = TILE_INFO[info.tile];
      if (ti) parts.push(`<div class="ins-tile"><b>${ti.name}</b><small>${ti.blurb}</small></div>`);
    }
    if (info.spawn) parts.push(`<div class="ins-tile warn"><b>WARP SIGNATURE</b><small>${UNIT_DEFS[info.spawn].name} arrives at end of turn. Occupy the tile to block it (1 DMG to blocker).</small></div>`);
    if (info.danger) parts.push(`<div class="ins-tile warn"><b>⚠ TARGETED</b><small>An enemy attack will land here.</small></div>`);
    if (!parts.length) { box.classList.remove('show'); return; }
    box.innerHTML = parts.join('') + `<div class="coord">TILE [${info.x},${info.y}]</div>`;
    box.classList.add('show');
  }

  // ---------------------------------------------------------------------------
  // Floating world UI
  createTag(e) {
    const t = el('div', `tag team-${e.team}`);
    t.innerHTML = `<span class="badge"></span><span class="tag-pips"></span><span class="tag-status"></span>`;
    this.world.appendChild(t);
    t._hp = -1;
    return t;
  }

  removeTag(t) { if (t && t.parentNode) t.parentNode.removeChild(t); }

  updateTag(t, e, state) {
    if (!t) return;
    if (e.team === 'enemy') {
      const live = state.entities.filter((x) => !x.dead && x.team === 'enemy').sort((a, b) => a.order - b.order);
      const idx = live.indexOf(e) + 1;
      const b = t.querySelector('.badge');
      b.textContent = e.intent ? `#${idx}` : (e.stunned ? 'ZZ' : '—');
      b.classList.toggle('idle', !e.intent);
      b.classList.toggle('hij', !!e.hijacked);
    }
    this.setTagHp(t, e.hp, e.maxHp);
    const st = t.querySelector('.tag-status');
    st.textContent = e.stunned ? 'STUN' : '';
    t.classList.toggle('done', e.team === 'player' && e.moved && e.acted);
  }

  setTagHp(t, hp, max) {
    if (!t) return;
    if (max) t._max = max;
    t.querySelector('.tag-pips').innerHTML = pips(hp, t._max || hp, 'tiny');
  }

  pulseTag(t) {
    if (!t) return;
    t.classList.remove('pulse');
    void t.offsetWidth;
    t.classList.add('pulse');
  }

  setSpawnMarkers(list) {
    for (const s of this.spawnTags) s.el.remove();
    this.spawnTags = list.map((s) => {
      const d = el('div', 'spawn-tag', `▼ WARP<br><small>${UNIT_DEFS[s.kind].name.split(' ')[0]}</small>`);
      this.world.appendChild(d);
      return { el: d, pos: s.pos };
    });
  }

  setPreview(items) {
    for (const p of this.previewTags) p.el.remove();
    this.previewTags = items.map((it) => {
      const d = el('div', `preview-tag ${it.cls || ''}`, it.text);
      this.world.appendChild(d);
      return { el: d, pos: it.pos };
    });
  }

  popup(worldPos, text, cls = 'dmg', color = null) {
    const d = el('div', `popup ${cls} ${color ? 'c-' + color : ''}`, text);
    this.world.appendChild(d);
    const p = this.sm.project(worldPos);
    // stack popups that land on the same spot
    const near = this.popups.filter((q) => Math.abs(q.x - p.x) < 40 && Math.abs(q.y - p.y) < 20 && q.t > performance.now() - 400).length;
    d.style.left = `${p.x}px`;
    d.style.top = `${p.y - near * 18}px`;
    const rec = { el: d, x: p.x, y: p.y, t: performance.now() };
    this.popups.push(rec);
    setTimeout(() => { d.remove(); this.popups.splice(this.popups.indexOf(rec), 1); }, 1300);
  }

  update(board) {
    const off = new THREE.Vector3(0, 1.12, 0);
    for (const v of board.views.values()) {
      if (!v.tag) continue;
      const base = v.isCore ? v.holder.position.clone().add(new THREE.Vector3(0, 0.55, 0)) : v.holder.position;
      const p = this.sm.project(base.clone().add(off));
      v.tag.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      v.tag.style.display = v.holder.visible === false ? 'none' : '';
    }
    for (const s of [...this.spawnTags, ...this.previewTags]) {
      const p = this.sm.project(s.pos);
      s.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
  }

  // ---------------------------------------------------------------------------
  showScreen(id, data = {}) {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('show');
    if (!id) return;
    const s = $(`#${id}`);
    if (id === 'end-screen') {
      s.classList.toggle('win', data.win);
      $('#end-title').textContent = data.win ? 'GRID SECURED' : 'GRID COMPROMISED';
      $('#end-sub').textContent = data.win
        ? 'The Unstable Power Core holds. Corporate Security retreats into the rain.'
        : data.reason;
      $('#end-stats').innerHTML = `
        <div><b>${data.wave}</b><span>WAVE REACHED</span></div>
        <div><b>${data.turn}</b><span>TURNS</span></div>
        <div><b>${data.kills}</b><span>DRONES SCRAPPED</span></div>
        <div><b>${data.core}</b><span>CORE INTEGRITY</span></div>`;
      $('#end-seed').textContent = `RUN SEED ${data.seed}`;
    }
    s.classList.add('show');
  }
}
