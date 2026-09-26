// Showcase modes glue: Race mode hooks, menu flow, debug params, result / HUD view models, screens.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race } from '../src/race/Race.js';
import { rulesForMode } from '../src/modes/rules.js';
import { applyModeChoice, finalizeSetup } from '../src/modes/flow.js';
import { parseDebugParams, quickSetup, wantsQuickStart, modeParam } from '../src/game/setup.js';
import { battleResultModel, teamResultModel, BATTLE_OPTIONS, TEAM_OPTIONS, medal } from '../src/modes/showcaseResults.js';
import { battleHudModel, teamHudModel, BATTLE_WIDGET, TEAM_WIDGET } from '../src/ui/widgets/showcaseModes.js';
import { kartTopHeight, BUBBLE_HEIGHT } from '../src/modes/battleSession.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { flowOrder } from '../src/ui/screenFlow.js';
import { arenaRaceSetup, HOW_TO_BATTLE } from '../src/ui/screens/arenaSelect.js';
import { ARENAS } from '../src/modes/arenas/index.js';
import { CHARACTERS } from '../src/data/characters.js';
import { TRACKS } from '../src/data/tracks.js';
import { buildKartModel } from '../src/render/characterModels.js';
import { trackFixture, defaultRacerIds, stubKartModel } from './helpers/raceHarness.js';
import { listSystems } from '../src/systems/index.js';

const BAD_WORDS = /\b(hit|kill|crash|destroy|die|dead|loser)\b/i;

function smallRace(rules, n = 4) {
  const { def, path } = trackFixture('gumdrop-meadow');
  const events = [];
  const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants: defaultRacerIds(n).map((c, i) => ({ characterId: c, playerIndex: i === 0 ? 0 : null })), seed: 3, rules, buildKartModel: stubKartModel(), onEvent: (e) => events.push(e) });
  return { race, events, path };
}

describe('Race mode hooks', () => {
  it('battle rule: no laps, no finish, never completes on its own', () => {
    const { race, events } = smallRace(rulesForMode('battle'));
    for (let i = 0; i < 30 * 200; i++) race.update(1 / 30, []);
    expect(race.state).toBe('racing');
    expect(race.karts.every((k) => k.lap === 1 && !k.finished)).toBe(true);
    expect(race.karts.some((k) => k.distance > race.path.length)).toBe(true); // they did drive round
    expect(events.some((e) => e.type === 'lap' || e.type === 'finish')).toBe(false);
    race.dispose();
  });

  it('completeWith(order) ends the race in that order, once', () => {
    const { race, events } = smallRace(rulesForMode('battle'));
    for (let i = 0; i < 200; i++) race.update(1 / 30, []);
    const [a, b, c, d] = race.karts;
    race.completeWith([c, a, { not: 'a kart' }]);
    expect(race.state).toBe('finished');
    expect(race.getStandings().slice(0, 2)).toEqual([c, a]);
    expect(race.getStandings().map((k) => k.finishPlace)).toEqual([1, 2, 3, 4]);
    expect(race.getStandings().every((k) => k.finished && !k.finishEstimated)).toBe(true);
    expect(new Set(race.getStandings())).toEqual(new Set([a, b, c, d]));
    race.completeWith([d]);
    expect(events.filter((e) => e.type === 'race-complete')).toHaveLength(1);
    expect(race.getStandings()[0]).toBe(c);
    race.dispose();
  });

  it('completeWith during the countdown still ends cleanly', () => {
    const { race } = smallRace(rulesForMode('battle'));
    race.completeWith([]);
    expect(race.state).toBe('finished');
    expect(race.countdown).toBe(0);
    race.dispose();
  });

  it('itemRoller replaces the place odds; rocketTarget picks who a rocket chases', () => {
    const { race } = smallRace(rulesForMode('free'));
    const k = race.karts[0];
    race.itemRoller = () => 'gumdrop';
    race._onBoxBreak(k);
    expect(k.phys.pendingItem).toBe('gumdrop');
    race.itemRoller = () => null; // null falls back to the normal odds
    k.phys.rouletteTime = 0;
    k.item = null;
    race._onBoxBreak(k);
    expect(typeof k.phys.pendingItem).toBe('string');
    const target = race.karts[2];
    race.rocketTarget = () => ({ target, distance: target.distance - 50 });
    const r = race.items.launchRocket(k);
    expect(r.target).toBe(target);
    expect(target.distance - r.distance).toBeCloseTo(50, 6);
    race.dispose();
  });

  it('a battle-out kart never uses its item', () => {
    const { race } = smallRace(rulesForMode('battle'));
    const k = race.karts[0];
    for (let i = 0; i < 120; i++) race.update(1 / 30, []);
    k.item = 'sprinkle-boost';
    k.itemCharges = 1;
    k.battleOut = true;
    race.update(1 / 30, [{ steer: 0, accel: 1, brake: 0, drift: false, useItem: true }]);
    expect(k.item).toBe('sprinkle-boost');
    k.battleOut = false;
    race.update(1 / 30, [{ steer: 0, accel: 1, brake: 0, drift: false, useItem: true }]);
    expect(k.item).toBe(null);
    race.dispose();
  });
});

