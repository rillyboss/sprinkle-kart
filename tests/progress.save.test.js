import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as progress from '../src/progress/progress.js';
import * as legacy from '../src/save/progress.js';
import { mergeProgress, emptyProgress, defaultSettings, STAT_KEYS, isValidUnlockRule } from '../src/progress/schema.js';
import { isAvailable } from '../src/progress/access.js';
import { describeUnlock, describeUnlockShort } from '../src/progress/describeUnlock.js';
import { makeSummary, useFakeStorage } from './progressFixtures.js';

describe('save migration / merge (v1 -> v2)', () => {
  it('a v1 save gains every v2 field with safe defaults', () => {
    const v1 = { unlocked: ['cotton-candy-girl'], wins: 2, trophies: { 'gumdrop-meadow': 2 } };
    const m = mergeProgress(v1);
    expect(m.unlocked).toEqual(['cotton-candy-girl']);
    expect(m.wins).toBe(2);
    expect(m.trophies).toEqual({ 'gumdrop-meadow': 2 });
    for (const k of STAT_KEYS) expect(m.stats[k], k).toBe(0);
    expect(m).toMatchObject({ tracks: {}, cups: {}, records: {}, racers: {}, unlockAll: false, settings: defaultSettings() });
  });

  it('repairs per-track, per-cup and per-racer entries', () => {
    const m = mergeProgress({
      tracks: { a: { finishes: 2, wins: 'x', bestPlace: 0 }, b: 'junk', c: { top3: 1, bestPlace: 3, extra: true } },
      cups: { 'sprinkle-cup': { wins: 1, bestPlace: 1.5 } },
      racers: { rocco: { races: 3 }, bad: [1, 2] },
    });
    expect(m.tracks.a).toEqual({ finishes: 2, wins: 0, top3: 0, bestPlace: null, timeTrials: 0 });
    expect(m.tracks.b).toBeUndefined();
    expect(m.tracks.c).toMatchObject({ top3: 1, bestPlace: 3, finishes: 0, extra: true });
    expect(m.cups['sprinkle-cup']).toEqual({ wins: 1, bestPlace: null, finished: 0 });
    expect(m.racers).toEqual({ rocco: { races: 3, wins: 0, podiums: 0 } });
  });

  it('clamps settings, drops junk and de-duplicates unlocked ids', () => {
    const m = mergeProgress({ settings: { music: 3, sfx: -1, kidAssistDefault: 'yes' }, unlocked: ['a', 'a', 'b'] });
    expect(m.settings).toEqual({ ...defaultSettings(), music: 1, sfx: 0, kidAssistDefault: false });
    expect(m.unlocked).toEqual(['a', 'b']);
    expect(mergeProgress({ settings: 'loud' }).settings).toEqual(defaultSettings());
  });

  it('new stat keys are valid in stat unlock rules and have friendly hints', () => {
    for (const k of ['miniTurbos1', 'miniTurbos2', 'miniTurbos3', 'itemBoxes', 'boosts', 'bonked', 'racesPlayed', 'recordsSet']) {
      expect(STAT_KEYS).toContain(k);
      expect(isValidUnlockRule({ type: 'stat', stat: k, count: 3 })).toBe(true);
      expect(describeUnlock({ type: 'stat', stat: k, count: 3 })).toMatch(/3.* to unlock!$/);
      expect(describeUnlockShort({ type: 'stat', stat: k, count: 1 })).not.toBe('Keep racing!');
    }
    expect(describeUnlock({ type: 'stat', stat: 'miniTurbos3', count: 1 })).toBe('Do a Rainbow Turbo to unlock!');
  });
});

