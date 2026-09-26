/**
 * Pure reducer for the "Touch controls" settings screen (src/ui/screens/touchSettings.js).
 * Works with taps AND controllers: Up/Down pick a row, Left/Right change it, A changes /
 * acts, B leaves. Mouse / tap: { action: 'select', index } (row tap) or
 * { action: 'set', key, value }.
 *
 *   let st = createTouchSettingsState(settings);
 *   const r = touchSettingsReduce(st, ev);   // → { state, patch|null, fx:[], go:null|'back', effect:null|'tilt'|'calibrate' }
 */
import { CONTROL_STYLES, CONTROL_SIZES, normalizeTouchSettings } from './touchSettings.js';

export const TOUCH_ROWS = Object.freeze(['style', 'autoGas', 'size', 'leftHanded', 'twoPlayers', 'haptics', 'calibrate', 'back']);

/** [emoji, title, helper] per row; value names per option. */
export const TOUCH_ROW_TEXT = Object.freeze({
  style: ['🕹️', 'Steering', 'How your thumb (or tablet) steers'],
  autoGas: ['🚀', 'Auto-gas', 'Your kart always zooms forward'],
  size: ['🔍', 'Button size', 'Bigger buttons are easier to hit'],
  leftHanded: ['🤚', 'Left-handed', 'Swap the buttons to the other side'],
  twoPlayers: ['👯', 'Two players on one tablet', 'Left half and right half each drive a kart'],
  haptics: ['📳', 'Buzz', 'A little wiggle when you bonk or boost'],
  calibrate: ['🎯', 'Straighten tilt', 'Hold it level, then tap here'],
  back: ['🏠', 'Back', ''],
});

export const STYLE_TEXT = Object.freeze({ joystick: 'Thumb stick', buttons: '◀ ▶ buttons', tilt: 'Tilt to steer' });
export const SIZE_TEXT = Object.freeze({ small: 'Small', medium: 'Medium', large: 'Large' });

/** Rows shown for these settings (calibrate only while tilt steering is picked). */
export function visibleRows(settings) {
  return TOUCH_ROWS.filter((r) => r !== 'calibrate' || settings.style === 'tilt');
}

export function createTouchSettingsState(settings, index = 0) {
  const s = normalizeTouchSettings(settings);
  const rows = visibleRows(s);
  return { settings: s, rows, index: Math.max(0, Math.min(rows.length - 1, index | 0)) };
}

function cycle(list, value, dir) {
  const i = Math.max(0, list.indexOf(value));
  return list[(i + dir + list.length) % list.length];
}

function withSettings(state, patch) {
  const settings = normalizeTouchSettings({ ...state.settings, ...patch });
  const rows = visibleRows(settings);
  const key = state.rows[state.index];
  let index = rows.indexOf(key);
  if (index < 0) index = Math.min(state.index, rows.length - 1);
  return { settings, rows, index };
}

function change(state, key, dir) {
  const s = state.settings;
  switch (key) {
    case 'style': return { style: cycle(CONTROL_STYLES, s.style, dir) };
    case 'size': return { size: cycle(CONTROL_SIZES, s.size, dir) };
    case 'autoGas':
    case 'leftHanded':
    case 'twoPlayers':
    case 'haptics':
      return { [key]: !s[key] };
    default:
      return null;
  }
}

const res = (state, extra = {}) => ({ state, patch: null, fx: [], go: null, effect: null, ...extra });

export function touchSettingsReduce(state, ev = {}) {
  const n = state.rows.length;
  const key = state.rows[state.index];
  const apply = (k, dir) => {
    const patch = change(state, k, dir);
    if (!patch) return null;
    const next = withSettings(state, patch);
    const effect = k === 'style' && next.settings.style === 'tilt' ? 'tilt' : null;
    return res(next, { patch, fx: ['move'], effect });
  };
  switch (ev.action) {
    case 'up':
      return res({ ...state, index: (state.index - 1 + n) % n }, { fx: ['move'] });
    case 'down':
      return res({ ...state, index: (state.index + 1) % n }, { fx: ['move'] });
    case 'left':
    case 'right':
      return apply(key, ev.action === 'left' ? -1 : 1) ?? res(state);
    case 'select': {
      const i = Number.isInteger(ev.index) ? ev.index : -1;
      if (i < 0 || i >= n) return res(state);
      const moved = { ...state, index: i };
      return touchSettingsReduce(moved, { action: 'confirm' });
    }
    case 'set': {
      if (!(ev.key in state.settings)) return res(state);
      const patch = { [ev.key]: ev.value };
      const next = withSettings(state, patch);
      const effect = ev.key === 'style' && next.settings.style === 'tilt' ? 'tilt' : null;
      return res(next, { patch: { [ev.key]: next.settings[ev.key] }, fx: ['move'], effect });
    }
    case 'confirm':
    case 'toggle':
      if (key === 'back') return res(state, { fx: ['back'], go: 'back' });
      if (key === 'calibrate') return res(state, { fx: ['confirm'], effect: 'calibrate' });
      return apply(key, 1) ?? res(state);
    case 'back':
      return res(state, { fx: ['back'], go: 'back' });
    default:
      return res(state);
  }
}

/** Display text for a row's current value ('' for action rows). */
export function rowValueText(settings, key) {
  switch (key) {
    case 'style': return STYLE_TEXT[settings.style];
    case 'size': return SIZE_TEXT[settings.size];
    case 'autoGas':
    case 'leftHanded':
    case 'twoPlayers':
    case 'haptics':
      return settings[key] ? 'ON' : 'OFF';
    default:
      return '';
  }
}