describe('menu flow for the showcase modes', () => {
  it('Bubble Battle swaps track select for arena select; Team Race keeps track select', () => {
    const d = applyModeChoice({ joinState: { players: [{ deviceId: 'kb1' }] } }, 'battle');
    expect(d.mode).toBe('battle');
    expect(d.skip.has('track-select')).toBe(true);
    expect(flowOrder(SCREENS, { draft: d })).toEqual(['title', 'join', 'mode-select', 'character-select', 'arena-select']);
    applyModeChoice(d, 'team');
    expect(d.skip.has('track-select')).toBe(false);
    expect(flowOrder(SCREENS, { draft: d })).toEqual(['title', 'join', 'mode-select', 'character-select', 'track-select']);
    // the default flow is untouched
    expect(flowOrder(SCREENS, { draft: { skip: new Set() } })).toEqual(['title', 'join', 'mode-select', 'character-select', 'track-select']);
  });

  it('finalizeSetup keeps the new modes (and the arena)', () => {
    expect(finalizeSetup({ players: [], mode: 'battle', arenaId: 'gumball-garden' }, {})).toMatchObject({ mode: 'battle', arenaId: 'gumball-garden' });
    expect(finalizeSetup({ players: [] }, { mode: 'team' }).mode).toBe('team');
  });

  it('arenaRaceSetup builds the RaceSetup from the draft', () => {
    const draft = {
      joinState: { players: [{ playerIndex: 0, deviceId: 'kb1', easyDrive: true }, { playerIndex: 1, deviceId: 'kb2' }] },
      charPicks: [{ playerIndex: 0, characterId: 'rocco' }, { playerIndex: 1, characterId: 'lenny' }],
      trackPrev: { trackId: 'gumdrop-meadow' },
    };
    const s = arenaRaceSetup(draft, 'gumball-garden', 'cozy');
    expect(s).toMatchObject({ mode: 'battle', arenaId: 'gumball-garden', speedClass: 'cozy', trackId: 'gumdrop-meadow', laps: null });
    expect(s.players).toEqual([
      { playerIndex: 0, deviceId: 'kb1', characterId: 'rocco', easyDrive: true },
      { playerIndex: 1, deviceId: 'kb2', characterId: 'lenny', easyDrive: undefined },
    ]);
    for (const [, text] of HOW_TO_BATTLE) expect(text).not.toMatch(BAD_WORDS);
  });

  it('the new screens are registered (arena select at 40, battle only)', () => {
    const arena = SCREENS.get('arena-select');
    expect(arena.flow.order).toBe(40);
    expect(arena.flow.when({ draft: { mode: 'battle' } })).toBe(true);
    expect(arena.flow.when({ draft: { mode: 'free' } })).toBe(false);
    expect(arena.flow.when({})).toBe(false);
    for (const id of ['battle-results', 'team-results']) {
      expect(typeof SCREENS.get(id)?.mount).toBe('function');
      expect(SCREENS.get(id).flow).toBeUndefined();
    }
  });
});

