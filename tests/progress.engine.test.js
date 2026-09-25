import { describe, it, expect } from 'vitest';
import {
  applyRaceSummary, applyGrandPrix, ruleProgress, isRuleMet, evaluateUnlocks, nextUnlock,
  lineupEntries, entriesFrom, progressCount,
} from '../src/progress/engine.js';
import { emptyProgress, mergeProgress, isValidUnlockRule } from '../src/progress/schema.js';
import { LINEUP_CHARACTERS, LINEUP_TRACKS } from '../src/content/lineup.js';
import { createRaceStats } from '../src/game/raceStats.js';
import { makeSummary, progressFor, humanKart, cpuKart } from './progressFixtures.js';

const rules = [...LINEUP_CHARACTERS, ...LINEUP_TRACKS].filter((x) => x.unlock);

describe('rule engine: every lineup rule', () => {
  it('the lineup uses every rule shape', () => {
    const types = new Set(rules.map((r) => r.unlock.type));
    expect([...types].sort()).toEqual(['cup-track', 'distinct-tracks', 'stat', 'track']);
    for (const r of rules) expect(isValidUnlockRule(r.unlock), r.id).toBe(true);
  });

  for (const item of rules) {
    it(`${item.id}: ${JSON.stringify(item.unlock)} is met exactly at its goal`, () => {
      const met = progressFor(item.unlock);
      const short = progressFor(item.unlock, { short: true });
      expect(isRuleMet(item.unlock, met)).toBe(true);
      expect(isRuleMet(item.unlock, short)).toBe(false);
      const entry = lineupEntries().find((e) => e.id === item.id);
      expect(evaluateUnlocks(met, [entry])).toEqual([{ kind: entry.kind, id: item.id }]);
      expect(evaluateUnlocks(short, [entry])).toEqual([]);
    });
  }
});

describe('ruleProgress', () => {
  it('counts stat progress and clamps at the goal', () => {
    const p = emptyProgress();
    p.stats.wins = 1;
    expect(ruleProgress({ type: 'stat', stat: 'wins', count: 3 }, p)).toEqual({ current: 1, target: 3, done: false, ratio: 1 / 3 });
    p.stats.wins = 9;
    expect(ruleProgress({ type: 'stat', stat: 'wins', count: 3 }, p)).toMatchObject({ current: 3, done: true, ratio: 1 });
  });

  it('distinct-tracks counts tracks, not results', () => {
    const p = emptyProgress();
    p.tracks = { a: { wins: 5 }, b: { wins: 0, top3: 2 }, c: { wins: 1 } };
    expect(ruleProgress({ type: 'distinct-tracks', result: 'win', count: 6 }, p)).toMatchObject({ current: 2, target: 6 });
    expect(ruleProgress({ type: 'distinct-tracks', result: 'top3', count: 2 }, p)).toMatchObject({ current: 1, done: false });
  });

  it('a win also needs its own counter: top3 does not imply a win and vice versa per field', () => {
    const p = emptyProgress();
    p.tracks['gumdrop-meadow'] = { finishes: 1, wins: 0, top3: 1 };
    expect(isRuleMet({ type: 'track', trackId: 'gumdrop-meadow', result: 'win' }, p)).toBe(false);
    expect(isRuleMet({ type: 'track', trackId: 'gumdrop-meadow', result: 'top3' }, p)).toBe(true);
    expect(isRuleMet({ type: 'track', trackId: 'gumdrop-meadow', result: 'finish' }, p)).toBe(true);
  });

  it('null rules are done; unknown / broken rules never unlock by play', () => {
    const p = emptyProgress();
    expect(ruleProgress(null, p).done).toBe(true);
    expect(ruleProgress({ type: 'magic' }, p).done).toBe(false);
    expect(ruleProgress({ type: 'track', trackId: 'x', result: 'podium' }, p).done).toBe(false);
    expect(ruleProgress({ type: 'cup-track', cupId: 'nope-cup', result: 'win' }, p).done).toBe(false);
    expect(ruleProgress({ type: 'stat', stat: 'wins', count: 1 }, null).done).toBe(false);
    expect(ruleProgress({ type: 'stat', stat: 'wins', count: 1 }, { stats: { wins: NaN } }).current).toBe(0);
  });

  it('progressCount only for multi-step goals', () => {
    expect(progressCount({ current: 1, target: 3 })).toBe('1/3');
    expect(progressCount({ current: 0, target: 1 })).toBe('');
    expect(progressCount(null)).toBe('');
  });
});

