/**
 * Tilt steering from DeviceOrientation (pure maths + a tiny permission helper).
 *
 * Holding a phone/tablet in LANDSCAPE like a steering wheel, "turning the wheel" rotates
 * the device around the axis that points out of the screen... except the sensors report
 * beta (front-back, -180..180) and gamma (left-right, -90..90) in the device's PORTRAIT
 * frame. rawTiltAngle() picks the right one for the current screen orientation:
 *
 *   portrait (0°)          steer = gamma          (tilt right edge down → right)
 *   landscape (90°, home button / notch on the left? → "landscape-primary" on most)  steer =  beta
 *   landscape (-90°/270°)  steer = -beta
 *   upside down (180°)     steer = -gamma
 *
 * TiltSteer then: subtracts the calibrated neutral angle, applies a deadzone, maps
 * ±maxAngle° to ±1 and low-pass filters (exponential smoothing, frame-rate independent).
 */

export const TILT_DEFAULTS = Object.freeze({
  maxAngle: 24,       // degrees of wheel-turn for full lock
  deadzone: 3,        // degrees ignored around neutral
  smoothing: 0.08,    // seconds time-constant of the low-pass (0 = raw)
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Normalise a screen orientation angle to 0 | 90 | 180 | 270. */
export function normalizeScreenAngle(angle) {
  const a = Number.isFinite(angle) ? angle : 0;
  const n = ((Math.round(a / 90) * 90) % 360 + 360) % 360;
  return n;
}

/** Wheel angle in degrees (+ = turn right) for this orientation reading. */
export function rawTiltAngle({ beta, gamma } = {}, screenAngle = 0) {
  const b = Number.isFinite(beta) ? beta : 0;
  const g = Number.isFinite(gamma) ? gamma : 0;
  switch (normalizeScreenAngle(screenAngle)) {
    case 90: return b;
    case 270: return -b;
    case 180: return -g;
    default: return g;
  }
}

/** Current screen orientation angle from a window-like object (0 if unknown). */
export function screenAngleOf(win) {
  try {
    const so = win?.screen?.orientation;
    if (so && Number.isFinite(so.angle)) return so.angle;
    if (Number.isFinite(win?.orientation)) return win.orientation; // old iOS Safari
  } catch { /* ignore */ }
  return 0;
}

export class TiltSteer {
  constructor(opts = {}) {
    this.opts = { ...TILT_DEFAULTS, ...opts };
    this.neutral = Number.isFinite(opts.neutral) ? opts.neutral : 0;
    this.raw = 0;          // latest wheel angle (deg)
    this.value = 0;        // smoothed steer -1..1
    this.hasReading = false;
  }

  /** Feed a DeviceOrientation reading. */
  feed(reading, screenAngle = 0) {
    if (!reading || (!Number.isFinite(reading.beta) && !Number.isFinite(reading.gamma))) return;
    this.raw = rawTiltAngle(reading, screenAngle);
    if (!this.hasReading) {
      this.hasReading = true;
      this.value = this.target();
    }
  }

  /** Remember the current angle as "straight ahead". Returns the neutral angle. */
  calibrate() {
    this.neutral = this.raw;
    this.value = 0;
    return this.neutral;
  }

  /** Unsmoothed steer for the latest reading. */
  target() {
    const { maxAngle, deadzone } = this.opts;
    let d = this.raw - this.neutral;
    // wrap across ±180 (beta flips there)
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    const a = Math.abs(d);
    if (a <= deadzone) return 0;
    const span = Math.max(1, maxAngle - deadzone);
    const out = clamp((a - deadzone) / span, 0, 1);
    return d < 0 ? -out : out;
  }

  /** Advance the smoothing by dt seconds; returns the smoothed steer. */
  update(dt) {
    const tgt = this.target();
    const tau = Math.max(0, this.opts.smoothing);
    if (tau <= 0 || !Number.isFinite(dt) || dt <= 0) {
      if (tau <= 0) this.value = tgt;
      return this.value;
    }
    const k = 1 - Math.exp(-dt / tau);
    this.value += (tgt - this.value) * k;
    if (Math.abs(this.value) < 1e-4) this.value = 0;
    return this.value;
  }
}

/** Is tilt steering possible at all in this browser? */
export function tiltSupported(win = typeof window !== 'undefined' ? window : undefined) {
  return !!win && typeof win.DeviceOrientationEvent !== 'undefined';
}

/**
 * Ask for motion permission. iOS 13+ Safari requires DeviceOrientationEvent.requestPermission()
 * to be called from a user gesture (a tap); elsewhere there is nothing to ask.
 * @returns {Promise<'granted'|'denied'|'unsupported'>}
 */
export async function requestTiltPermission(win = typeof window !== 'undefined' ? window : undefined) {
  if (!tiltSupported(win)) return 'unsupported';
  const DOE = win.DeviceOrientationEvent;
  if (typeof DOE.requestPermission !== 'function') return 'granted';
  try {
    const res = await DOE.requestPermission();
    return res === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}
