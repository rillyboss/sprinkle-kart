/**
 * Time Trial ghosts (pure, DOM/WebGL-free, unit tested): record a kart at
 * ~20 Hz, pack the run compactly (quantized + delta + zigzag varints +
 * base64), keep the best run per track in localStorage and replay it with
 * smooth interpolation. The 3D look lives in ./ghostKart.js.
 *
 * Stored ghost (JSON):
 *   { v: 1, trackId, laps, characterId, speedClass, time, hz, n, data }
 * `data` packs n samples of 5 channels [x, y, z, heading, distance].
 *
 *   localStorage['sprinkle-kart-ghosts-v1'] = { [trackId]: { [laps]: ghost } }
 *
 * OWNER: modes + timing workstream.
 */
import { jsonStore, defaultBackend } from './storage.js';

export const GHOST_KEY = 'sprinkle-kart-ghosts-v1';
export const GHOST_VERSION = 1;
export const GHOST_HZ = 20;
/** Longest run we keep (10 minutes). */
export const GHOST_MAX_SECONDS = 600;

const TAU = Math.PI * 2;
/** Quantization steps per unit: position 5 cm, heading 1/4096 turn, distance 10 cm. */
export const QUANT = Object.freeze({ pos: 20, heading: 4096 / TAU, dist: 10 });
const HEADING_STEPS = 4096;

/* ---------------- recording ---------------- */

/**
 * Samples a kart every 1/hz seconds of race time.
 *   const rec = createGhostRecorder();
 *   rec.record(race.time, kart)   // every frame after GO
 *   rec.samples                   // [{ t, x, y, z, heading, distance }]
 */
export function createGhostRecorder({ hz = GHOST_HZ, maxSeconds = GHOST_MAX_SECONDS } = {}) {
  const step = 1 / hz;
  const cap = Math.ceil(maxSeconds * hz) + 1;
  const samples = [];
  let prev = null; // last raw pose { t, x, y, z, heading, distance }
  const poseOf = (t, kart) => ({
    t,
    x: kart.position.x,
    y: kart.position.y,
    z: kart.position.z,
    heading: kart.heading ?? 0,
    distance: kart.distance ?? kart.progress ?? 0,
  });
  /** Fill every 1/hz grid slot up to time t, interpolating between the last pose and `cur`. */
  const fill = (cur) => {
    let added = 0;
    while (samples.length < cap) {
      const g = samples.length * step;
      if (g > cur.t + 1e-9) break;
      if (!prev || cur.t - prev.t < 1e-9 || g <= prev.t) {
        samples.push({ ...(g <= (prev?.t ?? -1) ? prev : cur), t: g });
      } else {
        const f = Math.max(0, Math.min(1, (g - prev.t) / (cur.t - prev.t)));
        samples.push({
          t: g,
          x: lerp(prev.x, cur.x, f),
          y: lerp(prev.y, cur.y, f),
          z: lerp(prev.z, cur.z, f),
          heading: lerpAngle(prev.heading, cur.heading, f),
          distance: lerp(prev.distance, cur.distance, f),
        });
      }
      added++;
    }
    prev = cur;
    return added;
  };
  return {
    hz,
    samples,
    /**
     * Offer the kart's pose at race time t (call every frame after GO). Frames
     * longer than 1/hz (slow devices, ?simspeed) are filled in by
     * interpolation, so sample i is always the pose at i/hz seconds.
     * Returns how many samples were added.
     */
    record(t, kart) {
      if (!kart?.position || !Number.isFinite(t) || t < 0) return 0;
      if (prev && t < prev.t) return 0;
      return fill(poseOf(t, kart));
    },
    /** Final pose at the finish time so the ghost ends right on the line. */
    finish(t, kart) {
      if (!kart?.position || !Number.isFinite(t)) return;
      if (prev && t < prev.t) return;
      fill(poseOf(t, kart));
      const g = samples.length * step;
      // one extra slot past the line so the replay reaches the finish time
      if (samples.length < cap && g - t < step) samples.push({ ...poseOf(t, kart), t: g });
    },
    get duration() { return samples.length ? samples[samples.length - 1].t : 0; },
  };
}

