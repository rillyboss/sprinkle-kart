/**
 * Scene-graph "fingerprints" for visual regression guards.
 *
 * A fingerprint is a sorted list of per-object signatures: object type,
 * geometry (vertex count + rounded sums of every attribute), instancing data
 * (instance matrices + colours), material (type, colour, opacity, flags) and,
 * for static scenery, the world transform. Two builds that produce the same
 * fingerprint render the same picture. Order-insensitive on purpose: the
 * order children are added in does not change the picture.
 *
 * `animated: true` skips transforms (character rigs are posed from a
 * per-kart random seed), keeping only geometry + materials.
 * `skipKartFx: true` leaves out kart-effect subtrees (userData.kartFx, see
 * src/fx/kartEffects.js) so effect restyles don't count as model changes.
 */
import * as THREE from 'three';

const r = (v) => Math.round(v * 1000) / 1000;

function sumArray(arr) {
  let s = 0;
  let a = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    s += v * ((i % 7) + 1); // weight by position so swaps are noticed
    a += Math.abs(v);
  }
  return `${r(s)}/${r(a)}`;
}

function geomSig(g) {
  if (!g) return '-';
  const parts = [];
  for (const name of Object.keys(g.attributes).sort()) {
    const at = g.attributes[name];
    parts.push(`${name}:${at.count}x${at.itemSize}:${sumArray(at.array)}`);
  }
  if (g.index) parts.push(`index:${g.index.count}:${sumArray(g.index.array)}`);
  return parts.join(',');
}

function colorHex(c) {
  return c && c.isColor ? c.getHexString() : '-';
}

function texSig(t) {
  if (!t) return '-';
  const img = t.image;
  const data = img?.data ? sumArray(img.data) : '';
  return `${t.type}:${img?.width ?? '?'}x${img?.height ?? '?'}:${data}:${r(t.repeat.x)},${r(t.repeat.y)}`;
}

function matSig(m) {
  if (!m) return '-';
  if (Array.isArray(m)) return m.map(matSig).join('|');
  const u = m.uniforms
    ? Object.keys(m.uniforms).sort().map((k) => `${k}=${m.uniforms[k].value?.isColor ? colorHex(m.uniforms[k].value) : ''}`).join(';')
    : '';
  return [
    m.type, colorHex(m.color), colorHex(m.emissive), r(m.emissiveIntensity ?? 0), r(m.opacity ?? 1),
    m.transparent ? 't' : '', m.side, m.vertexColors ? 'vc' : '', m.fog === false ? 'nofog' : '',
    m.depthWrite === false ? 'nodw' : '', texSig(m.map), m.size !== undefined ? r(m.size) : '', u,
  ].join(':');
}

/**
 * @param {THREE.Object3D} root
 * @param {{animated?: boolean}} [opts]
 * @returns {string[]} sorted signatures
 */
export function fingerprint(root, { animated = false, skipKartFx = false } = {}) {
  root.updateMatrixWorld(true);
  const out = [];
  const visit = (o) => {
    if (skipKartFx && o.userData?.kartFx) return; // src/fx/ effect subtrees (owned by workstreams)
    for (const c of o.children) visit(c);
    if (o === root) return;
    const bits = [o.type, o.name || '', o.visible ? 'v' : 'h', o.renderOrder];
    if (o.isLight) bits.push(colorHex(o.color), r(o.intensity), colorHex(o.groundColor));
    if (o.geometry) bits.push(geomSig(o.geometry));
    if (o.material) bits.push(matSig(o.material));
    if (o.isInstancedMesh) {
      bits.push(`inst:${o.count}:${sumArray(o.instanceMatrix.array)}`);
      if (o.instanceColor) bits.push(`icol:${sumArray(o.instanceColor.array)}`);
    }
    if (!animated) bits.push(`mw:${sumArray(o.matrixWorld.elements)}`);
    out.push(bits.join(' '));
  };
  visit(root);
  return out.sort();
}

/** Short stable hash of a fingerprint (FNV-1a over the joined lines). */
export function digest(lines) {
  let h = 2166136261;
  const s = lines.join('\n');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}:${lines.length}`;
}

export { THREE };
