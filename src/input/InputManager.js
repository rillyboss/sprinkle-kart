/**
 * InputManager — keyboards, gamepads and virtual (test) devices behind one API.
 *
 * Devices
 *   kb1  Keyboard (WASD)     always present
 *   kb2  Keyboard (Arrows)   always present
 *   gp0..gp3                 gamepads, id = 'gp' + gamepad.index (stable across reconnects)
 *   any string               virtual devices added with addVirtualDevice(id) (automation)
 *   touch1, touch2           external devices added with addExternalDevice(id, source) — the
 *                            on-screen touch controls (src/input/touch/, docs in its README.md)
 *
 * KEYBOARD MAPPING (full table in ./keyboardLayouts.js)
 *   kb1: W accel, S brake, A/D steer, Space/L-Shift drift, E item, Q look back, Esc/P pause.
 *        Menu: WASD move, Space/Enter confirm, Esc back, P start, Tab toggle.
 *   kb2: ↑ accel, ↓ brake, ←/→ steer, R-Shift drift, / or R-Ctrl item, . look back,
 *        Backspace or \ pause. Menu: arrows move, / or R-Shift or Numpad-Enter confirm,
 *        Backspace back, \ start, ' or R-Ctrl toggle.
 *
 * GAMEPAD MAPPING (full notes in ./gamepadMapping.js)
 *   A or RT accel, B or LT brake, left stick / d-pad steer (deadzone 0.2), RB or X drift,
 *   LB or Y item, right-stick click (or right stick down) look back, Start pause.
 *   Menu: stick/d-pad move, A confirm, B back, Y toggle, Start start.
 *
 * Conventions: steer -1 = left, +1 = right. Edge-triggered values (useItem, pause, menu events)
 * are computed in update() and stay true for exactly one update.
 */
import { KEYBOARD_LAYOUTS, CODE_TO_KEYBOARD, readKeyboardFrame } from './keyboardLayouts.js';
import { readGamepad, describeGamepad, gamepadLabels } from './gamepadMapping.js';
import { RepeatTimer, MENU_REPEAT_DELAY, MENU_REPEAT_INTERVAL } from './MenuRepeat.js';

export const MENU_ACTIONS = ['confirm', 'back', 'start', 'toggle'];
export const MENU_DIRECTIONS = ['up', 'down', 'left', 'right'];
const ALL_MENU_ACTIONS = new Set([...MENU_DIRECTIONS, ...MENU_ACTIONS]);

/** Unconsumed menu events are dropped once they are older than BOTH of these. */
const STALE_EVENT_MS = 400;
const STALE_EVENT_UPDATES = 3;
const MAX_QUEUED_EVENTS = 64;

/** @returns {{steer:number, accel:number, brake:number, drift:boolean, useItem:boolean, lookBack:boolean}} */
export function neutralDriveInput() {
  return { steer: 0, accel: 0, brake: 0, drift: false, useItem: false, lookBack: false };
}

function emptyFrame() {
  return { steer: 0, accel: 0, brake: 0, held: {}, taps: new Set(), anyButton: false };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, lo, hi) => (Number.isFinite(v) ? clamp(v, lo, hi) : 0);

function isEditable(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

function defaultTarget() {
  return typeof window !== 'undefined' ? window : null;
}

function defaultGetGamepads() {
  if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    return () => navigator.getGamepads();
  }
  return () => [];
}

function defaultNow() {
  return typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();
}

