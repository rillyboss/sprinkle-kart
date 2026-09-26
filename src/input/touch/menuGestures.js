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
    this._suppressUntil = -Infinity;
  }

  down(id, x, y, t) {
    if (this.g.count === 0) { this._startX = x; this._startY = y; }
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
