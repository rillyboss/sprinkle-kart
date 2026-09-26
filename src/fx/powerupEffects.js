/**
 * Power-up visuals on the kart model: the rainbow boost flame + puff + speed
 * lines, the bubble shield (glassy bubble, pink rim, sparkle band, floating
 * hearts), the "boing" squash & stretch and the dizzy stars during a happy
 * spin (bonked). OWNER: power-up clarity workstream. Restyle freely: this
 * subtree is excluded from the visual golden fingerprints.
 * (Race-level item FX such as the star aura and orbiting sprinkles live in src/race/KartFx.js.)
 *
 * Effect module contract: see ./kartEffects.js.
 */
import { THREE, FX, WHITE, TAU, RAINBOW, glow } from '../characters/parts.js';

/** Effects this module draws (see cueFor() in src/race/itemCatalog.js). */
export const FX_PROVIDES = Object.freeze(['rainbow-flame', 'flame-fade', 'speed-lines', 'shield-bubble', 'bubble-fade', 'dizzy-stars', 'boing-squash']);

const SPEED_LINES = 10;
const DIZZY = 5;

/**
 * Squash & stretch for the "boing!" of a bonk. `t` = seconds since the bonk.
 * Returns [sx, sy, sz]; settles to exactly [1, 1, 1] after ~0.9 s.
 */
export function boingScale(t) {
  if (!(t >= 0) || t > 0.9) return [1, 1, 1];
  const k = Math.exp(-t * 6) * Math.cos(t * 26);
  const sy = 1 - 0.38 * k;
  const sxz = 1 + 0.26 * k;
  return [sxz, sy, sxz];
}

/**
 * Glassy edge glow for the shield bubble: bright at the silhouette, clear in
 * the middle, so the bubble reads from the chase camera without hiding the kart.
 */
export function fresnelMaterial(color, opacity = 0.9, power = 2.2) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity }, power: { value: power } },
    vertexShader: 'varying vec3 vN; varying vec3 vV;\n'
      + 'void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 color; uniform float opacity; uniform float power; varying vec3 vN; varying vec3 vV;\n'
      + 'void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), power); gl_FragColor = vec4(color, clamp(f * opacity, 0.0, 1.0)); }',
    transparent: true,
    depthWrite: false,
  });
}

