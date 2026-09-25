/**
 * Menus — the whole pre-race flow plus pause, results and the unlock party.
 *
 *   const menus = new Menus(document.getElementById('ui'), { input, audio, portraits, characters, tracks, progress });
 *   const setup = await menus.run({ skipTitle: false, previous: null });
 *
 * IMPORTANT: call `menus.update(dt)` every frame while ANY of run() / showPause() /
 * showResults() is pending — it is what reads `input.consumeMenuEvents()`.
 * When no menu screen is active, update() does nothing (and does NOT consume events).
 *
 * All screen logic lives in pure reducers (./menuState.js); this file only
 * renders state to the DOM and wires mouse clicks into the same reducers.
 * Music is owned by the integrator; Menus only plays sfx() and voice().
 */
import './ui.css';
import { PLAYER_COLORS, SPEED_CLASSES, UNLOCK_CHARACTER_ID } from '../config.js';
import * as S from './menuState.js';
import { ensureFont, el, escapeHtml, glyph, kbd, hint, portraitHtml, floatiesLayer, confettiLayer } from './dom.js';
import {
  ordinal, medalFor, cheerMessage, formatTime, cssColor, lighten,
  prettyDeviceName, deviceIcon, trackOutlinePoints, keyHintsFor,
} from './hudLogic.js';

const TRACK_ART = {
  'cotton-candy-castle': ['🏰', '🍭', '💗'],
  'gumdrop-meadow': ['🍬', '🌈', '🌼'],
  'starlight-galaxy': ['🌟', '🪐', '🌙'],
  'sundae-slopes': ['🍦', '🍒', '❄️'],
};
const STAT_ROWS = [
  ['speed', 'Speed', '⚡'],
  ['accel', 'Zip', '🚀'],
  ['handling', 'Turning', '🌀'],
  ['weight', 'Weight', '🍩'],
];
const SPEED_HINT = { cozy: 'Nice and easy', zippy: 'Just right', zoomy: 'Super fast!' };
const INPUT_COOLDOWN = 0.22; // seconds of ignored input after a screen change

const pc = (i) => PLAYER_COLORS[i] ?? '#ff9ad5';

/** Seconds the unlock celebration stays up before a button press can close it. */
const UNLOCK_MIN_SHOW = 2.2;
/** Seconds a joined controller may stay unplugged on the join screen before it leaves. */
const JOIN_UNPLUG_DROP = 3;

export class Menus {
  constructor(root, { input = null, audio = null, portraits = null, characters = [], tracks = [], progress = null } = {}) {
    ensureFont();
    this.root = root;
    this.input = input;
    this.audio = audio;
    this.portraits = portraits instanceof Map ? portraits : new Map();
    this.characters = characters;
    this.tracks = tracks;
    this.progress = progress;
    this.el = el('div.sk-menus', { hidden: true });
    root.appendChild(this.el);
    this.screen = null;
    this._cooldown = 0;
    this._time = 0;
  }

  /** Swap in new portraits (e.g. when they finish rendering later). */
  setPortraits(portraits) {
    this.portraits = portraits instanceof Map ? portraits : new Map();
    this.screen?.refresh?.();
  }

  get active() {
    return !!this.screen;
  }

  /* ---------------- public API ---------------- */

  run({ skipTitle = false, previous = null } = {}) {
    return new Promise((resolve) => {
      this._resolveRun = resolve;
      this._prev = previous;
      this._joinState = S.createJoinState(previous?.players ?? []);
      this._charPicks = previous?.players ?? null;
      this._trackPrev = previous ? { trackId: previous.trackId, speedClass: previous.speedClass, laps: previous.laps } : null;
      this._drain();
      if (skipTitle) this._showJoin();
      else this._showTitle();
    });
  }

  update(dt = 1 / 60) {
    if (!this.screen) return;
    this._time += dt;
    this._cooldown -= dt;
    const events = this.input?.consumeMenuEvents?.() ?? [];
    for (const ev of events) {
      if (!this.screen) break;
      if (this._cooldown > 0) continue;
      this.screen.handle(ev);
    }
    this.screen?.update?.(dt);
  }

  showPause(playerLabel = '') {
    return new Promise((resolve) => {
      this._drain();
      this._showPause(playerLabel, resolve);
    });
  }

  showResults({ standings = [], trackDef = null, humanWinner = null, newlyUnlocked = null } = {}) {
    return new Promise((resolve) => {
      this._drain();
      this._showResults({ standings, trackDef, humanWinner, newlyUnlocked }, resolve);
    });
  }

