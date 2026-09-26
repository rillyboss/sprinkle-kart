/**
 * Jumps (candy ramps) and boost rings — the pure data + physics helpers shared by the track builder
 * (src/tracks/core.js builds the meshes), the Race (env.jumps / env.rings) and online prediction.
 * No THREE.js, no DOM: everything here is plain numbers and a TrackPath. OWNER: driving feel (physics).
 *
 * TrackDef contract (ARCHITECTURE.md §5):
 *   jumps: [{ at, lateral = 0, width = 9, length = 9, height = 1.3, style? }]
 *     at      lap fraction of the LIP (the take-off edge); the ramp runs `length` metres up to it
 *     lateral centre offset (+ = right), width = ramp width (metres), height = lip height (metres)
 *     style   free-form hint for the ramp look (themes read it in their buildRamp hook)
 *   rings: [{ at, lateral = 0, height = 3.5, radius = 2.2 }]
 *     a hoop floating `height` metres above the road (centre); flying through it gives a boost
 *
 * Built shape (builtTrack.jumps / builtTrack.rings, also what Race / prediction consume):
 *   jump = { s, lateral, halfWidth, length, lipHeight, launchAngle, style }   s = lip arc length
 *   ring = { s, lateral, height, radius, y }                                  y = world height of the centre
 *
 * Ramp profile: a kicker, h(u) = lipHeight * u^2 for u = 0 (foot) .. 1 (lip), so the lip angle is
 * atan(2 * lipHeight / length) (clamped 8..28 deg) and a kart leaving it at speed v rises with
 * vy = v * sin(launchAngle): faster = higher and longer.
 */
import { TUNING as T } from './tuning.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const DEG = Math.PI / 180;

/** Limits a TrackDef jump / ring is clamped to (a typo never breaks physics). */
export const JUMP_LIMITS = Object.freeze({
  width: [4, 22], length: [5, 16], height: [0.5, 2.4], angle: [8 * DEG, 28 * DEG],
  ringHeight: [1.6, 8], ringRadius: [1.4, 3.5],
});
export const JUMP_DEFAULTS = Object.freeze({ width: 9, length: 9, height: 1.3 });
export const RING_DEFAULTS = Object.freeze({ height: 3.5, radius: 2.2 });
/** Side bevel (metres) where a ramp tapers to the road, so sliding onto it from the side is gentle. */
export const RAMP_BEVEL = 0.8;

/** Lip angle of a kicker ramp of this height/length. */
export function launchAngleFor(lipHeight, length) {
  return clamp(Math.atan2(2 * lipHeight, length), JUMP_LIMITS.angle[0], JUMP_LIMITS.angle[1]);
}

/**
 * TrackDef.jumps -> built jumps, clamped inside the road.
 * @param {object} def TrackDef (reads def.jumps)
 * @param {{ length: number, halfWidth: number, wrap(s: number): number }} path
 */
export function buildJumps(def, path) {
  return (def?.jumps || []).map((j) => {
    const halfWidth = Math.min(clamp(j.width ?? JUMP_DEFAULTS.width, ...JUMP_LIMITS.width) / 2, path.halfWidth - 0.5);
    const maxLat = Math.max(0, path.halfWidth - 0.5 - halfWidth);
    const length = clamp(j.length ?? JUMP_DEFAULTS.length, ...JUMP_LIMITS.length);
    const lipHeight = clamp(j.height ?? JUMP_DEFAULTS.height, ...JUMP_LIMITS.height);
    return {
      s: path.wrap((Number(j.at) || 0) * path.length),
      lateral: clamp(Number(j.lateral) || 0, -maxLat, maxLat),
      halfWidth,
      length,
      lipHeight,
      launchAngle: launchAngleFor(lipHeight, length),
      style: j.style ?? null,
    };
  });
}

/**
 * TrackDef.rings -> built rings (centre height is above the road at the ring).
 * @param {object} def TrackDef (reads def.rings)
 * @param {{ length: number, halfWidth: number, wrap(s: number): number, pointAt?: Function }} path
 */
export function buildRings(def, path) {
  return (def?.rings || []).map((r) => {
    const s = path.wrap((Number(r.at) || 0) * path.length);
    const radius = clamp(r.radius ?? RING_DEFAULTS.radius, ...JUMP_LIMITS.ringRadius);
    const maxLat = Math.max(0, path.halfWidth - radius * 0.5);
    const height = clamp(r.height ?? RING_DEFAULTS.height, ...JUMP_LIMITS.ringHeight);
    const roadY = typeof path.pointAt === 'function' ? path.pointAt(s).y : 0;
    return { s, lateral: clamp(Number(r.lateral) || 0, -maxLat, maxLat), height, radius, y: roadY + height };
  });
}

