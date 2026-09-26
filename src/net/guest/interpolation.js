/**
 * Remote interpolation (NETWORKING.md §9.5). Everything that is not one of this machine's own karts —
 * remote players, CPUs, gumdrops, rockets — is drawn at the render time R, in the past, between two
 * snapshots that bracket it:
 *
 *   R = T_est − oneWay − interpDelay        (T_est = host present, so R trails the newest arrivable snapshot)
 *
 * - `createSnapshotBuffer({ capacity: 32 })`: decoded snapshots by tick; reordered/duplicate packets are
 *   inserted or ignored by tick; anything older than the one bracketing R is pruned.
 * - Karts: cubic Hermite between the two snapshots using position + velocity (smooth at 30 Hz), heading by
 *   shortest-arc slerp, discrete fields (timers, flags, item) step at the older snapshot.
 * - Starved (no snapshot beyond R): extrapolate with velocity up to 250 ms, then freeze; when data resumes
 *   the pose blends back (no pop). While the host is paused R is frozen too (the caller freezes T_est).
 * - Adaptive delay: interpDelay = clamp(2 × interval + 2 × jitter + lossAllowance + one render frame, 70, 150)
 *   where lossAllowance = 33 ms when measured loss > 2 %; it moves ≤ 1 ms per 100 ms; it starts at 100 ms.
 *   (The render-frame headroom — 16.7 ms — covers sampling R at an arbitrary phase between snapshots.)
 */
export const INTERP_START_MS = 100;
export const INTERP_MIN_MS = 70;
export const INTERP_MAX_MS = 150;
export const INTERP_SLEW_PER_100MS = 1;
export const MAX_EXTRAPOLATION_MS = 250;
export const LOSS_ALLOWANCE_MS = 33;
export const FRAME_HEADROOM_MS = 1000 / 60;
export const BLEND_TAU_MS = 100;

const TAU = Math.PI * 2;
export const wrapAngle = (a) => { let x = (a + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; };
/** Shortest-arc interpolation between two headings. */
export const slerpAngle = (a, b, t) => wrapAngle(a + wrapAngle(b - a) * t);

/**
 * Cubic Hermite between p0 (velocity v0) and p1 (velocity v1) over `dt` seconds, at t in [0, 1].
 */
export function hermite(p0, v0, p1, v1, t, dt) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * p0 + h10 * dt * v0 + h01 * p1 + h11 * dt * v1;
}

export function createSnapshotBuffer({ capacity = 32 } = {}) {
  const list = []; // sorted by tick ascending
  const stats = { inserted: 0, dup: 0, old: 0 };
  return {
    /** @returns {boolean} true when it was new */
    insert(snap) {
      const t = snap.tick;
      let i = list.length;
      while (i > 0 && list[i - 1].tick > t) i--;
      if (i > 0 && list[i - 1].tick === t) { stats.dup++; return false; }
      if (list.length >= capacity && i === 0) { stats.old++; return false; }
      list.splice(i, 0, snap);
      while (list.length > capacity) list.shift();
      stats.inserted++;
      return true;
    },
    /** Drop snapshots that can never bracket R again (keep the newest one at or before R). */
    prune(renderTick) {
      let keepFrom = 0;
      for (let i = 0; i < list.length; i++) if (list[i].tick <= renderTick) keepFrom = i;
      if (keepFrom > 0) list.splice(0, keepFrom);
    },
    /**
     * The snapshots around R: { a, b, t } with a.tick <= R < b.tick (t in [0, 1)), or { a: newest, b: null }
     * when R is past the newest (extrapolate), or { a: null, b: oldest } when R is before everything.
     */
    bracket(renderTick) {
      if (!list.length) return { a: null, b: null, t: 0 };
      if (renderTick < list[0].tick) return { a: null, b: list[0], t: 0 };
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].tick <= renderTick) {
          const a = list[i];
          const b = list[i + 1] || null;
          return { a, b, t: b ? (renderTick - a.tick) / (b.tick - a.tick) : 0 };
        }
      }
      return { a: null, b: list[0], t: 0 };
    },
    get newest() { return list.length ? list[list.length - 1] : null; },
    get oldest() { return list.length ? list[0] : null; },
    get size() { return list.length; },
    stats,
  };
}

