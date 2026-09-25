import * as THREE from 'three';

/**
 * Shared cute cel-shaded material helpers. Every module should build meshes
 * with these so the whole game has one consistent, soft, candy look.
 */

let gradient = null;
function gradientMap() {
  if (gradient) return gradient;
  // 4-step soft toon ramp.
  const data = new Uint8Array([90, 90, 90, 255, 160, 160, 160, 255, 220, 220, 220, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

const cache = new Map();

/**
 * Cached toon material. Do NOT mutate the returned material (it is shared);
 * pass `{ unique: true }` if you need your own instance to animate.
 * @param {number|string} color e.g. 0xff88cc or '#ff88cc'
 * @param {{emissive?:number|string, emissiveIntensity?:number, transparent?:boolean,
 *          opacity?:number, side?:number, unique?:boolean}} [opts]
 */
export function toon(color, opts = {}) {
  const key = opts.unique ? null : JSON.stringify([color, opts]);
  if (key && cache.has(key)) return cache.get(key);
  const mat = new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: gradientMap(),
    emissive: new THREE.Color(opts.emissive ?? 0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
  if (key) cache.set(key, mat);
  return mat;
}

/** Unlit glowing material (stars, sparkles, lights). Cached like toon(). */
export function glow(color, opts = {}) {
  const key = opts.unique ? null : 'glow' + JSON.stringify([color, opts]);
  if (key && cache.has(key)) return cache.get(key);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
  if (key) cache.set(key, mat);
  return mat;
}

/** Black inverted-hull outline for a mesh (the classic cartoon edge). */
export function addOutline(mesh, thickness = 0.04) {
  const outline = new THREE.Mesh(mesh.geometry, outlineMat());
  outline.scale.setScalar(1 + thickness);
  outline.renderOrder = -1;
  mesh.add(outline);
  return outline;
}
let _outline = null;
function outlineMat() {
  if (!_outline) _outline = new THREE.MeshBasicMaterial({ color: 0x2a1633, side: THREE.BackSide });
  return _outline;
}
