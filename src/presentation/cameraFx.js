/**
 * Camera flourishes (pure maths, no THREE objects created per frame):
 *  - a kid-tuned "screen wobble" (trauma model: bonks add trauma, it decays,
 *    the offset is trauma² so small bumps stay tiny),
 *  - the finish-line orbit: after a human crosses the line their camera
 *    swings round to the front of the kart and slowly circles it,
 *  - photo-finish detection and the track intro card text.
 * OWNER: showcase presentation (used by src/systems/raceSpectacle.js).
 */

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutSine = (t) => 0.5 - Math.cos(Math.PI * clamp01(t)) / 2;

/** Wrap an angle into (-PI, PI]. */
export function wrap(a) {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/**
 * Screen wobble. `add(amount)` (0..1) on a bonk, `step(dt)` each frame ->
 * `{ x, y, roll }` (metres / radians, camera-local). Deterministic.
 */
export function createShake({ decay = 1.8, maxOffset = 0.28, maxRoll = 0.03, freq = 17, seed = 1 } = {}) {
  let trauma = 0;
  let t = seed * 13.37;
  const out = { x: 0, y: 0, roll: 0 };
  const n = (k) => Math.sin(t * freq * (1 + k * 0.37) + k * 1.9) * 0.6 + Math.sin(t * freq * 0.53 * (1 + k * 0.21) + k * 4.1) * 0.4;
  return {
    add(amount) {
      if (Number.isFinite(amount) && amount > 0) trauma = Math.min(1, trauma + amount);
      return trauma;
    },
    step(dt) {
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
      t += dt;
      trauma = Math.max(0, trauma - decay * dt);
      const k = trauma * trauma;
      out.x = maxOffset * k * n(1) + 0; // + 0: never -0
      out.y = maxOffset * k * n(2) * 0.7 + 0;
      out.roll = maxRoll * k * n(3) + 0;
      return out;
    },
    get trauma() { return trauma; },
    reset() { trauma = 0; out.x = 0; out.y = 0; out.roll = 0; },
  };
}

/** How much wobble each event gives (0..1). */
export const SHAKE_AMOUNTS = Object.freeze({
  bonked: 0.55,
  'shield-pop': 0.25,
  bumpScale: 0.05, // times the bump strength
  bumpMax: 0.22,
});

export const FINISH_ORBIT = Object.freeze({
  blendIn: 1.1, // seconds to swing from the chase camera to the orbit
  sweep: Math.PI * 0.95, // how far round the kart the camera travels (ends in front)
  sweepTime: 1.7, // time constant of the sweep (it slows down: a "slow-mo" feel)
  drift: 0.07, // radians/second it keeps circling afterwards
  dist0: 6.2,
  dist1: 5.0,
  height0: 3.0,
  height1: 2.4, // high enough to pass over the item boxes
  lift: 1.8,
  lookHeight: 2.3, // aim above the kart so it sits under the "Finished!" banner
});

/**
 * Where the finish camera is `t` seconds after crossing the line.
 * @returns {{ yaw:number, dist:number, height:number, blend:number }} yaw is
 *   relative to the kart heading (0 = behind the kart, PI = in front).
 */
export function finishOrbitAt(t, o = FINISH_ORBIT) {
  t = Math.max(0, Number.isFinite(t) ? t : 0);
  const frac = 1 - Math.exp(-t / o.sweepTime);
  const sweep = o.sweep * frac + o.drift * t;
  const e = easeOutCubic(t / (o.sweepTime * 1.4));
  return {
    yaw: sweep,
    dist: o.dist0 + (o.dist1 - o.dist0) * e,
    // a crane move: up and over while passing the side of the kart (clears item boxes and fences)
    height: o.height0 + (o.height1 - o.height0) * e + (o.lift ?? 0) * Math.sin(Math.PI * Math.min(1, frac * 1.15)),
    blend: easeInOutSine(t / o.blendIn),
  };
}

/**
 * The finish camera position + look target (plain objects) for a kart.
 * @param {{x:number,y:number,z:number}} kartPos
 * @param {number} heading kart heading (forward = (sin h, 0, cos h))
 */
export function finishCameraPose(kartPos, heading, t, { dir = 1, lateral = null, halfWidth = null } = {}, o = FINISH_ORBIT) {
  const p = finishOrbitAt(t, o);
  const side = dir < 0 ? -1 : 1;
  const yaw = heading + Math.PI + side * p.yaw; // start behind the kart, swing round `dir` side
  let ox = Math.sin(yaw) * p.dist;
  let oz = Math.cos(yaw) * p.dist;
  let height = p.height;
  // Stay over the road: the finish arch posts and fences sit just outside it.
  if (Number.isFinite(lateral) && Number.isFinite(halfWidth) && halfWidth > 1) {
    const rx = -Math.cos(heading);
    const rz = Math.sin(heading); // "right" of the kart (ARCHITECTURE §10)
    const offLat = ox * rx + oz * rz;
    const limit = Math.max(0.5, halfWidth - 1);
    const lat = lateral + offLat;
    if (Math.abs(lat) > limit && Math.abs(offLat) > 1e-6) {
      const target = Math.sign(lat) * limit;
      const f = Math.max(0.3, Math.min(1, (target - lateral) / offLat));
      ox *= f;
      oz *= f;
      height += (1 - f) * 3.2; // closer in = look down from a bit higher
    }
  }
  return {
    ...p,
    height,
    pos: { x: kartPos.x + ox, y: kartPos.y + height, z: kartPos.z + oz },
    look: { x: kartPos.x, y: kartPos.y + o.lookHeight, z: kartPos.z },
  };
}

/**
 * Which way the finish camera swings: towards the side of the road with more room.
 * @returns {1|-1} +1 = round the kart's right side
 */
export function orbitSide(lateral, halfWidth) {
  if (!Number.isFinite(lateral) || !Number.isFinite(halfWidth)) return 1;
  const roomRight = halfWidth - lateral;
  const roomLeft = halfWidth + lateral;
  return roomRight >= roomLeft ? 1 : -1;
}

/**
 * Photo finish? `finishes` = [{ time, human }] in finishing order. True when
 * a human's finish is within `window` seconds of a neighbour's.
 */
export function photoFinishPair(finishes, window = 0.25) {
  for (let i = 1; i < finishes.length; i++) {
    const a = finishes[i - 1];
    const b = finishes[i];
    if (!Number.isFinite(a?.time) || !Number.isFinite(b?.time)) continue;
    if (Math.abs(b.time - a.time) <= window && (a.human || b.human)) return [i - 1, i];
  }
  return null;
}

/**
 * The text on the track intro card.
 * @param {object} trackDef
 * @param {{ mode?: string, gpRace?: number, cupId?: string }} [setup]
 * @param {{ cupName?: string, cupEmoji?: string, raceCount?: number }} [extra]
 */
export function introCardModel(trackDef, setup = {}, extra = {}) {
  const art = Array.isArray(trackDef?.art) && trackDef.art.length ? trackDef.art.slice(0, 3) : ['🏁', '🍬', '✨'];
  let kicker = '';
  if (setup?.mode === 'grand-prix') {
    const n = Number.isInteger(setup.gpRace) ? setup.gpRace + 1 : null;
    const count = extra.raceCount || 4;
    kicker = `${extra.cupEmoji ? `${extra.cupEmoji} ` : ''}${extra.cupName || 'Grand Prix'}${n ? ` · Race ${n} of ${count}` : ''}`;
  } else if (setup?.mode === 'time-trial') {
    kicker = '⏱️ Time Trial';
  } else {
    kicker = extra.cupName ? `${extra.cupEmoji ? `${extra.cupEmoji} ` : ''}${extra.cupName}` : '🏁 Free Race';
  }
  return {
    kicker,
    title: trackDef?.name || 'Mystery Track',
    subtitle: trackDef?.subtitle || '',
    art,
  };
}
