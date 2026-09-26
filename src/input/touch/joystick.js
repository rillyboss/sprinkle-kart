/**
 * Joystick math for the on-screen touch stick (pure, no DOM).
 *
 * The stick is FLOATING: wherever a thumb lands inside the steer zone becomes the
 * centre, so a small child never has to aim for a ring. Only the X axis steers.
 *
 *   const stick = new FloatingStick({ radius: 60 });
 *   stick.start(id, x, y);   stick.move(id, x2, y2);   stick.value  // { x: -1..1, y: -1..1 }
 *   stick.end(id);
 *
 * Shaping (steerFromStick): deadzone → rescale → response curve (exponent > 1 gives
 * finer control near the centre, 1 = linear) → clamp -1..1.
 */

export const STICK_DEFAULTS = Object.freeze({
  radius: 64,        // px from centre to full deflection
  deadzone: 0.12,    // fraction of radius ignored around the centre
  curve: 1.35,       // response exponent (1 = linear)
  follow: true,      // the base drags along when the thumb goes past the rim
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const finite = (v, d = 0) => (Number.isFinite(v) ? v : d);

/**
 * Raw stick vector from a centre to a thumb, clamped to the unit circle.
 * @returns {{x:number, y:number, mag:number}} y is +down (DOM)
 */
export function stickVector(ox, oy, px, py, radius = STICK_DEFAULTS.radius) {
  const r = Math.max(1, finite(radius, STICK_DEFAULTS.radius));
  let x = (finite(px) - finite(ox)) / r;
  let y = (finite(py) - finite(oy)) / r;
  const mag = Math.hypot(x, y);
  if (mag > 1) { x /= mag; y /= mag; }
  return { x, y, mag: Math.min(1, mag) };
}

/**
 * One axis through deadzone + curve. Output keeps the sign, ramps from 0 at the
 * deadzone edge to exactly 1 at full deflection.
 */
export function shapeAxis(v, { deadzone = STICK_DEFAULTS.deadzone, curve = STICK_DEFAULTS.curve } = {}) {
  const x = clamp(finite(v), -1, 1);
  const dz = clamp(finite(deadzone, 0), 0, 0.95);
  const a = Math.abs(x);
  if (a <= dz) return 0;
  const lin = (a - dz) / (1 - dz);
  const out = Math.pow(lin, Math.max(0.2, finite(curve, 1)));
  return x < 0 ? -out : out;
}

/** Steering (-1 left .. +1 right) from a stick vector. */
export function steerFromStick(vec, opts) {
  return shapeAxis(vec?.x ?? 0, opts);
}

/**
 * A floating analog stick tracking ONE pointer. Multi-touch safe: moves/ends of other
 * pointer ids are ignored.
 */
export class FloatingStick {
  constructor(opts = {}) {
    this.opts = { ...STICK_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.pointerId = null;
    this.origin = null;   // { x, y } base centre
    this.thumb = null;    // { x, y } knob (clamped to the rim)
    this.value = { x: 0, y: 0, mag: 0 };
  }

  get active() {
    return this.pointerId !== null;
  }

  /** Begin tracking; returns false if another pointer already owns the stick. */
  start(id, x, y) {
    if (this.pointerId !== null) return false;
    this.pointerId = id;
    this.origin = { x: finite(x), y: finite(y) };
    this.thumb = { ...this.origin };
    this.value = { x: 0, y: 0, mag: 0 };
    return true;
  }

  move(id, x, y) {
    if (id !== this.pointerId || !this.origin) return false;
    const r = Math.max(1, this.opts.radius);
    let v = stickVector(this.origin.x, this.origin.y, x, y, r);
    const rawMag = Math.hypot(finite(x) - this.origin.x, finite(y) - this.origin.y) / r;
    if (this.opts.follow && rawMag > 1) {
      // drag the base along so turning back the other way is instant
      const over = rawMag - 1;
      this.origin.x += v.x * over * r;
      this.origin.y += v.y * over * r;
      v = stickVector(this.origin.x, this.origin.y, x, y, r);
    }
    this.value = v;
    this.thumb = { x: this.origin.x + v.x * r, y: this.origin.y + v.y * r };
    return true;
  }

  end(id) {
    if (id !== this.pointerId) return false;
    this.reset();
    return true;
  }

  /** Shaped steering -1..1 (0 when idle). */
  steer() {
    return this.active ? steerFromStick(this.value, this.opts) : 0;
  }
}