describe('applyRaceSummary', () => {
  it('a solo win records every family counter once', () => {
    const p = emptyProgress();
    applyRaceSummary(p, makeSummary({ trackId: 'gumdrop-meadow', humans: [{ place: 1 }] }));
    expect(p.stats).toMatchObject({ racesFinished: 1, wins: 1, podiums: 1, racesPlayed: 1, multiplayerRaces: 0, kidAssistFinishes: 0 });
    expect(p.tracks['gumdrop-meadow']).toMatchObject({ finishes: 1, wins: 1, top3: 1, bestPlace: 1 });
    expect(p.wins).toBe(1);
    expect(p.trophies['gumdrop-meadow']).toBe(1);
    expect(p.racers.rocco).toEqual({ races: 1, wins: 1, podiums: 1 });
  });

  it('two humans in one race count the race ONCE, any human result counts', () => {
    const p = emptyProgress();
    applyRaceSummary(p, makeSummary({ humans: [{ place: 6 }, { place: 1, kidAssist: true }] }));
    expect(p.stats).toMatchObject({ racesFinished: 1, wins: 1, podiums: 1, racesPlayed: 2, multiplayerRaces: 1, kidAssistFinishes: 1 });
    expect(p.racers.rocco).toEqual({ races: 1, wins: 0, podiums: 0 });
    expect(p.racers.stella).toEqual({ races: 1, wins: 1, podiums: 1 });
    expect(p.tracks['gumdrop-meadow'].bestPlace).toBe(1);
  });

  it('bestPlace keeps the best ever; a worse race does not lower it', () => {
    const p = emptyProgress();
    applyRaceSummary(p, makeSummary({ trackId: 'starlight-galaxy', humans: [{ place: 4 }] }));
    expect(p.tracks['starlight-galaxy'].bestPlace).toBe(4);
    applyRaceSummary(p, makeSummary({ trackId: 'starlight-galaxy', humans: [{ place: 2 }] }));
    applyRaceSummary(p, makeSummary({ trackId: 'starlight-galaxy', humans: [{ place: 7 }] }));
    expect(p.tracks['starlight-galaxy']).toMatchObject({ bestPlace: 2, finishes: 3, top3: 1, wins: 0 });
    expect(p.stats.podiums).toBe(1);
  });

  it('estimated finishes count as finishes but never as wins / top 3', () => {
    const p = emptyProgress();
    applyRaceSummary(p, makeSummary({ humans: [{ place: 1, estimated: true }] }));
    expect(p.stats).toMatchObject({ racesFinished: 1, wins: 0, podiums: 0 });
    expect(p.tracks['gumdrop-meadow']).toMatchObject({ finishes: 1, wins: 0, top3: 0, bestPlace: null });
    expect(p.wins).toBe(0);
  });

  it('nobody over the line: only item / turbo counters count', () => {
    const p = emptyProgress();
    const stats = createRaceStats();
    stats.onEvent({ type: 'item-use', kart: humanKart(0) });
    applyRaceSummary(p, makeSummary({ humans: [{ place: 8, finished: false }], stats }));
    expect(p.stats).toMatchObject({ racesFinished: 0, itemsUsed: 1 });
    expect(p.tracks).toEqual({});
  });

  it('Time Trials count as time trials only (not races, wins or tracks)', () => {
    const p = emptyProgress();
    applyRaceSummary(p, makeSummary({ mode: 'time-trial', trackId: 'sundae-slopes', humans: [{ place: 1 }] }));
    expect(p.stats).toMatchObject({ timeTrialsFinished: 1, racesFinished: 0, wins: 0 });
    expect(p.tracks['sundae-slopes']).toMatchObject({ timeTrials: 1, finishes: 0, wins: 0 });
    expect(p.wins).toBe(0);
  });

  it('item / bonk / turbo counters add up every human, with turbo levels', () => {
    const p = emptyProgress();
    const stats = createRaceStats();
    const a = humanKart(0);
    const b = humanKart(1);
    const events = [
      { type: 'item-use', kart: a }, { type: 'item-use', kart: b }, { type: 'item-use', kart: cpuKart() },
      { type: 'bonked', kart: cpuKart(), by: a }, { type: 'bonked', kart: b, by: a }, { type: 'bonked', kart: a, by: a },
      { type: 'drift-boost', kart: a, level: 1 }, { type: 'drift-boost', kart: b, level: 3 }, { type: 'drift-boost', kart: b, level: 2 },
      { type: 'drift-boost', kart: cpuKart(), level: 3 }, { type: 'drift-boost', kart: a, level: 0 },
      { type: 'item-box', kart: a }, { type: 'boost', kart: b },
    ];
    events.forEach((e) => stats.onEvent(e));
    applyRaceSummary(p, makeSummary({ humans: [{ place: 2 }, { place: 3 }], stats }));
    expect(p.stats).toMatchObject({
      itemsUsed: 2, bonksGiven: 2, bonked: 2, miniTurbos: 3, miniTurbos1: 1, miniTurbos2: 1, miniTurbos3: 1, itemBoxes: 1, boosts: 1,
    });
  });

  it('uses the fallback tally only when the summary has no stats', () => {
    const p = emptyProgress();
    const tallies = () => ({ itemsUsed: 4, driftBoosts: [1, 0, 0], miniTurbos: 1 });
    applyRaceSummary(p, makeSummary({ humans: [{ place: 5 }] }), { tallies });
    expect(p.stats.itemsUsed).toBe(4);
    const stats = createRaceStats();
    stats.onEvent({ type: 'item-use', kart: humanKart(0) });
    applyRaceSummary(p, makeSummary({ humans: [{ place: 5 }], stats }), { tallies });
    expect(p.stats.itemsUsed).toBe(5); // 4 + the summary's own 1, not + 4 again
  });

  it('ignores junk input without throwing', () => {
    const p = emptyProgress();
    expect(() => applyRaceSummary(p, null)).not.toThrow();
    expect(() => applyRaceSummary(p, { humans: 'x' })).not.toThrow();
    expect(() => applyRaceSummary({}, { humans: [{ finished: true, place: 1 }] })).not.toThrow();
    expect(p.stats.racesFinished).toBe(0);
  });
});

