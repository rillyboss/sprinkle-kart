import * as THREE from 'three';
import { glow, toon } from '../render/toon.js';
import { TUNING as T } from './tuning.js';

const RAINBOW = [0xff6fb5, 0xffa94d, 0xffe066, 0x7ee07e, 0x6fc3ff, 0xb48cff];
const SPRINKLE = [0xff6fb5, 0xffe066, 0x6fc3ff];
const TRAIL = 18;

/** Race-level kart effects drawn here (see cueFor() in ./itemCatalog.js). */
export const FX_PROVIDES = Object.freeze(['star-aura', 'sprinkle-orbit']);

let geo = null;
function geos() {
  if (!geo) {
    geo = {
      star: new THREE.OctahedronGeometry(0.28, 0),
      sprinkle: new THREE.CapsuleGeometry(0.16, 0.5, 3, 8),
      shell: new THREE.SphereGeometry(1, 20, 14),
      ring: new THREE.RingGeometry(1.7, 2.3, 40).rotateX(-Math.PI / 2),
      spark: new THREE.OctahedronGeometry(0.16, 0),
    };
  }
  return geo;
}

/** Star power left as 0..1 (1 = just used). */
export function starFraction(kart) {
  return Math.max(0, Math.min(1, (kart?.starPower ?? 0) / T.starDuration));
}

/**
 * Per-kart extra sparkle that the kart model does not handle itself:
 * the Rainbow Star aura (colour-cycling rainbow shell, ground ring, orbiting
 * stars, sparkle trail) and the orbiting Triple Sprinkle charges.
 */
export class KartFx {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'kart-fx';
    const g = geos();

    // --- Rainbow Star
    this.star = new THREE.Group();
    this.star.visible = false;
    this.group.add(this.star);
    // additive, so the star makes the kart GLOW brighter instead of greying its colours under a tinted film
    this.shellMat = new THREE.MeshBasicMaterial({ color: 0xff6fb5, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    this.shellMat2 = new THREE.MeshBasicMaterial({ color: 0x6fc3ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending });
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.6, depthWrite: false });
    this.shell = new THREE.Mesh(g.shell, this.shellMat);
    this.shell.scale.set(1.35, 1.05, 1.75);
    this.shell.position.y = 0.85;
    this.shell.renderOrder = 5;
    this.shell2 = new THREE.Mesh(g.shell, this.shellMat2);
    this.shell2.scale.set(1.6, 1.25, 2.05);
    this.shell2.position.y = 0.85;
    this.shell2.renderOrder = 5;
    this.ring = new THREE.Mesh(g.ring, this.ringMat);
    this.ring.position.y = 0.12;
    this.ring.renderOrder = 3;
    this.star.add(this.shell, this.shell2, this.ring);
    this.stars = new THREE.Group();
    RAINBOW.forEach((c, i) => {
      const m = new THREE.Mesh(g.star, glow(c));
      m.userData.a = (i / RAINBOW.length) * Math.PI * 2;
      this.stars.add(m);
    });
    this.star.add(this.stars);
    // sparkle trail (world space, so it streams out behind the kart)
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.trail = new THREE.InstancedMesh(g.spark, this.trailMat, TRAIL);
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    const col = new THREE.Color();
    for (let i = 0; i < TRAIL; i++) this.trail.setColorAt(i, col.set(RAINBOW[i % RAINBOW.length]));
    this._trail = Array.from({ length: TRAIL }, () => ({ x: 0, y: -999, z: 0, t: 1 }));
    this._trailNext = 0;
    this._trailAcc = 0;
    this._lastTime = null;
    this._dummy = new THREE.Object3D();
    scene.add(this.trail);

