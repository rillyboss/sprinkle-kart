// Per-machine progression (NETWORKING.md §12, §9.6; acceptance M1-14, M2-2).
import { describe, it, expect } from 'vitest';
import { localizeSummary, localizeGp, isCountable } from '../src/net/session/localize.js';
import { applyRaceSummary, applyGrandPrix } from '../src/progress/engine.js';
import { applyGoalCounters, emptyGoals } from '../src/progress/goals.js';
import { emptyProgress } from '../src/progress/schema.js';
import { createRaceStats, emptyPlayerStats } from '../src/game/raceStats.js';
import { scoreGrandPrix, CUPS } from '../src/data/cups.js';
import { CHARACTERS } from '../src/characters/index.js';

// racer ids from the registry (never hard-code names: Boo Berry became Peekaberry in v2.0.1)
const [R0, R1, R2, R3, R4] = CHARACTERS.map((c) => c.id);
const CUP = CUPS[0];

const stats = (o = {}) => ({ ...emptyPlayerStats(), ...o });
const human = (playerIndex, place, characterId, extra = {}) => ({
  playerIndex, deviceId: `d${playerIndex}`, characterId, kidAssist: false, place, finished: true, estimated: false,
  finishTime: 60 + place, lapTimes: [20, 20, 20 + place], stats: stats(extra.stats), ...extra,
});

/** Host view: host house = pis 0,1; guest house B = pi 2; guest house C = pi 3. Host's P1 wins. */
function hostSummary(mode = 'free', over = {}) {
  const humans = [
    human(0, 1, R0, { stats: { miniTurbos: 3, itemsUsed: 2, driftBoosts: [1, 1, 1] } }),
    human(1, 4, R1, { stats: { itemsUsed: 1 } }),
    human(2, 2, R2, { stats: { miniTurbos: 1, driftBoosts: [1, 0, 0], bonksGiven: 2, itemsUsed: 3 } }),
    human(3, 6, R3, { stats: { bonked: 1 } }),
  ];
  return {
    mode, trackId: CUP.tracks?.[0] ?? 'cotton-candy-castle', cupId: mode === 'grand-prix' ? CUP.id : null, speedClass: 'zippy', laps: 3,
    humanCount: 4, raceTime: 70, humans,
    standings: [
      { characterId: R0, playerIndex: 0, isCPU: false, place: 1, finished: true, estimated: false, finishTime: 61 },
      { characterId: R2, playerIndex: 2, isCPU: false, place: 2, finished: true, estimated: false, finishTime: 62 },
      { characterId: R4, playerIndex: null, isCPU: true, place: 3, finished: true, estimated: false, finishTime: 63 },
      { characterId: R1, playerIndex: 1, isCPU: false, place: 4, finished: true, estimated: false, finishTime: 64 },
      { characterId: R3, playerIndex: 3, isCPU: false, place: 6, finished: true, estimated: false, finishTime: 66 },
    ],
    winner: { playerIndex: 0, characterId: R0 },
    totals: { itemsUsed: 6, bonksGiven: 2, miniTurbos: 4 },
    unlocks: [{ kind: 'track', id: 'host-only' }],
    records: { trackId: 'x', newBestRace: true },
    ...over,
  };
}