/* ---------------- packing ---------------- */

const zig = (n) => (n << 1) ^ (n >> 31);
const unzig = (n) => (n >>> 1) ^ -(n & 1);

function pushVarint(bytes, n) {
  let u = zig(n) >>> 0;
  while (u >= 0x80) { bytes.push((u & 0x7f) | 0x80); u >>>= 7; }
  bytes.push(u);
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.slice(i, i + 0x8000));
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'binary').toString('base64');
}

function fromBase64(str) {
  const s = typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const wrapHeadingStep = (d) => ((((d + HEADING_STEPS / 2) % HEADING_STEPS) + HEADING_STEPS) % HEADING_STEPS) - HEADING_STEPS / 2;

/** Quantize one sample to integers [x, y, z, heading, distance]. */
export function quantizeSample(s) {
  const h = Math.round(((((s.heading ?? 0) % TAU) + TAU) % TAU) * QUANT.heading) % HEADING_STEPS;
  return [
    Math.round(s.x * QUANT.pos),
    Math.round(s.y * QUANT.pos),
    Math.round(s.z * QUANT.pos),
    h,
    Math.round((s.distance ?? 0) * QUANT.dist),
  ];
}

/**
 * Pack samples + meta into a storable ghost.
 * @param {Array<{x,y,z,heading,distance}>} samples at `hz`
 * @param {{ trackId, laps, characterId, speedClass, time, hz? }} meta
 */
export function encodeGhost(samples, meta = {}) {
  const hz = meta.hz ?? GHOST_HZ;
  const bytes = [];
  let prev = [0, 0, 0, 0, 0];
  for (const s of samples) {
    const q = quantizeSample(s);
    for (let c = 0; c < 5; c++) {
      let d = q[c] - prev[c];
      if (c === 3) d = wrapHeadingStep(d);
      pushVarint(bytes, d);
    }
    prev = q;
  }
  return {
    v: GHOST_VERSION,
    trackId: meta.trackId ?? null,
    laps: meta.laps ?? null,
    characterId: meta.characterId ?? null,
    speedClass: meta.speedClass ?? null,
    time: meta.time ?? null,
    hz,
    n: samples.length,
    data: toBase64(bytes),
  };
}

/**
 * Unpack a stored ghost. Returns null for anything malformed.
 * @returns {{ meta: object, hz: number, n: number, x: Float32Array, y: Float32Array, z: Float32Array,
 *   heading: Float32Array, distance: Float32Array, duration: number } | null}
 */
export function decodeGhost(ghost) {
  if (!ghost || ghost.v !== GHOST_VERSION || typeof ghost.data !== 'string') return null;
  const n = ghost.n | 0;
  const hz = Number(ghost.hz) > 0 ? Number(ghost.hz) : GHOST_HZ;
  if (n <= 0 || n > GHOST_MAX_SECONDS * hz + 2) return null;
  let bytes;
  try { bytes = fromBase64(ghost.data); } catch { return null; }
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const acc = [0, 0, 0, 0, 0];
  let p = 0;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 5; c++) {
      let u = 0;
      let shift = 0;
      let b;
      do {
        if (p >= bytes.length) return null;
        b = bytes[p++];
        u |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80 && shift < 35);
      acc[c] += unzig(u >>> 0);
      if (c === 3) acc[c] = ((acc[c] % HEADING_STEPS) + HEADING_STEPS) % HEADING_STEPS;
    }
    ch[0][i] = acc[0] / QUANT.pos;
    ch[1][i] = acc[1] / QUANT.pos;
    ch[2][i] = acc[2] / QUANT.pos;
    ch[3][i] = acc[3] / QUANT.heading;
    ch[4][i] = acc[4] / QUANT.dist;
  }
  const { data, ...meta } = ghost;
  return { meta, hz, n, x: ch[0], y: ch[1], z: ch[2], heading: ch[3], distance: ch[4], duration: (n - 1) / hz };
}

