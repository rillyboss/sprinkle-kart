// Registry-wide sanity suite (systems: every auto-installed system through a whole race on every track): parametrized over the LIVE registries, so the
// v2 packs (16 tracks, 12 racers) are covered the moment they are listed in their pack
// file — nothing to edit here. Helpers: tests/helpers/ (see CONTRIBUTING.md).
import { describe, it, expect } from 'vitest';
import { TRACKS } from '../src/tracks/index.js';
import { runHeadlessSession } from './helpers/headlessSession.js';

describe('every registered system survives a whole race on every track', () => {
  for (const def of TRACKS) {
    it(`${def.id}: race-start → race:* → race-frame → race-end → race-exit with no handler errors`, () => {
      const humans = def.id === TRACKS[0].id ? 4 : 1; // one 4-player run exercises the split-screen paths
      const s = runHeadlessSession(def.id, { humans, laps: 1, seed: 17 });
      expect(s.errors.map((e) => `${e.name}: ${e.err?.message}`)).toEqual([]);
      expect(s.problems).toEqual([]);
      expect(s.summary, 'race never completed').toBeTruthy();
      expect(s.summary.trackId).toBe(def.id);
      expect(s.summary.humans).toHaveLength(humans);
      expect(s.bus.countOf('race-end')).toBe(1);
      expect(s.audio.played('go')).toBe(1);
      // friendly words only in anything the systems flash on screen
      for (const f of s.hud.flashes) expect(f.text).not.toMatch(/\b(hit|kill|killed|crash|destroy|destroyed|dead|die)\b/i);
    });
  }
});
