/**
 * Pure reducer for the "🖥️ Graphics" screen (src/ui/screens/graphics.js). OWNER: mobile platform.
 *
 *   let st = createGraphicsState('auto');
 *   const res = graphicsReduce(st, { action: 'right' }); // → { state, fx: ['skx-toggle-on'], choice: 'low', go: null }
 *
 * Rows: 'quality' (Auto · Low · Medium · High; Left/Right/A cycle, `select` with `value` picks one) and 'back'.
 * `choice` is what to hand to platform.setChoice() (null when nothing changed).
 */
import { QUALITY_CHOICES, isQualityChoice } from './quality.js';

export const GRAPHICS_ROWS = Object.freeze(['quality', 'back']);

export const QUALITY_LABELS = Object.freeze({
  auto: ['✨', 'Auto'],
  low: ['🐢', 'Speedy'],
  medium: ['🍭', 'Balanced'],
  high: ['🌈', 'Sparkly'],
});

/** One friendly sentence about what a tier means. */
export const QUALITY_HELP = Object.freeze({
  auto: 'Picks the best look your device can keep smooth.',
  low: 'Smoothest on older phones and tablets.',
  medium: 'A good mix of sparkle and speed.',
  high: 'Every outline and sparkle, for strong computers.',
});

export function createGraphicsState(choice = 'auto') {
  return { row: 0, choice: isQualityChoice(choice) ? choice : 'auto' };
}

/**
 * @param {{ row: number, choice: string }} state
 * @param {{ action: string, index?: number, value?: string }} ev
 * @returns {{ state: object, fx: string[], choice: string|null, go: null|'back' }}
 */
export function graphicsReduce(state, ev = {}) {
  const n = GRAPHICS_ROWS.length;
  const res = { state, fx: [], choice: null, go: null };
  const cycle = (dir) => {
    const i = QUALITY_CHOICES.indexOf(state.choice);
    const k = QUALITY_CHOICES.length;
    const next = QUALITY_CHOICES[(((i + dir) % k) + k) % k];
    res.state = { ...state, row: 0, choice: next };
    res.choice = next;
    res.fx.push('skx-toggle-on');
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
      if (GRAPHICS_ROWS[state.row] === 'quality') cycle(ev.action === 'left' ? -1 : 1);
      break;
    case 'confirm':
    case 'toggle':
      if (GRAPHICS_ROWS[state.row] === 'back') { res.go = 'back'; res.fx.push('back'); } else cycle(1);
      break;
    case 'select': {
      if (isQualityChoice(ev.value)) {
        if (ev.value !== state.choice) {
          res.state = { ...state, row: 0, choice: ev.value };
          res.choice = ev.value;
          res.fx.push('skx-toggle-on');
        } else res.state = { ...state, row: 0 };
        break;
      }
      const i = Number(ev.index);
      if (GRAPHICS_ROWS[i] === 'back') { res.go = 'back'; res.fx.push('back'); } else if (i === 0) { state = { ...state, row: 0 }; cycle(1); }
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

/**
 * The status line under the choice: which tier Auto is using and why, plus a reload note for antialias.
 * @param {{ choice: string, quality?: { id: string, reasons?: string[] }, antialiasOk?: boolean }} s
 */
export function graphicsStatus({ choice, quality, antialiasOk = true } = {}) {
  const parts = [];
  if (choice === 'auto' && quality?.id) parts.push(`Auto is using ${QUALITY_LABELS[quality.id]?.[1] ?? quality.id} on this device`);
  if (!antialiasOk) parts.push('smoother edges after a reload');
  return parts.join(' · ');
}
