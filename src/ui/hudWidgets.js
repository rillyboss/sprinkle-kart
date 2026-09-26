/**
 * HUD widget host — lets any module add its own per-player HUD element (a race
 * timer, an "incoming rocket!" warning, a lap-split popup ...) without editing
 * Hud.js.
 *
 *   hud.addWidget({
 *     id: 'race-timer',
 *     anchor: 'top-center',                    // optional reserved zone (HUD_ANCHORS below)
 *     order: 10,                               // optional: order inside the zone (low = first)
 *     create(node, playerIndex, vpNode) {      // once per player viewport
 *       const el = document.createElement('div'); node.appendChild(el);
 *       return {
 *         update(kart, race, t) { ... },       // every frame while the HUD updates
 *         reset() { ... },                     // between races (optional)
 *         destroy() { el.remove(); },          // viewport gone / widget removed (optional)
 *       };
 *     },
 *   });   // returns a remove() function
 *
 * With an `anchor`, `node` is this widget's own box inside a shared flex zone
 * of the viewport (widgets in one zone stack instead of overlapping; the host
 * removes the box on destroy). Without one, `node` is the raw viewport node and
 * the widget positions itself (legacy). `vpNode` is always the viewport node.
 *
 * Viewport nodes are absolutely positioned boxes (one per player, CSS px, font
 * size scales with the viewport) with `pointer-events: none`. Widgets that throw
 * are reported once and then skipped, so a HUD bug never stops the race.
 */
import './hudWidgets.css';

/**
 * Reserved HUD zones (see ARCHITECTURE.md §7). Built-in HUD (Candy Arcade): item slot + lap
 * plate (top corner on the item side), then the EDGE COLUMN under it (under-cluster zone,
 * callout zone, toast lane — src/ui/kit/toastLane.js), place badge (bottom corner), minimap.
 * Only the countdown, FINAL LAP and FINISH use the centre, briefly. Event popups go to the
 * toast lane (`hud.toast(pi, msg)` / `laneFor(vpNode).push(msg)`), never mid-screen.
 *   top-center     race timer, lap splits, mode pills          modes + timing
 *   under-cluster  item name / hints under the item slot       power-up clarity   (edge column)
 *   callout        status banners (online "Reconnecting…")     power-up / online  (edge column)
 *   bottom-center  drift / speed meters                        driving feel
 */
export const HUD_ANCHORS = Object.freeze(['top-center', 'under-cluster', 'callout', 'bottom-center']);

const canDom = (node) => !!node && typeof node.appendChild === 'function' && typeof document !== 'undefined';

function zoneFor(vpNode, anchor, zones) {
  let z = zones.get(anchor);
  if (!z) {
    // the Hud may pre-build a zone in its layout (under-cluster + callout live in the edge column)
    let pre = null;
    try { pre = vpNode.querySelector?.(`.sk-wzone-${anchor}`) ?? null; } catch { pre = null; }
    if (pre) z = pre;
    else {
      z = document.createElement('div');
      z.className = `sk-wzone sk-wzone-${anchor}`;
      vpNode.appendChild(z);
    }
    zones.set(anchor, z);
  }
  return z;
}

export function createWidgetHost({ onError } = {}) {
  const widgets = []; // { def, instances: Map<pi, inst>, broken:boolean }
  const viewports = new Map(); // pi -> node
  const report = onError || ((err, id) => console.error(`[hud] widget ${id} failed:`, err));

  const safe = (w, fn) => {
    if (w.broken) return undefined;
    try { return fn(); } catch (err) { w.broken = true; try { report(err, w.def.id); } catch { /* ignore */ } return undefined; }
  };
  const zonesByVp = new Map(); // pi -> Map(anchor -> zone node)
  const boxes = new Map(); // inst -> its anchored box
  const instantiate = (w, pi, node) => {
    let target = node;
    let box = null;
    if (w.def.anchor && canDom(node)) {
      if (!zonesByVp.has(pi)) zonesByVp.set(pi, new Map());
      box = document.createElement('div');
      box.className = 'sk-w';
      box.dataset.widget = String(w.def.id ?? '');
      box.style.order = String(Number.isFinite(w.def.order) ? w.def.order : 100);
      zoneFor(node, w.def.anchor, zonesByVp.get(pi)).appendChild(box);
      target = box;
    }
    const inst = safe(w, () => w.def.create(target, pi, node));
    if (inst) {
      w.instances.set(pi, inst);
      if (box) boxes.set(inst, box);
    } else if (box) box.remove();
  };
  const destroyInst = (w, inst) => {
    safe(w, () => inst.destroy?.());
    boxes.get(inst)?.remove();
    boxes.delete(inst);
  };

  return {
    /** Register a widget; returns remove(). */
    add(def) {
      if (!def || typeof def.create !== 'function') throw new Error('[hud] widget needs a create(vpNode, playerIndex) function');
      if (def.anchor !== undefined && !HUD_ANCHORS.includes(def.anchor)) throw new Error(`[hud] unknown widget anchor "${def.anchor}" (use ${HUD_ANCHORS.join(', ')})`);
      const w = { def, instances: new Map(), broken: false };
      widgets.push(w);
      for (const [pi, node] of viewports) instantiate(w, pi, node);
      return () => {
        const i = widgets.indexOf(w);
        if (i < 0) return;
        widgets.splice(i, 1);
        for (const inst of w.instances.values()) destroyInst(w, inst);
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
        if (inst) { destroyInst(w, inst); w.instances.delete(pi); }
      }
      for (const z of zonesByVp.get(pi)?.values() ?? []) z.remove();
      zonesByVp.delete(pi);
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
