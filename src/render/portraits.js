import * as THREE from 'three';
import { buildKartModel } from './characterModels.js';

/**
 * Render a cute 3/4-front portrait of each character's kart + driver into a
 * PNG data URL (transparent background), using one small offscreen renderer
 * that is disposed afterwards.
 *
 * @param {import('../data/characters.js').CharacterDef[]} characters
 * @param {number} [size=256] square pixel size
 * @param {{framing?: 'bust'|'full'}} [opts] 'bust' (default) = head & shoulders
 *        close-up for select screens / HUD; 'full' = whole kart
 * @returns {Promise<Map<string, string>>} id -> data URL ('' if rendering failed)
 */
export async function renderPortraits(characters, size = 256, opts = {}) {
  const out = new Map();
  if (typeof document === 'undefined' || !characters?.length) return out;
  const framing = opts.framing ?? 'bust';

  let renderer;
  try {
    const canvas = document.createElement('canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (err) {
    console.warn('[portraits] WebGL unavailable, portraits skipped', err);
    for (const c of characters) out.set(c.id, '');
    return out;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4fb, 0xc9a6ff, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 6, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc4ec, 1.2);
  rim.position.set(-4, 3, -4);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const boxSize = new THREE.Vector3();
  // 3/4 front view from the driver's right side (their wand hand is on the left)
  const viewDir = new THREE.Vector3(-0.42, 0.28, 1).normalize();

  for (const def of characters) {
    let model = null;
    try {
      model = buildKartModel(def);
      model.group.rotation.y = -0.2;
      // settle into a cheerful pose (tiny steer so the head tilts cutely)
      model.update(0.016, { speed: 0, steer: -0.25, time: 0.6 });
      scene.add(model.group);
      model.group.updateMatrixWorld(true);
      if (framing === 'bust' && model.head) {
        visibleBox(model.head, box);
        box.getSize(boxSize);
        const headY = model.head.getWorldPosition(center).y;
        // face-first framing: shoulders at the bottom, very tall hats may crop a little
        const top = Math.min(box.max.y, headY + 0.95);
        const bottom = headY - 0.8;
        const h = top - bottom;
        center.set((box.min.x + box.max.x) / 2, (top + bottom) / 2, (box.min.z + box.max.z) / 2);
        const dist = (Math.max(h, Math.min(boxSize.x, 1.6)) * 0.56) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.position.copy(center).addScaledVector(viewDir, dist);
        camera.lookAt(center);
      } else {
        visibleBox(model.group, box);
        box.getCenter(center);
        box.getSize(boxSize);
        const dist = (Math.max(boxSize.y, boxSize.x, boxSize.z) * 0.6) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        camera.position.copy(center).addScaledVector(viewDir, dist);
        camera.lookAt(center);
      }
      renderer.render(scene, camera);
      out.set(def.id, renderer.domElement.toDataURL('image/png'));
    } catch (err) {
      console.warn(`[portraits] failed for ${def?.id}`, err);
      out.set(def?.id, '');
    } finally {
      if (model) {
        scene.remove(model.group);
        model.dispose();
      }
    }
    // yield so boot doesn't block the main thread for long
    await new Promise((r) => setTimeout(r, 0));
  }

  renderer.dispose();
  renderer.forceContextLoss?.();
  return out;
}

const _b = new THREE.Box3();
/** Bounding box of only the visible meshes under `root` (hidden effects are skipped). */
function visibleBox(root, target) {
  target.makeEmpty();
  root.traverseVisible((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.material?.side === THREE.BackSide) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    target.union(_b);
  });
  return target;
}
