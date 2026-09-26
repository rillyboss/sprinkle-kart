/**
 * The saved Graphics choice ('auto' | 'low' | 'medium' | 'high'). OWNER: mobile platform.
 *
 *   import { graphicsPrefs } from './qualityPrefs.js';
 *   graphicsPrefs.get()              // { quality: 'auto' }
 *   graphicsPrefs.set({ quality: 'low' })
 *   const off = graphicsPrefs.subscribe((p) => ...)
 *
 * Its own localStorage key (never inside the progress save, so "fresh Sticker Book" keeps it), and safe
 * when storage is missing or throws (private windows, node tests): the store then lives in memory.
 */
import { isQualityChoice } from './quality.js';

export const GRAPHICS_KEY = 'sprinkle-kart-graphics-v1';
export const DEFAULT_GRAPHICS = Object.freeze({ quality: 'auto' });

/** Junk in, a full prefs object out. */
export function normalizeGraphics(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { quality: isQualityChoice(src.quality) ? src.quality : DEFAULT_GRAPHICS.quality };
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** @param {{ storage?: Storage|null, key?: string }} [opts] */
export function createGraphicsPrefs({ storage = defaultStorage(), key = GRAPHICS_KEY } = {}) {
  let current = null;
  const subs = new Set();
  const load = () => {
    let raw = null;
    try { raw = storage ? JSON.parse(storage.getItem(key) || 'null') : null; } catch { raw = null; }
    return normalizeGraphics(raw);
  };
  return {
    get() { current ??= load(); return { ...current }; },
    set(patch = {}) {
      current = normalizeGraphics({ ...this.get(), ...patch });
      try { storage?.setItem(key, JSON.stringify(current)); } catch { /* memory only */ }
      for (const fn of [...subs]) { try { fn({ ...current }); } catch { /* a bad subscriber never blocks others */ } }
      return { ...current };
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}

export const graphicsPrefs = createGraphicsPrefs();