/**
 * Snapshot arrival statistics: interval, jitter, loss and bursts (from the ticks that arrived).
 */
export function createArrivalStats({ tickMs = 1000 / 60, window = 64 } = {}) {
  const arrivals = []; // { tick, dev }
  const gaps = [];
  let newestTick = null;
  let jitterMs = 0;
  let lastBurst = 0;
  const seen = [];
  return {
    onSnapshot(tick, recvMs) {
      const dev = recvMs - tick * tickMs;
      arrivals.push({ tick, dev });
      if (arrivals.length > window) arrivals.shift();
      let min = Infinity;
      for (const a of arrivals) if (a.dev < min) min = a.dev;
      jitterMs += ((dev - min) - jitterMs) / 8;
      if (newestTick !== null && tick > newestTick) {
        const g = tick - newestTick;
        gaps.push(g);
        if (gaps.length > 16) gaps.shift();
        const interval = Math.min(...gaps);
        const missing = Math.round(g / interval) - 1;
        lastBurst = missing;
      }
      if (newestTick === null || tick > newestTick) newestTick = tick;
      seen.push(tick);
      if (seen.length > 90) seen.shift();
    },
    /** Snapshot interval in ms (the smallest recent tick gap: loss does not inflate it). */
    get intervalMs() { return (gaps.length ? Math.min(...gaps) : 2) * tickMs; },
    get jitterMs() { return jitterMs; },
    /** Missing snapshots in the most recent gap (a burst when >= 2). */
    get lastBurst() { return lastBurst; },
    /** Loss % over the recent window. */
    get lossPct() {
      if (seen.length < 10 || !gaps.length) return 0;
      const interval = Math.min(...gaps);
      const lo = Math.min(...seen);
      const hi = Math.max(...seen);
      const expected = Math.round((hi - lo) / interval) + 1;
      const got = new Set(seen).size;
      return Math.max(0, (100 * (expected - got)) / expected);
    },
  };
}

/** The adaptive interpolation delay (ms). */
export function createInterpDelay({
  startMs = INTERP_START_MS, minMs = INTERP_MIN_MS, maxMs = INTERP_MAX_MS, slewPer100 = INTERP_SLEW_PER_100MS,
} = {}) {
  let delay = startMs;
  let target = startMs;
  return {
    /** @param {number} dtMs local time since the last update */
    update(dtMs, { intervalMs = 1000 / 30, jitterMs = 0, lossPct = 0 } = {}) {
      target = Math.max(minMs, Math.min(maxMs,
        2 * intervalMs + 2 * jitterMs + (lossPct > 2 ? LOSS_ALLOWANCE_MS : 0) + FRAME_HEADROOM_MS));
      const step = (slewPer100 * Math.max(0, dtMs)) / 100;
      delay += Math.max(-step, Math.min(step, target - delay));
      return delay;
    },
    get ms() { return delay; },
    get target() { return target; },
  };
}

/**
 * Pose of one kart record at render tick R from the buffer (null if the kart is unknown).
 * Returns { x, y, z, heading, vx, vz, rec, mode: 'interp'|'extrap'|'frozen'|'early' }.
 */
