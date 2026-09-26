/**
 * Guest-side presentation adapters for the ReplicaRace (NETWORKING.md §8.3 ItemView / BoxView): the host
 * simulates items and boxes, a guest only DRAWS them at the remote timeline from snapshots. Until WS1's
 * `itemView` / `boxView` split lands, these adapt today's meshes (Items.js / ItemBoxes.js builders) without
 * running any item logic on the guest. Also: the kart-model builder that paints every kart with the paint
 * its player picked (the NetRaceSetup carries `paintId`), so every house sees the same colours.
 *
 * OWNER: WS7 (online game integration).
 */
import { buildGumdropMesh, buildRocketMesh, disposeTree, GUMDROP_SCALE } from '../race/Items.js';
import { ItemBoxes } from '../race/ItemBoxes.js';
import { paintedDef } from '../modes/paint.js';
import { Group } from 'three';

/** Items.js GUMDROP_COLORS (the snapshot / spawn event carries the index). */
export const GUMDROP_COLORS = Object.freeze([0xff6fb5, 0x7ee07e, 0xffd35c, 0x8fb8ff, 0xc38bff]);

/**
 * Kart models in each participant's picked paint. Race (today) calls `build(def)` once per participant in
 * kart order, ReplicaRace calls `build(def, participant)`: both end up with the setup's paint.
 * @param {(def: object) => object} build   e.g. buildKartModel
 * @param {Array<{ paintId?: string }>} participants  setup order
 */
export function netKartBuilder(build, participants = []) {
  let next = 0;
  return (def, participant) => {
    const p = participant ?? participants[next];
    next++;
    return build(paintedDef(def, p?.paintId ?? 'original'));
  };
}

/** Item boxes that follow the host's box states (never break or respawn on their own). */
export function createBoxView({ scene, slots = [] }) {
  const boxes = new ItemBoxes({ scene, slots });
  return {
    boxes,
    setActive(index, on) {
      const b = boxes.boxes[index];
      if (!b || b.active === !!on) return;
      b.active = !!on;
      b.mesh.visible = !!on;
      b.respawn = on ? 0 : Infinity; // only the host decides when a box comes back
      const at = { x: b.base.x, y: b.base.y + 1.25, z: b.base.z };
      if (on) { b.popT = 0; boxes.bursts.emit('respawn', at); } else boxes.bursts.emit('box-pop', at);
    },
    update(dt) { boxes.update(dt, [], null); },
    dispose() { boxes.dispose(); },
  };
}

/** Gumdrops and cupcake rockets drawn where the host's snapshots put them. */
export function createItemView({ scene }) {
  const root = new Group();
  root.name = 'replica-items';
  scene.add(root);
  const gumdrops = new Map();
  const rockets = new Map();
  let clock = 0;
  const remove = (map, id) => {
    const m = map.get(id);
    if (!m) return;
    root.remove(m);
    disposeTree(m);
    map.delete(id);
  };
  return {
    root,
    spawnGumdrop({ id, x, y, z, color }) {
      const mesh = buildGumdropMesh(GUMDROP_COLORS[color] ?? GUMDROP_COLORS[0]);
      mesh.position.set(x, y, z);
      mesh.userData.phase = (id % 7) * 0.9;
      root.add(mesh);
      gumdrops.set(id, mesh);
    },
    moveGumdrop(id, x, y, z) {
      const m = gumdrops.get(id);
      if (!m) return;
      m.position.set(x, y, z);
      const s = GUMDROP_SCALE * (1 + Math.sin(clock * 5 + m.userData.phase) * 0.04);
      m.getObjectByName?.('jelly')?.scale?.setScalar?.(s / GUMDROP_SCALE);
    },
    removeGumdrop(id) { remove(gumdrops, id); },
    spawnRocket({ id }) {
      const mesh = buildRocketMesh();
      root.add(mesh);
      rockets.set(id, mesh);
    },
    moveRocket(id, x, y, z, heading) {
      const m = rockets.get(id);
      if (!m) return;
      m.position.set(x, y, z);
      m.rotation.y = heading;
    },
    removeRocket(id) { remove(rockets, id); },
    update(dt) { clock += dt; },
    get counts() { return { gumdrops: gumdrops.size, rockets: rockets.size }; },
    dispose() {
      for (const id of [...gumdrops.keys()]) remove(gumdrops, id);
      for (const id of [...rockets.keys()]) remove(rockets, id);
      scene.remove(root);
    },
  };
}
