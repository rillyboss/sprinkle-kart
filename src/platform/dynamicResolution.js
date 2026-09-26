/**
 * Dynamic resolution + frame cap (mobile platform). OWNER: mobile platform. Pure: no DOM, no clock of its own.
 *
 *   const dr = createDynamicResolution({ min: 0.6, max: 1, targetFps: 60 });
 *   each frame: if (dr.sample(frameMs)) renderer.setPixelRatio(pixelRatioFor(q, players, dpr, dr.scale));
 *
 * Holds the frame rate by trading pixels, with hysteresis so it never "breathes":
 *   - the frame time is smoothed (EWMA, alpha 0.1) and compared with the budget 1000 / targetFps;
 *   - slower than budget × 1.2 for `downAfter` s → scale down one `step` (fast reaction, the game stutters);
 *   - faster than budget × 0.8 for `upAfter` s → scale up half a step (slow and careful);
 *   - after any change: `cooldown` s where nothing changes (the new size needs a few frames to settle);
 *   - between the two thresholds nothing accumulates (the dead band);
 *   - frames longer than `spikeMs` (tab switch, GC, shader compile) are ignored entirely.
 * `scale` always stays within [min, max]; min === max means the controller is off.
 *
 *   const cap = createFrameCap(30);  if (!cap.shouldRender(now)) return;  // steady 30 on a 60/120 Hz screen
 */

/**
 * @param {{ min?: number, max?: number, targetFps?: number, step?: number, downAfter?: number,
 *   upAfter?: number, cooldown?: number, spikeMs?: number, start?: number }} [opts]
 */
export function createDynamicResolution({
  min = 0.6, max = 1, targetFps = 60, step = 0.1, downAfter = 0.5, upAfter = 3, cooldown = 1, spikeMs = 250, start,
} = {}) {
  const lo = Math.max(0.25, Math.min(min, max));
  const hi = Math.max(lo, max);
  const clamp = (v) => Math.max(lo, Math.min(hi, v));
  const round = (v) => Math.round(v * 1000) / 1000;
  let budget = 1000 / Math.max(1, targetFps);
  let scale = clamp(start ?? hi);
  let avg = budget;
  let slowFor = 0;
  let fastFor = 0;
  let calm = 0;
  let changes = 0;

  const api = {
    get scale() { return scale; },
    get average() { return avg; },
    get budget() { return budget; },
    get changes() { return changes; },
    get enabled() { return hi > lo; },
    min: lo,
    max: hi,
    /**
     * Feed one frame time (ms). Returns true when `scale` changed.
     * @param {number} frameMs
     */
    sample(frameMs) {
      if (!(hi > lo) || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > spikeMs) return false;
      const sec = frameMs / 1000;
      avg += (frameMs - avg) * 0.1;
      if (calm > 0) { calm -= sec; return false; }
      if (avg > budget * 1.2) { slowFor += sec; fastFor = 0; } else if (avg < budget * 0.8) { fastFor += sec; slowFor = 0; } else { slowFor = 0; fastFor = 0; }
      let next = scale;
      if (slowFor >= downAfter) next = clamp(round(scale - step));
      else if (fastFor >= upAfter) next = clamp(round(scale + step / 2));
      if (next === scale) {
        if (slowFor >= downAfter) slowFor = 0; // pinned at a bound: start counting again
        if (fastFor >= upAfter) fastFor = 0;
        return false;
      }
      scale = next;
      slowFor = 0;
      fastFor = 0;
      calm = cooldown;
      avg = budget; // judge the new size on its own frames
      changes++;
      return true;
    },
    /** New target (e.g. the frame cap changed); keeps the scale. */
    setTarget(fps) { budget = 1000 / Math.max(1, fps); avg = budget; slowFor = 0; fastFor = 0; },
    /** Back to full size (a new race, a new preset). */
    reset(to = hi) { scale = clamp(to); avg = budget; slowFor = 0; fastFor = 0; calm = 0; },
  };
  return api;
}

/**
 * Render at most `fps` times per second on a faster display (rAF timestamps in ms). fps >= 55 → no cap.
 * A 4 ms tolerance keeps a 60 Hz screen at an even 30 (every other frame) despite rAF jitter.
 * @param {number} fps
 */
export function createFrameCap(fps = 60) {
  let interval = fps >= 55 ? 0 : 1000 / Math.max(1, fps);
  let last = -Infinity;
  return {
    get fps() { return interval ? 1000 / interval : 0; },
    set(nextFps) { interval = nextFps >= 55 ? 0 : 1000 / Math.max(1, nextFps); },
    /** @param {number} now rAF timestamp (ms) */
    shouldRender(now) {
      if (!interval) { last = now; return true; }
      if (now - last >= interval - 4) {
        // keep the phase (no drift), but never fall more than one interval behind
        last = now - last > interval * 2 ? now : last + interval;
        return true;
      }
      return false;
    },
  };
}