  hide() {
    this.screen?.destroy?.();
    this.screen = null;
    this.el.hidden = true;
    this.el.innerHTML = '';
  }

  dispose() {
    this.hide();
    this.el.remove();
  }

  /* ---------------- plumbing ---------------- */

  _drain() {
    try { this.input?.consumeMenuEvents?.(); } catch { /* ignore */ }
  }

  _mount(screen) {
    this.screen?.destroy?.();
    this.el.innerHTML = '';
    this.el.className = `sk-menus ${screen.cls || ''}`;
    this.el.hidden = false;
    this.el.appendChild(screen.node);
    this.screen = screen;
    this._cooldown = INPUT_COOLDOWN;
  }

  _fx(res) {
    for (const name of res.fx || []) this._sfx(name);
    if (res.voice) {
      const def = this._char(res.voice);
      if (def) try { this.audio?.voice?.(def, 'select'); } catch { /* ignore */ }
    }
  }

  _sfx(name, opts) {
    try { this.audio?.sfx?.(name, opts); } catch { /* audio is optional */ }
  }

  _char(id) {
    return this.characters.find((c) => c.id === id) ?? null;
  }

  _isLocked(def) {
    if (!def) return false;
    const lockable = def.locked || def.id === UNLOCK_CHARACTER_ID;
    if (!lockable) return false;
    try {
      return !(this.progress?.isUnlocked?.(def.id) ?? !def.locked);
    } catch {
      return !!def.locked;
    }
  }

  _devices() {
    try { return this.input?.getDevices?.() ?? []; } catch { return []; }
  }

  _shake(node) {
    if (!node) return;
    node.classList.remove('sk-shake');
    void node.offsetWidth; // restart animation
    node.classList.add('sk-shake');
  }

  _hints(items) {
    return el('div.sk-hints', { html: items.join('') });
  }

  _backButton(onClick) {
    return el('button.sk-back', { onclick: onClick, html: `${glyph('B')}<span>Back</span>` });
  }

  /* ---------------- Title ---------------- */

  _showTitle() {
    let wins = 0;
    try { wins = this.progress?.loadProgress?.()?.wins ?? 0; } catch { /* ignore */ }
    const letters = (word, off) => [...word].map((ch, i) => `<span style="--i:${i + off}">${ch}</span>`).join('');
    const sprinkles = Array.from({ length: 14 }, (_, i) => {
      const colors = ['#ff5fb4', '#6cc4ff', '#ffd95e', '#6fe3bf', '#b48cff', '#ff9f80'];
      const a = (i / 14) * Math.PI * 2;
      const x = 50 + Math.cos(a) * (46 + (i % 3) * 3);
      const y = 50 + Math.sin(a) * (40 + (i % 2) * 8);
      return `<i class="sk-logo-sprinkle" style="left:${x}%;top:${y}%;--r:${(i * 47) % 180}deg;--c:${colors[i % colors.length]};--i:${i}"></i>`;
    }).join('');

    const node = el('div.sk-screen.sk-title', { onclick: () => screen.handle({ deviceId: 'mouse', action: 'confirm' }) },
      floatiesLayer(34, 11),
      el('div.sk-logo-wrap', {},
        el('div.sk-logo', {
          html: `${sprinkles}<div class="sk-logo-line sk-logo-1">${letters('Sprinkle', 0)}</div>`
            + `<div class="sk-logo-line sk-logo-2">${letters('Kart', 8)}<span class="sk-logo-kart">🏎️</span></div>`,
        }),
        el('div.sk-subtitle', { html: 'made with <b>Sophia</b> <span class="sk-beat">💖</span>' }),
      ),
      el('div.sk-press', { html: `Press ${glyph('A')} or ${kbd('Enter')}!` }),
      wins > 0 ? el('div.sk-wins', { html: `🏆 × ${wins} <span>trophies won</span>` }) : null,
      el('div.sk-title-karts', { 'aria-hidden': 'true', html: '<span>🍭</span><span>🧁</span><span>🍬</span>' }),
    );
    const screen = {
      node,
      cls: 'sk-mode-full',
      handle: (ev) => {
        if (ev.action === 'confirm' || ev.action === 'start') {
          this._sfx('confirm');
          const dev = ev.deviceId === 'mouse' ? 'kb1' : ev.deviceId;
          // The device that pressed A becomes P1 straight away.
          if (!this._joinState.players.some((p) => p.deviceId === dev)) {
            this._joinState = S.joinReduce(this._joinState, { deviceId: dev, action: 'confirm' }).state;
          }
          this._showJoin();
        }
      },
    };
    this._mount(screen);
  }

