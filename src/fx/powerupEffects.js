/**
 * Power-up visuals on the kart model: the rainbow boost puff + exhaust
 * flames, the bubble shield with floating hearts, and the dizzy stars during
 * a happy spin (bonked). OWNER: power-up clarity workstream. Restyle freely:
 * this subtree is excluded from the visual golden fingerprints.
 * (Race-level item FX such as the star aura and orbiting sprinkles live in src/race/KartFx.js.)
 *
 * Effect module contract: see ./kartEffects.js.
 */
import { THREE, FX, WHITE, TAU, RAINBOW, glow } from '../characters/parts.js';

export default {
  id: 'powerup-effects',
  build(rig, owned) {
    const dummy = new THREE.Object3D();

    // sparkly rainbow boost puff + little flames
    const boost = new THREE.Group();
    boost.visible = false;
    rig.chassis.add(boost);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd9f0, transparent: true, opacity: 0.9, depthWrite: false });
    const flameCore = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
    owned.materials.push(flameMat, flameCore);
    const flames = rig.exhausts.map((p) => {
      const f = new THREE.Mesh(FX.flame, flameMat);
      f.position.copy(p);
      const core = new THREE.Mesh(FX.flame, flameCore);
      core.scale.setScalar(0.55);
      f.add(core);
      boost.add(f);
      return f;
    });
    const puffMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.9, depthWrite: false });
    owned.materials.push(puffMat);
    const puff = new THREE.InstancedMesh(FX.puff, puffMat, 16);
    puff.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < puff.count; i++) puff.setColorAt(i, col.set(RAINBOW[i % RAINBOW.length]));
    boost.add(puff);

    // shield bubble with floating hearts
    const shield = new THREE.Group();
    shield.position.set(0, 0.95, -0.05);
    shield.visible = false;
    rig.root.add(shield);
    const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xa8ecff, transparent: true, opacity: 0.3, depthWrite: false });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xff9fdc, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.BackSide });
    const shineMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.75, depthWrite: false });
    const heartMat = new THREE.MeshBasicMaterial({ color: 0xff7ac2, transparent: true, opacity: 0.9, depthWrite: false });
    owned.materials.push(bubbleMat, rimMat, shineMat, heartMat);
    const bubble = new THREE.Mesh(FX.bubble, bubbleMat);
    bubble.scale.set(1.45, 1.25, 1.6);
    bubble.renderOrder = 4;
    const rim = new THREE.Mesh(FX.bubble, rimMat);
    rim.scale.set(1.5, 1.3, 1.65);
    rim.renderOrder = 4;
    const shine = new THREE.Mesh(FX.bubble, shineMat);
    shine.scale.set(0.28, 0.16, 0.05);
    shine.position.set(0.55, 0.65, 1.1);
    shine.rotation.set(-0.5, 0.45, 0.5);
    shine.renderOrder = 5;
    shield.add(bubble, rim, shine);
    const hearts = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const h = new THREE.Mesh(FX.heart, heartMat);
      const a = (i / 3) * TAU;
      h.position.set(Math.cos(a) * 1.25, 0.2 * i - 0.1, Math.sin(a) * 1.35);
      hearts.add(h);
    }
    shield.add(hearts);

    // dizzy stars circling the head during a happy spin
    const dizzy = new THREE.Group();
    dizzy.position.set(0, 0.62, 0);
    dizzy.visible = false;
    rig.head.add(dizzy);
    const dizzyMat = glow(0xffe45c);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(FX.star, dizzyMat);
      const a = (i / 3) * TAU;
      s.position.set(Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42);
      s.scale.setScalar(1.3);
      dizzy.add(s);
    }

    function updateBoost(t, on) {
      boost.visible = on;
      if (!on) return;
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        const fl = 0.85 + Math.sin(t * 40 + i * 2) * 0.2;
        f.scale.set(fl, fl, 0.9 + Math.sin(t * 33 + i) * 0.35);
        f.position.z = rig.exhausts[i].z - 0.15;
      }
      const ex = rig.exhausts;
      for (let i = 0; i < puff.count; i++) {
        const e = ex[i % ex.length];
        const ph = (t * 2.4 + i / puff.count) % 1;
        const j = ((i * 0.61) % 1) - 0.5;
        dummy.position.set(e.x + j * 0.6 * ph, e.y + 0.05 + ph * 0.7 + j * 0.12, e.z - 0.2 - ph * 1.8);
        dummy.rotation.set(t * 3 + i, t * 2, 0);
        dummy.scale.setScalar((0.45 + ph * 1.2) * (1 - ph * ph));
        dummy.updateMatrix();
        puff.setMatrixAt(i, dummy.matrix);
      }
      puff.instanceMatrix.needsUpdate = true;
    }

    function update(t, dt, s, st) {
      updateBoost(t, st.boosting);
      st.shieldS += ((s.shielded ? 1 : 0) - st.shieldS) * (1 - Math.exp(-dt * 12));
      shield.visible = st.shieldS > 0.02;
      if (shield.visible) {
        const w = Math.sin(t * 5) * 0.03;
        shield.scale.set(st.shieldS * (1 + w), st.shieldS * (1 - w), st.shieldS * (1 + w * 0.5));
        hearts.rotation.y = t * 1.2;
        bubbleMat.opacity = 0.26 + Math.sin(t * 3) * 0.06;
      }
      dizzy.visible = st.spinning;
      if (st.spinning) dizzy.rotation.y = -st.spinA * 1.3 + t * 3;
    }

    return { update, dispose: () => puff.dispose(), boost, shield, dizzy };
  },
};
