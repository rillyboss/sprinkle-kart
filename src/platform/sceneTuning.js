/**
 * Apply a quality preset to a built race scene (mobile platform). OWNER: mobile platform.
 * Works on any three.js scene graph WITHOUT touching track / racer code, so new content is covered for free:
 *
 *   setOutlines(root, on)                  show / hide inverted-hull cartoon outlines (BackSide basic material
 *                                          in one of the outline colours)
 *   findAnimatedInstances(root, update)    InstancedMeshes whose matrices a track animator rewrites every frame
 *   thinScenery(root, { keep, skip })      compacts static InstancedMeshes: instances whose world position fails
 *                                          `keep(x, z)` are dropped (matrices + colours moved down, count lowered)
 *   roadProximity(path, radius)            fast "is (x, z) within radius of the road centre line?" (grid hash)
 *   scaleFog(scene, s) / restoreFog        fog near/far × s
 *   createKartLod(karts, distance)         per-frame: karts far from every camera drop their outline mesh
 *   disposeTree(root)                      free every geometry / material / texture under root (GPU memory)
 *
 * Why spatial thinning is safe: instances that belong together (a snowman's hat + body, a pillar + its rings,
 * an instanced puff + its instanced outline) sit at the same spot, so they are kept or dropped together, and
 * road-side pieces (fence posts, curbs, arches) are always within the radius. Animated meshes are skipped
 * because their animator writes instance i by index every frame.
 */
import { BackSide } from 'three';

/** Outline colours in use: tracks (src/tracks/constants.js OUTLINE_COLOR) and racers (characters/parts.js). */
export const OUTLINE_COLORS = Object.freeze([0x3a2046, 0x2a1633]);

/** Is this material a cartoon outline? */
export function isOutlineMaterial(m) {
  if (!m || Array.isArray(m) || !m.isMeshBasicMaterial || m.side !== BackSide) return false;
  const hex = typeof m.color?.getHex === 'function' ? m.color.getHex() : null;
  return hex !== null && OUTLINE_COLORS.includes(hex);
}

/**
 * Show / hide every outline mesh under root. Returns how many meshes changed.
 * @param {import('three').Object3D} root
 * @param {boolean} on
 */
export function setOutlines(root, on) {
  let n = 0;
  root?.traverse?.((o) => {
    if (o.isMesh && isOutlineMaterial(o.material) && o.visible !== on) { o.visible = on; n++; }
  });
  return n;
}

/**
 * InstancedMeshes that change when the track animates: run `update` twice and compare matrix versions.
 * @param {import('three').Object3D} root
 * @param {(dt: number, t: number) => void} update e.g. built.update
 * @returns {Set<object>}
 */
export function findAnimatedInstances(root, update) {
  const meshes = [];
  root?.traverse?.((o) => { if (o.isInstancedMesh) meshes.push(o); });
  const before = meshes.map((m) => m.instanceMatrix?.version ?? 0);
  try { update?.(1 / 60, 0.37); update?.(1 / 60, 1.91); } catch { /* an animator that needs more context */ }
  return new Set(meshes.filter((m, i) => (m.instanceMatrix?.version ?? 0) !== before[i]));
}

const _m = new Float32Array(16);

/**
 * Drop instances of static InstancedMeshes where keep(x, z) is false (world position).
 * @param {import('three').Object3D} root
 * @param {{ keep: (x: number, z: number) => boolean, skip?: Set<object>, minCount?: number }} opts
 * @returns {{ meshes: number, removed: number, kept: number }}
 */
export function thinScenery(root, { keep, skip = new Set(), minCount = 4 } = {}) {
  const out = { meshes: 0, removed: 0, kept: 0 };
  if (!root?.traverse || typeof keep !== 'function') return out;
  root.updateMatrixWorld?.(true);
  const list = [];
  root.traverse((o) => { if (o.isInstancedMesh && !skip.has(o) && o.count >= minCount) list.push(o); });
  for (const mesh of list) {
    // per-instance custom attributes on the geometry would fall out of step: leave those meshes alone
    const attrs = mesh.geometry?.attributes ?? {};
    if (Object.values(attrs).some((a) => a?.isInstancedBufferAttribute)) continue;
    const mat = mesh.instanceMatrix.array;
    const col = mesh.instanceColor?.array ?? null;
    const w = mesh.matrixWorld.elements;
    let write = 0;
    const n = mesh.count;
    for (let i = 0; i < n; i++) {
      const o = i * 16;
      const lx = mat[o + 12], ly = mat[o + 13], lz = mat[o + 14];
      const x = w[0] * lx + w[4] * ly + w[8] * lz + w[12];
      const z = w[2] * lx + w[6] * ly + w[10] * lz + w[14];
      if (!keep(x, z)) continue;
      if (write !== i) {
        for (let k = 0; k < 16; k++) _m[k] = mat[o + k];
        mat.set(_m, write * 16);
        if (col) { col[write * 3] = col[i * 3]; col[write * 3 + 1] = col[i * 3 + 1]; col[write * 3 + 2] = col[i * 3 + 2]; }
      }
      write++;
    }
    if (write === n) continue;
    out.meshes++;
    out.removed += n - write;
    mesh.count = write;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (write === 0) mesh.visible = false;
    try { mesh.boundingSphere = null; mesh.boundingBox = null; if (write) mesh.computeBoundingSphere?.(); } catch { /* ignore */ }
  }
  root.traverse((o) => { if (o.isInstancedMesh && o.visible) out.kept += o.count; });
  return out;
}

