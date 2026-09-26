/**
 * Presentation preferences ("✨ Effects & comfort"): how much sparkle, wobble
 * and chatter the game shows. OWNER: showcase presentation.
 *
 *   import { prefs, effectivePrefs } from '../presentation/prefs.js';
 *   const fx = effectivePrefs(prefs.get());   // { gentle, shake, flourishes, particleScale, ... }
 *   const off = prefs.subscribe((p) => ...);  // called after every change
 *   prefs.set({ bubbles: false });
 *
 * Saved in its own localStorage key (never inside the progress save, so a
 * "fresh Sticker Book" keeps the comfort settings). The first time, "Gentle
 * motion" follows the device's `prefers-reduced-motion` setting.
 * Everything is safe when storage or window are missing (node tests, private
 * windows): the store simply lives in memory.
 */

export const PREFS_KEY = 'sprinkle-kart-presentation-v1';

/** Rows of the Effects screen, in order. */
export const PREF_ROWS = Object.freeze(['motion', 'shake', 'bubbles', 'weather', 'attract', 'colorAssist']);

/** 'full' = every sparkle and camera swoop; 'gentle' = reduced motion. */
export const MOTION_MODES = Object.freeze(['full', 'gentle']);

export const DEFAULT_PREFS = Object.freeze({
  motion: 'full',
  shake: true,
  bubbles: true,
  weather: true,
  attract: true,
  colorAssist: false,
});

const BOOL_KEYS = ['shake', 'bubbles', 'weather', 'attract', 'colorAssist'];

/**
 * Clean up anything (old saves, junk, partial objects) into a full prefs object.
 * @param {any} raw
 * @param {{ reducedMotion?: boolean }} [env] device prefers reduced motion (used only when motion is unset)
 */
export function normalizePrefs(raw, { reducedMotion = false } = {}) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { ...DEFAULT_PREFS };
  out.motion = MOTION_MODES.includes(src.motion) ? src.motion : reducedMotion ? 'gentle' : 'full';
  for (const k of BOOL_KEYS) if (typeof src[k] === 'boolean') out[k] = src[k];
  return out;
}

/**
 * What the systems actually use. Gentle motion switches off the big camera
 * moves and wobbles and halves the particles, whatever the other toggles say.
 * @param {typeof DEFAULT_PREFS} p
 */
export function effectivePrefs(p) {
  const n = normalizePrefs(p);
  const gentle = n.motion === 'gentle';
  return {
    gentle,
    shake: n.shake && !gentle,
    flourishes: !gentle,
    particleScale: gentle ? 0.5 : 1,
    bubbles: n.bubbles,
    weather: n.weather,
    attract: n.attract,
    colorAssist: n.colorAssist,
  };
}

/** Does the device ask for reduced motion? (false without window / matchMedia) */
export function deviceReducedMotion(win = typeof window !== 'undefined' ? window : null) {
  try { return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * A small observable prefs store.
 * @param {{ storage?: Storage|null, reducedMotion?: boolean, key?: string }} [opts]
 */
export function createPrefsStore({ storage = defaultStorage(), reducedMotion = deviceReducedMotion(), key = PREFS_KEY } = {}) {
  let current = null;
  const listeners = new Set();

  const load = () => {
    let raw = null;
    try {
      const txt = storage?.getItem?.(key);
      raw = txt ? JSON.parse(txt) : null;
    } catch { raw = null; }
    return normalizePrefs(raw, { reducedMotion });
  };
  const save = (p) => {
    try { storage?.setItem?.(key, JSON.stringify(p)); } catch { /* storage full / blocked: keep it in memory */ }
  };
  const notify = () => {
    for (const fn of [...listeners]) {
      try { fn(current); } catch (err) { console.warn('[prefs] listener failed', err); }
    }
  };

  return {
    /** The current prefs (a fresh copy). */
    get() {
      if (!current) current = load();
      return { ...current };
    },
    /** Merge a patch, save and tell the listeners. Returns the new prefs. */
    set(patch = {}) {
      if (!current) current = load();
      const next = normalizePrefs({ ...current, ...patch }, { reducedMotion });
      const changed = Object.keys(next).some((k) => next[k] !== current[k]);
      current = next;
      if (changed) { save(current); notify(); }
      return { ...current };
    },
    /** Back to the defaults (motion follows the device again). */
    reset() {
      try { storage?.removeItem?.(key); } catch { /* ignore */ }
      current = normalizePrefs(null, { reducedMotion });
      notify();
      return { ...current };
    },
    /** fn(prefs) after every change; returns unsubscribe. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Forget the cached copy (tests / another tab changed storage). */
    reload() { current = null; return this.get(); },
  };
}

/** The game's shared store. */
export const prefs = createPrefsStore();