describe('debug params', () => {
  it('?mode=battle / team (and friendly aliases), ?arena=', () => {
    expect(modeParam('battle')).toBe('battle');
    expect(modeParam('Bubble')).toBe('battle');
    expect(modeParam('team')).toBe('team');
    expect(modeParam('team-race')).toBe('team');
    const p = parseDebugParams('?mode=battle&arena=gumball-garden&players=2');
    expect(p).toMatchObject({ mode: 'battle', arena: 'gumball-garden', players: 2 });
    expect(parseDebugParams('?mode=battle').arena).toBe(null);
    expect(wantsQuickStart(p)).toBe(true);
    expect(wantsQuickStart(parseDebugParams('?mode=team'))).toBe(false);
    expect(wantsQuickStart(parseDebugParams('?mode=team&quick=gumdrop-meadow'))).toBe(true);
  });

  it('quickSetup for a battle and a team race', () => {
    const b = quickSetup(parseDebugParams('?mode=battle&arena=gumball-garden&players=2'), null, CHARACTERS, TRACKS);
    expect(b).toMatchObject({ mode: 'battle', arenaId: 'gumball-garden' });
    expect(b.players).toHaveLength(2);
    const t = quickSetup(parseDebugParams('?mode=team&quick=gumdrop-meadow&players=3'), null, CHARACTERS, TRACKS);
    expect(t).toMatchObject({ mode: 'team', trackId: 'gumdrop-meadow' });
    expect(t.arenaId).toBeUndefined();
  });
});

describe('results view models', () => {
  const row = (o) => ({ characterId: 'x', playerIndex: null, isCPU: true, place: 1, bubbles: 0, max: 3, pops: 0, out: false, ...o });

  it('battle: a human winner, a CPU winner, ties and reasons', () => {
    const names = (id) => ({ rocco: 'Rocco', lenny: 'Lenny' }[id] ?? id);
    let m = battleResultModel({ reason: 'last', ranking: [row({ characterId: 'rocco', playerIndex: 0, isCPU: false, bubbles: 2 }), row({ place: 2, out: true })] }, names);
    expect(m.title).toBe('P1 is the last one bobbing! 🏆');
    expect(m.humanWon).toBe(true);
    expect(m.sub).toMatch(/out of bubbles/);
    expect(m.rows[0]).toMatchObject({ medal: '🥇', winner: true, bubbles: 2, max: 3 });
    m = battleResultModel({ reason: 'humans-out', ranking: [row({ characterId: 'lenny' }), row({ place: 2, playerIndex: 0, isCPU: false, out: true })] }, names);
    expect(m.title).toBe('Lenny wins this one! 🫧');
    expect(m.humanWon).toBe(false);
    expect(m.sub).toMatch(/rematch/);
    m = battleResultModel({ reason: 'time', ranking: [row({ playerIndex: 0, isCPU: false }), row({ playerIndex: 1, isCPU: false })] }, names);
    expect(m.title).toBe('P1 & P2 share the win! 🫧');
    expect(m.tie).toBe(true);
    m = battleResultModel({ reason: 'time', ranking: [row({}), row({ characterId: 'lenny' })] }, names);
    expect(m.title).toMatch(/tie/);
    expect(battleResultModel(null).title).toBe('Bubble Battle!');
    for (const r of [m, battleResultModel(null)]) expect(`${r.title} ${r.sub}`).not.toMatch(BAD_WORDS);
    expect(medal(4)).toBe('');
  });

  it('team: two sides with members, totals and the winner', () => {
    const team = {
      totals: { sprinkle: 33, sparkle: 25 }, winner: 'sprinkle', margin: 8, series: { races: 1, wins: { sprinkle: 1, sparkle: 0 }, ties: 0 },
      rows: [
        { characterId: 'rocco', playerIndex: 0, isCPU: false, place: 1, points: 15, team: 'sprinkle' },
        { characterId: 'lenny', playerIndex: null, isCPU: true, place: 2, points: 12, team: 'sparkle' },
      ],
    };
    const m = teamResultModel(team);
    expect(m.won).toBe(true);
    expect(m.tie).toBe(false);
    expect(m.sides.map((s) => [s.id, s.total, s.winner, s.members.length])).toEqual([['sprinkle', 33, true, 1], ['sparkle', 25, false, 1]]);
    expect(m.sides[0].members[0]).toMatchObject({ medal: '🥇', points: 15, playerIndex: 0 });
    expect(teamResultModel({ ...team, winner: null }).tie).toBe(true);
    expect(teamResultModel(null).sides[0].total).toBe(0);
    for (const opts of [BATTLE_OPTIONS, TEAM_OPTIONS]) expect(opts.map((o) => o[0])).toEqual(['again', 'next-track', 'menu']);
  });
});

