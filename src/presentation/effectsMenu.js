/**
 * Pure reducer for the "✨ Effects & comfort" screen (src/ui/screens/effects.js).
 *
 *   let st = createEffectsState(prefs.get());
 *   const res = effectsReduce(st, { action: 'down' });  // -> { state, fx: ['move'], patch: null, go: null }
 *
 * Rows = PREF_ROWS + 'back'. Up/Down pick a row (wrapping), Left/Right/A
 * change it (A on "Back" leaves), `select` (mouse) picks + changes a row,
 * B leaves. `patch` is what to hand to prefs.set().
 */
import { PREF_ROWS, MOTION_MODES, normalizePrefs } from './prefs.js';

export const EFFECTS_ROWS = Object.freeze([...PREF_ROWS, 'back']);

export function createEffectsState(p = {}) {
  return { row: 0, prefs: normalizePrefs(p) };
}

/** The patch that flips one row (null for 'back' / unknown rows). */
export function togglePatch(prefsObj, key, dir = 1) {
  const p = normalizePrefs(prefsObj);
  if (key === 'motion') {
    const i = MOTION_MODES.indexOf(p.motion);
    const n = MOTION_MODES.length;
    return { motion: MOTION_MODES[(((i + (dir < 0 ? -1 : 1)) % n) + n) % n] };
  }
  if (PREF_ROWS.includes(key)) return { [key]: !p[key] };
  return null;
}

/** The switch sound for a row after it changed: a rising "bip-bop!" for on (and Full motion), a soft falling one for off. */
export function toggleSound(key, prefs) {
  const on = key === 'motion' ? prefs?.motion !== 'gentle' : !!prefs?.[key];
  return on ? 'skx-toggle-on' : 'skx-toggle-off';
}

/**
 * @param {{row:number, prefs:object}} state
 * @param {{action:string, index?:number}} ev
 * @returns {{ state, fx: string[], patch: object|null, go: null|'back' }}
 */
export function effectsReduce(state, ev = {}) {
  const n = EFFECTS_ROWS.length;
  const res = { state, fx: [], patch: null, go: null };
  const change = (row, dir) => {
    const key = EFFECTS_ROWS[row];
    if (key === 'back') { res.go = 'back'; res.fx.push('back'); return; }
    const patch = togglePatch(state.prefs, key, dir);
    if (!patch) return;
    res.patch = patch;
    res.state = { ...res.state, row, prefs: normalizePrefs({ ...state.prefs, ...patch }) };
    res.fx.push(toggleSound(key, res.state.prefs));
  };
  switch (ev.action) {
    case 'up':
      res.state = { ...state, row: (state.row - 1 + n) % n };
      res.fx.push('move');
      break;
    case 'down':
      res.state = { ...state, row: (state.row + 1) % n };
      res.fx.push('move');
      break;
    case 'left':
    case 'right':
      if (EFFECTS_ROWS[state.row] !== 'back') change(state.row, ev.action === 'left' ? -1 : 1);
      break;
    case 'confirm':
    case 'toggle':
      change(state.row, 1);
      break;
    case 'select': {
      const i = Number(ev.index);
      if (Number.isInteger(i) && i >= 0 && i < n) {
        res.state = { ...state, row: i };
        state = res.state;
        change(i, 1);
      }
      break;
    }
    case 'back':
      res.go = 'back';
      res.fx.push('back');
      break;
    default:
      break;
  }
  return res;
}
