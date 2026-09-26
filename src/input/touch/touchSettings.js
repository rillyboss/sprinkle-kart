/**
 * Touch-control preferences (per browser, localStorage key `sprinkle-kart.touch.v1`).
 *
 *   style        'joystick' (floating analog stick) | 'buttons' (big ◀ ▶) | 'tilt' (steer by tilting)
 *   autoGas      true  → the kart always drives forward (hold BRAKE to slow / reverse)
 *   size         'small' | 'medium' | 'large'  (button + stick scale)
 *   leftHanded   true  → swap sides: buttons on the left, steering on the right
 *   twoPlayers   true  → a tablet can seat TWO touch players (left half / right half)
 *   haptics      true  → short vibrations on bonks, item use, boosts (where supported)
 *   opacity      0.35..1 control transparency
 *   tiltNeutral  calibrated "straight ahead" wheel angle in degrees
 *
 * Everything is optional in storage; normalizeTouchSettings() fills and clamps.
 */

export const TOUCH_SETTINGS_KEY = 'sprinkle-kart.touch.v1';
export const CONTROL_STYLES = Object.freeze(['joystick', 'buttons', 'tilt']);
export const CONTROL_SIZES = Object.freeze(['small', 'medium', 'large']);
export const SIZE_SCALE = Object.freeze({ small: 0.82, medium: 1, large: 1.2 });

export const DEFAULT_TOUCH_SETTINGS = Object.freeze({
  style: 'joystick',
  autoGas: true,
  size: 'medium',
  leftHanded: false,
  twoPlayers: false,
  haptics: true,
  opacity: 0.8,
  tiltNeutral: 0,
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function normalizeTouchSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_TOUCH_SETTINGS;
  return {
    style: CONTROL_STYLES.includes(s.style) ? s.style : d.style,
    autoGas: typeof s.autoGas === 'boolean' ? s.autoGas : d.autoGas,
    size: CONTROL_SIZES.includes(s.size) ? s.size : d.size,
    leftHanded: typeof s.leftHanded === 'boolean' ? s.leftHanded : d.leftHanded,
    twoPlayers: typeof s.twoPlayers === 'boolean' ? s.twoPlayers : d.twoPlayers,
    haptics: typeof s.haptics === 'boolean' ? s.haptics : d.haptics,
    opacity: Number.isFinite(s.opacity) ? clamp(s.opacity, 0.35, 1) : d.opacity,
    tiltNeutral: Number.isFinite(s.tiltNeutral) ? clamp(s.tiltNeutral, -180, 180) : d.tiltNeutral,
  };
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadTouchSettings(storage = defaultStorage()) {
  try {
    const txt = storage?.getItem?.(TOUCH_SETTINGS_KEY);
    return normalizeTouchSettings(txt ? JSON.parse(txt) : null);
  } catch {
    return normalizeTouchSettings(null);
  }
}

export function saveTouchSettings(settings, storage = defaultStorage()) {
  const s = normalizeTouchSettings(settings);
  try { storage?.setItem?.(TOUCH_SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode: keep in memory */ }
  return s;
}

/**
 * A tiny observable store so the overlay, the input device and the settings screen share
 * one copy: store.get(), store.set(patch) → saved copy, store.subscribe(fn) → unsubscribe.
 */
export function createTouchSettingsStore(storage = defaultStorage()) {
  let current = loadTouchSettings(storage);
  const subs = new Set();
  return {
    get: () => current,
    set(patch = {}) {
      current = saveTouchSettings({ ...current, ...patch }, storage);
      for (const fn of [...subs]) { try { fn(current); } catch (err) { console.error(err); } }
      return current;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
