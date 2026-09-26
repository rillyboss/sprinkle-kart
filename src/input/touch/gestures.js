/**
 * Menu gesture recognition (pure, no DOM, injectable clock).
 *
 *   const g = new GestureRecognizer();
 *   g.down(id, x, y, t); g.move(id, x, y, t); const out = g.up(id, x, y, t);
 *   g.tick(t)   // → 'long-press' once a finger has rested long enough (fires while held)
 *
 * Gestures (one finger unless noted):
 *   tap          short press, little movement          (menus already get a native click)
 *   long-press   held still ≥ LONG_PRESS_MS            → menu 'toggle' (alt action, like Y)
 *   swipe-left/right/up/down  fast flick ≥ SWIPE_MIN_PX → menu direction (swipe LEFT = next = 'right')
 *   two-finger-tap  two fingers down and up quickly    → menu 'back'
 *
 * gestureToMenuAction() maps a gesture to the InputManager menu action names.
 */

export const GESTURE_DEFAULTS = Object.freeze({
  tapMaxMs: 280,
  tapSlopPx: 14,
  longPressMs: 550,
  swipeMinPx: 48,
  swipeMaxMs: 600,
  swipeAxisRatio: 1.4,   // dominant axis must beat the other by this much
  twoFingerMaxMs: 350,
});

export class GestureRecognizer {
  constructor(opts = {}) {
    this.opts = { ...GESTURE_DEFAULTS, ...opts };
    this.pointers = new Map(); // id -> { x0, y0, x, y, t0, moved, longFired }
    this._multi = null;        // { t0, ids:Set, maxCount, cancelled }
  }

  get count() {
    return this.pointers.size;
  }

  down(id, x, y, t) {
    this.pointers.set(id, { x0: x, y0: y, x, y, t0: t, moved: false, longFired: false });
    if (this.pointers.size === 1) this._multi = { t0: t, maxCount: 1, cancelled: false };
    else if (this._multi) this._multi.maxCount = Math.max(this._multi.maxCount, this.pointers.size);
  }

  move(id, x, y) {
    const p = this.pointers.get(id);
    if (!p) return;
    p.x = x;
    p.y = y;
    if (Math.hypot(x - p.x0, y - p.y0) > this.opts.tapSlopPx) {
      p.moved = true;
      if (this._multi && this._multi.maxCount > 1) this._multi.cancelled = true;
    }
  }

  /** Call every frame: returns 'long-press' once per resting finger (single-finger only). */
  tick(t) {
    if (this.pointers.size !== 1 || (this._multi && this._multi.maxCount > 1)) return null;
    const [p] = this.pointers.values();
    if (!p.moved && !p.longFired && t - p.t0 >= this.opts.longPressMs) {
      p.longFired = true;
      return 'long-press';
    }
    return null;
  }

  /** @returns {string|null} the finished gesture */
  up(id, x, y, t) {
    const p = this.pointers.get(id);
    if (!p) return null;
    if (Number.isFinite(x)) { this.move(id, x, y); }
    this.pointers.delete(id);
    const multi = this._multi;
    if (multi && multi.maxCount > 1) {
      // multi-finger gesture: decided when the LAST finger lifts
      if (this.pointers.size > 0) return null;
      this._multi = null;
      const ok = multi.maxCount === 2 && !multi.cancelled && t - multi.t0 <= this.opts.twoFingerMaxMs;
      return ok ? 'two-finger-tap' : null;
    }
    this._multi = null;
    if (p.longFired) return null;
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    const dt = t - p.t0;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const o = this.opts;
    if (dt <= o.swipeMaxMs && Math.max(ax, ay) >= o.swipeMinPx) {
      if (ax >= ay * o.swipeAxisRatio) return dx < 0 ? 'swipe-left' : 'swipe-right';
      if (ay >= ax * o.swipeAxisRatio) return dy < 0 ? 'swipe-up' : 'swipe-down';
      return null; // diagonal: ignore rather than guess
    }
    if (!p.moved && dt <= o.tapMaxMs) return 'tap';
    return null;
  }

  cancel(id) {
    this.pointers.delete(id);
    if (!this.pointers.size) this._multi = null;
  }

  reset() {
    this.pointers.clear();
    this._multi = null;
  }
}

/**
 * Gesture → menu action ('left'|'right'|'up'|'down'|'toggle'|'back') or null.
 * Swiping content LEFT reveals what is on the right, so it walks 'right' (and vice versa).
 * Taps return null: the screens already handle the native click.
 */
export function gestureToMenuAction(gesture) {
  switch (gesture) {
    case 'swipe-left': return 'right';
    case 'swipe-right': return 'left';
    case 'swipe-up': return 'down';
    case 'swipe-down': return 'up';
    case 'long-press': return 'toggle';
    case 'two-finger-tap': return 'back';
    default: return null;
  }
}
