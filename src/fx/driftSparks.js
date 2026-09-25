/**
 * Drift sparks behind the rear wheels. OWNER: driving-feel workstream.
 * Restyle freely: this subtree is excluded from the visual golden
 * fingerprints (tests/visual.golden.test.js).
 *
 *   level 0  a few soft cream dust motes (sliding, no turbo yet)
 *   level 1  blue sparks + a blue glow at each rear wheel   (Mini-Turbo ready)
 *   level 2  pink, bigger, faster                           (Super Turbo ready)
 *   level 3  rainbow, the most sparks                       (Rainbow Turbo ready)
 * Every level-up "pops" (sparks and glows swell for a moment) so kids see the
 * colour change clearly.
 *
 * Effect module contract: see ./kartEffects.js.
 *   s  = raw model state from the Race (speed, drifting, driftLevel, boosting, shielded, spinning, star, ...)
 *   st = the model's smoothed animation state (steer, speedF, spinA, boosting, spinning, shieldS, ...)
 */
import { THREE, FX } from '../characters/parts.js';

/** Spark colour per drift level (level 3 cycles through the rainbow). */
export const SPARK_COLORS = Object.freeze([0xfff4c2, 0x5cc2ff, 0xff6fd2, 0xffffff]);
/** How many of the pooled sparks show per level (dust is sparse, rainbow is lavish). */
export const SPARKS_PER_LEVEL = Object.freeze([8, 20, 28, 36]);
export const MAX_SPARKS = 36;
/** Seconds a level-up pop lasts. */
export const POP_TIME = 0.3;

/** Spark size multiplier for a level (+ pop 0..1). */
export function sparkSize(level, pop = 0) {
  const l = Math.max(0, Math.min(3, level | 0));
  return (l === 0 ? 0.75 : 1.25 + l * 0.32) * (1 + 0.8 * Math.max(0, Math.min(1, pop)));
}

/** Rainbow colour for spark `i` at time t (level 3). */
export function rainbowHue(t, i) {
  const h = (t * 1.6 + i * 0.13) % 1;
  return h < 0 ? h + 1 : h;
}

export default {
  id: 'drift-sparks',
  build(rig, owned) {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const root = new THREE.Group();
    root.name = 'drift-sparks';
    root.visible = false;
    rig.root.add(root);

    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
    owned.materials.push(sparkMat);
    const sparks = new THREE.InstancedMesh(FX.spark, sparkMat, MAX_SPARKS);
    sparks.frustumCulled = false;
    sparks.renderOrder = 3;
    for (let i = 0; i < MAX_SPARKS; i++) sparks.setColorAt(i, col.set(0xffffff));
    root.add(sparks);

    // A soft glow ball at each rear wheel, coloured by the turbo level.
    const glowGeo = new THREE.IcosahedronGeometry(0.2, 1);
    owned.geometries.push(glowGeo);
    const glowMat = new THREE.MeshBasicMaterial({ color: SPARK_COLORS[1], transparent: true, opacity: 0.55, depthWrite: false });
    owned.materials.push(glowMat);
    const glows = [-1, 1].map((side) => {
      const m = new THREE.Mesh(glowGeo, glowMat);
      m.position.set(side * 0.8, 0.2, -0.9);
      m.renderOrder = 3;
      root.add(m);
      return m;
    });

    let level = -1;
    let pop = 0;

    function update(t, dt, s) {
      const on = !!s.drifting && (s.speed ?? 1) !== 0;
      const d = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
      if (!on) {
        level = -1;
        pop = 0;
        root.visible = false;
        return;
      }
      root.visible = true;
      const lv = Math.max(0, Math.min(3, s.driftLevel | 0));
      if (lv !== level) {
        if (lv > level && level >= 0) pop = 1; // level-up pop (not on the very first frame)
        level = lv;
        if (lv < 3) {
          col.set(SPARK_COLORS[lv]);
          for (let i = 0; i < MAX_SPARKS; i++) sparks.setColorAt(i, col);
          sparks.instanceColor.needsUpdate = true;
        }
      }
      pop = Math.max(0, pop - d / POP_TIME);
      const tt = Number.isFinite(t) ? t : 0;
      const size = sparkSize(lv, pop);
      const shown = SPARKS_PER_LEVEL[lv];
      const x0 = 0.8;
      for (let i = 0; i < MAX_SPARKS; i++) {
        if (i >= shown) {
          dummy.position.set(0, -50, 0);
          dummy.scale.setScalar(0);
        } else {
          const side = i % 2 === 0 ? 1 : -1;
          const ph = (tt * (2.4 + lv * 0.6) + i * 0.618) % 1;
          const spread = ((i * 0.37) % 1) - 0.5;
          const lift = lv === 0 ? 0.12 : 0.3 + lv * 0.14;
          dummy.position.set(
            side * (x0 + ph * (0.25 + spread * 0.5)),
            0.1 + Math.sin(ph * Math.PI) * lift,
            -0.85 - ph * (0.8 + lv * 0.2 + spread * 0.4),
          );
          dummy.rotation.set(tt * 7 + i, tt * 5 + i * 2, 0);
          dummy.scale.setScalar(size * (1 - ph) * (0.7 + ((i * 0.53) % 1) * 0.6));
        }
        dummy.updateMatrix();
        sparks.setMatrixAt(i, dummy.matrix);
        if (lv === 3) sparks.setColorAt(i, col.setHSL(rainbowHue(tt, i), 0.95, 0.66));
      }
      sparks.instanceMatrix.needsUpdate = true;
      if (lv === 3) sparks.instanceColor.needsUpdate = true;

      // Wheel glows: hidden for plain dust, pulse per level, swell on a pop.
      const glowOn = lv > 0;
      if (lv === 3) glowMat.color.setHSL(rainbowHue(tt, 0), 0.9, 0.7);
      else if (glowOn) glowMat.color.set(SPARK_COLORS[lv]);
      glowMat.opacity = 0.45 + 0.1 * lv;
      for (let g = 0; g < glows.length; g++) {
        glows[g].visible = glowOn;
        const pulse = 1 + 0.18 * Math.sin(tt * 22 + g * 1.7);
        glows[g].scale.setScalar((0.8 + 0.35 * lv) * pulse * (1 + 0.9 * pop));
      }
    }

    return {
      update,
      dispose: () => sparks.dispose(),
      sparks,
      glows,
      root,
      get level() { return level; },
      get pop() { return pop; },
    };
  },
};
