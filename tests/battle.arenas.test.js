// Bubble Pop Battle arenas: every entry of src/modes/arenas/index.js builds, animates, frees its
// geometry, is a sensible little loop and hosts a healthy battle. Arenas are NOT race tracks: they
// must never leak into the track registry, the lineup or the cups.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ARENAS, getArena, nextArenaId, arenaIdOr } from '../src/modes/arenas/index.js';
import { TRACKS } from '../src/tracks/index.js';
import { LINEUP_TRACKS } from '../src/content/lineup.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack } from '../src/render/trackBuilder.js';
import { Race } from '../src/race/Race.js';
import { rulesForMode } from '../src/modes/rules.js';
import { runCpuRace } from './helpers/raceHarness.js';
import { buildAndDispose, nonFiniteTransforms, nonFiniteVertices } from './helpers/threeInspect.js';
import { SONG_IDS } from '../src/audio/songs.js';

const BAD_WORDS = /\b(hit|kill|crash|destroy|die|dead|blood|weapon|shoot)\b/i;

describe('arena registry', () => {
  it('lists at least two arenas with unique ids that never collide with tracks', () => {
    expect(ARENAS.length).toBeGreaterThanOrEqual(2);
    const ids = ARENAS.map((a) => a.def.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(TRACKS.some((t) => t.id === id)).toBe(false);
      expect(LINEUP_TRACKS.some((t) => t.id === id)).toBe(false);
    }
  });

  it('getArena / nextArenaId / arenaIdOr', () => {
    const [a, b] = ARENAS.map((x) => x.def.id);
    expect(getArena(a)).toBe(ARENAS[0]);
    expect(getArena('nope')).toBe(null);
    expect(nextArenaId(a)).toBe(b);
    expect(nextArenaId(ARENAS.at(-1).def.id)).toBe(a);
    expect(nextArenaId('nope')).toBe(a);
    expect(arenaIdOr(b)).toBe(b);
    expect(arenaIdOr(undefined)).toBe(a);
  });
});

for (const arena of ARENAS) {
  const { def } = arena;
  describe(`arena ${def.id}`, () => {
    const path = new TrackPath(def.controlPoints, def.width);

    it('is a short, wide, friendly loop with no unlock and a real song', () => {
      expect(def.arena).toBe(true);
      expect(def.unlock).toBe(null);
      expect(def.laps).toBe(1);
      expect(def.width).toBeGreaterThanOrEqual(22);
      expect(def.width).toBeLessThanOrEqual(28);
      expect(path.length).toBeGreaterThan(350);
      expect(path.length).toBeLessThan(650);
      expect(def.art).toHaveLength(3);
      expect(`${def.name} ${def.subtitle}`).not.toMatch(BAD_WORDS);
      expect(typeof arena.buildScenery).toBe('function');
      expect(SONG_IDS).toContain(def.theme.music);
      expect(def.itemBoxRows.length).toBeGreaterThanOrEqual(3);
      for (const f of def.itemBoxRows) expect(f >= 0 && f < 1).toBe(true);
    });

    it('builds, animates without NaN and frees its geometry', () => {
      const built = buildTrack(def, path, { module: arena });
      try {
        expect(built.group.name).toBe(`track:${def.id}`);
        expect(nonFiniteVertices(built.group)).toEqual([]);
        for (const [dt, time] of [[1 / 60, 3], [0, 3], [0.1, 3.1], [1 / 30, 1e4]]) built.update(dt, time);
        expect(nonFiniteTransforms(built.group)).toEqual([]);
        expect(built.itemBoxSlots.length).toBeGreaterThanOrEqual(def.itemBoxRows.length * 4);
      } finally {
        built.dispose();
      }
      const first = buildAndDispose(() => buildTrack(def, path, { module: arena }));
      expect(first.left.geometries.map((g) => g.type)).toEqual([]);
      const second = buildAndDispose(() => buildTrack(def, path, { module: arena }));
      expect(second.left.materials.filter((m) => !first.left.materials.includes(m)).map((m) => m.type)).toEqual([]);
    });

    it('CPUs lap it happily as a normal race (the road is drivable)', () => {
      const r = runCpuRace(def, { laps: 2, seed: 5 });
      expect(r.finished).toBe(true);
      expect(r.problems).toEqual([]);
      expect(r.standings.filter((s) => !s.estimated).length).toBeGreaterThanOrEqual(7);
    });

    it('the grid fits: every kart starts on the road in battle mode', () => {
      const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants: Array.from({ length: 8 }, (_, i) => ({ characterId: 'rocco', playerIndex: i < 2 ? i : null })), seed: 1, rules: rulesForMode('battle') });
      for (const k of race.karts) expect(Math.abs(k.lateral)).toBeLessThan(path.halfWidth);
      race.dispose();
    });
  });
}