describe('localizeSummary', () => {
  it('keeps only this machine\'s rows (with the host\'s per-player stats), never the host\'s winner', () => {
    const s = localizeSummary(hostSummary(), [2]);
    expect(s.humans.map((h) => h.playerIndex)).toEqual([2]);
    expect(s.humans[0].stats).toEqual(hostSummary().humans[2].stats);
    expect(s.winner).toBe(null);
    expect(s.totals).toEqual({ itemsUsed: 3, bonksGiven: 2, miniTurbos: 1 });
    expect(s.humanCount).toBe(4); // all humans: multiplayerRaces still counts
    expect(s.online).toBe(true);
    expect(s.unlocks).toEqual([]); // a fresh collector, never the host's unlocks
    expect(s.records).toBeUndefined();
    expect(s.standings).toHaveLength(5); // everyone still sees the whole result
  });

  it('credits a local win on the machine that won it (and clean-win goals only there)', () => {
    const s = localizeSummary(hostSummary(), [0, 1]);
    expect(applyGoalCounters({ ...emptyProgress(), goals: emptyGoals() }, s).goals.counters.cleanWins).toBe(1);
    expect(applyGoalCounters({ ...emptyProgress(), goals: emptyGoals() }, localizeSummary(hostSummary(), [2])).goals.counters.cleanWins).toBe(0);
    expect(s.winner).toEqual({ playerIndex: 0, characterId: R0 });
    expect(s.humans.map((h) => h.playerIndex)).toEqual([0, 1]);
    expect(s.totals.miniTurbos).toBe(3);
  });

  it('does not mutate the host summary', () => {
    const src = hostSummary();
    const copy = structuredClone(src);
    const s = localizeSummary(src, [2]);
    s.humans[0].stats.miniTurbos = 99;
    expect(src).toEqual(copy);
  });

  it('a guest is never credited for the host\'s win in the progress engine', () => {
    const guest = applyRaceSummary(emptyProgress(), localizeSummary(hostSummary(), [2]));
    expect(guest.stats.wins).toBe(0);
    expect(guest.stats.podiums).toBe(1); // their own 2nd place
    expect(guest.stats.racesFinished).toBe(1);
    expect(guest.stats.multiplayerRaces).toBe(1);
    expect(guest.stats.miniTurbos).toBe(1);
    const host = applyRaceSummary(emptyProgress(), localizeSummary(hostSummary(), [0, 1]));
    expect(host.stats.wins).toBe(1);
    expect(host.stats.miniTurbos).toBe(3);
    // the unlocalized summary WOULD have credited the guest (why localize is mandatory)
    expect(applyRaceSummary(emptyProgress(), hostSummary()).stats.wins).toBe(1);
  });

  it('works for every online mode (free, grand-prix, team, battle)', () => {
    for (const mode of ['free', 'grand-prix', 'team', 'battle']) {
      const s = localizeSummary(hostSummary(mode), [3]);
      expect(s.mode).toBe(mode);
      expect(s.humans.map((h) => h.playerIndex)).toEqual([3]);
      expect(s.winner).toBe(null);
    }
  });

  it('battle: humanWinner and pops only for local players', () => {
    const battle = {
      reason: 'time', time: 90,
      ranking: [
        { characterId: R0, playerIndex: 0, isCPU: false, place: 1, bubbles: 2, max: 3, pops: 4, popped: 1, out: false },
        { characterId: R2, playerIndex: 2, isCPU: false, place: 2, bubbles: 1, max: 3, pops: 2, popped: 2, out: false },
        { characterId: R4, playerIndex: null, isCPU: true, place: 3, bubbles: 0, max: 3, pops: 1, popped: 3, out: true },
      ],
      winners: [{ characterId: R0, playerIndex: 0, isCPU: false }],
      humanWinner: { playerIndex: 0, characterId: R0 },
      humanPops: 6,
    };
    const guest = localizeSummary(hostSummary('battle', { battle }), [2]);
    expect(guest.battle.humanWinner).toBe(null);
    expect(guest.battle.humanPops).toBe(2);
    const g = applyGoalCounters({ ...emptyProgress(), goals: emptyGoals() }, guest);
    expect(g.goals.counters).toMatchObject({ battlesPlayed: 1, battlesWon: 0, bubblesPopped: 2 });
    const host = localizeSummary(hostSummary('battle', { battle }), [0, 1]);
    expect(host.battle.humanWinner).toEqual({ playerIndex: 0, characterId: R0 });
    expect(host.battle.humanPops).toBe(4);
    expect(applyGoalCounters({ ...emptyProgress(), goals: emptyGoals() }, host).goals.counters).toMatchObject({ battlesWon: 1, bubblesPopped: 4 });
  });

  it('team: every human is Team Sprinkle, so the team result is shared by every house', () => {
    const team = { winner: 'sprinkle', homeTeam: 'sprinkle', scores: { sprinkle: 30, star: 20 } };
    const s = localizeSummary(hostSummary('team', { team }), [3]);
    expect(s.team).toEqual(team);
  });

  it('a predicted drift-boost the host contradicted never increments the goal / stat counter', () => {
    // Guest machine (pi 2) predicted a mini-turbo locally: presentation only.
    const kart = { playerIndex: 2, isCPU: false };
    const guestStream = [
      { type: 'drift-boost', kart, level: 2, predicted: true },   // cancelled on the host by a bump the guest couldn't predict
      { type: 'item-use', kart, item: 'sprinkle-boost' },         // host-confirmed
    ];
    const local = createRaceStats();
    for (const e of guestStream) if (isCountable(e)) local.onEvent(e);
    expect(local.forPlayer(2).miniTurbos).toBe(0);
    // the host saw no mini-turbo for pi 2 in this race
    const host = hostSummary('free', {
      humans: hostSummary().humans.map((h) => (h.playerIndex === 2 ? { ...h, stats: stats({ itemsUsed: 1 }) } : h)),
    });
    const s = localizeSummary(host, [2]);
    expect(s.humans[0].stats.miniTurbos).toBe(0);
    const p = applyRaceSummary(emptyProgress(), s);
    expect(p.stats.miniTurbos).toBe(0);
    expect(p.stats.miniTurbos2).toBe(0);
    expect(p.stats.itemsUsed).toBe(1);
    expect(isCountable({ type: 'lap' })).toBe(true);
    expect(isCountable(null)).toBe(false);
  });
});