export class InputManager {
  /**
   * @param {EventTarget|null} [target=window] where keyboard/pointer listeners are attached
   * @param {object} [opts] dependency injection (tests)
   * @param {() => (Gamepad|null)[]} [opts.getGamepads] defaults to navigator.getGamepads
   * @param {() => number} [opts.now] ms clock, defaults to performance.now
   * @param {number} [opts.repeatDelay=350] menu auto-repeat initial delay (ms)
   * @param {number} [opts.repeatInterval=120] menu auto-repeat interval (ms)
   */
  constructor(target = defaultTarget(), opts = {}) {
    this.target = target;
    this._getGamepads = opts.getGamepads || defaultGetGamepads();
    this._now = opts.now || defaultNow();
    this._repeatOpts = {
      delay: opts.repeatDelay ?? MENU_REPEAT_DELAY,
      interval: opts.repeatInterval ?? MENU_REPEAT_INTERVAL,
    };

    /** @type {Map<string, object>} */
    this._devices = new Map();
    this._menuQueue = [];
    this._updateCount = 0;
    this._deviceListeners = new Set();
    this._gestureListeners = new Set();
    this._hadDomGesture = false;
    this.rumbleEnabled = true;
    /** 'mouse' | 'touch' | 'pen' | null — kind of the last pointer press (pointerDevice()). */
    this.lastPointerType = null;

    this._keysHeld = new Set();
    this._keysTapped = new Set();

    for (const layout of Object.values(KEYBOARD_LAYOUTS)) {
      this._devices.set(layout.id, this._makeRecord({
        id: layout.id,
        type: 'keyboard',
        name: layout.name,
        kind: 'keyboard',
        labels: { ...layout.labels },
        connected: true,
        layout,
      }));
    }

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onPointer = this._onPointer.bind(this);
    this._listen(true);
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  _listen(on) {
    const t = this.target;
    if (!t || typeof t.addEventListener !== 'function') return;
    const fn = on ? 'addEventListener' : 'removeEventListener';
    t[fn]('keydown', this._onKeyDown);
    t[fn]('keyup', this._onKeyUp);
    t[fn]('blur', this._onBlur);
    t[fn]('pointerdown', this._onPointer);
    t[fn]('touchend', this._onPointer);
  }

  dispose() {
    this._listen(false);
    this._deviceListeners.clear();
    this._gestureListeners.clear();
    this._menuQueue.length = 0;
    this._keysHeld.clear();
    this._keysTapped.clear();
    this._disposed = true;
  }

  _makeRecord(fields) {
    const repeaters = {};
    for (const d of MENU_DIRECTIONS) repeaters[d] = new RepeatTimer(this._repeatOpts);
    return {
      virtual: false,
      index: null,
      ...fields,
      frame: emptyFrame(),
      prevHeld: {},
      edges: new Set(),
      prevAnyButton: false,
      repeaters,
    };
  }

  _resetRecordState(rec) {
    rec.frame = emptyFrame();
    rec.prevHeld = {};
    rec.edges = new Set();
    rec.prevAnyButton = false;
    for (const d of MENU_DIRECTIONS) rec.repeaters[d].reset();
  }

  // ───────────────────────────── DOM events ─────────────────────────────

  _onKeyDown(e) {
    const code = e && e.code;
    if (code && CODE_TO_KEYBOARD.has(code)) {
      if (!e.metaKey && !e.altKey && !isEditable(e.target) && typeof e.preventDefault === 'function') {
        e.preventDefault();
      }
      if (!this._keysHeld.has(code) && !e.repeat) this._keysTapped.add(code);
      this._keysHeld.add(code);
    }
    this._domGesture('keyboard');
  }

  _onKeyUp(e) {
    const code = e && e.code;
    if (!code) return;
    this._keysHeld.delete(code);
    if (CODE_TO_KEYBOARD.has(code) && !isEditable(e.target) && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
  }

  _onBlur() {
    // Window lost focus: we will never see the keyups, so release everything.
    this._keysHeld.clear();
  }

  _onPointer(e) {
    const pt = e && typeof e.pointerType === 'string' && e.pointerType ? e.pointerType : e && e.type === 'touchend' ? 'touch' : null;
    if (pt) this.lastPointerType = pt;
    this._domGesture('pointer');
  }

  // ───────────────────────────── per-frame update ─────────────────────────────

  /** Call once per frame. Polls gamepads, computes edges, queues menu events. */
  update() {
    if (this._disposed) return;
    const now = this._now();
    this._updateCount++;

    // Keyboards
    for (const layout of Object.values(KEYBOARD_LAYOUTS)) {
      const rec = this._devices.get(layout.id);
      rec.frame = readKeyboardFrame(layout, this._keysHeld, this._keysTapped);
    }
    this._keysTapped.clear();

    // Gamepads
    this._pollGamepads();

    // External devices (touch controls): the source builds a gamepad-shaped frame
    for (const rec of this._devices.values()) {
      if (!rec.external) continue;
      let f = null;
      try { f = rec.source.read(now); } catch (err) { console.error('InputManager external device failed', err); }
      rec.frame = f && typeof f === 'object'
        ? { steer: f.steer ?? 0, accel: f.accel ?? 0, brake: f.brake ?? 0, held: f.held ?? {}, taps: f.taps instanceof Set ? f.taps : new Set(), anyButton: false }
        : emptyFrame();
    }

    // Virtual devices
    for (const rec of this._devices.values()) {
      if (!rec.virtual) continue;
      const v = rec.virtualState;
      const taps = new Set();
      if (v.itemPending) taps.add('item');
      if (v.pausePending) taps.add('pause');
      v.itemPending = false;
      v.pausePending = false;
      rec.frame = {
        steer: v.steer,
        accel: v.accel,
        brake: v.brake,
        held: { drift: v.drift, lookBack: v.lookBack },
        taps,
        anyButton: false,
      };
    }

    // Edges + menu events
    let gamepadGesture = false;
    for (const rec of this._devices.values()) {
      if (!rec.connected) continue;
      const { held, taps } = rec.frame;
      rec.edges = new Set();
      for (const name of Object.keys(held)) {
        if (held[name] && !rec.prevHeld[name]) rec.edges.add(name);
      }
      for (const name of taps) rec.edges.add(name);

      for (const action of MENU_ACTIONS) {
        if (rec.edges.has(action)) this._queueMenu(rec.id, action, now);
      }
      for (const dir of MENU_DIRECTIONS) {
        if (rec.repeaters[dir].update(!!held[dir], now, taps.has(dir))) this._queueMenu(rec.id, dir, now);
      }

      if (rec.type === 'gamepad' && !rec.virtual) {
        if (rec.frame.anyButton && !rec.prevAnyButton) gamepadGesture = true;
        rec.prevAnyButton = rec.frame.anyButton;
      }
      rec.prevHeld = { ...held };
    }
    if (gamepadGesture) this._gamepadGesture();

    // Drop stale, never-consumed events (e.g. keys mashed mid-race) so they
    // can't skip the next screen.
    this._menuQueue = this._menuQueue.filter(
      (ev) => !(now - ev._t > STALE_EVENT_MS && this._updateCount - ev._u > STALE_EVENT_UPDATES),
    );
    if (this._menuQueue.length > MAX_QUEUED_EVENTS) {
      this._menuQueue.splice(0, this._menuQueue.length - MAX_QUEUED_EVENTS);
    }
  }

  _queueMenu(deviceId, action, now = this._now()) {
    this._menuQueue.push({ deviceId, action, _t: now, _u: this._updateCount });
  }

  _pollGamepads() {
    let pads = [];
    try {
      pads = Array.from(this._getGamepads() || []);
    } catch {
      pads = [];
    }
    const seen = new Set();
    for (const gp of pads) {
      if (!gp || gp.connected === false || !Number.isInteger(gp.index)) continue;
      const id = `gp${gp.index}`;
      seen.add(id);
      let rec = this._devices.get(id);
      const desc = describeGamepad(gp.id);
      if (!rec) {
        rec = this._makeRecord({
          id,
          type: 'gamepad',
          index: gp.index,
          name: desc.name,
          kind: desc.kind,
          labels: gamepadLabels(desc.kind),
          rawId: gp.id,
          connected: false,
        });
        this._devices.set(id, rec);
      }
      if (rec.rawId !== gp.id) {
        rec.rawId = gp.id;
        rec.name = desc.name;
        rec.kind = desc.kind;
        rec.labels = gamepadLabels(desc.kind);
      }
      rec.mapping = gp.mapping;
      if (!rec.connected) {
        rec.connected = true;
        this._resetRecordState(rec);
        this._emitDeviceChange('connected', rec);
      }
      rec.frame = readGamepad(gp, rec.frame);
    }
    for (const rec of this._devices.values()) {
      if (rec.type === 'gamepad' && !rec.virtual && rec.connected && !seen.has(rec.id)) {
        rec.connected = false;
        this._resetRecordState(rec);
        this._emitDeviceChange('disconnected', rec);
      }
    }
  }

  // ───────────────────────────── queries ─────────────────────────────

  _publicDevice(rec) {
    const out = {
      id: rec.id,
      type: rec.type,
      name: rec.name,
      connected: rec.connected,
      kind: rec.kind,
      labels: { ...rec.labels },
      virtual: rec.virtual,
    };
    if (rec.icon) out.icon = rec.icon;
    return out;
  }

  /**
   * @returns {{id:string, type:'keyboard'|'gamepad', name:string, connected:boolean,
   *            kind:'keyboard'|'xbox'|'playstation'|'switch'|'generic'|'virtual',
   *            labels:Record<string,string>, virtual:boolean}[]}
   * Keyboards first, then gamepads by index, then virtual devices. Gamepads that were seen
   * and later unplugged stay in the list with connected:false.
   */
  getDevices() {
    const all = [...this._devices.values()];
    const order = (r) => (r.type === 'keyboard' ? 0 : r.virtual ? 2 : r.external ? 1.5 : 1);
    all.sort((a, b) => order(a) - order(b) || (a.index ?? 0) - (b.index ?? 0));
    return all.map((r) => this._publicDevice(r));
  }

  /** @returns {object|null} same shape as a getDevices() entry */
  getDevice(deviceId) {
    const rec = this._devices.get(deviceId);
    return rec ? this._publicDevice(rec) : null;
  }

  isConnected(deviceId) {
    const rec = this._devices.get(deviceId);
    return !!(rec && rec.connected);
  }

  /** Returns and clears queued menu events: [{ deviceId, action }] in press order. */
  consumeMenuEvents() {
    const out = this._menuQueue.map(({ deviceId, action }) => ({ deviceId, action }));
    this._menuQueue.length = 0;
    return out;
  }

  /** Drop any queued menu events (e.g. when switching screens). */
  clearMenuEvents() {
    this._menuQueue.length = 0;
  }

  /** @returns {{steer:number, accel:number, brake:number, drift:boolean, useItem:boolean, lookBack:boolean}} */
  getDriveInput(deviceId) {
    const rec = this._devices.get(deviceId);
    if (!rec || !rec.connected) return neutralDriveInput();
    const f = rec.frame;
    return {
      steer: num(f.steer, -1, 1),
      accel: num(f.accel, 0, 1),
      brake: num(f.brake, 0, 1),
      drift: !!f.held.drift,
      useItem: rec.edges.has('item'),
      lookBack: !!f.held.lookBack,
    };
  }

  /** Edge: true for one update after pause was pressed. With no id: any device. */
  isPausePressed(deviceId) {
    if (deviceId === undefined) {
      for (const rec of this._devices.values()) if (rec.connected && rec.edges.has('pause')) return true;
      return false;
    }
    const rec = this._devices.get(deviceId);
    return !!(rec && rec.connected && rec.edges.has('pause'));
  }

  /** Which device pressed pause this update (first found), or null. */
  getPauseDevice() {
    for (const rec of this._devices.values()) if (rec.connected && rec.edges.has('pause')) return rec.id;
    return null;
  }

  // ───────────────────────────── rumble ─────────────────────────────

  /**
   * Gentle controller rumble. No-op for keyboards, virtual devices and pads without haptics.
   * @param {string} deviceId
   * @param {number} strength 0..1
   * @param {number} ms duration
   */
  rumble(deviceId, strength = 0.5, ms = 150) {
    if (!this.rumbleEnabled) return;
    const rec = this._devices.get(deviceId);
    if (!rec || !rec.connected) return;
    const s = num(strength, 0, 1);
    const duration = Math.round(num(ms, 0, 5000));
    if (s <= 0 || duration <= 0) return;
    if (rec.external) {
      try { rec.source.rumble?.(s, duration); } catch { /* haptics are a nice-to-have */ }
      return;
    }
    if (rec.type !== 'gamepad' || rec.virtual) return;
    let gp = null;
    try {
      const pads = this._getGamepads() || [];
      gp = pads[rec.index] || Array.from(pads).find((p) => p && p.index === rec.index) || null;
    } catch {
      gp = null;
    }
    if (!gp) return;
    try {
      const act = gp.vibrationActuator;
      if (act && typeof act.playEffect === 'function') {
        const p = act.playEffect('dual-rumble', {
          startDelay: 0,
          duration,
          weakMagnitude: s,
          strongMagnitude: s * 0.6,
        });
        if (p && typeof p.catch === 'function') p.catch(() => {});
        return;
      }
      const h = gp.hapticActuators && gp.hapticActuators[0];
      if (h && typeof h.pulse === 'function') {
        const p = h.pulse(s, duration);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch {
      /* haptics are a nice-to-have */
    }
  }

  setRumbleEnabled(on) {
    this.rumbleEnabled = !!on;
  }

  // ───────────────────────────── events ─────────────────────────────

  /**
   * Subscribe to gamepad / virtual device connect + disconnect.
   * cb({ type: 'connected'|'disconnected', deviceId, device })
   * @returns {() => void} unsubscribe
   */
  onDeviceChange(cb) {
    this._deviceListeners.add(cb);
    return () => this._deviceListeners.delete(cb);
  }

  _emitDeviceChange(type, rec) {
    const ev = { type, deviceId: rec.id, device: this._publicDevice(rec) };
    for (const cb of [...this._deviceListeners]) {
      try {
        cb(ev);
      } catch (err) {
        console.error('InputManager device listener failed', err);
      }
    }
  }

  /**
   * Fires `cb(source)` on the first user gesture (source: 'keyboard'|'pointer'|'gamepad').
   * Use it to unlock audio. If the first gesture was a gamepad button (which browsers may not
   * count as user activation), cb fires once more on the first keyboard/pointer gesture.
   * If a keyboard/pointer gesture already happened, cb fires immediately.
   * @returns {() => void} unsubscribe
   */
  onAnyUserGesture(cb) {
    if (this._hadDomGesture) {
      try {
        cb('keyboard');
      } catch (err) {
        console.error(err);
      }
      return () => {};
    }
    const entry = { cb, gamepadFired: false };
    this._gestureListeners.add(entry);
    return () => this._gestureListeners.delete(entry);
  }

  _domGesture(source) {
    this._hadDomGesture = true;
    if (!this._gestureListeners.size) return;
    const list = [...this._gestureListeners];
    this._gestureListeners.clear();
    for (const entry of list) {
      try {
        entry.cb(source);
      } catch (err) {
        console.error(err);
      }
    }
  }

  _gamepadGesture() {
    for (const entry of [...this._gestureListeners]) {
      if (entry.gamepadFired) continue;
      entry.gamepadFired = true;
      try {
        entry.cb('gamepad');
      } catch (err) {
        console.error(err);
      }
    }
  }

  // ───────────────────────────── virtual devices ─────────────────────────────

  /**
   * Add a scriptable device (smoke tests, ?quick mode, autodrive). Shows up in getDevices()
   * as { type: 'gamepad', kind: 'virtual', virtual: true }. Idempotent.
   */
  addVirtualDevice(id, name = 'Robo Driver') {
    if (!id || typeof id !== 'string') throw new Error('addVirtualDevice needs a string id');
    const existing = this._devices.get(id);
    if (existing) {
      if (!existing.virtual) throw new Error(`device id "${id}" is already a real device`);
      return this._publicDevice(existing);
    }
    const rec = this._makeRecord({
      id,
      type: 'gamepad',
      name,
      kind: 'virtual',
      labels: gamepadLabels('generic'),
      connected: true,
      virtual: true,
    });
    rec.virtualState = { ...neutralDriveInput(), itemPending: false, pausePending: false };
    delete rec.virtualState.useItem;
    this._devices.set(id, rec);
    this._emitDeviceChange('connected', rec);
    return this._publicDevice(rec);
  }

  // ───────────────────────────── external devices ─────────────────────────────

  /**
   * Add a device whose input comes from elsewhere — the on-screen touch controls
   * (src/input/touch/). `source.read(now)` is called once per update() and returns a
   * gamepad-shaped frame { steer, accel, brake, held: { drift, lookBack, <menu dirs> },
   * taps: Set<'item'|'pause'|menu action> }; optional `source.rumble(strength, ms)`.
   * `info`: { name, kind='touch', type='touch', icon, labels, pointerType }.
   * It then behaves like a gamepad: getDriveInput / menu events / isPausePressed / rumble.
   */
  addExternalDevice(id, source, info = {}) {
    if (!id || typeof id !== 'string') throw new Error('addExternalDevice needs a string id');
    if (!source || typeof source.read !== 'function') throw new Error('addExternalDevice needs a source with read()');
    const existing = this._devices.get(id);
    if (existing && !existing.external) throw new Error(`device id "${id}" is already taken`);
    if (existing) this._devices.delete(id);
    const rec = this._makeRecord({
      id,
      type: info.type || 'touch',
      name: info.name || 'Touch screen',
      kind: info.kind || 'touch',
      labels: { ...(info.labels || {}) },
      connected: true,
      external: true,
      icon: info.icon || null,
      pointerType: info.pointerType || null,
    });
    rec.source = source;
    this._devices.set(id, rec);
    this._emitDeviceChange('connected', rec);
    return this._publicDevice(rec);
  }

  removeExternalDevice(id) {
    const rec = this._devices.get(id);
    if (!rec || !rec.external) return;
    this._devices.delete(id);
    rec.connected = false;
    this._emitDeviceChange('disconnected', rec);
    this._menuQueue = this._menuQueue.filter((e) => e.deviceId !== id);
  }

  /**
   * The device a mouse / touch CLICK on a menu should act as: the first connected external
   * device registered for the last pointer type (e.g. 'touch' → 'touch1') that is not in
   * `taken`, or null (callers then fall back to the keyboards).
   * @param {string[]} [taken] device ids already used (e.g. joined players)
   */
  pointerDevice(taken = []) {
    const pt = this.lastPointerType;
    if (!pt) return null;
    const skip = new Set(taken);
    for (const rec of this._devices.values()) {
      if (rec.external && rec.connected && rec.pointerType === pt && !skip.has(rec.id)) return rec.id;
    }
    return null;
  }

  removeVirtualDevice(id) {
    const rec = this._devices.get(id);
    if (!rec || !rec.virtual) return;
    this._devices.delete(id);
    rec.connected = false;
    this._emitDeviceChange('disconnected', rec);
    this._menuQueue = this._menuQueue.filter((e) => e.deviceId !== id);
  }

  /**
   * Set a virtual device's drive state (partial DriveInput merges). `useItem: true` and
   * `pause: true` are one-shot presses delivered on the next update().
   */
  setVirtualDriveInput(id, input = {}) {
    const rec = this._devices.get(id);
    if (!rec || !rec.virtual) throw new Error(`no virtual device "${id}"`);
    const v = rec.virtualState;
    if ('steer' in input) v.steer = num(input.steer, -1, 1);
    if ('accel' in input) v.accel = num(input.accel, 0, 1);
    if ('brake' in input) v.brake = num(input.brake, 0, 1);
    if ('drift' in input) v.drift = !!input.drift;
    if ('lookBack' in input) v.lookBack = !!input.lookBack;
    if (input.useItem) v.itemPending = true;
    if (input.pause) v.pausePending = true;
  }

  /** Queue a menu event from a virtual device ('up'|'down'|'left'|'right'|'confirm'|'back'|'start'|'toggle'). */
  pushVirtualMenuEvent(id, action) {
    const rec = this._devices.get(id);
    if (!rec || !rec.virtual) throw new Error(`no virtual device "${id}"`);
    if (!ALL_MENU_ACTIONS.has(action)) throw new Error(`unknown menu action "${action}"`);
    this._queueMenu(id, action);
  }
}

export default InputManager;