export function sampleKartPose(buffer, kartId, renderTick, { tickMs = 1000 / 60, maxExtrapMs = MAX_EXTRAPOLATION_MS } = {}) {
  const { a, b, t } = buffer.bracket(renderTick);
  if (!a && !b) return null;
  if (!a) {
    const r = b.karts[kartId];
    return r ? { x: r.position[0], y: r.position[1], z: r.position[2], heading: r.heading, vx: r.velocity[0], vz: r.velocity[2], rec: r, snap: b, mode: 'early' } : null;
  }
  const ra = a.karts[kartId];
  if (!ra) return null;
  if (b && b.karts[kartId]) {
    const rb = b.karts[kartId];
    const dt = ((b.tick - a.tick) * tickMs) / 1000;
    const teleport = b.flags?.teleport;
    if (teleport) return { x: rb.position[0], y: rb.position[1], z: rb.position[2], heading: rb.heading, vx: rb.velocity[0], vz: rb.velocity[2], rec: ra, snap: a, mode: 'interp' };
    return {
      x: hermite(ra.position[0], ra.velocity[0], rb.position[0], rb.velocity[0], t, dt),
      z: hermite(ra.position[2], ra.velocity[2], rb.position[2], rb.velocity[2], t, dt),
      y: ra.position[1] + (rb.position[1] - ra.position[1]) * t,
      heading: slerpAngle(ra.heading, rb.heading, t),
      vx: ra.velocity[0] + (rb.velocity[0] - ra.velocity[0]) * t,
      vz: ra.velocity[2] + (rb.velocity[2] - ra.velocity[2]) * t,
      rec: ra, snap: a, mode: 'interp',
    };
  }
  const exMs = (renderTick - a.tick) * tickMs;
  const useMs = Math.min(exMs, maxExtrapMs);
  const s = useMs / 1000;
  return {
    x: ra.position[0] + ra.velocity[0] * s, z: ra.position[2] + ra.velocity[2] * s, y: ra.position[1],
    heading: ra.heading, vx: ra.velocity[0], vz: ra.velocity[2], rec: ra, snap: a, mode: exMs > maxExtrapMs ? 'frozen' : 'extrap',
  };
}

/**
 * Keeps one remote object's drawn pose continuous across mode changes (extrapolated/frozen → interpolated):
 * the jump becomes an offset that decays with τ = 100 ms. A teleport (or a jump > snapDist) snaps.
 */
export function createPoseSmoother({ tauMs = BLEND_TAU_MS, snapDist = 8, popDist = 0.25, popHeading = 0.35 } = {}) {
  let off = { x: 0, y: 0, z: 0, h: 0 };
  let last = null; // drawn pose
  let target = null; // previous target pose (with velocity)
  const stats = { pops: 0, snaps: 0 };
  return {
    /**
     * Any target that moves differently from its own velocity by more than `popDist` in one frame (a switch
     * from extrapolated/frozen to interpolated data, a late snapshot reshaping the curve, a render-time
     * correction) becomes an offset that decays with τ, so the drawn pose never pops. A teleport or a jump
     * beyond `snapDist` snaps.
     * @returns {{ x, y, z, heading }} the pose to draw
     */
    step(pose, dtMs, { teleport = false } = {}) {
      if (!pose) return last;
      const k = Math.exp(-Math.max(0, dtMs) / tauMs);
      off = { x: off.x * k, y: off.y * k, z: off.z * k, h: off.h * k };
      if (teleport) { off = { x: 0, y: 0, z: 0, h: 0 }; stats.snaps++; } else if (target) {
        const s = Math.max(0, dtMs) / 1000;
        const ex = target.x + (target.vx || 0) * s;
        const ez = target.z + (target.vz || 0) * s;
        const dx = pose.x - ex;
        const dz = pose.z - ez;
        const dev = Math.hypot(dx, dz);
        if (dev > snapDist) { off = { x: 0, y: 0, z: 0, h: 0 }; stats.snaps++; } else if (dev > popDist) {
          off.x -= dx; off.z -= dz; off.y -= pose.y - target.y;
          stats.pops++;
        }
        const dh = wrapAngle(pose.heading - target.heading);
        if (Math.abs(dh) > popHeading) off.h -= dh;
      }
      target = { x: pose.x, y: pose.y, z: pose.z, vx: pose.vx, vz: pose.vz, heading: pose.heading };
      last = { x: pose.x + off.x, y: pose.y + off.y, z: pose.z + off.z, heading: wrapAngle(pose.heading + off.h) };
      return last;
    },
    get offset() { return Math.hypot(off.x, off.z); },
    reset() { off = { x: 0, y: 0, z: 0, h: 0 }; last = null; target = null; },
    stats,
  };
}