describe('localizeGp', () => {
  function gp(winnerPi) {
    const races = [0, 1, 2, 3].map(() => {
      const s = hostSummary('grand-prix');
      if (winnerPi === 2) {
        s.standings = [s.standings[1], s.standings[0], ...s.standings.slice(2)].map((r, i) => ({ ...r, place: i + 1 }));
        s.humans = s.humans.map((h) => ({ ...h, place: s.standings.find((r) => r.playerIndex === h.playerIndex).place }));
        s.winner = { playerIndex: 2, characterId: R2 };
      }
      return s;
    });
    return scoreGrandPrix(CUP.id, races);
  }

  it('a guest is never credited cupsWon for another house\'s win; its own win is credited', () => {
    const hostWins = gp(0);
    expect(hostWins.humanWinner.playerIndex).toBe(0);
    const guestView = localizeGp(hostWins, [2]);
    expect(guestView.humanWinner).toBe(null);
    expect(guestView.bestHumanPlace).toBe(2);
    expect(guestView.races.every((r) => r.winner === null && r.online)).toBe(true);
    expect(applyGrandPrix(emptyProgress(), guestView).stats.cupsWon).toBe(0);
    expect(applyGrandPrix(emptyProgress(), localizeGp(hostWins, [0, 1])).stats.cupsWon).toBe(1);

    const guestWins = gp(2);
    const mine = localizeGp(guestWins, [2]);
    expect(mine.humanWinner).toEqual({ playerIndex: 2, characterId: R2 });
    expect(mine.bestHumanPlace).toBe(1);
    expect(applyGrandPrix(emptyProgress(), mine).stats.cupsWon).toBe(1);
    expect(applyGrandPrix(emptyProgress(), localizeGp(guestWins, [0, 1])).stats.cupsWon).toBe(0);
    // without localizing, cups.js treats ANY human as the winner
    expect(applyGrandPrix(emptyProgress(), guestWins).stats.cupsWon).toBe(1);
  });

  it('a house whose players did not race gets no best place and fresh unlocks', () => {
    const g = localizeGp(gp(0), [7]);
    expect(g.bestHumanPlace).toBe(null);
    expect(g.unlocks).toEqual([]);
    expect(localizeGp(null, [0])).toMatchObject({ races: [], humanWinner: null, bestHumanPlace: null });
  });
});
