/**
 * Fake input devices for node tests.
 *
 *   // 1) the REAL InputManager wired to a fake window, fake gamepads and a fake clock
 *   const rig = createInputRig();
 *   rig.target.keydown('KeyW'); rig.im.update();
 *   rig.im.getDriveInput('kb1').accel;            // 1
 *   const pad = rig.connectPad(0);                // standard-mapping pad at index 0 -> 'gp0'
 *   pad.press(0); rig.im.update(); rig.im.consumeMenuEvents(); // [{ deviceId: 'gp0', action: 'confirm', ... }]
 *   rig.clock.advance(400);                       // ms, for menu auto-repeat
 *
 *   // 2) a scripted stand-in with the InputManager API (Menus, systems, session helpers)
 *   const input = createFakeInput();
 *   input.pushMenu('kb1', 'confirm');  input.setDrive('kb1', { accel: 1 });  input.pressPause('kb1');
 *   input.rumbles                                 // [{ deviceId, strength, ms }]
 */
import { InputManager, neutralDriveInput } from '../../src/input/InputManager.js';

/** Minimal EventTarget standing in for `window` (keydown / keyup / blur / pointer ...). */
export class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  /** Total number of registered listeners (dispose() should bring it back to 0). */
  count() {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  dispatch(type, props = {}) {
    const ev = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }
  keydown(code, extra = {}) {
    return this.dispatch('keydown', { code, ...extra });
  }
  keyup(code, extra = {}) {
    return this.dispatch('keyup', { code, ...extra });
  }
  /** keydown + keyup in the same frame (a tap shorter than a frame). */
  tap(code, extra = {}) {
    this.keydown(code, extra);
    return this.keyup(code, extra);
  }
}

/** A Gamepad-API-shaped fake. `press(i, value)` / `release(i)` / `axis(i, v)`. */
export function makePad({ index = 0, id = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', mapping = 'standard', nButtons = 17, nAxes = 4 } = {}) {
  return {
    index,
    id,
    mapping,
    connected: true,
    timestamp: 0,
    buttons: Array.from({ length: nButtons }, () => ({ pressed: false, touched: false, value: 0 })),
    axes: Array.from({ length: nAxes }, () => 0),
    vibrationActuator: { effects: [], playEffect(type, params) { this.effects.push({ type, ...params }); return Promise.resolve('complete'); } },
    press(i, value = 1) {
      this.buttons[i] = { pressed: value > 0.5, touched: value > 0, value };
      this.timestamp++;
    },
    release(i) {
      this.buttons[i] = { pressed: false, touched: false, value: 0 };
      this.timestamp++;
    },
    axis(i, v) {
      this.axes[i] = v;
      this.timestamp++;
    },
  };
}

/** Standard-mapping button indices (W3C "standard" gamepad). */
export const PAD = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9,
  LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
});

/**
 * The real InputManager on fakes. `opts` are passed through to InputManager.
 * @returns {{ im: InputManager, target: FakeTarget, pads: Array<object|null>, clock: { get(): number, advance(ms: number): void },
 *   connectPad(index?: number, padOpts?: object): object, disconnectPad(index: number): void, frame(ms?: number): void }}
 */
export function createInputRig(opts = {}) {
  const target = new FakeTarget();
  const pads = [null, null, null, null];
  let t = 1000;
  const clock = { get: () => t, advance: (ms) => { t += ms; } };
  const im = new InputManager(target, { getGamepads: () => pads, now: clock.get, ...opts });
  return {
    im,
    target,
    pads,
    clock,
    connectPad(index = 0, padOpts = {}) {
      pads[index] = makePad({ index, ...padOpts });
      return pads[index];
    },
    disconnectPad(index) {
      pads[index] = null;
    },
    /** Advance the clock by one frame (default 16 ms) and run im.update(). */
    frame(ms = 16) {
      clock.advance(ms);
      im.update();
    },
  };
}

/**
 * A scripted fake with the InputManager API. Menu events and pause presses are
 * delivered once (like the real edge-triggered ones); drive inputs persist until changed.
 */
export function createFakeInput({ devices = ['kb1', 'kb2'] } = {}) {
  const known = new Map(devices.map((id) => [id, { id, name: id, kind: id.startsWith('gp') ? 'gamepad' : id.startsWith('kb') ? 'keyboard' : 'virtual', connected: true }]));
  let menuQueue = [];
  const pausePressed = new Set();
  const drive = new Map();
  const deviceCbs = new Set();
  const gestureCbs = new Set();
  const fake = {
    rumbles: [],
    updates: 0,
    update() { fake.updates++; },
    getDevices: () => [...known.values()].map((d) => ({ ...d })),
    getDevice: (id) => (known.has(id) ? { ...known.get(id) } : null),
    isConnected: (id) => !!known.get(id)?.connected,
    consumeMenuEvents() { const out = menuQueue; menuQueue = []; return out; },
    clearMenuEvents() { menuQueue = []; },
    getDriveInput: (id) => ({ ...neutralDriveInput(), ...(drive.get(id) || {}) }),
    isPausePressed(id) { const hit = pausePressed.has(id); pausePressed.delete(id); return hit; },
    getPauseDevice() { const first = pausePressed.values().next().value ?? null; if (first) pausePressed.delete(first); return first; },
    rumble(deviceId, strength = 0.5, ms = 150) { fake.rumbles.push({ deviceId, strength, ms }); },
    setRumbleEnabled() {},
    onDeviceChange(cb) { deviceCbs.add(cb); return () => deviceCbs.delete(cb); },
    onAnyUserGesture(cb) { gestureCbs.add(cb); return () => gestureCbs.delete(cb); },
    addVirtualDevice(id, name = 'Robo Driver') { known.set(id, { id, name, kind: 'virtual', connected: true }); return id; },
    removeVirtualDevice(id) { known.delete(id); },
    setVirtualDriveInput(id, input = {}) { drive.set(id, { ...input }); },
    pushVirtualMenuEvent(id, action) { fake.pushMenu(id, action); },
    dispose() { deviceCbs.clear(); gestureCbs.clear(); },

    // ---- scripting ----
    /** Queue a menu event ({ deviceId, action, ...extra }) for the next consumeMenuEvents(). */
    pushMenu(deviceId, action, extra = {}) { menuQueue.push({ deviceId, action, ...extra }); },
    setDrive(deviceId, input) { drive.set(deviceId, { ...input }); },
    pressPause(deviceId) { pausePressed.add(deviceId); },
    connect(deviceId, name = deviceId) {
      known.set(deviceId, { id: deviceId, name, kind: deviceId.startsWith('gp') ? 'gamepad' : 'virtual', connected: true });
      for (const cb of deviceCbs) cb({ type: 'connected', deviceId });
    },
    disconnect(deviceId) {
      const d = known.get(deviceId);
      if (d) d.connected = false;
      for (const cb of deviceCbs) cb({ type: 'disconnected', deviceId });
    },
    gesture(source = 'keyboard') { for (const cb of gestureCbs) cb(source); },
  };
  return fake;
}
