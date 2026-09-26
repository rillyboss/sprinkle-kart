/**
 * Kart-level power-up visuals: rainbow flame + speed lines, the fresnel shield
 * bubble, boing squash & stretch, dizzy stars (src/fx/powerupEffects.js) and
 * the Rainbow Star aura / Triple Sprinkle orbit (src/race/KartFx.js).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CHARACTERS } from '../src/characters/index.js';
import { buildKartModel } from '../src/characters/model.js';
import { boingScale, fresnelMaterial } from '../src/fx/powerupEffects.js';
import { KartFx, starFraction } from '../src/race/KartFx.js';
import { shimmerBoxes, buildItemBoxMesh, carry } from '../src/race/ItemBoxes.js';
import { buildRocketMesh, buildGumdropMesh, ROCKET_SCALE } from '../src/race/Items.js';
import { TUNING } from '../src/race/tuning.js';

const run = (m, n, state) => { for (let i = 0; i < n; i++) m.update(1 / 60, state); };
function fxOf(m) {
  // the effect groups are the tagged children; find them by what they contain
  const tagged = [];
  m.group.traverse((o) => { if (o.userData.kartFx === 'powerup-effects') tagged.push(o); });
  return tagged;
}

describe('boing squash & stretch', () => {
  it('squashes on impact, wobbles, then settles exactly back to 1', () => {
    const [sx0, sy0] = boingScale(0);
    expect(sy0).toBeLessThan(0.7);
    expect(sx0).toBeGreaterThan(1.2);
    const later = boingScale(0.12);
    expect(later[1]).toBeGreaterThan(1); // stretches back up
    expect(boingScale(1)).toEqual([1, 1, 1]);
    expect(boingScale(-1)).toEqual([1, 1, 1]);
    expect(boingScale(NaN)).toEqual([1, 1, 1]);
    for (let t = 0; t < 0.9; t += 0.01) for (const v of boingScale(t)) expect(v).toBeGreaterThan(0.5);
  });
});

describe('power-up effects on a real kart', { timeout: 30000 }, () => {
  const def = CHARACTERS[0];

  it('boost shows the flame + speed lines and fades out after', () => {
    const m = buildKartModel(def);
    run(m, 10, { speed: 25, boosting: true });
    const visible = fxOf(m).filter((o) => o.visible);
    expect(visible.length).toBeGreaterThan(0);
    const lines = [];
    m.group.traverse((o) => { if (o.isInstancedMesh && o.count === 10) lines.push(o); });
    expect(lines.length).toBe(1);
    expect(Array.from(lines[0].instanceMatrix.array).every(Number.isFinite)).toBe(true);
    run(m, 60, { speed: 25 });
    expect(fxOf(m).every((o) => !o.visible)).toBe(true);
    m.dispose();
  });

  it('the shield bubble uses a see-through fresnel rim and is visible while shielded', () => {
    const m = buildKartModel(def);
    run(m, 30, { speed: 10, shielded: true });
    let shader = null;
    m.group.traverse((o) => { if (o.material?.isShaderMaterial) shader = o.material; });
    expect(shader).toBeTruthy();
    expect(shader.transparent).toBe(true);
    expect(shader.depthWrite).toBe(false);
    expect(fxOf(m).some((o) => o.visible)).toBe(true);
    m.dispose();
  });

  it('a happy spin boings the kart and brings out the dizzy stars; scale returns to 1', () => {
    const m = buildKartModel(def);
    run(m, 5, { speed: 10 });
    // the shield bubble group (0, 0.95, -0.05) hangs off rig.root, the node that squashes
    const shield = fxOf(m).find((o) => Math.abs(o.position.y - 0.95) < 1e-6 && Math.abs(o.position.z + 0.05) < 1e-6);
    const root = shield.parent;
    expect(root.scale.y).toBe(1);
    m.update(1 / 60, { speed: 5, spinning: true });
    expect(root.scale.y).toBeLessThan(0.8);
    expect(root.scale.x).toBeGreaterThan(1.15);
    expect(fxOf(m).some((o) => o.visible)).toBe(true); // dizzy stars
    run(m, 60, { speed: 5, spinning: true });
    run(m, 60, { speed: 10 });
    expect(root.scale.y).toBe(1);
    expect(root.scale.x).toBe(1);
    m.dispose();
  });

  it('fresnelMaterial is a transparent shader with colour + opacity uniforms', () => {
    const mat = fresnelMaterial(0xff00ff, 0.5);
    expect(mat.isShaderMaterial).toBe(true);
    expect(mat.uniforms.opacity.value).toBe(0.5);
    expect(mat.uniforms.color.value.getHex()).toBe(0xff00ff);
    expect(mat.fragmentShader).toMatch(/gl_FragColor/);
    mat.dispose();
  });
});

const fakeKart = (extra = {}) => ({ position: new THREE.Vector3(1, 0, 2), heading: 0.5, starPower: 0, item: null, itemCharges: 0, itemRoulette: 0, ...extra });

describe('KartFx (race-level aura)', () => {
  it('Rainbow Star: colour-cycling shell, ring, orbiting stars and a sparkle trail', () => {
    const scene = new THREE.Scene();
    const fx = new KartFx(scene);
    const k = fakeKart({ starPower: TUNING.starDuration });
    fx.update(k, 0);
    expect(fx.star.visible).toBe(true);
    const c0 = fx.shellMat.color.getHex();
    for (let i = 1; i < 30; i++) fx.update(k, i / 60);
    expect(fx.shellMat.color.getHex()).not.toBe(c0); // colours cycle
    expect(fx.trail.visible).toBe(true);
    expect(Array.from(fx.trail.instanceMatrix.array).every(Number.isFinite)).toBe(true);
    k.starPower = 0;
    for (let i = 30; i < 90; i++) fx.update(k, i / 60);
    expect(fx.star.visible).toBe(false);
    expect(fx.trail.visible).toBe(false); // trail sparkles fade out after the star ends
    fx.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('Triple Sprinkle: one orbiting sprinkle per charge (hidden while rolling)', () => {
    const fx = new KartFx(new THREE.Scene());
    for (const n of [3, 2, 1, 0]) {
      fx.update(fakeKart({ item: n ? 'triple-sprinkle' : null, itemCharges: n }), 1);
      expect(fx.sprinkles.children.filter((c) => c.visible)).toHaveLength(n);
    }
    fx.update(fakeKart({ item: 'triple-sprinkle', itemCharges: 3, itemRoulette: 0.5 }), 1);
    expect(fx.sprinkles.children.filter((c) => c.visible)).toHaveLength(0);
  });

  it('starFraction', () => {
    expect(starFraction(fakeKart({ starPower: TUNING.starDuration }))).toBe(1);
    expect(starFraction(fakeKart())).toBe(0);
    expect(starFraction(null)).toBe(0);
  });
});

describe('item meshes', () => {
  it('item boxes shimmer through the rainbow (shared materials, no NaN)', () => {
    const box = buildItemBoxMesh();
    const halo = box.getObjectByName('halo');
    shimmerBoxes(0);
    const a = halo.material.color.getHex();
    shimmerBoxes(1.3);
    expect(halo.material.color.getHex()).not.toBe(a);
    expect(Number.isFinite(box.getObjectByName('glow').material.opacity)).toBe(true);
  });

  it('the rocket is scaled up with a halo; the gumdrop has a face and a jelly group', () => {
    const r = buildRocketMesh();
    expect(r.getObjectByName('body').scale.x).toBe(ROCKET_SCALE);
    expect(r.getObjectByName('halo')).toBeTruthy();
    const g = buildGumdropMesh(0xff00ff);
    expect(g.getObjectByName('jelly')).toBeTruthy();
  });

  it('carry() follows the kart velocity and survives junk', () => {
    expect(carry({ velocity: { x: 10, z: -20 } })).toEqual({ x: 8.5, z: -17 });
    expect(carry({})).toEqual({ x: 0, z: 0 });
    expect(carry({ velocity: { x: NaN, z: 1 } })).toEqual({ x: 0, z: 0 });
  });
});

describe('Rainbow Star glow (play-test: the kart looked muddy under the star)', () => {
  it('both star shells blend additively, so the kart brightens instead of turning grey-brown', async () => {
    const THREE = await import('three');
    const { KartFx } = await import('../src/race/KartFx.js');
    const fx = new KartFx(new THREE.Scene());
    expect(fx.shellMat.blending).toBe(THREE.AdditiveBlending);
    expect(fx.shellMat2.blending).toBe(THREE.AdditiveBlending);
    expect(fx.shellMat.depthWrite).toBe(false);
    fx.dispose?.();
  });
});
