/**
 * Small helpers shared by the menu screens (not a screen itself — files
 * starting with "_" are skipped by the screen registry).
 */
import { PLAYER_COLORS } from '../../config.js';
import { el, glyph } from '../dom.js';
import { describeUnlock, describeUnlockShort, unlockDetail } from '../../progress/describeUnlock.js';

/** Player colour for P1..P4. */
export const pc = (i) => PLAYER_COLORS[i] ?? '#ff9ad5';

/** Seconds of ignored input after a screen change. */
export const INPUT_COOLDOWN = 0.22;
/** Seconds the unlock celebration stays up before a button press can close it. */
export const UNLOCK_MIN_SHOW = 2.2;
/** Seconds a joined controller may stay unplugged on the join screen before it leaves. */
export const JOIN_UNPLUG_DROP = 3;

export const STAT_ROWS = [
  ['speed', 'Speed', '⚡'],
  ['accel', 'Zip', '🚀'],
  ['handling', 'Turning', '🌀'],
  ['weight', 'Weight', '🍩'],
];
export const SPEED_HINT = { cozy: 'Nice and easy', zippy: 'Just right', zoomy: 'Super fast!' };

/** Menu-card emoji art for a track: def.art, else a friendly default. */
export function trackArt(def) {
  return Array.isArray(def?.art) && def.art.length >= 3 ? def.art : ['🏁', '🍬', '✨'];
}

/** Short locked-tile hint for a character or track def. */
export function lockHint(def, { short = false } = {}) {
  if (short) return def?.unlockHintShort || describeUnlockShort(def?.unlock) || 'Keep racing!';
  return def?.unlockHint || describeUnlock(def?.unlock) || 'Keep racing to unlock!';
}

/** Longer locked-panel sentence. */
export function lockDetail(def, kind = 'character') {
  return unlockDetail(def?.unlock, kind) || 'Keep racing to meet a sweet new friend…';
}

/** Restart a CSS "nope" wiggle on a node. */
export function shake(node) {
  if (!node) return;
  node.classList.remove('sk-shake');
  void node.offsetWidth; // restart animation
  node.classList.add('sk-shake');
}

export function hintsBar(items) {
  return el('div.sk-hints', { html: items.join('') });
}

export function backButton(onClick) {
  return el('button.sk-back', { onclick: onClick, html: `${glyph('B')}<span>Back</span>` });
}

/** Keep a focused element visible inside a scrolling container (no-op without layout). */
export function keepVisible(node) {
  try { node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
}
