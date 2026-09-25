// Registry-wide sanity suite (tracks: build, NaN, disposal, CPU races): parametrized over the LIVE registries, so the
// v2 packs (16 tracks, 12 racers) are covered the moment they are listed in their pack
// file — nothing to edit here. Helpers: tests/helpers/ (see CONTRIBUTING.md).
import { describe, it, expect } from 'vitest';
import { TRACKS } from '../src/tracks/index.js';
import { buildTrack } from '../src/render/trackBuilder.js';
import { runCpuRace, trackFixture } from './helpers/raceHarness.js';
import { buildAndDispose, nonFiniteTransforms, nonFiniteVertices } from './helpers/threeInspect.js';

describe('every registered track', () => {
  it('the registry is not empty and ids are unique', () => {
    expect(TRACKS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
  });

  for (const def of TRACKS) {
    describe(def.id, () => {
      it('builds and animates with no NaN in transforms or vertices', () => {
        const { path } = trackFixture(def.id);
        const built = buildTrack(def, path);
        try {
          expect(nonFiniteVertices(built.group)).toEqual([]);
          // real frame times, a paused frame, the clamped maximum and a very long session
          for (const [dt, time] of [[1 / 60, 3], [0, 3], [0.1, 3.1], [1 / 60, 600], [1 / 30, 1e4]]) built.update(dt, time);
          expect(nonFiniteTransforms(built.group)).toEqual([]);
          expect(built.itemBoxSlots.length).toBeGreaterThan(0);
          for (const s of built.itemBoxSlots) expect(Number.isFinite(s.position.x + s.position.y + s.position.z)).toBe(true);
          for (const p of built.boostPads) expect(Number.isFinite(p.s) && Number.isFinite(p.lateral)).toBe(true);
          for (const [x, z] of [[0, 0], [path.px[0], path.pz[0]], [1e4, -1e4]]) {
            const h = built.terrainHeight(x, z);
            expect(h === null || Number.isFinite(h)).toBe(true);
          }
        } finally {
          built.dispose();
        }
      });

      it('dispose() frees every geometry and rebuilding leaks no materials or textures', () => {
        const { path } = trackFixture(def.id);
        const first = buildAndDispose(() => buildTrack(def, path));
        expect(first.res.geometries.size).toBeGreaterThan(0);
        expect(first.left.geometries.map((g) => g.type)).toEqual([]);
        // Whatever survives dispose() must be a shared cache (the same objects every build).
        const second = buildAndDispose(() => buildTrack(def, path));
        const leakedMaterials = second.left.materials.filter((m) => !first.left.materials.includes(m));
        const leakedTextures = second.left.textures.filter((t) => !first.left.textures.includes(t));
        expect(leakedMaterials.map((m) => `${m.type} ${m.name}`)).toEqual([]);
        expect(leakedTextures.map((t) => `${t.type} ${t.name}`)).toEqual([]);
      });

      it('a full 1-lap CPU race completes with healthy physics', () => {
        const r = runCpuRace(def.id, { laps: 1, seed: 11, builtTrack: 'real' });
        expect(r.finished).toBe(true);
        expect(r.problems).toEqual([]);
        const real = r.standings.filter((s) => !s.estimated);
        expect(real.length, `only ${real.length}/8 CPUs really finished`).toBeGreaterThanOrEqual(7);
        const winner = r.standings[0];
        expect(winner.estimated).toBe(false);
        // sane lap time for the lap length: slower than 60 m/s, faster than 4 m/s
        expect(winner.finishTime).toBeGreaterThan(r.path.length / 60);
        expect(winner.finishTime).toBeLessThan(r.path.length / 4);
        expect(r.eventCounts.go).toBe(1);
        expect(r.eventCounts['race-complete']).toBe(1);
      });

      it('an autodriven Kid-Assist human finishes (Zoomy, dt spikes)', () => {
        const r = runCpuRace(def.id, { laps: 1, seed: 3, humans: 1, easyDrive: true, speedClass: 'zoomy', dtJitter: [1 / 240, 0.25] });
        expect(r.finished).toBe(true);
        expect(r.problems).toEqual([]);
        const me = r.standings.find((s) => s.playerIndex === 0);
        expect(me.estimated, `P1 placed by estimate on ${def.id}`).toBe(false);
      });
    });
  }
});