/**
 * "Within `radius` of the road?" from the path's centre-line samples (px / pz arrays, as TrackPath has),
 * using a grid of radius-sized cells: a query looks at 9 cells only.
 * @param {{ px: ArrayLike<number>, pz: ArrayLike<number>, count?: number, halfWidth?: number }} path
 * @param {number} radius metres from the centre line
 * @returns {(x: number, z: number) => boolean}
 */
export function roadProximity(path, radius) {
  if (!Number.isFinite(radius)) return () => true;
  const px = path?.px, pz = path?.pz;
  const n = path?.count ?? px?.length ?? 0;
  if (!px || !pz || !n) return () => true;
  const r = Math.max(1, radius + (path.halfWidth ?? 0));
  const cell = r;
  const grid = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(px[i] / cell), Math.floor(pz[i] / cell));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  const r2 = r * r;
  return (x, z) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get(key(cx + dx, cz + dz));
        if (!arr) continue;
        for (const i of arr) {
          const ex = x - px[i], ez = z - pz[i];
          if (ex * ex + ez * ez <= r2) return true;
        }
      }
    }
    return false;
  };
}

/** Multiply the fog distances (THREE.Fog). Returns a function that restores them. */
export function scaleFog(scene, s) {
  const fog = scene?.fog;
  if (!fog || fog.far === undefined || !Number.isFinite(s) || s === 1) return () => {};
  const { near, far } = fog;
  fog.near = near * s;
  fog.far = far * s;
  return () => { fog.near = near; fog.far = far; };
}

/**
 * Kart outline LOD: outline meshes of karts farther than `distance` from every camera are hidden.
 * Outline meshes are looked up lazily (models can be rebuilt, e.g. paint shop) and cached per model.
 * @param {() => Array<{ position?: {x:number,y:number,z:number}, model?: { group?: any } }>} getKarts
 * @param {number} distance
 */
export function createKartLod(getKarts, distance) {
  const cache = new WeakMap();
  const d2 = distance * distance;
  const outlinesOf = (group) => {
    let list = cache.get(group);
    if (!list) {
      list = [];
      group.traverse((o) => { if (o.isMesh && isOutlineMaterial(o.material)) list.push(o); });
      cache.set(group, list);
    }
    return list;
  };
  let hidden = 0;
  return {
    get hidden() { return hidden; },
    /** @param {Array<{ position: {x:number,y:number,z:number} }>} cameras */
    update(cameras) {
      hidden = 0;
      if (!Number.isFinite(distance)) return 0;
      const cams = (cameras || []).filter(Boolean);
      for (const k of getKarts() || []) {
        const g = k?.model?.group;
        const p = k?.position ?? g?.position;
        if (!g?.traverse || !p) continue;
        let near = !cams.length;
        for (const c of cams) {
          const cp = c.position;
          const dx = cp.x - p.x, dy = cp.y - p.y, dz = cp.z - p.z;
          if (dx * dx + dy * dy + dz * dz <= d2) { near = true; break; }
        }
        for (const o of outlinesOf(g)) o.visible = near;
        if (!near) hidden++;
      }
      return hidden;
    },
    /** Show every outline again (race over, preset changed). */
    restore() {
      for (const k of getKarts() || []) {
        const g = k?.model?.group;
        if (g?.traverse) for (const o of outlinesOf(g)) o.visible = true;
      }
      hidden = 0;
    },
  };
}

const TEXTURE_KEYS = ['map', 'alphaMap', 'aoMap', 'bumpMap', 'normalMap', 'emissiveMap', 'gradientMap', 'lightMap', 'matcap', 'specularMap', 'displacementMap', 'envMap', 'roughnessMap', 'metalnessMap'];

/**
 * Free the GPU side of everything under root (geometries, textures, and with `materials: true` the materials).
 * CPU data stays, so an object that is drawn again later (a cached, shared geometry or texture) is simply
 * uploaded again by three. Materials are kept by default: their compiled shader programs are shared between
 * races and recompiling them on a phone costs a visible hitch at the next countdown.
 * @param {import('three').Object3D} root
 * @param {{ materials?: boolean }} [opts]
 * @returns {{ geometries: number, materials: number, textures: number }}
 */
export function disposeTree(root, { materials = false } = {}) {
  const geos = new Set();
  const mats = new Set();
  const texs = new Set();
  root?.traverse?.((o) => {
    if (o.geometry?.dispose) geos.add(o.geometry);
    const list = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of list) {
      if (!m?.dispose) continue;
      mats.add(m);
      for (const k of TEXTURE_KEYS) if (m[k]?.isTexture) texs.add(m[k]);
      for (const u of Object.values(m.uniforms ?? {})) if (u?.value?.isTexture) texs.add(u.value);
    }
    if (o.isInstancedMesh) { try { o.dispose?.(); } catch { /* ignore */ } }
  });
  const run = (set) => { for (const x of set) { try { x.dispose(); } catch { /* ignore */ } } };
  run(geos); run(texs);
  if (materials) run(mats);
  return { geometries: geos.size, materials: materials ? mats.size : 0, textures: texs.size };
}
