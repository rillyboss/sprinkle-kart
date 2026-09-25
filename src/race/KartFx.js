import * as THREE from 'three';
import { glow, toon } from '../render/toon.js';

const RAINBOW = [0xff6fb5, 0xffa94d, 0xffe066, 0x7ee07e, 0x6fc3ff, 0xb48cff];
const SPRINKLE = [0xff6fb5, 0xffe066, 0x6fc3ff];

let geo = null;
function geos() {
  if (!geo) {
    geo = {
      star: new THREE.OctahedronGeometry(0.2, 0),
      sprinkle: new THREE.CapsuleGeometry(0.12, 0.42, 3, 8),
    };
  }
  return geo;
}

/**
 * Per-kart extra sparkle that the kart model does not handle itself:
 * a rainbow-star aura and orbiting triple-sprinkle charges.
 */
export class KartFx {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'kart-fx';
    const g = geos();
    this.stars = new THREE.Group();
    RAINBOW.forEach((c, i) => {
      const m = new THREE.Mesh(g.star, glow(c));
      m.userData.a = (i / RAINBOW.length) * Math.PI * 2;
      this.stars.add(m);
    });
    this.stars.visible = false;
    this.group.add(this.stars);
    this.sprinkles = new THREE.Group();
    SPRINKLE.forEach((c, i) => {
      const m = new THREE.Mesh(g.sprinkle, toon(c, { emissive: c, emissiveIntensity: 0.35 }));
      m.userData.a = (i / 3) * Math.PI * 2;
      this.sprinkles.add(m);
    });
    this.group.add(this.sprinkles);
    scene.add(this.group);
  }

  update(kart, time) {
    this.group.position.copy(kart.position);
    const star = kart.starPower > 0;
    this.stars.visible = star;
    if (star) {
      const blink = kart.starPower < 1.2 ? (Math.sin(time * 30) > 0 ? 1 : 0.4) : 1;
      this.stars.children.forEach((m, i) => {
        const a = m.userData.a + time * 4.5;
        m.position.set(Math.cos(a) * 1.7, 0.9 + Math.sin(time * 6 + i) * 0.45, Math.sin(a) * 1.7);
        m.rotation.y = time * 8;
        m.scale.setScalar(blink * (0.9 + Math.sin(time * 12 + i) * 0.3));
      });
    }
    const charges = kart.item === 'triple-sprinkle' && kart.itemRoulette <= 0 ? kart.itemCharges : 0;
    this.sprinkles.children.forEach((m, i) => {
      m.visible = i < charges;
      if (!m.visible) return;
      const a = m.userData.a + time * 3;
      m.position.set(Math.cos(a) * 1.55, 0.8, Math.sin(a) * 1.55);
      m.rotation.set(time * 3 + i, a, 0.8);
    });
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
