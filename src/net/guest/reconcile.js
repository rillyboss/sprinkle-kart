/**
 * Local-kart prediction and reconciliation (NETWORKING.md §9.6).
 *
 * The guest's own karts are simulated together by `predictTick(localKarts, inputs, ctx)` (WS1, §8.5) every
 * predicted tick with the local inputs, so there is no input delay. On each snapshot (tick S) carrying this
 * house's owner tail:
 *   1. remember each local kart's drawn pose (predicted pose + current visual offset),
 *   2. set the local karts to the snapshot state (quantised hot fields + owner-only phys),
 *   3. replay the stored inputs for ticks S+1 … P for all local karts jointly, with `emit` a no-op
 *      (a predicted hop/drift/boost fires once, the first time its tick is predicted, never on replay),
 *   4. the difference between the old drawn pose and the new predicted pose becomes a visual error offset
 *      that decays exponentially (τ = 100 ms, heading τ = 80 ms). It snaps (no smoothing) when the error is
 *      > 4 m, the heading error > 0.6 rad, or the snapshot's teleport flag is set.
 *
 * `applyKartRecord` writes a decoded snapshot kart record (+ owner phys) onto a kart object; the replica
 * uses it for remote karts too (without owner phys).
 */
export const RECONCILE_TAU_MS = 100;
export const HEADING_TAU_MS = 80;
export const SNAP_DIST = 4;
export const SNAP_HEADING = 0.6;