  /* ---------------- Join ---------------- */

  _showJoin() {
    const slotEls = [];
    const sigs = [];
    const slots = el('div.sk-slots');
    for (let i = 0; i < 4; i++) {
      const s = el('div.sk-slot', {
        '--pc': pc(i),
        onclick: (e) => this._joinClick(i, e.target.closest('[data-act]')?.dataset.act),
      });
      slotEls.push(s);
      slots.appendChild(s);
    }
    const goBtn = el('button.sk-bigbtn.sk-go', {
      onclick: (e) => {
        e.stopPropagation();
        let st = this._joinState;
        if (!st.players.length) st = S.joinReduce(st, { deviceId: 'kb1', action: 'confirm' }).state;
        this._joinState = st;
        handle({ deviceId: st.players[0].deviceId, action: 'start' });
      },
    });
    const node = el('div.sk-screen.sk-join',
      {},
      floatiesLayer(24, 5),
      el('div.sk-header', {},
        this._backButton(() => handle({ deviceId: '__nobody', action: 'back', force: true })),
        el('h1.sk-h1', { html: 'Who\'s playing? <span class="sk-wiggle">🎈</span>' })),
      el('p.sk-lead', { html: `Everyone press ${glyph('A')} or ${kbd('Enter')} to hop in!` }),
      slots,
      goBtn,
      this._hints([
        hint('A', 'Enter', 'Join'),
        hint('Y', 'Tab', 'Magic Steering ✨'),
        hint('B', 'Esc', 'Leave'),
      ]),
    );

    let devTimer = 0;
    const unpluggedFor = new Map(); // deviceId -> seconds unplugged
    const sync = (force = false) => {
      const devices = this._devices();
      const { players } = this._joinState;
      for (let i = 0; i < 4; i++) {
        const p = players[i];
        let html;
        let sig;
        if (p) {
          const dev = devices.find((d) => d.id === p.deviceId) ?? { id: p.deviceId, type: /^kb/.test(p.deviceId) ? 'keyboard' : 'gamepad' };
          const unplugged = dev.connected === false;
          const kh = keyHintsFor(p.deviceId);
          const key = (letter, name) => (kh ? kbd(kh[name]) : glyph(letter));
          sig = `${p.deviceId}|${p.easyDrive}|${dev.name}|${unplugged}`;
          html = `<div class="sk-slot-tag">P${i + 1}</div>`
            + `<div class="sk-slot-icon">${deviceIcon(p.deviceId, devices)}</div>`
            + `<div class="sk-slot-name">${escapeHtml(prettyDeviceName(dev))}</div>`
            + (unplugged ? '<div class="sk-slot-warn">💤 unplugged — leaving soon</div>' : '<div class="sk-slot-ready">Ready to roll!</div>')
            + `<button class="sk-easy ${p.easyDrive ? 'on' : ''}" data-act="toggle">`
            + `<span class="sk-easy-emoji">✨</span><span class="sk-easy-t">Magic Steering<b>${p.easyDrive ? 'ON' : 'OFF'}</b></span>`
            + `<span class="sk-easy-k">${key('Y', 'toggle')}</span></button>`
            + `<button class="sk-slot-leave" data-act="leave">${key('B', 'back')} leave</button>`;
        } else {
          sig = 'empty';
          html = '<div class="sk-slot-plus">+</div>'
            + `<div class="sk-slot-join">Press ${glyph('A')} to join!</div>`
            + `<div class="sk-slot-keys">🎮 ${glyph('A')} &nbsp;·&nbsp; ⌨️ ${kbd('Enter')} or ${kbd('/')}</div>`;
        }
        if (force || sigs[i] !== sig) {
          const wasEmpty = sigs[i] === 'empty' || sigs[i] === undefined;
          sigs[i] = sig;
          slotEls[i].innerHTML = html;
          slotEls[i].classList.toggle('sk-slot-on', !!p);
          if (p && wasEmpty) { slotEls[i].classList.remove('sk-pop'); void slotEls[i].offsetWidth; slotEls[i].classList.add('sk-pop'); }
        }
      }
      const n = players.length;
      goBtn.classList.toggle('sk-disabled', n === 0);
      goBtn.innerHTML = n === 0
        ? '<span>Waiting for racers…</span>'
        : `<span>Let's go!</span> <span class="sk-go-k">P1 ${glyph('A')}</span>`;
    };

    const handle = (ev) => {
      if (ev.force && ev.action === 'back') {
        this._sfx('back');
        this._showTitle();
        return;
      }
      const res = S.joinReduce(this._joinState, ev);
      this._joinState = res.state;
      this._fx(res);
      if (res.shake != null) this._shake(slotEls[res.shake]);
      sync();
      if (res.go === 'next') this._showChars();
      else if (res.go === 'back') this._showTitle();
    };

    this._joinHandle = handle;
    this._mount({
      node,
      cls: 'sk-mode-full',
      handle,
      update: (dt) => {
        devTimer -= dt;
        if (devTimer <= 0) { devTimer = 0.5; sync(); }
        // A joined controller that stays unplugged for a few seconds leaves by
        // itself, so nobody needs a mouse to clear a flat-battery pad.
        const devices = this._devices();
        for (const p of [...this._joinState.players]) {
          const dev = devices.find((d) => d.id === p.deviceId);
          const off = dev?.connected === false;
          const t = off ? (unpluggedFor.get(p.deviceId) ?? 0) + dt : 0;
          if (off) unpluggedFor.set(p.deviceId, t); else unpluggedFor.delete(p.deviceId);
          if (t >= JOIN_UNPLUG_DROP) {
            unpluggedFor.delete(p.deviceId);
            handle({ deviceId: p.deviceId, action: 'back' });
          }
        }
      },
      refresh: () => sync(true),
    });
    sync(true);
  }