describe('HUD widget models', () => {
  it('battle HUD: hidden outside a battle, your bubbles + a strip inside one', () => {
    expect(battleHudModel({ id: 0 }, { modeInfo: {} })).toBe(null);
    expect(battleHudModel({ id: 0 }, null)).toBe(null);
    const race = {
      state: 'racing',
      modeInfo: { battle: { clock: '1:40', hurry: false, alive: 2, total: 3, racers: [
        { id: 0, bubbles: 2, max: 3, out: false, isCPU: false },
        { id: 1, bubbles: 0, max: 3, out: true, isCPU: true },
        { id: 2, bubbles: 3, max: 3, out: false, isCPU: true },
      ] } },
    };
    const m = battleHudModel({ id: 0 }, race);
    expect(m).toMatchObject({ clock: '1:40', mine: { bubbles: 2, max: 3, out: false }, alive: 2, total: 3, waiting: false });
    expect(m.strip.map((r) => [r.me, r.out, r.human])).toEqual([[true, false, true], [false, true, false], [false, false, false]]);
    expect(battleHudModel({ id: 9 }, race).mine).toBe(null);
  });

  it('team HUD: the live score with your team', () => {
    expect(teamHudModel({}, { modeInfo: {} })).toBe(null);
    const m = teamHudModel({ team: 'sparkle' }, { modeInfo: { team: { totals: { sprinkle: 30, sparkle: 28 }, leader: 'sprinkle' } } });
    expect(m).toMatchObject({ mine: 'sparkle', home: 30, away: 28, leader: 'sprinkle' });
    expect(teamHudModel({}, { modeInfo: { team: { totals: {} } } })).toMatchObject({ mine: 'sprinkle', home: 0, away: 0, leader: null });
  });

  it('widgets are headless-safe and anchored top-center; the HUD system installs both', () => {
    for (const w of [BATTLE_WIDGET, TEAM_WIDGET]) {
      expect(w.anchor).toBe('top-center');
      const inst = w.create(null, 0);
      expect(() => { inst.update({}, {}); inst.reset(); inst.destroy(); }).not.toThrow();
    }
    const sys = listSystems().find((s) => s.id === 'showcase-hud');
    expect(sys).toBeTruthy();
    const added = [];
    const off = sys.install({}, { hud: { addWidget: (w) => { added.push(w.id); return () => added.splice(added.indexOf(w.id), 1); } } });
    expect(added).toEqual(['battle-hud', 'team-hud']);
    off();
    expect(added).toEqual([]);
    expect(sys.install({}, {})).toBeUndefined();
  });
});

describe('kartTopHeight', () => {
  it('floats things over the real racer (taller racers get more room), never absurdly high', () => {
    const heights = {};
    for (const id of ['rocco', 'muffin', 'twiggy']) {
      const def = CHARACTERS.find((c) => c.id === id);
      if (!def) continue;
      const model = buildKartModel(def);
      heights[id] = kartTopHeight({ model });
      expect(heights[id]).toBeGreaterThanOrEqual(BUBBLE_HEIGHT);
      expect(heights[id]).toBeLessThanOrEqual(3.8);
      model.dispose();
    }
    if (heights.twiggy && heights.muffin) expect(heights.twiggy).toBeGreaterThanOrEqual(heights.muffin);
    expect(kartTopHeight({})).toBe(BUBBLE_HEIGHT);
    expect(kartTopHeight(null, { min: 2 })).toBe(2);
    expect(kartTopHeight({ model: { group: new THREE.Group() } }, { min: 2.5 })).toBe(2.5);
  });

  it('every arena has a battle-worthy grid of item boxes', () => {
    for (const a of ARENAS) expect(a.def.itemBoxRows.length).toBeGreaterThanOrEqual(3);
  });
});