/* ---------------- replay ---------------- */

const lerp = (a, b, f) => a + (b - a) * f;
function lerpAngle(a, b, f) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * f;
}

/**
 * The ghost's pose at race time t (clamped to the run). Writes into `out`.
 * @returns {{ x, y, z, heading, distance, done: boolean, speed: number }}
 */
export function ghostPoseAt(g, t, out = {}) {
  const last = g.n - 1;
  const f = Math.max(0, t) * g.hz;
  const i = Math.min(last, Math.floor(f));
  const j = Math.min(last, i + 1);
  const k = i === j ? 0 : Math.min(1, f - i);
  out.x = lerp(g.x[i], g.x[j], k);
  out.y = lerp(g.y[i], g.y[j], k);
  out.z = lerp(g.z[i], g.z[j], k);
  out.heading = lerpAngle(g.heading[i], g.heading[j], k);
  out.distance = lerp(g.distance[i], g.distance[j], k);
  out.done = f >= last;
  out.speed = i === j ? 0 : Math.hypot(g.x[j] - g.x[i], g.z[j] - g.z[i]) * g.hz;
  return out;
}

/**
 * Seconds the ghost needed to reach `distance` (interpolated), or null when
 * it never got that far / before the line.
 */
export function ghostTimeAtDistance(g, distance) {
  if (!g || !Number.isFinite(distance)) return null;
  const d = g.distance;
  if (distance <= d[0]) return 0;
  if (distance > d[g.n - 1]) return null;
  // distance is (almost) monotonic: binary search the first sample >= distance
  let lo = 0;
  let hi = g.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid] < distance) lo = mid + 1; else hi = mid;
  }
  if (lo === 0) return 0;
  const a = d[lo - 1];
  const b = d[lo];
  const k = b > a ? (distance - a) / (b - a) : 0;
  return (lo - 1 + k) / g.hz;
}

/**
 * Gap to the ghost in seconds for a kart at `distance` at race time `t`:
 * negative = you are ahead of your ghost, positive = behind. null when unknown.
 */
export function ghostGap(g, t, distance) {
  if (!g || !Number.isFinite(t) || !(t > 0.5)) return null;
  const tg = ghostTimeAtDistance(g, distance);
  if (tg === null) return distance > g.distance[g.n - 1] ? t - g.duration : null;
  return t - tg;
}

/* ---------------- storage ---------------- */

/** Should `time` replace the saved ghost? (faster, or nothing saved yet) */
export function isBetterRun(time, saved) {
  if (!(Number.isFinite(time) && time > 0)) return false;
  return !saved || !(Number.isFinite(saved.time) && saved.time > 0) || time < saved.time;
}

/** Best-run ghosts per track and lap count. */
export function createGhostStore(backend = defaultBackend()) {
  const store = jsonStore(GHOST_KEY, backend);
  return {
    /** The saved ghost (packed) for a track + laps, or null. */
    load(trackId, laps) {
      const g = store.read()[trackId]?.[String(laps)];
      return g && g.v === GHOST_VERSION ? g : null;
    },
    /** Save a packed ghost if it beats the saved one. Returns true if saved. */
    offer(ghost) {
      if (!ghost?.trackId || !Number.isFinite(ghost.laps)) return false;
      const saved = this.load(ghost.trackId, ghost.laps);
      if (!isBetterRun(ghost.time, saved)) return false;
      const all = store.read();
      all[ghost.trackId] = { ...(all[ghost.trackId] || {}), [String(ghost.laps)]: ghost };
      return store.write(all);
    },
    clear: () => store.clear(),
  };
}

/** The shared instance (browser localStorage). */
export const ghostStore = createGhostStore();