export default {
  id: 'powerup-effects',
  build(rig, owned) {
    const dummy = new THREE.Object3D();

    // --- rainbow boost flame + puff + speed lines
    const boost = new THREE.Group();
    boost.visible = false;
    rig.chassis.add(boost);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8fd0, transparent: true, opacity: 0.95, depthWrite: false });
    const flameMid = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95, depthWrite: false });
    const flameCore = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false });
    owned.materials.push(flameMat, flameMid, flameCore);
    const flames = rig.exhausts.map((p) => {
      const f = new THREE.Mesh(FX.flame, flameMat);
      f.position.copy(p);
      const mid = new THREE.Mesh(FX.flame, flameMid);
      mid.scale.setScalar(0.72);
      const core = new THREE.Mesh(FX.flame, flameCore);
      core.scale.setScalar(0.45);
      f.add(mid, core);
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
    const lineGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
    owned.geometries.push(lineGeo);
    const lineMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.75, depthWrite: false });
    owned.materials.push(lineMat);
    const lines = new THREE.InstancedMesh(lineGeo, lineMat, SPEED_LINES);
    lines.frustumCulled = false;
    boost.add(lines);
    let boostFade = 0; // 0..1, lets the flame shrink away instead of popping off

    // --- shield bubble with sparkle band + floating hearts
    const shield = new THREE.Group();
    shield.position.set(0, 0.95, -0.05);
    shield.visible = false;
    rig.root.add(shield);
    const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xa8ecff, transparent: true, opacity: 0.34, depthWrite: false });
    const rimMat = fresnelMaterial(0xff9fdc, 0.95);
    const shineMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.85, depthWrite: false });
    const heartMat = new THREE.MeshBasicMaterial({ color: 0xff7ac2, transparent: true, opacity: 0.95, depthWrite: false });
    const bandMat = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.7, depthWrite: false });
    owned.materials.push(bubbleMat, rimMat, shineMat, heartMat, bandMat);
    const bubble = new THREE.Mesh(FX.bubble, bubbleMat);
    bubble.scale.set(1.5, 1.3, 1.65);
    bubble.renderOrder = 4;
    const rim = new THREE.Mesh(FX.bubble, rimMat);
    rim.scale.set(1.58, 1.38, 1.73);
    rim.renderOrder = 4;
    const shine = new THREE.Mesh(FX.bubble, shineMat);
    shine.scale.set(0.34, 0.2, 0.06);
    shine.position.set(0.55, 0.7, 1.1);
    shine.rotation.set(-0.5, 0.45, 0.5);
    shine.renderOrder = 5;
    const shine2 = shine.clone();
    shine2.scale.set(0.16, 0.1, 0.04);
    shine2.position.set(-0.7, 0.55, 1.0);
    const bandGeo = new THREE.TorusGeometry(1.62, 0.035, 5, 48);
    owned.geometries.push(bandGeo);
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.rotation.x = Math.PI / 2;
    band.scale.set(1, 1.08, 1);
    band.renderOrder = 5;
    shield.add(bubble, rim, shine, shine2, band);
    const hearts = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const h = new THREE.Mesh(FX.heart, heartMat);
      const a = (i / 4) * TAU;
      h.position.set(Math.cos(a) * 1.3, 0.2 * i - 0.2, Math.sin(a) * 1.4);
      h.scale.setScalar(1.4);
      hearts.add(h);
    }
    shield.add(hearts);

    // --- dizzy stars circling the head during a happy spin
    const dizzy = new THREE.Group();
    dizzy.position.set(0, 0.7, 0);
    dizzy.visible = false;
    rig.head.add(dizzy);
    const dizzyMat = glow(0xffe45c);
    const dizzyMat2 = glow(0xffffff);
    for (let i = 0; i < DIZZY; i++) {
      const s = new THREE.Mesh(FX.star, i % 2 ? dizzyMat2 : dizzyMat);
      const a = (i / DIZZY) * TAU;
      s.position.set(Math.cos(a) * 0.62, Math.sin(a * 2) * 0.08, Math.sin(a) * 0.62);
      s.scale.setScalar(i % 2 ? 2.2 : 3.2);
      dizzy.add(s);
    }

    let wasSpinning = false;
    let bonkT = 9;
    let shieldPop = 0; // >0 while the bubble "blips" away

    function updateBoost(t, dt, on) {
      boostFade = on ? Math.min(1, boostFade + dt * 10) : Math.max(0, boostFade - dt * 4);
      boost.visible = boostFade > 0.01;
      if (!boost.visible) return;
      const hue = (t * 1.6) % 1;
      flameMat.color.setHSL(hue, 1, 0.66);
      flameMid.color.setHSL((hue + 0.33) % 1, 1, 0.72);
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        const fl = (0.95 + Math.sin(t * 40 + i * 2) * 0.22) * boostFade;
        f.scale.set(fl * 1.35, fl * 1.35, (1.25 + Math.sin(t * 33 + i) * 0.4) * boostFade);
        f.position.z = rig.exhausts[i].z - 0.2;
      }
      const ex = rig.exhausts;
      for (let i = 0; i < puff.count; i++) {
        const e = ex[i % ex.length];
        const ph = (t * 2.4 + i / puff.count) % 1;
        const j = ((i * 0.61) % 1) - 0.5;
        dummy.position.set(e.x + j * 0.6 * ph, e.y + 0.05 + ph * 0.7 + j * 0.12, e.z - 0.2 - ph * 1.8);
        dummy.rotation.set(t * 3 + i, t * 2, 0);
        dummy.scale.setScalar((0.45 + ph * 1.2) * (1 - ph * ph) * boostFade);
        dummy.updateMatrix();
        puff.setMatrixAt(i, dummy.matrix);
      }
      puff.instanceMatrix.needsUpdate = true;
      // speed lines: long white streaks whooshing past the kart
      for (let i = 0; i < SPEED_LINES; i++) {
        const a = (i / SPEED_LINES) * TAU + 0.3;
        const ph = (t * 3.2 + ((i * 0.37) % 1)) % 1;
        dummy.position.set(Math.cos(a) * 1.25, 0.75 + Math.sin(a) * 0.65, 1.6 - ph * 4.2);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, (1.4 + (i % 3) * 0.4) * (1 - Math.abs(ph - 0.5) * 1.4) * boostFade);
        dummy.updateMatrix();
        lines.setMatrixAt(i, dummy.matrix);
      }
      lines.instanceMatrix.needsUpdate = true;
      lineMat.opacity = 0.7 * boostFade;
    }

    function update(t, dt, s, st) {
      updateBoost(t, dt, !!st.boosting);

      const wasShield = st.shieldS > 0.5;
      st.shieldS += ((s.shielded ? 1 : 0) - st.shieldS) * (1 - Math.exp(-dt * 12));
      if (wasShield && !s.shielded) shieldPop = 0.25;
      shieldPop = Math.max(0, shieldPop - dt);
      shield.visible = st.shieldS > 0.02;
      if (shield.visible) {
        const w = Math.sin(t * 5) * 0.035;
        const pop = shieldPop > 0 ? 1 + (0.25 - shieldPop) * 1.6 : 1; // swells as it pops
        const k = st.shieldS * pop;
        shield.scale.set(k * (1 + w), k * (1 - w), k * (1 + w * 0.5));
        hearts.rotation.y = t * 1.2;
        band.rotation.z = t * 0.9;
        band.rotation.x = Math.PI / 2 + Math.sin(t * 1.7) * 0.25;
        bubbleMat.opacity = 0.3 + Math.sin(t * 3) * 0.06;
        rimMat.uniforms.color.value.setHSL((0.88 + Math.sin(t * 0.7) * 0.08 + 1) % 1, 0.9, 0.72);
      }

      // "boing!" squash & stretch when a happy spin starts, then dizzy stars
      if (st.spinning && !wasSpinning) bonkT = 0;
      wasSpinning = !!st.spinning;
      bonkT += dt;
      const [sx, sy, sz] = boingScale(bonkT);
      rig.root.scale.set(sx, sy, sz);
      dizzy.visible = !!st.spinning;
      if (st.spinning) {
        dizzy.rotation.y = -st.spinA * 1.3 + t * 4;
        dizzy.position.y = 0.7 + Math.sin(t * 8) * 0.05;
      }
    }

    return { update, dispose: () => { puff.dispose(); lines.dispose(); }, boost, shield, dizzy };
  },
};
