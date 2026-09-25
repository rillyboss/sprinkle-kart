/**
 * Three.js inspection helpers for node tests: find NaNs, collect GPU resources and
 * check that dispose() really frees them.
 *
 *   const res = collectResources(built.group);          // { geometries, materials, textures } (Sets)
 *   const watch = watchDisposal(res);                   // listens for three's 'dispose' events
 *   built.dispose();
 *   watch.undisposed().geometries                       // [] when everything was freed
 *
 *   buildAndDispose(() => buildTrack(def, path))       // { res, left }: build, collect, dispose, see what stayed alive
 *
 *   nonFiniteTransforms(root)   // ['Mesh "wheel": position.x = NaN', ...]
 *   nonFiniteVertices(root)     // meshes whose position attribute holds NaN / Infinity
 */

const TEXTURE_KEYS = ['map', 'gradientMap', 'alphaMap', 'emissiveMap', 'normalMap', 'aoMap', 'bumpMap', 'lightMap', 'matcap', 'envMap', 'specularMap', 'roughnessMap', 'metalnessMap', 'displacementMap'];

const materialsOf = (o) => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);

/** Unique geometries / materials / textures reachable from `root` (including invisible nodes). */
export function collectResources(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of materialsOf(o)) {
      materials.add(m);
      for (const k of TEXTURE_KEYS) if (m[k]?.isTexture) textures.add(m[k]);
      for (const u of Object.values(m.uniforms || {})) if (u?.value?.isTexture) textures.add(u.value);
    }
  });
  return { geometries, materials, textures };
}

/**
 * Listen for 'dispose' events on every resource. `undisposed()` lists what is still alive.
 * @param {{ geometries: Set<object>, materials: Set<object>, textures: Set<object> }} res
 */
export function watchDisposal(res) {
  const disposed = new Set();
  const onDispose = (e) => disposed.add(e.target);
  for (const set of Object.values(res)) for (const r of set) r.addEventListener?.('dispose', onDispose);
  return {
    disposed,
    undisposed() {
      const out = {};
      for (const [k, set] of Object.entries(res)) out[k] = [...set].filter((r) => !disposed.has(r));
      return out;
    },
  };
}

const label = (o) => `${o.type}${o.name ? ` "${o.name}"` : ''}`;

/** Every non-finite position / rotation / scale / quaternion in the tree (as text). */
export function nonFiniteTransforms(root) {
  const bad = [];
  root.traverse((o) => {
    for (const [key, v] of [['position', o.position], ['rotation', o.rotation], ['scale', o.scale]]) {
      for (const axis of ['x', 'y', 'z']) if (!Number.isFinite(v[axis])) bad.push(`${label(o)}: ${key}.${axis} = ${v[axis]}`);
    }
    for (const axis of ['x', 'y', 'z', 'w']) if (!Number.isFinite(o.quaternion[axis])) bad.push(`${label(o)}: quaternion.${axis} = ${o.quaternion[axis]}`);
  });
  return bad;
}

/** Meshes / lines / points whose vertex positions contain NaN or Infinity (as text). */
export function nonFiniteVertices(root) {
  const bad = [];
  const seen = new Set();
  root.traverse((o) => {
    const geo = o.geometry;
    if (!geo || seen.has(geo)) return;
    seen.add(geo);
    const pos = geo.attributes?.position;
    if (!pos) return;
    const arr = pos.array;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) { bad.push(`${label(o)}: vertex component ${i} = ${arr[i]}`); break; }
    }
    if (o.isInstancedMesh) {
      const m = o.instanceMatrix.array;
      for (let i = 0; i < o.count * 16; i++) {
        if (!Number.isFinite(m[i])) { bad.push(`${label(o)}: instanceMatrix[${i}] = ${m[i]}`); break; }
      }
    }
  });
  return bad;
}

/**
 * Build something with `{ group, dispose() }`, dispose it, and report what stayed alive.
 * Leftover materials / textures / geometries must be shared caches (the same objects on
 * every build) — compare two builds to tell a cache from a leak.
 * @param {() => { group: object, dispose: () => void }} build
 */
export function buildAndDispose(build) {
  const thing = build();
  const res = collectResources(thing.group);
  const watch = watchDisposal(res);
  thing.dispose();
  return { res, left: watch.undisposed() };
}