describe('saved progress API', () => {
  let ls;
  beforeEach(() => { ls = useFakeStorage(); progress.resetProgress(); });
  afterEach(() => { progress.resetProgress(); vi.unstubAllGlobals(); });

  it('the legacy path re-exports the v2 API', () => {
    for (const fn of ['recordRace', 'recordGrandPrix', 'evaluate', 'setUnlockAll', 'getSettings', 'setSettings', 'isEarned', 'update']) {
      expect(typeof legacy[fn], fn).toBe('function');
    }
  });

  it('unlockAll makes isUnlocked (and isAvailable) true for everything, isEarned stays honest', () => {
    const def = { id: 'twiggy', unlock: { type: 'stat', stat: 'wins', count: 3 } };
    expect(progress.isUnlocked('twiggy')).toBe(false);
    expect(isAvailable(def)).toBe(false);
    progress.setUnlockAll(true);
    expect(progress.isUnlocked('twiggy')).toBe(true);
    expect(progress.isUnlocked('ribbon-sky')).toBe(true);
    expect(isAvailable(def)).toBe(true);
    expect(progress.isEarned('twiggy')).toBe(false);
    expect(JSON.parse(ls.getItem(progress.PROGRESS_KEY)).unlockAll).toBe(true);
    progress.setUnlockAll(false);
    expect(progress.isUnlocked('twiggy')).toBe(false);
  });

  it('settings are saved, clamped and kept by a settings-keeping reset', () => {
    expect(progress.getSettings()).toEqual(defaultSettings());
    progress.setSettings({ music: 0.2, kidAssistDefault: true });
    progress.setSettings({ sfx: 7 });
    expect(progress.getSettings()).toEqual({ ...defaultSettings(), music: 0.2, sfx: 1, kidAssistDefault: true });
    progress.recordRace(makeSummary({ humans: [{ place: 1 }] }));
    progress.resetProgress({ keepSettings: true });
    expect(progress.getSettings()).toEqual({ ...defaultSettings(), music: 0.2, sfx: 1, kidAssistDefault: true });
    expect(progress.loadProgress().stats.wins).toBe(0);
    expect(progress.loadProgress().unlocked).toEqual([]);
    progress.resetProgress();
    expect(progress.getSettings()).toEqual(defaultSettings());
  });

  it('recordRace persists stats + unlocks and returns the new ones', () => {
    const fresh = progress.recordRace(makeSummary({ humans: [{ place: 1 }] }));
    expect(fresh.map((u) => u.id)).toContain('cotton-candy-girl');
    const saved = JSON.parse(ls.getItem(progress.PROGRESS_KEY));
    expect(saved.stats.racesFinished).toBe(1);
    expect(saved.unlocked).toContain('cotton-candy-girl');
    // a "reload": the next load re-reads storage
    ls.setItem(progress.PROGRESS_KEY, JSON.stringify({ ...saved, stats: { ...saved.stats, wins: 7 } }));
    expect(progress.loadProgress().stats.wins).toBe(7);
  });

  it('evaluate() catches up on content whose rule was met earlier (e.g. a racer that shipped later)', () => {
    progress.update((p) => { p.stats.racesFinished = 5; });
    expect(progress.evaluate([{ kind: 'character', id: 'bruno', unlock: { type: 'stat', stat: 'racesFinished', count: 2 } }]))
      .toEqual([{ kind: 'character', id: 'bruno' }]);
    expect(progress.evaluate([{ kind: 'character', id: 'bruno', unlock: { type: 'stat', stat: 'racesFinished', count: 2 } }])).toEqual([]);
  });

  it('submitRecord counts new records (recordsSet)', () => {
    progress.submitRecord('gumdrop-meadow', { raceTime: 90, bestLap: 30 });
    progress.submitRecord('gumdrop-meadow', { raceTime: 95, bestLap: 31 }); // not better
    progress.submitRecord('gumdrop-meadow', { raceTime: 88 });
    expect(progress.loadProgress().stats.recordsSet).toBe(2);
    expect(progress.getRecord('gumdrop-meadow')).toEqual({ bestRace: 88, bestLap: 30 });
  });

  it('update() sanitises whatever the callback leaves behind', () => {
    progress.update((p) => { p.stats.wins = 'lots'; p.unlocked.push(5, 'luna'); });
    const p = progress.loadProgress();
    expect(p.stats.wins).toBe(0);
    expect(p.unlocked).toEqual(['luna']);
  });

  it('works with no storage at all (private window)', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    progress.resetProgress();
    expect(() => progress.recordRace(makeSummary({ humans: [{ place: 1 }] }))).not.toThrow();
    expect(progress.isUnlocked('cotton-candy-girl')).toBe(true);
  });

  it('emptyProgress is a fresh object each time', () => {
    const a = emptyProgress();
    a.stats.wins = 3;
    a.unlocked.push('x');
    expect(emptyProgress().stats.wins).toBe(0);
    expect(emptyProgress().unlocked).toEqual([]);
  });
});
