/**
 * MenuGestureController — swipes / long-press / two-finger tap on the MENUS become menu
 * events of a touch device (pure; src/ui/touch/menuGestureLayer.js wires the DOM).
 *
 *   const mg = new MenuGestureController({ deviceFor: (x, y) => touch.device('touch1') });
 *   mg.down(id, x, y, t); mg.move(id, x, y); mg.up(id, x, y, t); mg.tick(t);
 *   mg.suppressClick(t)   // true right after a gesture: swallow the native click it causes
 *
 * Taps are NOT turned into events — every screen already handles the native click (which
 * clickDevice() attributes to the touch player). See gestureToMenuAction() for the map.
 */
import { GestureRecognizer, gestureToMenuAction } from './gestures.js';

export const CLICK_SUPPRESS_MS = 450;

export class MenuGestureController {
  constructor({ deviceFor, recognizer = new GestureRecognizer(), onAction = null } = {}) {
    this.deviceFor = deviceFor || (() => null);
    this.g = recognizer;
    this.onAction = onAction;
    this._startX = 0;
    this._startY = 0;
    this._nativeY = false;
    this._suppressUntil = -Infinity;
  }

  /**
   * @param {{nativeScrollY?: boolean}} [opts] nativeScrollY: the finger landed on something
   *   that scrolls vertically by itself — up/down swipes are left to the browser.
   */
  down(id, x, y, t, opts = {}) {
    // a NEW press means the click of the last gesture is over: never swallow this one's click
    this._suppressUntil = -Infinity;
    if (this.g.count === 0) { this._startX = x; this._startY = y; this._nativeY = !!opts.nativeScrollY; }
    this.g.down(id, x, y, t);
  }

  move(id, x, y) {
    this.g.move(id, x, y);
  }

  up(id, x, y, t) {
    return this._emit(this.g.up(id, x, y, t), t);
  }

  cancel(id) {
    this.g.cancel(id);
  }

  tick(t) {
    return this._emit(this.g.tick(t), t);
  }

  _emit(gesture, t) {
    const action = gestureToMenuAction(gesture);
    if (!action) return null;
    this._suppressUntil = t + CLICK_SUPPRESS_MS;
    if (this._nativeY && (action === 'up' || action === 'down')) return null;
    let dev = null;
    try { dev = this.deviceFor(this._startX, this._startY); } catch { dev = null; }
    if (!dev) return null;
    dev.menu(action, t);
    try { this.onAction?.(action, dev.id, gesture); } catch { /* optional */ }
    return action;
  }

  suppressClick(t) {
    return t <= this._suppressUntil;
  }
}
