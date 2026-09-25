import { describe, it, expect, beforeEach } from 'vitest';
import { STAT_KEYS, emptyStats, emptyProgress, isValidUnlockRule, UNLOCK_RULE_TYPES } from '../src/progress/schema.js';
import { describeUnlock, unlockDetail } from '../src/progress/describeUnlock.js';
import { LINEUP_CHARACTERS, LINEUP_TRACKS } from '../src/content/lineup.js';
import * as progress from '../src/progress/progress.js';
import * as legacy from '../src/save/progress.js';

describe('progress schema', () => {
  it('has zeroed counters for every stat', () => {
    const s = emptyStats();
    expect(Object.keys(s)).toEqual([...STAT_KEYS]);
    for (const k of STAT_KEYS) expect(s[k]).toBe(0);
    expect(emptyProgress()).toMatchObject({ unlocked: [], wins: 0, trophies: {}, tracks: {}, cups: {}, records: {}, unlockAll: false });
  });

  it('validates unlock rules structurally', () => {
    expect(UNLOCK_RULE_TYPES).toEqual(['stat', 'track', 'cup-track', 'distinct-tracks']);
    expect(isValidUnlockRule(null)).toBe(true);
    expect(isValidUnlockRule({ type: 'stat', stat: 'wins', count: 2 })).toBe(true);
    expect(isValidUnlockRule({ type: 'stat', stat: 'wins', count: 0 })).toBe(false);
    expect(isValidUnlockRule({ type: 'stat', stat: 'sneezes', count: 2 })).toBe(false);
    expect(isValidUnlockRule({ type: 'track', trackId: 'x', result: 'win' })).toBe(true);
    expect(isValidUnlockRule({ type: 'track', trackId: 'x', result: 'podium' })).toBe(false);
    expect(isValidUnlockRule({ type: 'cup-track', cupId: 'bubble-cup', result: 'top3' })).toBe(true);
    expect(isValidUnlockRule({ type: 'distinct-tracks', result: 'finish', count: 8 })).toBe(true);
    expect(isValidUnlockRule({ type: 'magic' })).toBe(false);
    expect(isValidUnlockRule('wins')).toBe(false);
  });
});

describe('describeUnlock', () => {
  it('keeps the original Cotton Candy Girl wording', () => {
    const r = { type: 'stat', stat: 'wins', count: 1 };
    expect(describeUnlock(r)).toBe('Win a race to unlock!');
    expect(unlockDetail(r)).toBe('Finish in 1st place to meet a sweet new racer…');
  });

  it('reads nicely for every lineup rule', () => {
    for (const e of [...LINEUP_CHARACTERS, ...LINEUP_TRACKS]) {
      if (!e.unlock) continue;
      const t = describeUnlock(e.unlock);
      expect(t, e.id).toMatch(/ to unlock!$/);
      expect(t, e.id).not.toMatch(/undefined|null|secret/);
      expect(unlockDetail(e.unlock, 'track')).toMatch(/…$/);
    }
    expect(describeUnlock({ type: 'track', trackId: 'mermaid-lagoon', result: 'win' })).toBe('Win on Mermaid Lagoon to unlock!');
    expect(describeUnlock({ type: 'cup-track', cupId: 'bubble-cup', result: 'win' })).toBe('Win on any Bubble Cup track to unlock!');
    expect(describeUnlock({ type: 'distinct-tracks', result: 'top3', count: 2 })).toBe('Finish top 3 on 2 different tracks to unlock!');
    expect(describeUnlock({ type: 'stat', stat: 'racesFinished', count: 3 })).toBe('Finish 3 races to unlock!');
  });

  it('is gentle with missing / unknown rules', () => {
    expect(describeUnlock(null)).toBe('');
    expect(describeUnlock({ type: 'magic' })).toBe('Keep racing to unlock!');
    expect(unlockDetail(null)).toBe('');
  });

  it('uses only friendly words', () => {
    const text = [...LINEUP_CHARACTERS, ...LINEUP_TRACKS].filter((e) => e.unlock).map((e) => describeUnlock(e.unlock)).join(' ');
    expect(text).not.toMatch(/\b(hit|kill|destroy|die|dead|attack)\b/i);
  });
});

describe('progress module location', () => {
  beforeEach(() => progress.resetProgress());

  it('the legacy src/save/progress.js path is the same module', () => {
    expect(legacy.isUnlocked).toBe(progress.isUnlocked);
    legacy.unlock('cotton-candy-girl');
    expect(progress.isUnlocked('cotton-candy-girl')).toBe(true);
  });

  it('fresh progress carries the v2 fields', () => {
    const p = progress.loadProgress();
    expect(p.stats).toEqual(emptyStats());
    expect(p.unlocked).toEqual([]);
  });
});
