// Kid-Assist survives every way into a race: for each mode's setup builder (the pure
// functions the menu screens finish with, plus the per-mode transforms main.js applies),
// a player who switched Kid-Assist on in the join screen ends up as a Race kart with
// easyDrive — and that kart drives off with NO input at all (the "Kid-Assist doesn't press
// the gas" complaint), while a player without it and no input stays on the grid.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race } from '../src/race/Race.js';
import { buildParticipants } from '../src/game/setup.js';
import * as S from '../src/ui/menuState.js';
import { cupRaceSetup } from '../src/ui/screens/cupSelect.js';
import { dailyRaceSetup } from '../src/ui/screens/daily.js';
import { arenaRaceSetup } from '../src/ui/screens/arenaSelect.js';
import { cupPlayers } from '../src/ui/screens/myCup.js';
import { finalizeSetup } from '../src/modes/flow.js';
import { createGrandPrix, gpRaceSetup, gpNextRace } from '../src/modes/grandPrix.js';
import { applyKidAssistDefault } from '../src/systems/progressSettings.js';
import { CHARACTERS } from '../src/data/characters.js';
import { TRACKS } from '../src/data/tracks.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';

const ev = (deviceId, action) => ({ deviceId, action });

/** Join screen: kb1 joins + toggles Kid-Assist (Y / Tab), gp1 joins without it. */
function joinedDraft() {
  let join = S.createJoinState();
  for (const e of [ev('kb1', 'confirm'), ev('kb1', 'toggle'), ev('gp1', 'confirm')]) join = S.joinReduce(join, e).state;
  return {
    joinState: join,
    charPicks: [{ playerIndex: 0, characterId: 'luna' }, { playerIndex: 1, characterId: 'rocco' }],
  };
}

const CHARS = CHARACTERS.filter((c) => !c.locked);

/** Free race: the real reducers all the way (join -> racer select -> track select). */
function freeRaceSetup(draft) {
  let chars = S.createCharSelectState({ players: draft.joinState.players, characters: CHARS, isLocked: () => false });
  for (const e of [ev('kb1', 'confirm'), ev('gp1', 'right'), ev('gp1', 'confirm')]) chars = S.charSelectReduce(chars, e).state;
  let tracks = S.createTrackSelectState({ tracks: TRACKS, controllerId: 'kb1', easyDrive: true });
  tracks = S.trackSelectReduce(tracks, ev('kb1', 'right')).state;
  return finalizeSetup(S.buildRaceSetup(draft.joinState, chars, tracks, TRACKS), { ...draft, mode: 'free' });
}

const gp = () => createGrandPrix({ cupId: 'sprinkle-cup', trackIds: ['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes'], cpuIds: defaultRacerIds(8).slice(2) });
const card = { cup: { id: 'sprinkle-cup' }, tracks: [{ def: { id: 'cotton-candy-castle' } }] };

/** [mode, (draft) -> RaceSetup as main.js hands it to startRace] */
const BUILDERS = [
  ['free race', (d) => freeRaceSetup(d)],
  ['grand prix, race 1', (d) => gpRaceSetup(gp(), finalizeSetup(cupRaceSetup(d, card, 'cozy'), d))],
  ['grand prix, race 2+', (d) => {
    const next = gpNextRace(Object.freeze({ ...gp(), phase: 'standings' }));
    expect(next.raceIndex).toBe(1);
    return gpRaceSetup(next, finalizeSetup(cupRaceSetup(d, card, 'cozy'), d));
  }],
  ['time trial', (d) => {
    const s = finalizeSetup({ ...freeRaceSetup(d), mode: 'time-trial' }, d);
    return { ...s, mode: 'time-trial', players: s.players.slice(0, 1) }; // main.js runTimeTrial
  }],
  ['team race', (d) => ({ ...freeRaceSetup(d), mode: 'team' })], // main.js runTeamRaces
  ['battle', (d) => finalizeSetup(arenaRaceSetup(d, 'arena', 'cozy'), d)],
  ['daily sprinkle', (d) => {
    const s = finalizeSetup(dailyRaceSetup(d, { id: '2026-09-26', trackId: 'gumdrop-meadow', speedClass: 'zoomy' }), d);
    expect(s.speedClass).toBe('zippy'); // little racers with Kid-Assist never get a Zoomy day
    return s;
  }],
  ['my cup', (d) => ({ players: cupPlayers(d), trackId: 'gumdrop-meadow', speedClass: 'cozy', mode: 'grand-prix', cupId: 'my-cup' })],
];

