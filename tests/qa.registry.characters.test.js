// Registry-wide sanity suite (racers: model, NaN, disposal, racing as a CPU): parametrized over the LIVE registries, so the
// v2 packs (16 tracks, 12 racers) are covered the moment they are listed in their pack
// file — nothing to edit here. Helpers: tests/helpers/ (see CONTRIBUTING.md).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TRACKS } from '../src/tracks/index.js';
import { CHARACTERS, getCharacterEntry } from '../src/characters/index.js';
import { buildKartModel } from '../src/render/characterModels.js';
import { runCpuRace, defaultRacerIds, stubKartModel } from './helpers/raceHarness.js';
import { buildAndDispose, nonFiniteTransforms, nonFiniteVertices } from './helpers/threeInspect.js';

/** Model states a race can produce (plus a few silly ones). */
const MODEL_STATES = [
  {},
  { speed: 0, steer: 0, time: 0 },
  { speed: 30, steer: 1, drifting: true, driftLevel: 1, driftDir: 1, time: 1 },
  { speed: 28, steer: -1, drifting: true, driftLevel: 2, driftDir: -1, time: 2 },
  { speed: 32, steer: -0.4, drifting: true, driftLevel: 3, boosting: true, time: 3 },
  { speed: 10, spinning: true, shielded: true, time: 4 },
  { speed: -5, steer: 0.3, happy: true, star: true, time: 5 },
  { speed: 22, hop: 0.4, offRoad: true, time: 6 },
  { speed: 45, boosting: true, star: true, shielded: true, drifting: true, driftLevel: 3, time: 1e4 }, // long session
];

describe('every registered racer', () => {
  it('the registry is not empty and ids are unique', () => {
    expect(CHARACTERS.length).toBeGreaterThanOrEqual(9);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
  });

  CHARACTERS.forEach((def, i) => {
    describe(def.id, () => {
      it('has a model builder and animates every state without NaN', () => {
        expect(typeof getCharacterEntry(def.id)?.build).toBe('function');
        const m = buildKartModel(def);
        try {
          expect(nonFiniteVertices(m.group)).toEqual([]);
          for (let f = 0; f < 120; f++) m.update(1 / 60, MODEL_STATES[f % MODEL_STATES.length]);
          m.update(0, MODEL_STATES[2]);
          m.update(0.1, MODEL_STATES[4]);
          expect(nonFiniteTransforms(m.group)).toEqual([]);
          expect(nonFiniteVertices(m.group)).toEqual([]);
        } finally {
          m.dispose();
        }
      });

      it('dispose() frees its own geometries and rebuilding leaks nothing', () => {
        const animated = () => {
          const m = buildKartModel(def);
          for (let f = 0; f < MODEL_STATES.length; f++) m.update(1 / 60, MODEL_STATES[f]); // effects build lazily
          return m;
        };
        const first = buildAndDispose(animated);
        expect(first.res.geometries.size).toBeGreaterThan(0);
        const second = buildAndDispose(animated);
        // module-level shared geometries (effects) may outlive a model; per-model ones may not
        expect(second.left.geometries.filter((g) => !first.left.geometries.includes(g)).map((g) => g.type)).toEqual([]);
        expect(first.left.geometries.length).toBeLessThan(first.res.geometries.size / 2);
        expect(second.left.materials.filter((m) => !first.left.materials.includes(m)).map((m) => m.type)).toEqual([]);
        expect(second.left.textures.filter((t) => !first.left.textures.includes(t)).map((t) => t.type)).toEqual([]);
      });

      it('races as a CPU (with its real model) and finishes', () => {
        const track = TRACKS[i % TRACKS.length];
        const others = defaultRacerIds(CHARACTERS.length).filter((id) => id !== def.id).slice(0, 7);
        const scene = new THREE.Scene();
        // the racer under test drives its real model (fed real race states); the others are stubs (speed)
        const stub = stubKartModel();
        const models = (d) => (d?.id === def.id ? buildKartModel(d) : stub(d));
        const r = runCpuRace(track.id, { laps: 1, seed: 20 + i, characters: [def.id, ...others], buildKartModel: models, scene });
        expect(r.finished).toBe(true);
        expect(r.problems).toEqual([]);
        const mine = r.standings.find((s) => s.characterId === def.id);
        expect(mine.estimated, `${def.id} never finished on ${track.id}`).toBe(false);
        expect(scene.children.filter((c) => c.isGroup && c.children.length).length, 'kart models left in the scene after race.dispose()').toBe(0);
      });
    });
  });
});

