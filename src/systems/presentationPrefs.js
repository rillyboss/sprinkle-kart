/**
 * Presentation prefs -> the page. OWNER: showcase presentation.
 *
 *  - body classes: `skx-gentle` (gentle motion: decorative CSS loops off) and
 *    `skx-cb` (colour-friendly player shapes), kept in sync with the saved
 *    prefs (src/presentation/prefs.js) whenever they change;
 *  - a tiny HUD widget that tags each player viewport with `data-skx-p="1..4"`
 *    so the CSS can draw that player's shape (♥ ★ ◆ ●) and border pattern.
 */
import '../presentation/presentation.css';
import { prefs as sharedPrefs, effectivePrefs } from '../presentation/prefs.js';

/** Body classes for a prefs object. */
export function bodyClassesFor(p) {
  const e = effectivePrefs(p);
  return { 'skx-gentle': e.gentle, 'skx-cb': e.colorAssist };
}

/** Apply the classes to a classList-like target (no-op without one). */
export function applyBodyClasses(target, p) {
  if (!target?.classList) return;
  for (const [cls, on] of Object.entries(bodyClassesFor(p))) target.classList.toggle(cls, !!on);
}

/** HUD widget: marks the viewport with its player number. */
export const playerShapeWidget = {
  id: 'skx-player-shape',
  create(node, playerIndex, vpNode) {
    const vp = vpNode || node;
    if (vp?.dataset) vp.dataset.skxP = String(playerIndex + 1);
    return {
      update() {},
      destroy() { if (vp?.dataset) delete vp.dataset.skxP; },
    };
  },
};

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'presentation-prefs',
  order: 5,
  install(bus, app) {
    const store = app.prefs ?? sharedPrefs;
    const body = typeof document !== 'undefined' ? document.body : null;
    applyBodyClasses(body, store.get());
    const unsub = store.subscribe((p) => applyBodyClasses(body, p));
    let removeWidget = null;
    try { removeWidget = app.hud?.addWidget?.(playerShapeWidget) ?? null; } catch (err) { console.warn('[presentation] shape widget', err); }
    return () => {
      unsub();
      try { removeWidget?.(); } catch { /* ignore */ }
    };
  },
};
