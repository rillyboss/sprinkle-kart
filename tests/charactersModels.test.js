import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CHARACTERS } from '../src/data/characters.js';
import { buildKartModel, MODELLED_CHARACTER_IDS } from '../src/render/characterModels.js';
import { renderPortraits } from '../src/render/portraits.js';

const STATES = [
  {},
  { speed: 0, steer: 0, time: 0 },
  { speed: 30, steer: 1, drifting: true, driftLevel: 1, time: 1 },
  { speed: 28, steer: -1, drifting: true, driftLevel: 2, time: 2 },
  { speed: 32, steer: -0.4, drifting: true, driftLevel: 3, boosting: true, time: 3 },
  { speed: 10, steer: 0, spinning: true, shielded: true, time: 4 },
  { speed: -5, steer: 0.3, happy: true, time: 5 },
];

function visibleBox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const b = new THREE.Box3();
  root.traverseVisible((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    o.geometry.computeBoundingBox();
    b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(b);
  });
  return box;
}

function assertFinite(root) {
  root.traverse((o) => {
    for (const v of [o.position.x, o.position.y, o.position.z, o.rotation.x, o.rotation.y, o.rotation.z, o.scale.x, o.scale.y, o.scale.z]) {
      expect(Number.isFinite(v), `${o.name || o.type}`).toBe(true);
    }
  });
}

describe('buildKartModel', () => {
  it('has a hand-built model for every roster character', () => {
    for (const c of CHARACTERS) expect(MODELLED_CHARACTER_IDS).toContain(c.id);
  });

  for (const def of CHARACTERS) {
    it(`builds and animates ${def.id}`, () => {
      const m = buildKartModel(def);
      expect(m.group).toBeInstanceOf(THREE.Group);
      expect(m.characterId).toBe(def.id);
      expect(m.head).toBeInstanceOf(THREE.Object3D);

      // kart-sized, sits on the ground, forward is +Z
      const box = visibleBox(m.group);
      const size = box.getSize(new THREE.Vector3());
      expect(size.z).toBeGreaterThan(1.9);
      expect(size.z).toBeLessThan(3.0);
      expect(size.x).toBeGreaterThan(1.3);
      expect(size.x).toBeLessThan(2.4);
      expect(box.min.y).toBeGreaterThan(-0.05);
      expect(box.min.y).toBeLessThan(0.1);
      expect(m.head.getWorldPosition(new THREE.Vector3()).z).toBeLessThan(0.2);

      // reasonably light (the game draws 8 karts in up to 4 viewports)
      expect(m.triangles).toBeGreaterThan(1000);
      expect(m.triangles).toBeLessThan(25000);

      for (let i = 0; i < 90; i++) m.update(1 / 60, STATES[i % STATES.length]);
      m.update(1 / 60, undefined);
      m.update(NaN, { speed: NaN, steer: NaN });
      m.update(5, { speed: 20 }); // huge dt is clamped
      assertFinite(m.group);
      m.dispose();
      m.dispose(); // idempotent
    });
  }

  it('builds a generic racer for unknown characters', () => {
    const m = buildKartModel({ id: 'mystery', colors: { primary: 0x123456, secondary: 0x654321, accent: 0xffffff, kart: 0x00ff00 } });
    m.update(1 / 60, { speed: 10 });
    expect(m.triangles).toBeGreaterThan(500);
    m.dispose();
    expect(() => buildKartModel(null).dispose()).not.toThrow();
  });

  it('shows effects only when their state is on', () => {
    const m = buildKartModel(CHARACTERS[0]);
    const count = () => {
      let n = 0;
      m.group.traverseVisible((o) => o.isMesh && n++);
      return n;
    };
    m.update(1 / 60, { speed: 10 });
    const base = count();
    m.update(1 / 60, { speed: 10, drifting: true, driftLevel: 2 });
    expect(count()).toBeGreaterThan(base);
    m.update(1 / 60, { speed: 10, boosting: true });
    expect(count()).toBeGreaterThan(base);
    for (let i = 0; i < 60; i++) m.update(1 / 60, { speed: 10 });
    expect(count()).toBe(base);
    for (let i = 0; i < 30; i++) m.update(1 / 60, { speed: 10, shielded: true });
    expect(count()).toBeGreaterThan(base);
    m.dispose();
  });

  it('happy-spins and settles back facing forward', () => {
    const m = buildKartModel(CHARACTERS[1]);
    const root = m.group.children.find((c) => c.isGroup);
    for (let i = 0; i < 30; i++) m.update(1 / 60, { speed: 5, spinning: true });
    expect(Math.abs(root.rotation.y)).toBeGreaterThan(1);
    for (let i = 0; i < 120; i++) m.update(1 / 60, { speed: 5 });
    expect(root.rotation.y).toBeCloseTo(0, 5);
    m.dispose();
  });

  it('spins wheels with speed and leans the driver into turns', () => {
    const m = buildKartModel(CHARACTERS[0]);
    const snapshot = () => {
      const r = [];
      m.group.traverse((o) => r.push(o.rotation.x, o.rotation.z));
      return r;
    };
    m.update(1 / 60, { speed: 0, time: 0 });
    const a = snapshot();
    for (let i = 0; i < 20; i++) m.update(1 / 60, { speed: 25, steer: 1, time: 0 });
    const b = snapshot();
    expect(a).not.toEqual(b);
    m.dispose();
  });
});

describe('renderPortraits', () => {
  it('returns an empty map without a DOM (node / tests)', async () => {
    const map = await renderPortraits(CHARACTERS, 64);
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
  });
});