const TAU = Math.PI * 2;
const wrap = (a) => { let x = (a + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; };

/** Hot fields every machine sees (kart block of §6.1). */
export function applyKartRecord(kart, rec, owner = null, path = null) {
  kart.position.set(rec.position[0], rec.position[1], rec.position[2]);
  kart.velocity.set(rec.velocity[0], rec.velocity[1] || 0, rec.velocity[2]);
  kart.heading = rec.heading;
  kart.speed = rec.speed;
  kart.distance = rec.distance;
  kart.progress = rec.distance;
  kart.lap = Math.max(1, rec.lap);
  kart.boosting = rec.boosting;
  kart.spinning = rec.spinning;
  kart.shielded = rec.shielded;
  kart.drifting = rec.drifting;
  kart.driftLevel = rec.driftLevel;
  kart.driftDir = rec.driftDir;
  kart.starPower = rec.starPower;
  kart.offRoad = rec.offRoad;
  kart.wrongWay = rec.wrongWay;
  kart.battleOut = rec.battleOut;
  kart.item = rec.item;
  kart.itemCharges = rec.itemCharges;
  kart.itemRoulette = rec.itemRoulette;
  kart.roboDriven = rec.roboDriven;
  const p = kart.phys;
  const rp = rec.phys;
  p.boostTime = rp.boostTime;
  p.spinTime = rp.spinTime;
  p.shieldTime = rp.shieldTime;
  p.hopTime = rp.hopTime;
  p.hopY = rp.hopY;
  p.spinAngle = rp.spinAngle;
  p.driftCharge = rp.driftCharge;
  p.steerSmoothed = rp.steerSmoothed;
  p.slide = rp.slide;
  p.pitch = rp.pitch;
  p.roll = rp.roll;
  p.throttle = rp.throttle;
  p.braking = rp.braking;
  p.reversing = rp.reversing;
  if (owner) {
    const o = owner.phys;
    p.driftHeld = o.driftHeld;
    p.prevAccel = o.prevAccel;
    p.driftWindow = o.driftWindow;
    p.hopLen = o.hopLen > 0 ? o.hopLen : p.hopLen;
    p.onPad = o.onPad;
    p.wallCooldown = o.wallCooldown;
    p.accelPressedAt = o.accelPressedAt;
    p.slideDir = o.slideDir;
    p.wrongWayTime = o.wrongWayTime;
    p.lastLapStart = o.lastLapStart;
    p.driftTime = o.driftTime;
    p.groundY = o.groundY;
    p.pendingItem = o.pendingItem;
    p.rouletteTime = o.rouletteTime;
    if (Number.isFinite(owner.aiSpeedMult)) kart.aiSpeedMult = owner.aiSpeedMult;
  } else {
    p.groundY = rec.position[1] - rp.hopY;
  }
  // s / lateral are derived: s = wrap(distance) (measured exact), lateral from projecting the position.
  if (path) {
    kart.s = path.wrap(rec.distance);
    const pr = path.project(kart.position, kart.s);
    kart.s = pr.s;
    kart.lateral = pr.lateral;
  }
}

/**
 * @param {{ tauMs?: number, headingTauMs?: number, snapDist?: number, snapHeading?: number, keepErrors?: number }} [o]
 */
export function createReconciler({
  tauMs = RECONCILE_TAU_MS, headingTauMs = HEADING_TAU_MS, snapDist = SNAP_DIST, snapHeading = SNAP_HEADING, keepErrors = 4096,
} = {}) {
  const offsets = new Map(); // kartId → { x, y, z, h }
  const errors = []; // { tick, kart, err } raw correction magnitudes
  const stats = { corrections: 0, snaps: 0, replays: 0, replayedTicks: 0 };
  const off = (id) => { let o = offsets.get(id); if (!o) { o = { x: 0, y: 0, z: 0, h: 0 }; offsets.set(id, o); } return o; };

  /** The pose a kart is drawn at (predicted pose + offset). */
  function drawn(kart) {
    const o = off(kart.id);
    return { x: kart.position.x + o.x, y: kart.position.y + o.y, z: kart.position.z + o.z, heading: wrap(kart.heading + o.h) };
  }

  return {
    drawn,
    offset(id) { return { ...off(id) }; },
    /**
     * Reconcile the local karts against snapshot `snap` and replay to `toTick`.
     * @param {object} o
     * @param {object[]} o.karts          local predicted karts (not Robo-driven)
     * @param {object} o.snap             decoded snapshot (karts[], owner[], flags, tick)
     * @param {(tick: number) => object[]|null} o.inputsFor   resolved DriveInputs for those karts at `tick`
     * @param {number} o.toTick           P (last predicted tick)
     * @param {(karts: object[], inputs: object[], ctx: object) => void} o.predictTick
     * @param {(tick: number) => object} o.ctxFor   predictTick ctx for a tick (its emit is replaced by a no-op)
     * @param {boolean} [o.forceSnap]     snap instead of smoothing (Robo Driver hand-back)
     * @param {object} [o.path]           TrackPath, to derive s / lateral from the snapshot
     * @returns {{ errors: Array<{ kart: number, err: number, snapped: boolean }> }}
     */
    reconcile({ karts, snap, inputsFor, toTick, predictTick, ctxFor, forceSnap = false, path = null }) {
      if (!karts.length) return { errors: [] };
      const before = karts.map((k) => ({ drawn: drawn(k), pos: { x: k.position.x, y: k.position.y, z: k.position.z }, heading: k.heading }));
      const ownerById = new Map((snap.owner || []).map((o) => [o.kart, o]));
      for (const k of karts) {
        const rec = snap.karts[k.id];
        if (rec) applyKartRecord(k, rec, ownerById.get(k.id) || null, path);
      }
      let replayed = 0;
      for (let t = snap.tick + 1; t <= toTick; t++) {
        const inputs = inputsFor(t);
        if (!inputs) continue;
        const ctx = { ...ctxFor(t), emit: () => {} };
        predictTick(karts, inputs, ctx);
        replayed++;
      }
      stats.replays++;
      stats.replayedTicks += replayed;
      const out = [];
      karts.forEach((k, i) => {
        const b = before[i];
        const err = Math.hypot(b.pos.x - k.position.x, b.pos.z - k.position.z);
        const hErr = Math.abs(wrap(b.heading - k.heading));
        const o = off(k.id);
        const dx = b.drawn.x - k.position.x;
        const dy = b.drawn.y - k.position.y;
        const dz = b.drawn.z - k.position.z;
        const dh = wrap(b.drawn.heading - k.heading);
        const snapIt = forceSnap || snap.flags?.teleport || err > snapDist || hErr > snapHeading || Math.hypot(dx, dz) > snapDist;
        if (snapIt) { o.x = 0; o.y = 0; o.z = 0; o.h = 0; stats.snaps++; } else { o.x = dx; o.y = dy; o.z = dz; o.h = dh; }
        stats.corrections++;
        errors.push({ tick: snap.tick, kart: k.id, err, snapped: snapIt });
        if (errors.length > keepErrors) errors.shift();
        out.push({ kart: k.id, err, snapped: snapIt });
      });
      return { errors: out };
    },
    /** Decay every offset by `dtMs`. */
    decay(dtMs) {
      const k = Math.exp(-Math.max(0, dtMs) / tauMs);
      const kh = Math.exp(-Math.max(0, dtMs) / headingTauMs);
      for (const o of offsets.values()) { o.x *= k; o.y *= k; o.z *= k; o.h *= kh; }
    },
    /** Forget a kart's offset (it snaps). */
    clear(id) { offsets.delete(id); },
    /** Recent raw correction magnitudes (m). */
    errors() { return errors.slice(); },
    /** p-th percentile (0..1) of recent corrections. */
    percentile(p, filter = () => true) {
      const e = errors.filter(filter).map((x) => x.err).sort((a, b) => a - b);
      return e.length ? e[Math.min(e.length - 1, Math.floor(p * (e.length - 1)))] : 0;
    },
    stats,
  };
}