describe('applyGrandPrix', () => {
  const gp = (extra) => ({ cupId: 'sprinkle-cup', finished: true, raceIndex: 3, raceCount: 4, races: [], standings: [], humanWinner: null, bestHumanPlace: 3, unlocks: [], ...extra });

  it('a finished cup counts; a human 1st on points wins it', () => {
    const p = emptyProgress();
    applyGrandPrix(p, gp());
    expect(p.stats).toMatchObject({ grandPrixFinished: 1, cupsWon: 0 });
    expect(p.cups['sprinkle-cup']).toMatchObject({ bestPlace: 3, wins: 0, finished: 1 });
    applyGrandPrix(p, gp({ humanWinner: { playerIndex: 1, characterId: 'dino' }, bestHumanPlace: 1 }));
    expect(p.stats).toMatchObject({ grandPrixFinished: 2, cupsWon: 1 });
    expect(p.cups['sprinkle-cup']).toMatchObject({ bestPlace: 1, wins: 1, finished: 2 });
    applyGrandPrix(p, gp({ bestHumanPlace: 5 }));
    expect(p.cups['sprinkle-cup'].bestPlace).toBe(1);
  });

  it('an unfinished or broken GP result is ignored', () => {
    const p = emptyProgress();
    applyGrandPrix(p, gp({ finished: false }));
    applyGrandPrix(p, null);
    applyGrandPrix(p, { finished: true });
    expect(p.stats.grandPrixFinished).toBe(0);
  });

  it('winning a cup unlocks Cupcake Carnival', () => {
    const p = applyGrandPrix(emptyProgress(), gp({ humanWinner: { playerIndex: 0, characterId: 'rocco' }, bestHumanPlace: 1 }));
    expect(evaluateUnlocks(p).map((u) => u.id)).toContain('cupcake-carnival');
  });
});

