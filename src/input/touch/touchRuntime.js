/**
 * The live touch runtime ({ touch, overlay }) installed by src/systems/touchControls.js,
 * for code that is not handed `app` — the touch settings screen, the HUD (phase 2),
 * tests. null until the system installed (and always null in node).
 *
 *   import { getTouchRuntime, getTouchSafeRects } from '../input/touch/touchRuntime.js';
 *   getTouchSafeRects()   // [] when no touch controls are on screen
 */
let runtime = null;

export function setTouchRuntime(rt) {
  runtime = rt || null;
  return runtime;
}

export function getTouchRuntime() {
  return runtime;
}

/** Screen rects covered by visible touch race controls ([] when none) — the HUD avoids them. */
export function getTouchSafeRects() {
  try { return runtime?.overlay?.getTouchSafeRects?.() ?? []; } catch { return []; }
}

/** Should touch-only UI (the Touch settings entry, gesture hints) show? */
export function touchUiWanted() {
  const t = runtime?.touch;
  return !!(t && (t.capable || t.registered));
}