  _joinClick(slot, act) {
    const p = this._joinState.players[slot];
    if (p) {
      if (act === 'toggle') this._joinHandle({ deviceId: p.deviceId, action: 'toggle' });
      else if (act === 'leave') this._joinHandle({ deviceId: p.deviceId, action: 'back' });
      return;
    }
    const free = ['kb1', 'kb2'].find((id) => !this._joinState.players.some((q) => q.deviceId === id));
    if (free) this._joinHandle({ deviceId: free, action: 'confirm' });
  }

  /* ---------------- Character select ---------------- */

  _showChars() {
    const players = this._joinState.players;
    let state = S.createCharSelectState({
      players,
      characters: this.characters,
      isLocked: (d) => this._isLocked(d),
      previous: this._charPicks,
    });
    const solo = players.length === 1;
    const tiles = [];
    const tileSigs = [];
    const grid = el('div.sk-grid', { '--cols': state.cols });
    state.items.forEach((it, i) => {
      const def = this._char(it.id);
      const t = el('button.sk-tile', {
        onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'pick', index: i }); },
        html: `${portraitHtml(def, this.portraits, { locked: it.locked })}`
          + `<div class="sk-tile-name">${it.locked ? '🔒 Win a race to unlock!' : escapeHtml(def?.name ?? it.id)}</div>`
          + '<div class="sk-rings"></div>',
      });
      if (it.locked) t.classList.add('sk-tile-locked');
      tiles.push(t);
      grid.appendChild(t);
    });

    const panelWrap = el('div.sk-panels');
    const panels = state.cursors.map((c) => {
      const p = el('div.sk-panel', { '--pc': pc(c.playerIndex) });
      panelWrap.appendChild(p);
      return p;
    });
    const panelSigs = [];
    const readyBanner = el('div.sk-ready-banner', { html: 'Everyone\'s ready! 🎉' });

    const node = el('div.sk-screen.sk-chars', { class: solo ? 'sk-chars-solo' : `sk-chars-n${players.length}` },
      floatiesLayer(18, 9),
      el('div.sk-header', {},
        this._backButton(() => { this._sfx('back'); this._keepPicks(state); this._showJoin(); }),
        el('h1.sk-h1', { html: 'Pick your racer! <span class="sk-wiggle">✨</span>' })),
      el('div.sk-chars-body', {}, grid, panelWrap),
      readyBanner,
      this._hints([
        hint('A', 'Enter', 'Pick'),
        hint('B', 'Esc', 'Undo / Back'),
        `<span class="sk-hint"><span class="sk-hint-t">Friends can pick the same racer too! 💞</span></span>`,
      ]),
    );

    const sync = (force = false) => {
      state.items.forEach((it, i) => {
        const here = state.cursors.filter((c) => c.index === i);
        const sig = here.map((c) => `${c.playerIndex}${c.ready ? 'r' : ''}`).join(',');
        if (!force && tileSigs[i] === sig) return;
        tileSigs[i] = sig;
        tiles[i].classList.toggle('sk-tile-hot', here.length > 0);
        tiles[i].classList.toggle('sk-tile-picked', here.some((c) => c.ready));
        const rings = here.map((c, k) => `<i class="sk-ring ${c.ready ? 'ready' : ''}" style="--pc:${pc(c.playerIndex)};--k:${k}"></i>`).join('');
        const tags = here.map((c) => `<b class="sk-tag ${c.ready ? 'ready' : ''}" style="--pc:${pc(c.playerIndex)}">P${c.playerIndex + 1}${c.ready ? ' ✓' : ''}</b>`).join('');
        tiles[i].querySelector('.sk-rings').innerHTML = `${rings}<div class="sk-tags">${tags}</div>`;
      });
      state.cursors.forEach((c, k) => {
        const it = state.items[c.index];
        const sig = `${c.index}|${c.ready}`;
        if (!force && panelSigs[k] === sig) return;
        panelSigs[k] = sig;
        const def = this._char(it.id);
        let body;
        if (it.locked) {
          body = `${portraitHtml(def, this.portraits, { locked: true, cls: 'sk-panel-portrait' })}`
            + '<div class="sk-panel-info"><div class="sk-panel-name">Mystery Friend!</div>'
            + '<div class="sk-panel-tag">🔒 Win a race to unlock!</div>'
            + '<div class="sk-panel-hint">Finish in 1st place to meet a sweet new racer…</div></div>';
        } else {
          const stats = STAT_ROWS.map(([key, label, icon]) => {
            const v = Math.max(1, Math.min(5, Math.round(def?.stats?.[key] ?? 3)));
            const pips = Array.from({ length: 5 }, (_, j) => `<i class="${j < v ? 'on' : ''}"></i>`).join('');
            return `<div class="sk-stat"><span class="sk-stat-l">${icon} ${label}</span><span class="sk-pips">${pips}</span></div>`;
          }).join('');
          body = `${portraitHtml(def, this.portraits, { cls: 'sk-panel-portrait' })}`
            + `<div class="sk-panel-info"><div class="sk-panel-name">${escapeHtml(def?.name ?? it.id)}</div>`
            + `<div class="sk-panel-tag">${escapeHtml(def?.tagline ?? '')}</div>`
            + (def?.personality ? `<div class="sk-panel-about">${escapeHtml(def.personality)}</div>` : '')
            + (def?.quotes?.select ? `<div class="sk-bubble">“${escapeHtml(def.quotes.select)}”</div>` : '')
            + `<div class="sk-stats">${stats}</div></div>`;
        }
        panels[k].innerHTML = `<div class="sk-panel-p">P${c.playerIndex + 1}</div>${body}`
          + (c.ready ? '<div class="sk-stamp">READY!</div>' : '');
        panels[k].classList.toggle('sk-panel-ready', c.ready);
        if (c.ready) { panels[k].classList.remove('sk-pop'); void panels[k].offsetWidth; panels[k].classList.add('sk-pop'); }
      });
      node.classList.toggle('sk-all-ready', S.allReady(state));
    };

    let readyTimer = 0;
    const handle = (ev) => {
      const disconnected = this._devices().filter((d) => d.connected === false).map((d) => d.id);
      const res = S.charSelectReduce(state, ev, { disconnected });
      state = res.state;
      this._fx(res);
      if (res.shake != null) {
        const ci = state.cursors.findIndex((c) => c.playerIndex === res.shake);
        this._shake(panels[ci]);
        this._shake(tiles[state.cursors[ci]?.index]);
      }
      sync();
      if (S.allReady(state) && readyTimer <= 0) readyTimer = 1.1;
      if (!S.allReady(state)) readyTimer = 0;
      if (res.go === 'next') this._finishChars(state);
      else if (res.go === 'back') { this._keepPicks(state); this._showJoin(); }
    };

    this._mount({
      node,
      cls: 'sk-mode-full',
      handle,
      update: (dt) => {
        if (readyTimer > 0) {
          readyTimer -= dt;
          if (readyTimer <= 0 && S.allReady(state)) this._finishChars(state);
        }
      },
      refresh: () => {
        state.items.forEach((it, i) => {
          const def = this._char(it.id);
          const old = tiles[i].querySelector('.sk-portrait');
          if (old) old.outerHTML = portraitHtml(def, this.portraits, { locked: it.locked });
        });
        sync(true);
      },
    });
    sync(true);
  }

  _keepPicks(state) {
    this._charPicks = state.cursors.map((c) => ({
      playerIndex: c.playerIndex, deviceId: c.deviceId, characterId: state.items[c.index].id,
    }));
  }

  _finishChars(state) {
    if (this.screen?.node?.classList.contains('sk-chars') !== true) return;
    this._charState = state;
    this._keepPicks(state);
    this._showTracks();
  }

  /* ---------------- Track select ---------------- */

  _showTracks() {
    const p1 = this._joinState.players[0];
    let state = S.createTrackSelectState({
      tracks: this.tracks,
      previous: this._trackPrev,
      controllerId: p1?.deviceId ?? null,
      easyDrive: this._joinState.players.some((p) => p.easyDrive),
    });
    let trophies = {};
    try { trophies = this.progress?.loadProgress?.()?.trophies ?? {}; } catch { /* ignore */ }

    const cards = this.tracks.map((t, i) => {
      const base = cssColor(t.previewColor, '#ffa6d8');
      const art = TRACK_ART[t.id] ?? ['🏁', '🍬', '✨'];
      const outline = trackOutlinePoints(t.controlPoints, 100, 60, 0.1);
      const cups = trophies[t.id] ? `<div class="sk-card-cup">🏆 ${trophies[t.id]}</div>` : '';
      return el('button.sk-card', {
        '--c1': lighten(base, 0.55),
        '--c2': base,
        '--c3': lighten(base, 0.2),
        onclick: (e) => {
          e.stopPropagation();
          if (state.trackIndex === i) handle({ deviceId: 'mouse', action: 'confirm' });
          else handle({ deviceId: 'mouse', action: 'set', key: 'trackIndex', value: i });
        },
        html: `<div class="sk-card-art"><span class="a1">${art[0]}</span><span class="a2">${art[1]}</span><span class="a3">${art[2]}</span>`
          + (outline ? `<svg viewBox="0 0 100 60" class="sk-card-map"><polygon points="${outline}"/></svg>` : '')
          + `</div>${cups}<div class="sk-card-name">${escapeHtml(t.name)}</div>`
          + `<div class="sk-card-sub">${escapeHtml(t.subtitle ?? '')}</div>`,
      });
    });

    const speedPills = S.SPEED_ORDER.map((id, i) => {
      const sc = SPEED_CLASSES[id] ?? { name: id, emoji: '' };
      return el('button.sk-pill', {
        onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'speedIndex', value: i }); },
        html: `<span class="sk-pill-e">${sc.emoji}</span><span class="sk-pill-t">${escapeHtml(sc.name)}<small>${SPEED_HINT[id] ?? ''}</small></span>`,
      });
    });
    const lapPills = S.LAP_OPTIONS.map((n, i) => el('button.sk-pill.sk-pill-num', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'lapsIndex', value: i }); },
      html: `<b>${n}</b>`,
    }));
    const goBtn = el('button.sk-bigbtn.sk-race', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'confirm' }); },
      html: `<span>Let's race!</span> <span class="sk-flag">🏁</span> <span class="sk-go-k">${glyph('A')}</span>`,
    });

    const rowEls = [
      el('div.sk-cards', {}, cards),
      el('div.sk-optrow', {}, el('div.sk-optlabel', { html: 'Speed' }), el('div.sk-pills', {}, speedPills)),
      el('div.sk-optrow', {}, el('div.sk-optlabel', { html: 'Laps' }), el('div.sk-pills', {}, lapPills)),
      el('div.sk-gorow', {}, goBtn),
    ];

    const node = el('div.sk-screen.sk-tracks', {},
      floatiesLayer(20, 13),
      el('div.sk-header', {},
        this._backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Choose a track! <span class="sk-wiggle">🗺️</span>' }),
        el('div.sk-chooser', { html: `<b class="sk-tag" style="--pc:${pc(0)}">P1</b> is choosing — everyone else, cheer! 📣` })),
      ...rowEls,
      this._hints([
        hint('A', 'Enter', 'Race!'),
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose</span></span>`,
        hint('Y', 'Tab', 'Speed'),
        hint('B', 'Esc', 'Back'),
      ]),
    );

    const sync = () => {
      cards.forEach((c, i) => c.classList.toggle('sk-sel', i === state.trackIndex));
      speedPills.forEach((c, i) => c.classList.toggle('sk-sel', i === state.speedIndex));
      lapPills.forEach((c, i) => c.classList.toggle('sk-sel', i === state.lapsIndex));
      rowEls.forEach((r, i) => r.classList.toggle('sk-row-focus', i === state.row));
    };

    const handle = (ev) => {
      const res = S.trackSelectReduce(state, ev);
      state = res.state;
      this._fx(res);
      sync();
      if (res.go === 'next') {
        this._trackPrev = S.trackSelection(state, this.tracks);
        const setup = S.buildRaceSetup(this._joinState, this._charState, state, this.tracks);
        const resolve = this._resolveRun;
        this._resolveRun = null;
        this.hide();
        resolve?.(setup);
      } else if (res.go === 'back') {
        this._trackPrev = S.trackSelection(state, this.tracks);
        this._showChars();
      }
    };

    this._mount({ node, cls: 'sk-mode-full', handle });
    sync();
  }

  /* ---------------- Pause ---------------- */

  _showPause(playerLabel, resolve) {
    const opts = [
      ['resume', 'Keep racing!', '▶️'],
      ['restart', 'Start over', '🔁'],
      ['quit', 'Back to menu', '🏠'],
    ];
    let state = S.createListState(opts.map((o) => o[0]));
    const btns = opts.map(([id, label, icon], i) => el('button.sk-listbtn', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: i }); },
      html: `<span class="sk-listbtn-i">${icon}</span><span>${label}</span>`,
    }));
    const node = el('div.sk-screen.sk-pause', {},
      el('div.sk-card-pop.sk-pause-card', {},
        el('div.sk-pause-emoji', { html: '🍪' }),
        el('h1.sk-h1', { html: 'Snack break!' }),
        el('p.sk-lead', { html: escapeHtml(S.pauseLeadText(playerLabel)) }),
        el('div.sk-list', {}, btns),
        el('div.sk-hints.sk-hints-in', { html: hint('A', 'Enter', 'Choose') + hint('B', 'Esc', 'Keep racing') })));
    const sync = () => btns.forEach((b, i) => b.classList.toggle('sk-sel', i === state.index));
    const handle = (ev) => {
      const res = S.listReduce(state, ev, { startCancels: true });
      state = res.state;
      this._fx(res);
      sync();
      if (res.go) {
        this.hide();
        resolve(res.go === 'cancel' ? 'resume' : res.go);
      }
    };
    this._mount({ node, cls: 'sk-mode-overlay', handle });
    sync();
  }

  /* ---------------- Results ---------------- */

  _showResults({ standings, trackDef, humanWinner, newlyUnlocked }, resolve) {
    const total = standings.length;
    const placeOf = (k, i) => k.finishPlace ?? k.place ?? i + 1;
    const nameOf = (k) => k.name ?? this._char(k.characterId)?.name ?? 'Racer';
    const tagOf = (k) => (k.playerIndex != null && !k.isCPU
      ? `<b class="sk-tag" style="--pc:${pc(k.playerIndex)}">P${k.playerIndex + 1}</b>` : '');

    const podiumOrder = [1, 0, 2].filter((i) => i < total);
    const podium = el('div.sk-podium', {}, podiumOrder.map((i) => {
      const k = standings[i];
      const place = placeOf(k, i);
      return el(`div.sk-step.sk-step-${place}`, {
        html: `${place === 1 ? '<div class="sk-crown">👑</div>' : ''}`
          + `${portraitHtml(this._char(k.characterId), this.portraits, { cls: 'sk-step-portrait' })}`
          + `<div class="sk-step-name">${tagOf(k)} ${escapeHtml(nameOf(k))}</div>`
          + `<div class="sk-step-block sk-medal-${medalFor(place)}"><span>${ordinal(place)}</span></div>`,
      });
    }));

    const list = el('div.sk-standings', {}, standings.map((k, i) => {
      const place = placeOf(k, i);
      const human = k.playerIndex != null && !k.isCPU;
      return el(`div.sk-row${human ? '.sk-row-human' : ''}`, {
        '--pc': human ? pc(k.playerIndex) : 'transparent',
        '--i': i,
        html: `<span class="sk-row-place sk-medal-${medalFor(place)}">${ordinal(place)}</span>`
          + `${portraitHtml(this._char(k.characterId), this.portraits, { cls: 'sk-row-portrait' })}`
          + `<span class="sk-row-name">${tagOf(k)} ${escapeHtml(nameOf(k))}</span>`
          + `<span class="sk-row-cheer">${cheerMessage(place, total)}</span>`
          + `<span class="sk-row-time">${k.finished ? formatTime(k.finishTime) : 'zooming…'}</span>`,
      });
    }));

    const opts = [
      ['again', 'Race again', '🔁'],
      ['next-track', 'Next track', '➡️'],
      ['menu', 'Menu', '🏠'],
    ];
    let state = S.createListState(opts.map((o) => o[0]));
    const btns = opts.map(([id, label, icon], i) => el('button.sk-listbtn', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: i }); },
      html: `<span class="sk-listbtn-i">${icon}</span><span>${label}</span>`,
    }));

    const headline = humanWinner
      ? `${escapeHtml(humanWinner.playerIndex != null ? `P${humanWinner.playerIndex + 1} ` : '')}${escapeHtml(nameOf(humanWinner))} wins! 🏆`
      : 'What a race! 🎉';
    const node = el('div.sk-screen.sk-results', {},
      floatiesLayer(16, 21),
      confettiLayer(90, 3),
      el('div.sk-results-head', {},
        el('h1.sk-h1.sk-results-title', { html: headline }),
        el('p.sk-lead', { html: `${trackDef?.name ? `${escapeHtml(trackDef.name)} · ` : ''}Everybody did great!` })),
      el('div.sk-results-body', {}, podium, list),
      el('div.sk-list.sk-list-row', {}, btns),
      this._hints([hint('A', 'Enter', 'Choose')]),
    );

    let celebration = null;
    let celebrationAge = 0; // seconds the unlock reveal has been on screen
    let celebrateTimer = newlyUnlocked ? 1.8 : 0;
    const celebrate = () => {
      celebrateTimer = 0;
      celebration = this._unlockOverlay(newlyUnlocked);
      node.appendChild(celebration);
      this._sfx('unlock');
      try { this.audio?.voice?.(newlyUnlocked, 'win'); } catch { /* ignore */ }
      celebrationAge = 0;
      this._cooldown = 0.6;
    };
    const sync = () => btns.forEach((b, i) => b.classList.toggle('sk-sel', i === state.index));
    const handle = (ev) => {
      if (celebrateTimer > 0) {
        if (ev.action === 'confirm' || ev.action === 'start' || ev.action === 'select') celebrate();
        return;
      }
      if (celebration) {
        // Mashing A through the finish must not skip the big reveal.
        if (celebrationAge < UNLOCK_MIN_SHOW) return;
        if (['confirm', 'start', 'back', 'select'].includes(ev.action)) {
          this._sfx('confirm');
          celebration.classList.add('sk-leaving');
          const c = celebration;
          celebration = null;
          setTimeout(() => c.remove(), 450);
          this._cooldown = 0.9;
        }
        return;
      }
      if (ev.action === 'back') return; // no accidental exit from results
      const res = S.listReduce(state, ev);
      state = res.state;
      this._fx(res);
      sync();
      if (res.go) {
        this.hide();
        resolve(res.go);
      }
    };
    this._mount({
      node,
      cls: 'sk-mode-full sk-mode-results',
      handle,
      update: (dt) => {
        if (celebrateTimer > 0) {
          celebrateTimer -= dt;
          if (celebrateTimer <= 0) celebrate();
        }
        if (celebration) {
          celebrationAge += dt;
          celebration.classList.toggle('sk-can-continue', celebrationAge >= UNLOCK_MIN_SHOW);
        }
      },
    });
    this._sfx('cheer');
    sync();
  }

  _unlockOverlay(def) {
    const clouds = Array.from({ length: 9 }, (_, i) => `<i class="sk-cloud sk-cloud-${i % 3}" style="--i:${i}"></i>`).join('');
    const hearts = Array.from({ length: 16 }, (_, i) => `<i class="sk-uheart" style="--i:${i}">${['💗', '💙', '✨', '🍬'][i % 4]}</i>`).join('');
    const ov = el('div.sk-unlock', {
      onclick: (e) => { e.stopPropagation(); this.screen?.handle({ deviceId: 'mouse', action: 'confirm' }); },
      html: `<div class="sk-rays"></div>${clouds}${hearts}`
        + '<div class="sk-unlock-inner">'
        + '<div class="sk-unlock-kicker">NEW FRIEND UNLOCKED!</div>'
        + `<div class="sk-unlock-portrait">${portraitHtml(def, this.portraits, { cls: 'sk-big-portrait' })}<div class="sk-sparkle s1">✨</div><div class="sk-sparkle s2">✨</div><div class="sk-sparkle s3">⭐</div></div>`
        + `<div class="sk-unlock-name">${escapeHtml(def?.name ?? 'Cotton Candy Girl')}</div>`
        + `<div class="sk-unlock-tag">${escapeHtml(def?.tagline ?? 'Fluffy, sparkly and super sweet!')}</div>`
        + '<div class="sk-unlock-sub">She can race with you now! Pick her on the racer screen 💖</div>'
        + `<div class="sk-press">Press ${glyph('A')} or ${kbd('Enter')} to continue</div>`
        + '</div>',
    });
    ov.appendChild(confettiLayer(70, 17));
    return ov;
  }
}