    // --- Triple Sprinkle charges
    this.sprinkles = new THREE.Group();
    SPRINKLE.forEach((c, i) => {
      const m = new THREE.Mesh(g.sprinkle, toon(c, { emissive: c, emissiveIntensity: 0.45 }));
      m.userData.a = (i / 3) * Math.PI * 2;
      this.sprinkles.add(m);
    });
    this.group.add(this.sprinkles);
    scene.add(this.group);
  }

  update(kart, time) {
    const dt = this._lastTime === null ? 0 : Math.max(0, Math.min(0.1, time - this._lastTime));
    this._lastTime = time;
    this.group.position.copy(kart.position);
    this.group.rotation.y = kart.heading ?? 0;
    const star = kart.starPower > 0;
    this.star.visible = star;
    if (star) {
      const frac = starFraction(kart);
      // blink faster in the last second and a bit so "it's ending" is readable
      const ending = kart.starPower < 1.4;
      const blink = ending ? (Math.sin(time * 26) > 0 ? 1 : 0.35) : 1;
      const hue = (time * 1.4) % 1;
      this.shellMat.color.setHSL(hue, 1, 0.6);
      this.shellMat2.color.setHSL((hue + 0.45) % 1, 1, 0.6);
      this.ringMat.color.setHSL((hue + 0.2) % 1, 1, 0.65);
      this.shellMat.opacity = (0.26 + Math.sin(time * 9) * 0.06) * blink;
      this.shellMat2.opacity = 0.2 * blink;
      this.ringMat.opacity = 0.55 * blink;
      const pulse = 1 + Math.sin(time * 10) * 0.05;
      this.shell.scale.set(1.35 * pulse, 1.05 * pulse, 1.75 * pulse);
      this.ring.scale.setScalar(0.85 + frac * 0.3 + Math.sin(time * 6) * 0.04);
      this.stars.children.forEach((m, i) => {
        const a = m.userData.a + time * 4.5;
        m.position.set(Math.cos(a) * 1.9, 1 + Math.sin(time * 6 + i) * 0.5, Math.sin(a) * 2.1);
        m.rotation.y = time * 8;
        m.scale.setScalar(blink * (0.9 + Math.sin(time * 12 + i) * 0.3));
      });
    }
    this._updateTrail(kart, dt, star);

    const charges = kart.item === 'triple-sprinkle' && kart.itemRoulette <= 0 ? kart.itemCharges : 0;
    this.sprinkles.children.forEach((m, i) => {
      m.visible = i < charges;
      if (!m.visible) return;
      const a = m.userData.a + time * 3;
      m.position.set(Math.cos(a) * 1.7, 1.0 + Math.sin(time * 4 + i) * 0.12, Math.sin(a) * 1.9);
      m.rotation.set(time * 3 + i, a, 0.8);
    });
  }

  _updateTrail(kart, dt, star) {
    if (!star && !this.trail.visible) return; // nothing live: skip the per-frame matrix work
    const d = this._dummy;
    let any = false;
    if (star) {
      this._trailAcc += dt;
      while (this._trailAcc > 0.045) {
        this._trailAcc -= 0.045;
        const p = this._trail[this._trailNext];
        this._trailNext = (this._trailNext + 1) % TRAIL;
        const h = kart.heading ?? 0;
        const side = (this._trailNext % 3) - 1;
        p.x = kart.position.x - Math.sin(h) * 1.3 + Math.cos(h) * side * 0.6;
        p.y = kart.position.y + 0.5 + (this._trailNext % 4) * 0.25;
        p.z = kart.position.z - Math.cos(h) * 1.3 - Math.sin(h) * side * 0.6;
        p.t = 0;
      }
    }
    for (let i = 0; i < TRAIL; i++) {
      const p = this._trail[i];
      if (p.t < 1) { p.t = Math.min(1, p.t + dt / 0.6); p.y += dt * 0.8; any = true; }
      const s = p.t < 1 ? (1 - p.t) * 1.3 : 0;
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.t * 6, p.t * 4, 0);
      d.scale.setScalar(Math.max(0.0001, s));
      d.updateMatrix();
      this.trail.setMatrixAt(i, d.matrix);
    }
    this.trail.visible = any;
    if (any) this.trail.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.trail);
    this.trail.dispose();
    for (const m of [this.shellMat, this.shellMat2, this.ringMat, this.trailMat]) m.dispose();
  }
}