describe('evaluateUnlocks', () => {
  it('several unlocks from one race come in lineup order: racers first, then tracks', () => {
    const p = emptyProgress();
    const stats = createRaceStats();
    for (let i = 0; i < 10; i++) stats.onEvent({ type: 'item-use', kart: humanKart(0) });
    applyRaceSummary(p, makeSummary({ trackId: 'gumdrop-meadow', humans: [{ place: 1 }], stats }));
    expect(evaluateUnlocks(p)).toEqual([
      { kind: 'character', id: 'cotton-candy-girl' },
      { kind: 'character', id: 'shelly' },
      { kind: 'track', id: 'bubblegum-bay' },
      { kind: 'track', id: 'mermaid-lagoon' },
      { kind: 'track', id: 'honeycomb-hive' },
    ]);
  });

  it('is idempotent once ids are earned, and never lists free content', () => {
    const p = progressFor({ type: 'stat', stat: 'wins', count: 8 });
    const first = evaluateUnlocks(p);
    expect(first.length).toBeGreaterThan(3);
    p.unlocked.push(...first.map((u) => u.id));
    expect(evaluateUnlocks(p)).toEqual([]);
    const free = new Set([...LINEUP_CHARACTERS, ...LINEUP_TRACKS].filter((x) => !x.unlock).map((x) => x.id));
    for (const u of first) expect(free.has(u.id)).toBe(false);
  });

  it('entriesFrom uses the def rule, falls back to the lineup, and skips placeholders', () => {
    const e = entriesFrom([{ id: 'cotton-candy-girl' }, { id: 'rocco', unlock: null }, { id: 'x', placeholder: true, unlock: {} }], [{ id: 'bubblegum-bay' }]);
    expect(e).toEqual([
      { kind: 'character', id: 'cotton-candy-girl', unlock: { type: 'stat', stat: 'wins', count: 1 } },
      { kind: 'character', id: 'rocco', unlock: null },
      { kind: 'track', id: 'bubblegum-bay', unlock: { type: 'stat', stat: 'racesFinished', count: 1 } },
    ]);
  });
});

describe('nextUnlock (results teaser)', () => {
  it('picks the locked item closest to done', () => {
    const p = emptyProgress();
    p.stats.racesFinished = 2; // teddy 2/3, pillow 2/6
    p.stats.itemsUsed = 9; // honeycomb 9/10
    p.unlocked = ['bubblegum-bay', 'bruno'];
    const n = nextUnlock(p);
    expect(n).toMatchObject({ kind: 'track', id: 'honeycomb-hive', progress: { current: 9, target: 10 } });
  });

  it('breaks ties by fewest steps left, then lineup order', () => {
    const p = emptyProgress();
    // nothing started: every ratio is 0 -> the first one-step item in lineup order
    expect(nextUnlock(p)).toMatchObject({ id: 'cotton-candy-girl' });
    const entries = [
      { kind: 'track', id: 'a', unlock: { type: 'stat', stat: 'wins', count: 4 } },
      { kind: 'track', id: 'b', unlock: { type: 'stat', stat: 'wins', count: 2 } },
    ];
    p.stats.wins = 1; // a 1/4, b 1/2 -> b
    expect(nextUnlock(p, entries).id).toBe('b');
  });

  it('skips earned and ready-to-unlock items; null when all done or unlockAll', () => {
    const entries = [{ kind: 'character', id: 'c', unlock: { type: 'stat', stat: 'wins', count: 1 } }];
    const p = emptyProgress();
    p.stats.wins = 1;
    expect(nextUnlock(p, entries)).toBe(null);
    const q = emptyProgress();
    expect(nextUnlock({ ...q, unlocked: ['c'] }, entries)).toBe(null);
    expect(nextUnlock({ ...q, unlockAll: true }, entries)).toBe(null);
    expect(nextUnlock(q, entries)).toMatchObject({ id: 'c' });
  });
});

describe('merged saves feed the engine safely', () => {
  it('a v1 save (no stats / tracks) evaluates without NaN and keeps earned ids', () => {
    const p = mergeProgress({ unlocked: ['cotton-candy-girl'], wins: 3, trophies: { 'gumdrop-meadow': 3 } });
    applyRaceSummary(p, makeSummary({ humans: [{ place: 1 }] }));
    expect(p.stats.wins).toBe(1);
    expect(p.wins).toBe(4);
    expect(evaluateUnlocks(p).map((u) => u.id)).not.toContain('cotton-candy-girl');
  });
});
