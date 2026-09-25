/**
 * Kart-model effects (src/fx/): drift sparks (driving feel) and the power-up
 * visuals (boost puff, shield bubble, dizzy stars). They are split out of the
 * frozen model code so their owners can restyle them; these checks keep them
 * safe for every racer.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CHARACTERS } from '../src/characters/index.js';
import { buildKartModel } from '../src/characters/model.js';
import { buildKartEffects, EFFECT_MODULES } from '../src/fx/kartEffects.js';
import { fingerprint } from './helpers/fingerprint.js';

const STATES = [
  { speed: 20, drifting: true, driftLevel: 0 },
  { speed: 20, drifting: true, driftLevel: 1 },
  { speed: 20, drifting: true, driftLevel: 2 },
  { speed: 20, drifting: true, driftLevel: 3 },
  { speed: 25, boosting: true },
  { speed: 10, shielded: true },
  { speed: 5, spinning: true },
  { speed: 0, star: true, boosting: true, shielded: true, drifting: true, driftLevel: 3 },
  {},
];

const fxNodes = (group) => {
  const out = [];
  group.traverse((o) => { if (o.userData.kartFx) out.push(o); });
  return out;
};

function finiteTree(group) {
  let ok = true;
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o.matrixWorld.elements.some((v) => !Number.isFinite(v))) ok = false;
    if (o.isInstancedMesh && o.instanceMatrix.array.some((v) => !Number.isFinite(v))) ok = false;
  });
  return ok;
}

describe('kart effects host', () => {
  it('registers drift sparks and power-up effects with unique ids', () => {
    const ids = EFFECT_MODULES.map((m) => m.id);
    expect(ids).toEqual(['drift-sparks', 'powerup-effects']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags every node an effect module adds, and only those', () => {
    const rig = { root: new THREE.Group(), chassis: new THREE.Group(), driver: new THREE.Group(), head: new THREE.Group(), exhausts: [] };
    const before = new THREE.Mesh();
    rig.root.add(before);
    const owned = { geometries: [], materials: [] };
    const fx = buildKartEffects(rig, owned, [{ id: 'mine', build(r) { r.chassis.add(new THREE.Group()); r.head.add(new THREE.Group()); return { update() {} }; } }]);
    expect(before.userData.kartFx).toBeUndefined();
    expect(rig.chassis.children[0].userData.kartFx).toBe('mine');
    expect(rig.head.children[0].userData.kartFx).toBe('mine');
    expect(Object.keys(fx.parts)).toEqual(['mine']);
    expect(() => { fx.update(0, 0, {}, {}); fx.dispose(); }).not.toThrow();
  });

  for (const def of CHARACTERS) {
    it(`${def.id}: effects animate every state without NaNs and show the right parts`, () => {
      const m = buildKartModel(def);
      const tagged = fxNodes(m.group);
      expect(new Set(tagged.map((o) => o.userData.kartFx))).toEqual(new Set(['drift-sparks', 'powerup-effects']));
      for (let i = 0; i < 120; i++) m.update(1 / 60, STATES[i % STATES.length]);
      expect(finiteTree(m.group)).toBe(true);

      for (let i = 0; i < 20; i++) m.update(1 / 60, { speed: 20, drifting: true, driftLevel: 2 });
      const sparks = tagged.find((o) => o.userData.kartFx === 'drift-sparks');
      expect(sparks.visible).toBe(true);
      for (let i = 0; i < 40; i++) m.update(1 / 60, { speed: 20 });
      expect(sparks.visible).toBe(false);
      expect(tagged.filter((o) => o.userData.kartFx === 'powerup-effects').every((o) => !o.visible)).toBe(true);

      // the golden fingerprint ignores effects entirely
      const withFx = fingerprint(m.group, { animated: true });
      const noFx = fingerprint(m.group, { animated: true, skipKartFx: true });
      expect(noFx.length).toBeLessThan(withFx.length);
      expect(noFx.every((line) => withFx.includes(line))).toBe(true);
      m.dispose();
    });
  }
});
