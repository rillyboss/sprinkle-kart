/**
 * Shared fixtures for the progression tests (tests/progress*.test.js).
 * Not a test file itself (vitest only runs *.test.js).
 */
import { vi } from 'vitest';
import { buildRaceSummary } from '../src/game/summary.js';
import { LINEUP_CUPS } from '../src/content/lineup.js';
import { emptyProgress } from '../src/progress/schema.js';
import { RESULT_FIELD } from '../src/progress/engine.js';

export function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

/** Stub localStorage for a test file; returns the fake. */
export function useFakeStorage() {
  const ls = fakeStorage();
  vi.stubGlobal('localStorage', ls);
  return ls;
}

/** A human KartState-ish object for race events. */
export const humanKart = (pi, extra = {}) => ({ playerIndex: pi, isCPU: false, characterId: 'rocco', ...extra });
export const cpuKart = (extra = {}) => ({ playerIndex: null, isCPU: true, characterId: 'lenny', ...extra });

/**
 * Build a real RaceSummary (via src/game/summary.js) from a compact description.
 * @param {object} o
 * @param {string} [o.trackId]
 * @param {'free'|'grand-prix'|'time-trial'} [o.mode]
 * @param {Array<{place:number, characterId?:string, kidAssist?:boolean, estimated?:boolean, finished?:boolean}>} o.humans
 * @param {object} [o.stats] a createRaceStats() instance (or null)
 */
export function makeSummary({ trackId = 'gumdrop-meadow', mode = 'free', humans = [{ place: 1 }], stats = null, cup } = {}) {
  const hs = humans.map((h, i) => ({ playerIndex: i, deviceId: `d${i}`, characterId: h.characterId ?? ['rocco', 'stella', 'dino', 'bizzy'][i], easyDrive: !!h.kidAssist }));
  const taken = new Set(humans.map((h) => h.place));
  const standings = [];
  for (let place = 1; place <= 8; place++) {
    const hi = humans.findIndex((h) => h.place === place);
    if (hi >= 0) {
      const h = humans[hi];
      standings.push({ characterId: hs[hi].characterId, playerIndex: hi, isCPU: false, finishPlace: h.finished === false ? null : place, place, finished: h.finished !== false, finishEstimated: !!h.estimated, finishTime: 60 + place });
    } else if (!taken.has(place)) {
      standings.push({ characterId: `cpu${place}`, playerIndex: null, isCPU: true, finishPlace: place, place, finished: true, finishEstimated: false, finishTime: 60 + place });
    }
  }
  const cupId = cup ?? LINEUP_CUPS.find((c) => c.trackIds.includes(trackId))?.id;
  return buildRaceSummary({ setup: { speedClass: 'zippy', mode }, trackDef: { id: trackId, cup: cupId }, humans: hs, standings, stats, laps: 3, raceTime: 70 });
}

/** A progress object that satisfies `rule` exactly (`short` = one step short of it). */
export function progressFor(rule, { short = false } = {}) {
  const p = emptyProgress();
  const field = RESULT_FIELD[rule.result];
  switch (rule.type) {
    case 'stat': p.stats[rule.stat] = rule.count - (short ? 1 : 0); break;
    case 'track': if (!short) p.tracks[rule.trackId] = { [field]: 1 }; else p.tracks[rule.trackId] = { [field]: 0 }; break;
    case 'cup-track': {
      const ids = LINEUP_CUPS.find((c) => c.id === rule.cupId).trackIds;
      if (!short) p.tracks[ids[ids.length - 1]] = { [field]: 1 };
      // a result on another cup's track never counts
      const other = LINEUP_CUPS.find((c) => c.id !== rule.cupId).trackIds[0];
      p.tracks[other] = { finishes: 5, wins: 5, top3: 5 };
      break;
    }
    case 'distinct-tracks': {
      const all = LINEUP_CUPS.flatMap((c) => c.trackIds);
      const n = rule.count - (short ? 1 : 0);
      for (let i = 0; i < n; i++) p.tracks[all[i]] = { [field]: 3 }; // many results on one track = still one track
      break;
    }
    default: break;
  }
  return p;
}
