/**
 * HUD widget host — lets any module add its own per-player HUD element (a race
 * timer, an "incoming rocket!" warning, a lap-split popup ...) without editing
 * Hud.js.
 *
 *   hud.addWidget({
 *     id: 'race-timer',
 *     create(vpNode, playerIndex) {            // once per player viewport
 *       const el = document.createElement('div'); vpNode.appendChild(el);
 *       return {
 *         update(kart, race, t) { ... },       // every frame while the HUD updates
 *         reset() { ... },                     // between races (optional)
 *         destroy() { el.remove(); },          // viewport gone / widget removed (optional)
 *       };
 *     },
 *   });   // returns a remove() function
 *
 * Viewport nodes are absolutely positioned boxes (one per player, CSS px, font
 * size scales with the viewport) with `pointer-events: none`. Widgets that throw
 * are reported once and then skipped, so a HUD bug never stops the race.
 */
export function createWidgetHost({ onError } = {}) {
  const widgets = []; // { def, instances: Map<pi, inst>, broken:boolean }
  const viewports = new Map(); // pi -> node
  const report = onError || ((err, id) => console.error(`[hud] widget ${id} failed:`, err));

  const safe = (w, fn) => {
    if (w.broken) return undefined;
    try { return fn(); } catch (err) { w.broken = true; try { report(err, w.def.id); } catch { /* ignore */ } return undefined; }
  };
  const instantiate = (w, pi, node) => {
    const inst = safe(w, () => w.def.create(node, pi));
    if (inst) w.instances.set(pi, inst);
  };

  return {
    /** Register a widget; returns remove(). */
    add(def) {
      if (!def || typeof def.create !== 'function') throw new Error('[hud] widget needs a create(vpNode, playerIndex) function');
      const w = { def, instances: new Map(), broken: false };
      widgets.push(w);
      for (const [pi, node] of viewports) instantiate(w, pi, node);
      return () => {
        const i = widgets.indexOf(w);
        if (i < 0) return;
        widgets.splice(i, 1);
        for (const inst of w.instances.values()) safe(w, () => inst.destroy?.());
        w.instances.clear();
      };
    },
    /** A player viewport node appeared. */
    attach(pi, node) {
      viewports.set(pi, node);
      for (const w of widgets) if (!w.instances.has(pi)) instantiate(w, pi, node);
    },
    /** A player viewport node went away. */
    detach(pi) {
      viewports.delete(pi);
      for (const w of widgets) {
        const inst = w.instances.get(pi);
        if (inst) { safe(w, () => inst.destroy?.()); w.instances.delete(pi); }
      }
    },
    update(pi, kart, race, t) {
      for (const w of widgets) {
        const inst = w.instances.get(pi);
        if (inst?.update) safe(w, () => inst.update(kart, race, t));
      }
    },
    reset() {
      for (const w of widgets) for (const inst of w.instances.values()) if (inst.reset) safe(w, () => inst.reset());
    },
    ids: () => widgets.map((w) => w.def.id),
  };
}