/** The Race main.js startRace() would build for this setup (humans sorted, CPUs filling up). */
function raceFor(setup) {
  const humans = [...setup.players].sort((a, b) => a.playerIndex - b.playerIndex);
  const cpus = defaultRacerIds(8).filter((id) => !humans.some((h) => h.characterId === id)).slice(0, 8 - humans.length);
  const { def, path } = trackFixture('gumdrop-meadow');
  return new Race({ scene: new THREE.Scene(), trackDef: def, path, participants: buildParticipants(humans, cpus), speedClass: 'cozy', buildKartModel: stubKartModel(), laps: 3, seed: 2 });
}

describe('Kid-Assist reaches the Race from every mode', () => {
  it('the join screen toggle really set it (only for the player who pressed it)', () => {
    const d = joinedDraft();
    expect(d.joinState.players.map((p) => [p.deviceId, p.easyDrive])).toEqual([['kb1', true], ['gp1', false]]);
  });

  for (const [mode, build] of BUILDERS) {
    it(`${mode}: the setup, the participants and the kart keep easyDrive`, () => {
      const d = joinedDraft();
      const setup = build(d);
      const p1 = setup.players.find((p) => p.playerIndex === 0);
      expect(p1.easyDrive, `${mode} setup lost Kid-Assist`).toBe(true);
      const p2 = setup.players.find((p) => p.playerIndex === 1);
      if (p2) expect(!!p2.easyDrive).toBe(false);
      const race = raceFor(setup);
      const k1 = race.getPlayerKart(0);
      expect(k1.easyDrive, `${mode} kart lost Kid-Assist`).toBe(true);
      if (p2) expect(race.getPlayerKart(1).easyDrive).toBe(false);
      for (const k of race.karts.filter((x) => x.isCPU)) expect(k.easyDrive).toBe(false);
      race.dispose();
    });
  }

  it('Kid-Assist drives with NO input; without it and no input you stay put', () => {
    const race = raceFor(freeRaceSetup(joinedDraft()));
    const k1 = race.getPlayerKart(0);
    const k2 = race.getPlayerKart(1);
    for (let i = 0; i < 3 * 60; i++) race.update(1 / 60, []); // countdown
    const start = [k1.progress, k2.progress];
    for (let i = 0; i < 2.5 * 60; i++) race.update(1 / 60, []); // 2.5 s, no buttons
    expect(k1.progress - start[0]).toBeGreaterThan(3);
    expect(k1.speed).toBeGreaterThan(0.6 * k1.stats.maxSpeed); // full gas, not a crawl
    expect(Math.abs(k2.progress - start[1])).toBeLessThan(0.5);
    race.dispose();
  });

  it('the "Kid-Assist for new players" setting turns it on at join, and a carried-over choice stays', () => {
    const seen = new Set();
    const join = { players: [{ deviceId: 'kb1', easyDrive: false }, { deviceId: 'gp1', easyDrive: true }] };
    const on = applyKidAssistDefault(join, seen, true);
    expect(on.players.map((p) => p.easyDrive)).toEqual([true, true]);
    const off = { players: [{ deviceId: 'kb1', easyDrive: false }] };
    expect(applyKidAssistDefault(off, seen, true)).toBe(off); // already seen: the player's own choice stays
  });
});
