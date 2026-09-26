/**
 * Speed lines (OWNER: driving-feel workstream): soft white streaks round the
 * edge of a player's view at top speed and whenever they boost. Pure CSS,
 * one element per player viewport, so it is cheap with 4 players.
 *
 * This widget covers the whole viewport (no anchor, positioned by its own
 * CSS, inserted underneath the rest of the HUD, pointer-events: none).
 */
import './driveSpeedLines.css';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Target strength 0..1 of the speed lines for a kart. */
export function speedLinesTarget(kart) {
  if (!kart || kart.finished) return 0;
  if (kart.spinning) return 0;
  const max = Math.max(1, kart.stats?.maxSpeed ?? 30);
  const sp = Number.isFinite(kart.speed) ? kart.speed : 0;
  let v = clamp((sp / max - 0.93) / 0.07, 0, 1) * 0.45; // just a hint at top speed
  if (kart.boosting) v = Math.max(v, 0.6 + 0.4 * clamp((sp / max - 1) / 0.25, 0, 1));
  if (kart.starPower > 0) v = Math.max(v, 0.75);
  return clamp(v, 0, 1);
}

/** Ease `cur` toward `target` (fast in, slower out). */
export function easeSpeedLines(cur, target, dt) {
  const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
  const rate = target > cur ? 9 : 3.5;
  return cur + (target - cur) * (1 - Math.exp(-rate * d));
}

/** Largest opacity the lines ever reach (kept subtle). */
export const SPEED_LINES_MAX_OPACITY = 0.42;

export default {
  id: 'drive-speed-lines',
  create(node, playerIndex, vpNode) {
    if (typeof document === 'undefined' || !vpNode?.appendChild) return { update() {}, reset() {}, destroy() {} };
    const el = document.createElement('div');
    el.className = 'sk-speedlines';
    el.innerHTML = '<i class="sk-speedlines-a"></i><i class="sk-speedlines-b"></i>';
    vpNode.insertBefore(el, vpNode.firstChild);
    let cur = 0;
    let lastT = null;
    let shown = -1;
    return {
      update(kart, race, t) {
        const dt = lastT === null || !Number.isFinite(t) ? 0 : t - lastT;
        lastT = Number.isFinite(t) ? t : lastT;
        cur = easeSpeedLines(cur, race?.state === 'racing' ? speedLinesTarget(kart) : 0, dt);
        const o = Math.round(cur * SPEED_LINES_MAX_OPACITY * 100) / 100;
        if (o !== shown) {
          shown = o;
          el.style.opacity = String(o);
          el.classList.toggle('on', o > 0.01);
        }
      },
      reset() { cur = 0; lastT = null; shown = -1; el.style.opacity = '0'; el.classList.remove('on'); },
      destroy() { el.remove(); },
    };
  },
};
