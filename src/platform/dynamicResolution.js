/**
 * Dynamic resolution + frame cap (mobile platform). OWNER: mobile platform. Pure: no DOM, no clock of its own.
 *
 *   const dr = createDynamicResolution({ min: 0.6, max: 1, targetFps: 60 });
 *   each frame: if (dr.sample(frameMs)) renderer.setPixelRatio(pixelRatioFor(q, players, dpr, dr.scale));
 *
 * Holds the frame rate by trading pixels, with hysteresis so it never "breathes":
 *   - the frame time is smoothed (EWMA, alpha 0.1) and compared with the budget 1000 / targetFps;
 *   - slower than budget × 1.25 for `downAfter` s → scale down one `step` (fast reaction, the game stutters);
 *   - on budget (≤ × 1.1) for `upAfter` s → PROBE half a step up. The display's vsync hides spare time
 *     (a fast frame still waits for the next refresh), so going up is a careful probe: if the game turns slow
 *     right after it, the wait before the next probe doubles (up to `maxUpAfter` s) — no ping-pong;
 *   - after any change: `cooldown` s where nothing changes (the new size needs a few frames to settle);
 *   - between the two thresholds nothing accumulates (the dead band);
 *   - frames longer than `spikeMs` (tab switch, GC, shader compile) are ignored entirely.
 * `scale` always stays within [min, max]; min === max means the controller is off.
 *
 *   const cap = createFrameCap(30);  if (!cap.shouldRender(now)) return;  // steady 30 on a 60/120 Hz screen
 */

/**
 * @param {{ min?: number, max?: number, targetFps?: number, step?: number, downAfter?: number,
 *   upAfter?: number, maxUpAfter?: number, cooldown?: number, spikeMs?: number, start?: number }} [opts]
 */
export function createDynamicResolution({
  min = 0.6, max = 1, targetFps = 60, step = 0.1, downAfter = 0.5, upAfter = 3, maxUpAfter = 32, cooldown = 1, spikeMs = 250, start,
} = {}) {
  const lo = Math.max(0.25, Math.min(min, max));
  const hi = Math.max(lo, max);
  const clamp = (v) => Math.max(lo, Math.min(hi, v));
  const round = (v) => Math.round(v * 1000) / 1000;
  let budget = 1000 / Math.max(1, targetFps);
  let scale = clamp(start ?? hi);
  let avg = budget;
  let slowFor = 0;
  let goodFor = 0;
  let calm = 0;
  let changes = 0;
  let upWait = upAfter;
  let sinceUp = Infinity; // seconds since the last step UP (a probe)

  const api = {
    get scale() { return scale; },
    get average() { return avg; },
    get budget() { return budget; },
    get changes() { return changes; },
    get upWait() { return upWait; },
    get enabled() { return hi > lo; },
    min: lo,
    max: hi,
    /**
     * Feed one frame time (ms between rendered frames). Returns true when `scale` changed.
     * @param {number} frameMs
     */
    sample(frameMs) {
      if (!(hi > lo) || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > spikeMs) return false;
      const sec = frameMs / 1000;
      avg += (frameMs - avg) * 0.1;
      sinceUp += sec;
      if (calm > 0) { calm -= sec; return false; }
      if (avg > budget * 1.25) { slowFor += sec; goodFor = 0; } else if (avg <= budget * 1.1) { goodFor += sec; slowFor = 0; } else { slowFor = 0; goodFor = 0; }
      let next = scale;
      let up = false;
      if (slowFor >= downAfter) next = clamp(round(scale - step));
      else if (goodFor >= upWait) { next = clamp(round(scale + step / 2)); up = true; }
      if (next === scale) {
        if (slowFor >= downAfter) slowFor = 0; // pinned at a bound: start counting again
        if (goodFor >= upWait) goodFor = 0;
        return false;
      }
      // Too slow right after a probe up: that size is too much, wait longer before the next probe.
      if (!up && sinceUp < upWait + cooldown + downAfter + 1) upWait = Math.min(maxUpAfter, upWait * 2);
      sinceUp = up ? 0 : Infinity;
      scale = next;
      slowFor = 0;
      goodFor = 0;
      calm = cooldown;
      avg = budget; // judge the new size on its own frames
      changes++;
      return true;
    },
    /** New target (e.g. the frame cap changed); keeps the scale. */
    setTarget(fps) { budget = 1000 / Math.max(1, fps); avg = budget; slowFor = 0; goodFor = 0; },
    /** Back to full size (a new race, a new preset). */
    reset(to = hi) { scale = clamp(to); avg = budget; slowFor = 0; goodFor = 0; calm = 0; upWait = upAfter; sinceUp = Infinity; },
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