/**
 * Height of one ramp's surface above the road at (s, lateral), or 0 off the ramp.
 * @returns {number}
 */
export function rampHeight(jump, path, s, lateral) {
  const along = path.delta(jump.s, s); // < 0 before the lip
  if (along > 0 || along < -jump.length) return 0;
  const side = jump.halfWidth - Math.abs(lateral - jump.lateral);
  if (side <= 0) return 0;
  const u = 1 + along / jump.length;
  return jump.lipHeight * u * u * Math.min(1, side / RAMP_BEVEL);
}

/**
 * The ramp under (s, lateral): { index, height, slope } (index -1 = none). `slope` = rise per metre
 * along the track (for the kart's nose-up pitch).
 */
export function rampAt(jumps, path, s, lateral, out = { index: -1, height: 0, slope: 0 }) {
  out.index = -1; out.height = 0; out.slope = 0;
  if (!jumps) return out;
  for (let i = 0; i < jumps.length; i++) {
    const h = rampHeight(jumps[i], path, s, lateral);
    if (h > out.height) {
      const j = jumps[i];
      const u = 1 + path.delta(j.s, s) / j.length;
      out.index = i; out.height = h; out.slope = (2 * j.lipHeight * u) / j.length;
    }
  }
  return out;
}

/** Is (s, lateral) just past this ramp's lip (inside its width), i.e. did a kart on it take off? */
export function pastLip(jump, path, s, lateral) {
  const along = path.delta(jump.s, s);
  return along >= 0 && along < 12 && Math.abs(lateral - jump.lateral) <= jump.halfWidth + 0.5;
}

/** Downward pull while airborne (m/s^2) for a track's gameplay modifiers (Moonbounce = floatier). */
export function airGravity(gameplay) {
  return T.airGravity * clamp(gameplay?.gravity ?? 1, 0.2, 2);
}

/** Vertical take-off speed for leaving `jump` at forward `speed`. */
export function launchSpeed(jump, speed) {
  return Math.max(0, speed) * Math.sin(jump.launchAngle) * T.jumpLaunch;
}

/**
 * Seconds until a kart `height` metres above the road, rising at `vy`, lands (flat road).
 */
export function timeToLand(vy, height, g) {
  const h = Math.max(0, height);
  return (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
}

/**
 * The flight off a ramp at `speed` on flat road: { vy, airTime, apex, distance, heightAt(d) } —
 * `heightAt(d)` = height above the road `d` metres past the lip. Track teams use it to place rings.
 * @param {object} jump built jump
 * @param {number} speed forward speed at the lip (m/s), e.g. SPEED_CLASSES.zippy.maxSpeed
 * @param {object} [gameplay] track gameplay modifiers
 */
export function jumpArc(jump, speed, gameplay) {
  const g = airGravity(gameplay);
  const vy = launchSpeed(jump, speed);
  const airTime = timeToLand(vy, jump.lipHeight, g);
  const v = Math.max(1e-6, speed);
  return {
    vy,
    airTime,
    apex: jump.lipHeight + (vy * vy) / (2 * g),
    distance: airTime * speed,
    heightAt(d) {
      const t = d / v;
      return Math.max(0, jump.lipHeight + vy * t - 0.5 * g * t * t);
    },
  };
}

/**
 * Where to hang a ring so a kart leaving `jump` at `speed` flies through its middle:
 * { at, lateral, height } in TrackDef units (a lap fraction), at `frac` (0..1) of the flight.
 */
export function suggestRing(jump, path, speed, { frac = 0.45, gameplay } = {}) {
  const arc = jumpArc(jump, speed, gameplay);
  const d = arc.distance * frac;
  return {
    at: path.wrap(jump.s + d) / path.length,
    lateral: jump.lateral,
    height: clamp(arc.heightAt(d) + T.kartCenterY, ...JUMP_LIMITS.ringHeight),
  };
}

/** Trick kinds (1..3) and their names (for voices / HUD). 0 = no trick. */
export const TRICKS = Object.freeze(['none', 'flip', 'spin', 'twirl']);
