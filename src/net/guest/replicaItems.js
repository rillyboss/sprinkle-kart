/**
 * Replica items and boxes on a guest (NETWORKING.md §8.3 ItemView/BoxView, §9.5). Gumdrops and rockets are
 * host entities with u16 ids; the guest draws them on the remote timeline R from the snapshot buffer (linear
 * between the two bracketing snapshots — rockets fly straight between 30 Hz samples), spawns an entity when
 * it first appears at R and removes it when R passes the last snapshot that had it. Item boxes switch at the
 * older snapshot. Spawn colours and despawn reasons come from replicated events when they arrive.
 *
 * The views are optional (tests and headless runs pass none):
 *   ItemView { spawnGumdrop({ id, x, y, z, color }), moveGumdrop(id, x, y, z), removeGumdrop(id, why),
 *              spawnRocket({ id, owner, target }), moveRocket(id, x, y, z, heading), removeRocket(id, why),
 *              update(dt, clock), dispose() }
 *   BoxView  { setActive(index, on), pop(index), update(dt, clock), dispose() }
 */
import { slerpAngle } from './interpolation.js';

const noop = () => {};

export function createReplicaItems({ itemView = null, boxView = null } = {}) {
  const gumdrops = new Map(); // id → { id, x, y, z, color }
  const rockets = new Map(); // id → { id, x, y, z, heading, target }
  const colors = new Map(); // id → colour index from gumdrop-spawn
  const whys = new Map(); // id → despawn reason from the despawn events
  let boxes = [];
  const v = {
    spawnGumdrop: itemView?.spawnGumdrop?.bind(itemView) ?? noop,
    moveGumdrop: itemView?.moveGumdrop?.bind(itemView) ?? noop,
    removeGumdrop: itemView?.removeGumdrop?.bind(itemView) ?? noop,
    spawnRocket: itemView?.spawnRocket?.bind(itemView) ?? noop,
    moveRocket: itemView?.moveRocket?.bind(itemView) ?? noop,
    removeRocket: itemView?.removeRocket?.bind(itemView) ?? noop,
    setActive: boxView?.setActive?.bind(boxView) ?? noop,
  };
  const stats = { gumdropsSpawned: 0, rocketsSpawned: 0, removed: 0 };

  function sync(map, list, spawn, move, remove, isRocket) {
    const alive = new Set();
    for (const e of list) {
      alive.add(e.id);
      let cur = map.get(e.id);
      if (!cur) {
        cur = { ...e, color: colors.get(e.id) ?? e.color ?? 0 };
        map.set(e.id, cur);
        if (isRocket) { stats.rocketsSpawned++; spawn({ id: e.id, owner: e.owner ?? 255, target: e.target ?? 255 }); } else { stats.gumdropsSpawned++; spawn({ id: e.id, x: e.x, y: e.y, z: e.z, color: cur.color }); }
      }
      Object.assign(cur, e);
      if (isRocket) move(e.id, e.x, e.y, e.z, e.heading ?? 0); else move(e.id, e.x, e.y, e.z);
    }
    for (const id of [...map.keys()]) {
      if (alive.has(id)) continue;
      map.delete(id);
      stats.removed++;
      remove(id, whys.get(id) ?? (isRocket ? 'gone' : 'popped'));
    }
  }

  return {
    /**
     * Draw the item world at render tick R.
     * @param {{ bracket: (r: number) => { a, b, t } }} buffer
     * @param {number} renderTick
     */
    update(buffer, renderTick) {
      const { a, b, t } = buffer.bracket(renderTick);
      if (!a) return;
      const lerpList = (la, lb, isRocket) => {
        if (!lb) return la.map((e) => ({ ...e }));
        const byId = new Map(lb.map((e) => [e.id, e]));
        return la.map((e) => {
          const n = byId.get(e.id);
          if (!n) return { ...e };
          const out = { ...e, x: e.x + (n.x - e.x) * t, y: e.y + (n.y - e.y) * t, z: e.z + (n.z - e.z) * t };
          if (isRocket) out.heading = slerpAngle(e.heading ?? 0, n.heading ?? 0, t);
          return out;
        });
      };
      sync(gumdrops, lerpList(a.gumdrops || [], b?.gumdrops, false), v.spawnGumdrop, v.moveGumdrop, v.removeGumdrop, false);
      sync(rockets, lerpList(a.rockets || [], b?.rockets, true), v.spawnRocket, v.moveRocket, v.removeRocket, true);
      const nb = a.boxes || [];
      for (let i = 0; i < nb.length; i++) if (boxes[i] !== nb[i]) v.setActive(i, nb[i]);
      boxes = nb.slice();
    },
    /** Presentation facts from replicated events (colour on spawn, why on despawn). */
    onEvent(e) {
      if (e.type === 'gumdrop-spawn') { colors.set(e.id, e.color); const g = gumdrops.get(e.id); if (g) g.color = e.color; }
      else if (e.type === 'gumdrop-despawn' || e.type === 'rocket-despawn') whys.set(e.id, e.why);
      if (colors.size > 256) colors.delete(colors.keys().next().value);
      if (whys.size > 256) whys.delete(whys.keys().next().value);
    },
    get gumdrops() { return [...gumdrops.values()]; },
    get rockets() { return [...rockets.values()]; },
    get boxes() { return boxes.slice(); },
    stats,
    dispose() {
      for (const id of gumdrops.keys()) v.removeGumdrop(id, 'dispose');
      for (const id of rockets.keys()) v.removeRocket(id, 'dispose');
      gumdrops.clear();
      rockets.clear();
      itemView?.dispose?.();
      boxView?.dispose?.();
    },
  };
}
