/**
 * Drift sparks behind the rear wheels (dust, blue, pink, rainbow by
 * driftLevel). OWNER: driving-feel workstream. Restyle freely: this subtree
 * is excluded from the visual golden fingerprints (tests/visual.golden.test.js).
 *
 * Effect module contract: see ./kartEffects.js.
 *   s  = raw model state from the Race (speed, drifting, driftLevel, boosting, shielded, spinning, star, ...)
 *   st = the model's smoothed animation state (steer, speedF, spinA, boosting, spinning, shieldS, ...)
 */
import { THREE, FX, WHITE, DRIFT_COLORS } from '../characters/parts.js';

export default {
  id: 'drift-sparks',
  build(rig, owned) {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const sparkMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.95, depthWrite: false });
    owned.materials.push(sparkMat);
    const sparks = new THREE.InstancedMesh(FX.spark, sparkMat, 24);
    sparks.frustumCulled = false;
    sparks.visible = false;
    sparks.renderOrder = 3;
    for (let i = 0; i < sparks.count; i++) sparks.setColorAt(i, new THREE.Color(WHITE));
    rig.root.add(sparks);
    let sparkLevel = -1;

    function update(t, dt, s) {
      const on = !!s.drifting && (s.speed ?? 1) !== 0;
      sparks.visible = on;
      if (!on) {
        sparkLevel = -1;
        return;
      }
      const level = Math.max(0, Math.min(3, s.driftLevel | 0));
      if (level !== sparkLevel && level < 3) {
        col.set(DRIFT_COLORS[level]);
        for (let i = 0; i < sparks.count; i++) sparks.setColorAt(i, col);
        sparks.instanceColor.needsUpdate = true;
      }
      sparkLevel = level;
      const size = level === 0 ? 0.9 : 1.3 + level * 0.35;
      const x0 = 0.8;
      for (let i = 0; i < sparks.count; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const ph = (t * (2.6 + level * 0.5) + i * 0.618) % 1;
        const spread = ((i * 0.37) % 1) - 0.5;
        dummy.position.set(side * (x0 + ph * (0.25 + spread * 0.4)), 0.1 + Math.sin(ph * Math.PI) * (0.35 + level * 0.12), -0.85 - ph * (0.9 + spread * 0.4));
        dummy.rotation.set(t * 7 + i, t * 5 + i * 2, 0);
        dummy.scale.setScalar(size * (1 - ph) * (0.7 + ((i * 0.53) % 1) * 0.6));
        dummy.updateMatrix();
        sparks.setMatrixAt(i, dummy.matrix);
        if (level === 3) {
          col.setHSL((t * 1.8 + i * 0.13) % 1, 0.95, 0.65);
          sparks.setColorAt(i, col);
        }
      }
      sparks.instanceMatrix.needsUpdate = true;
      if (level === 3) sparks.instanceColor.needsUpdate = true;
    }

    return { update, dispose: () => sparks.dispose(), sparks };
  },
};
