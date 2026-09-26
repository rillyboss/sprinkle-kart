/**
 * TouchDevice — one touch player's controller state, turned into the SAME input frame a
 * gamepad produces ({ steer, accel, brake, held, taps }), so InputManager computes
 * DriveInput + menu events for it exactly like for a pad.
 *
 *   const dev = new TouchDevice({ id: 'touch1', settings });
 *   dev.press('drift') / dev.release('drift')      held buttons (gas, brake, drift, left, right, lookBack)
 *   dev.tap('item') / dev.tap('pause')             one-shot presses (next frame)
 *   dev.setStickSteer(v) / dev.setTiltSteer(v)     analog steering -1..1
 *   dev.menu('right' | 'confirm' | 'toggle' | ...) menu events from gestures (next frame)
 *   dev.read()                                     → frame (consumes taps); InputManager calls it
 *
 * Steering priority: ◀ ▶ buttons (digital) > stick > tilt. Auto-gas (default ON) gives
 * full throttle unless BRAKE is held; with auto-gas off, GAS must be held.
 */
import { normalizeTouchSettings } from './touchSettings.js';

export const TOUCH_HELD = Object.freeze(['gas', 'brake', 'drift', 'left', 'right', 'lookBack']);
export const TOUCH_TAPS = Object.freeze(['item', 'pause']);
export const TOUCH_MENU = Object.freeze(['up', 'down', 'left', 'right', 'confirm', 'back', 'start', 'toggle']);

/** Labels shown in prompts ("Tap ITEM"), same keys as gamepadLabels(). */
export const TOUCH_LABELS = Object.freeze({
  confirm: 'Tap', back: '⬅', toggle: 'Hold', start: 'Tap', accel: 'GO', brake: 'BRAKE',
  drift: 'HOP', item: 'ITEM', lookBack: '👀', pause: '⏸', steer: 'Stick', move: 'Swipe',
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class TouchDevice {
  constructor({ id = 'touch1', name = 'Touch screen', settings = {}, slot = 0 } = {}) {
    this.id = id;
    this.name = name;
    this.slot = slot;
    this.settings = normalizeTouchSettings(settings);
    this.held = new Set();
    this.pendingTaps = new Set();
    this.pendingMenu = [];
    this.stickSteer = 0;
    this.tiltSteer = 0;
    this.lastActivity = -Infinity;
    this.haptics = null; // (pattern) => void, set by the installer
  }

  setSettings(s) {
    this.settings = normalizeTouchSettings(s);
  }

  _touch(t) {
    this.lastActivity = Number.isFinite(t) ? t : Date.now();
  }

  press(name, t) {
    if (!TOUCH_HELD.includes(name)) return;
    this.held.add(name);
    this._touch(t);
  }

  release(name) {
    this.held.delete(name);
  }

  releaseAll() {
    this.held.clear();
    this.stickSteer = 0;
  }

  tap(name, t) {
    if (!TOUCH_TAPS.includes(name)) return;
    this.pendingTaps.add(name);
    this._touch(t);
  }

  menu(action, t) {
    if (!TOUCH_MENU.includes(action)) return;
    this.pendingMenu.push(action);
    this._touch(t);
  }

  setStickSteer(v) {
    this.stickSteer = clamp(Number.isFinite(v) ? v : 0, -1, 1);
  }

  setTiltSteer(v) {
    this.tiltSteer = clamp(Number.isFinite(v) ? v : 0, -1, 1);
  }

  /** Current steering -1..1 after priority rules. */
  steer() {
    const l = this.held.has('left');
    const r = this.held.has('right');
    if (l !== r) return l ? -1 : 1;
    if (l && r) return 0;
    if (this.stickSteer !== 0) return this.stickSteer;
    return this.settings.style === 'tilt' ? this.tiltSteer : 0;
  }

  /** Build this frame's input frame and consume one-shot presses. */
  read() {
    const brake = this.held.has('brake') ? 1 : 0;
    const gas = this.held.has('gas') || (this.settings.autoGas && !brake);
    const taps = new Set(this.pendingTaps);
    for (const a of this.pendingMenu) taps.add(a);
    this.pendingTaps.clear();
    this.pendingMenu.length = 0;
    return {
      steer: this.steer(),
      accel: gas ? 1 : 0,
      brake,
      held: { drift: this.held.has('drift'), lookBack: this.held.has('lookBack') },
      taps,
      anyButton: false,
    };
  }

  /** Controller rumble → phone vibration (InputManager.rumble calls this). */
  rumble(strength = 0.5, ms = 150) {
    if (!this.settings.haptics || typeof this.haptics !== 'function') return;
    const dur = Math.round(clamp(ms * (0.5 + clamp(strength, 0, 1) * 0.5), 10, 400));
    try { this.haptics(dur); } catch { /* optional */ }
  }
}

/**
 * navigator.vibrate wrapper (Android Chrome; iOS Safari has no vibrate). Returns a function or null.
 */
export function makeHaptics(nav = typeof navigator !== 'undefined' ? navigator : undefined) {
  if (!nav || typeof nav.vibrate !== 'function') return null;
  return (pattern) => {
    try { nav.vibrate(pattern); } catch { /* ignore */ }
  };
}
