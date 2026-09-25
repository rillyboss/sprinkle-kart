import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TRACKS } from '../src/data/tracks.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack, createPathIndex, createTerrain, makeRng, seedFromString } from '../src/render/trackBuilder.js';

describe('buildTrack (headless)', () => {
  for (const def of TRACKS) {
    describe(def.id, () => {
      const path = new TrackPath(def.controlPoints, def.width);
      const built = buildTrack(def, path);

      it('returns the contract shape', () => {
        expect(built.group).toBeInstanceOf(THREE.Group);
        expect(built.sky).toBeInstanceOf(THREE.Object3D);
        expect(built.sky.parent).toBe(built.group);
        expect(built.lights.some((l) => l.isHemisphereLight)).toBe(true);
        expect(built.lights.some((l) => l.isDirectionalLight)).toBe(true);
        for (const l of built.lights) expect(l.parent).toBe(built.group);
        expect(typeof built.update).toBe('function');
        expect(typeof built.dispose).toBe('function');
      });

      it('computes item box slots and boost pads from the def', () => {
        expect(built.itemBoxSlots.length).toBe(def.itemBoxRows.length * (def.width >= 18 ? 5 : 4));
        for (const slot of built.itemBoxSlots) {
          expect(slot.position).toBeInstanceOf(THREE.Vector3);
          const expected = path.positionAt(slot.s, slot.lateral);
          expect(slot.position.distanceTo(expected)).toBeLessThan(1e-6);
        }
        expect(built.boostPads.length).toBe(def.boostPads.length);
        built.boostPads.forEach((pad, i) => {
          expect(pad.s).toBeCloseTo(path.wrap(def.boostPads[i].at * path.length), 6);
          expect(pad.lateral).toBe(def.boostPads[i].lateral);
          expect(pad).toMatchObject({ length: 6, halfWidth: 2.5 });
        });
      });

      it('animates without throwing', () => {
        for (let k = 0; k < 5; k++) built.update(1 / 60, k / 60 + 3);
      });

      it('never lets the ground poke through the road', () => {
        if (def.scenery.terrain !== 'hills') return;
        for (let s = 0; s < path.length; s += 7) {
          for (const lat of [-path.halfWidth, 0, path.halfWidth]) {
            const p = path.positionAt(s, lat);
            expect(built.terrainHeight(p.x, p.z)).toBeLessThan(p.y);
          }
        }
      });

      it('disposes cleanly', () => {
        const scene = new THREE.Scene();
        scene.add(built.group);
        built.dispose();
        expect(built.group.parent).toBe(null);
      });
    });
  }
});

describe('terrain', () => {
  it('is void in space and flat (with a moat) at the castle', () => {
    const g = TRACKS.find((t) => t.id === 'starlight-galaxy');
    const gp = new TrackPath(g.controlPoints, g.width);
    expect(createTerrain(g, gp, createPathIndex(gp)).height(0, 0)).toBe(null);
    const c = TRACKS.find((t) => t.id === 'cotton-candy-castle');
    const cp = new TrackPath(c.controlPoints, c.width);
    const ct = createTerrain(c, cp, createPathIndex(cp));
    expect(ct.height(0, 0)).toBe(0);
    expect(ct.height(64, 0)).toBeLessThan(-1);
  });

  it('seeded rng is deterministic', () => {
    const a = makeRng(seedFromString('x'));
    const b = makeRng(seedFromString('x'));
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});
