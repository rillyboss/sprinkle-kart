import { describe, it, expect } from 'vitest';
import {
  createGrandPrix, gpRaceSetup, gpRecordRace, gpNextRace, gpTrackId, gpIsLastRace, gpRaceCount, gpCpuGrid,
  standingsTally, tallyValue, trophyFor, podiumOrder, ceremonyHeadline, cupCards,
} from '../src/modes/grandPrix.js';
import { CUPS, GP_POINTS, scoreGrandPrix } from '../src/data/cups.js';
import { TRACKS } from '../src/tracks/index.js';
import { createEventBus } from '../src/game/events.js';

const TRACK_IDS = ['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes'];
const CPUS = ['stella', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy'];
const HUMANS = [{ playerIndex: 0, deviceId: 'kb1', characterId: 'rocco' }, { playerIndex: 1, deviceId: 'kb2', characterId: 'lenny' }];

/** A RaceSummary-like result: `order` = racer keys best first ('p0', 'p1' or a CPU id). */
function race(order, trackId = 'x') {
  return {
    trackId,
    standings: order.map((key, i) => (/^p[0-3]$/.test(key)
      ? { characterId: HUMANS[+key.slice(1)].characterId, playerIndex: +key.slice(1), isCPU: false, place: i + 1 }
      : { characterId: key, playerIndex: null, isCPU: true, place: i + 1 })),
  };
}

const newGp = () => createGrandPrix({ cupId: 'sprinkle-cup', trackIds: TRACK_IDS, cpuIds: CPUS });

describe('Grand Prix flow reducer', () => {
  it('starts on the first track and needs tracks', () => {
    const gp = newGp();
    expect(gp).toMatchObject({ cupId: 'sprinkle-cup', raceIndex: 0, phase: 'racing', result: null });
    expect(gpTrackId(gp)).toBe('cotton-candy-castle');
    expect(gpRaceCount(gp)).toBe(4);
    expect(gpIsLastRace(gp)).toBe(false);
    expect(Object.isFrozen(gp)).toBe(true);
    expect(() => createGrandPrix({ cupId: 'x', trackIds: [] })).toThrow();
  });

  it('runs 4 races: record -> standings -> next ... -> done, with points from scoreGrandPrix', () => {
    let gp = newGp();
    const races = [
      race(['p0', 'stella', 'p1', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy']),
      race(['stella', 'p0', 'peachy', 'p1', 'gumbo', 'muffin', 'dino', 'bizzy']),
      race(['p0', 'p1', 'stella', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy']),
      race(['p1', 'p0', 'stella', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy']),
    ];
    const tracks = [];
    races.forEach((r, i) => {
      expect(gp.phase).toBe('racing');
      tracks.push(gpTrackId(gp));
      gp = gpRecordRace(gp, r);
      expect(gp.summaries).toHaveLength(i + 1);
      expect(gp.result).toEqual(scoreGrandPrix('sprinkle-cup', races.slice(0, i + 1), { raceCount: 4 }));
      expect(gp.result.raceIndex).toBe(i);
      if (i < 3) {
        expect(gp.phase).toBe('standings');
        expect(gp.result.finished).toBe(false);
        gp = gpNextRace(gp);
      }
    });
    expect(tracks).toEqual(TRACK_IDS);
    expect(gp.phase).toBe('done');
    expect(gp.result.finished).toBe(true);
    // P1 (rocco): 15 + 12 + 15 + 12 = 54, the winner
    expect(gp.result.standings[0]).toMatchObject({ playerIndex: 0, points: 54, racePoints: [15, 12, 15, 12] });
    expect(gp.result.humanWinner).toEqual({ playerIndex: 0, characterId: 'rocco' });
    expect(gp.result.bestHumanPlace).toBe(1);
  });

  it('ignores out-of-phase actions', () => {
    const gp = newGp();
    expect(gpNextRace(gp)).toBe(gp); // not in standings yet
    const after = gpRecordRace(gp, race(['p0']));
    expect(gpRecordRace(after, race(['p0']))).toBe(after); // must go to the next race first
    expect(gpRecordRace(gp, null)).toBe(gp);
  });

  it('a restarted race (pause -> start over) is simply not recorded', () => {
    let gp = newGp();
    // race 1 restarted twice: nothing recorded until a race really finishes
    expect(gp.summaries).toHaveLength(0);
    gp = gpRecordRace(gp, race(['p0', 'stella']));
    expect(gp.summaries).toHaveLength(1);
  });

  it('race setups keep players + speed and carry mode, cup, track and the fixed CPUs', () => {
    const base = { players: HUMANS, speedClass: 'zoomy', trackId: 'whatever', laps: 5, mode: 'grand-prix', cupId: 'sprinkle-cup' };
    const gp = newGp();
    const s = gpRaceSetup(gp, base);
    expect(s).toMatchObject({ players: HUMANS, speedClass: 'zoomy', mode: 'grand-prix', cupId: 'sprinkle-cup', trackId: 'cotton-candy-castle', laps: null, gpRace: 0 });
    expect(s.cpuIds).toEqual(CPUS);
    expect(gpRaceSetup(gp, base, { laps: 1 }).laps).toBe(1);
  });

  it('after a race the CPU points leader starts on pole', () => {
    let gp = gpRecordRace(newGp(), race(['p0', 'dino', 'p1', 'bizzy', 'stella', 'peachy', 'gumbo', 'muffin']));
    gp = gpNextRace(gp);
    const grid = gpCpuGrid(gp);
    expect(grid).toHaveLength(CPUS.length);
    expect(new Set(grid)).toEqual(new Set(CPUS));
    expect(grid.slice(0, 2)).toEqual(['dino', 'bizzy']);
    expect(gpRaceSetup(gp, { players: HUMANS }).trackId).toBe('gumdrop-meadow');
  });

  it('emits a GrandPrixResult both events accept (bus contract)', () => {
    const bus = createEventBus();
    const seen = [];
    bus.on('gp-race-end', (gp) => seen.push(['race', gp.raceIndex, gp.finished]));
    bus.on('gp-end', (gp) => { seen.push(['end', gp.raceIndex, gp.finished]); gp.unlocks.push({ kind: 'track', id: 'cupcake-carnival' }); });
    let gp = newGp();
    for (let i = 0; i < 4; i++) {
      gp = gpRecordRace(gp, race(['p0', 'stella']));
      bus.emit('gp-race-end', gp.result);
      if (gp.result.finished) bus.emit('gp-end', gp.result);
      if (gp.phase === 'standings') gp = gpNextRace(gp);
    }
    expect(seen).toEqual([['race', 0, false], ['race', 1, false], ['race', 2, false], ['race', 3, true], ['end', 3, true]]);
    expect(gp.result.unlocks).toEqual([{ kind: 'track', id: 'cupcake-carnival' }]);
  });
});

describe('standings tally + ceremony helpers', () => {
  const result = scoreGrandPrix('sprinkle-cup', [
    race(['stella', 'p0', 'peachy']),
    race(['p0', 'peachy', 'stella']),
  ], { raceCount: 4 });

  it('knows points before/after the latest race and the old/new order', () => {
    const rows = standingsTally(result);
    const p0 = rows.find((r) => r.playerIndex === 0);
    expect(p0).toMatchObject({ before: 12, after: 27, gained: 15, toIndex: 0, fromIndex: 1 });
    const stella = rows.find((r) => r.characterId === 'stella');
    expect(stella).toMatchObject({ before: 15, after: 25, gained: 10, fromIndex: 0 });
    expect(rows.map((r) => r.toIndex)).toEqual([0, 1, 2]);
    expect(new Set(rows.map((r) => r.fromIndex))).toEqual(new Set([0, 1, 2]));
    expect(standingsTally(null)).toEqual([]);
  });

  it('counts up with an ease-out and lands exactly', () => {
    expect(tallyValue(10, 25, 0)).toBe(10);
    expect(tallyValue(10, 25, 5)).toBe(25);
    const mid = tallyValue(10, 25, 0.6, 1.2);
    expect(mid).toBeGreaterThan(17); // ease-out: past halfway at half time
    expect(mid).toBeLessThan(25);
    let last = 10;
    for (let t = 0; t <= 1.2; t += 0.05) { const v = tallyValue(10, 25, t, 1.2); expect(v).toBeGreaterThanOrEqual(last); last = v; }
    expect(tallyValue(3, 3, 0.5)).toBe(3);
    expect(tallyValue(1, 9, 0.5, 0)).toBe(9);
  });

  it('gold / silver / bronze for the top 3, podium in 2-1-3 order', () => {
    expect([1, 2, 3, 4].map(trophyFor)).toEqual(['gold', 'silver', 'bronze', null]);
    const top = podiumOrder(result.standings);
    expect(top.map((r) => r.place)).toEqual([2, 1, 3]);
    expect(podiumOrder(result.standings.slice(0, 1)).map((r) => r.place)).toEqual([1]);
    expect(podiumOrder([])).toEqual([]);
  });

  it('friendly ceremony headlines', () => {
    const name = (id) => ({ rocco: 'Rocco', stella: 'Stella' }[id] ?? id);
    expect(ceremonyHeadline(result, name, 'Sprinkle Cup')).toBe('P1 Rocco wins Sprinkle Cup! 🏆');
    const cpuWin = scoreGrandPrix('sprinkle-cup', [race(['stella', 'p0'])]);
    expect(ceremonyHeadline(cpuWin, name, 'Sprinkle Cup')).toMatch(/Silver cup/);
    const third = scoreGrandPrix('sprinkle-cup', [race(['stella', 'peachy', 'p0'])]);
    expect(ceremonyHeadline(third, name)).toMatch(/Bronze/);
    const far = scoreGrandPrix('sprinkle-cup', [race(['stella', 'peachy', 'gumbo', 'p0'])]);
    expect(ceremonyHeadline(far, name, 'Sprinkle Cup')).toMatch(/Stella wins Sprinkle Cup/);
    expect(ceremonyHeadline(null)).toMatch(/Grand Prix/);
    for (const h of [ceremonyHeadline(result, name), ceremonyHeadline(far, name)]) expect(h).not.toMatch(/\b(lose|loser|last|fail)\b/i);
  });
});

describe('cup select cards', () => {
  it('only cups with all 4 tracks unlocked are playable', () => {
    const all = cupCards(CUPS, TRACKS, () => false);
    const sprinkle = all.find((c) => c.cup.id === 'sprinkle-cup');
    expect(sprinkle.playable).toBe(true);
    expect(sprinkle.tracks.map((t) => t.def.id)).toEqual(TRACK_IDS);
    expect(all).toHaveLength(5);
    // lock one track of the Sprinkle Cup -> not playable, hint points at that track
    const locked = cupCards(CUPS, TRACKS, (t) => t.id === 'starlight-galaxy').find((c) => c.cup.id === 'sprinkle-cup');
    expect(locked.playable).toBe(false);
    expect(locked.firstLocked.id).toBe('starlight-galaxy');
    expect(locked.tracks.filter((t) => t.locked)).toHaveLength(1);
  });

  it('cups whose tracks are not built yet say so instead of breaking', () => {
    const only = TRACKS.filter((t) => TRACK_IDS.includes(t.id));
    const cards = cupCards(CUPS, only, () => false);
    const bubble = cards.find((c) => c.cup.id === 'bubble-cup');
    expect(bubble).toMatchObject({ playable: false, missing: 4, firstLocked: null });
    expect(bubble.tracks).toEqual([]);
  });

  it('a throwing lock check counts as locked', () => {
    const cards = cupCards(CUPS, TRACKS, () => { throw new Error('nope'); });
    expect(cards.every((c) => !c.playable)).toBe(true);
  });

  it('the points table is the contract one', () => {
    expect([...GP_POINTS]).toEqual([15, 12, 10, 8, 6, 4, 2, 1]);
  });
});
