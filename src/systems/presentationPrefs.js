/**
 * Presentation prefs -> the page. OWNER: showcase presentation.
 *
 *  - body classes: `skx-gentle` (gentle motion: decorative CSS loops off) and
 *    `skx-cb` (colour-friendly player shapes), kept in sync with the saved
 *    prefs (src/presentation/prefs.js) whenever they change;
 *  - a tiny HUD widget that tags each player viewport with `data-skx-p="1..4"`
 *    so the CSS can draw that player's shape (♥ ★ ◆ ●) and border pattern;
 *  - with colour-friendly shapes on, the "P1".."P4" tags in the menus (join
 *    slots, character select cursors + panels, results, standings, ceremony)
 *    get `data-skx-tag="1..4"` so they show the same shapes (a light scan of the
 *    menus a few times a second; nothing runs during a race).
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

/** Each player's shape (P1..P4), matching presentation.css. */
export const PLAYER_SHAPES = Object.freeze(['♥', '★', '◆', '●']);
/** Menu elements that show a player tag like "P2" or "P2 ✓". */
export const MENU_TAG_SELECTOR = '.sk-tag, .sk-slot-tag, .sk-panel-p';
/** Seconds between menu tag scans. */
export const TAG_SCAN_EVERY = 0.2;

/** 1..4 for a tag text starting with "P1".."P4", else null. */
export function playerOfTag(text) {
  const m = /^\s*P([1-4])(?![0-9])/.exec(String(text ?? ''));
  return m ? Number(m[1]) : null;
}

/** Mark every player tag under `root` with data-skx-tag (and clear stale marks). Returns how many are marked. */
export function markPlayerTags(root) {
  if (!root?.querySelectorAll) return 0;
  let n = 0;
  for (const el of root.querySelectorAll(MENU_TAG_SELECTOR)) {
    if (!el?.dataset) continue;
    const p = playerOfTag(el.textContent);
    if (p) {
      n++;
      if (el.dataset.skxTag !== String(p)) el.dataset.skxTag = String(p);
    } else if (el.dataset.skxTag) delete el.dataset.skxTag;
  }
  return n;
}

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
    let scanIn = 0;
    const offFrame = bus.on('frame', (dt, game) => {
      if (game?.state === 'race') return;
      scanIn -= Number.isFinite(dt) ? dt : 0;
      if (scanIn > 0) return;
      scanIn = TAG_SCAN_EVERY;
      if (!effectivePrefs(store.get()).colorAssist) return;
      markPlayerTags(app.menus?.el ?? null);
    });
    return () => {
      offFrame();
      unsub();
      try { removeWidget?.(); } catch { /* ignore */ }
    };
  },
};
