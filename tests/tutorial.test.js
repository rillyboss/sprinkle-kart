import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  TUTORIAL_STEPS, TUTORIAL_MODE, TUTORIAL_LAPS, TUTORIAL_SPEED, CHEER_TIME, GO_TIME, DRIFT_TIME,
  createTutorial, tutorialObserve, tutorialStep, tutorialCoach, tutorialResult, controlLabel,
  tutorialTrackId, tutorialSetup, tutorialCards, pickTutorialRacer, tutorialResultModel, TUTORIAL_OPTIONS,
} from '../src/modes/tutorial.js';
import { createTutorialSession } from '../src/modes/tutorialSession.js';
import { tutorialHudModel, TUTORIAL_WIDGET } from '../src/ui/widgets/showcaseModes.js';
import showcaseHud from '../src/systems/showcaseHud.js';
import { rulesForMode, modeId } from '../src/modes/rules.js';
import { MODES, buildRaceSummary } from '../src/game/summary.js';
import { parseDebugParams, wantsQuickStart, quickSetup } from '../src/game/setup.js';
import { finalizeSetup } from '../src/modes/flow.js';
import { applyRaceSummary } from '../src/progress/engine.js';
import { emptyProgress, mergeProgress } from '../src/progress/schema.js';
import { applyGoalCounters, earnGoals, getGoal, GOALS, GOAL_COUNTERS } from '../src/progress/goals.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { menuEntries } from '../src/ui/screenFlow.js';
import { Race, aiDriveInput } from '../src/race/Race.js';
import { createRaceStats } from '../src/game/raceStats.js';
import { TRACKS } from '../src/data/tracks.js';
import { CHARACTERS } from '../src/data/characters.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';

const BAD_WORDS = /\b(hit|kill|crash|destroy|die|dead|loser|fail|shoot|attack)\b/i;
const idle = (o = {}) => ({ speed: 0, maxSpeed: 30, steer: 0, drifting: false, miniTurbos: 0, itemBoxes: 0, itemsUsed: 0, hasItem: false, finished: false, ...o });
/** Feed observations for `secs` seconds in 1/30 s steps. */
function feed(state, obs, secs = 0.1) {
  const events = [];
  let s = state;
  for (let t = 0; t < secs - 1e-9; t += 1 / 30) {
    const r = tutorialStep(s, typeof obs === 'function' ? obs(t) : obs, 1 / 30);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}
/** Wait out the cheer so the next trick can be checked. */
const rest = (s) => feed(s, idle(), CHEER_TIME + 0.1).state;

describe('How to Play: the tricks', () => {
  it('six friendly tricks, in a sensible order, with kid-safe words', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual(['go', 'steer', 'drift', 'box', 'item', 'finish']);
    for (const s of TUTORIAL_STEPS) {
      expect(s.emoji).toBeTruthy();
      expect(s.text.length).toBeLessThanOrEqual(32);
      expect(s.text).not.toMatch(BAD_WORDS);
      expect(s.cheer).not.toMatch(BAD_WORDS);
    }
    expect(TUTORIAL_MODE).toBe('tutorial');
    expect(TUTORIAL_LAPS).toBe(2);
    expect(TUTORIAL_SPEED).toBe('cozy');
  });

  it('go: needs a good speed held for a moment (a quick blip does not count)', () => {
    let s = createTutorial();
    s = feed(s, idle({ speed: 20 }), GO_TIME / 2).state;
    s = feed(s, idle({ speed: 2 }), 0.1).state; // slowed down: timer resets
    expect(s.index).toBe(0);
    expect(s.goTime).toBe(0);
    const r = feed(s, idle({ speed: 20 }), GO_TIME + 0.1);
    expect(r.state.learned).toEqual(['go']);
    expect(r.events).toEqual(['step']);
    expect(r.state.cheerText).toBe('Vroom vroom!');
  });

  it('steer: both directions are needed (in any order)', () => {
    let s = rest(feed(createTutorial(), idle({ speed: 20 }), GO_TIME + 0.1).state);
    s = feed(s, idle({ steer: 0.9 }), 0.2).state;
    expect(s.index).toBe(1);
    s = feed(s, idle({ steer: -0.1 }), 0.2).state; // a wobble is not a turn
    expect(s.index).toBe(1);
    s = feed(s, idle({ steer: -0.6 }), 0.1).state;
    expect(s.learned).toEqual(['go', 'steer']);
  });

  it('drift: hold it for a moment, or any drift turbo counts', () => {
    const at = (i) => ({ ...createTutorial(), index: i, learned: TUTORIAL_STEPS.slice(0, i).map((x) => x.id) });
    let s = feed(at(2), idle({ drifting: true }), DRIFT_TIME / 2).state;
    s = feed(s, idle({ drifting: false }), 0.1).state;
    expect(s.index).toBe(2);
    s = feed(s, idle({ drifting: true }), DRIFT_TIME + 0.1).state;
    expect(s.learned).toContain('drift');
    expect(feed(at(2), idle({ miniTurbos: 1 }), 0.05).state.learned).toContain('drift');
  });

  it('box / item / finish follow the family counters', () => {
    const at = (i) => ({ ...createTutorial(), index: i, learned: TUTORIAL_STEPS.slice(0, i).map((x) => x.id) });
    expect(feed(at(3), idle({ itemBoxes: 1 }), 0.05).state.learned).toContain('box');
    expect(feed(at(3), idle({ hasItem: true }), 0.05).state.learned).toContain('box');
    expect(feed(at(4), idle({ itemsUsed: 1 }), 0.05).state.learned).toContain('item');
    const done = feed(at(5), idle({ finished: true }), 0.05);
    expect(done.state.complete).toBe(true);
    expect(done.events).toEqual(['step', 'complete']);
    expect(tutorialResult(done.state)).toEqual({ learned: TUTORIAL_STEPS.map((x) => x.id), total: 6, done: true, complete: true });
  });

  it('tricks wait their turn: counters already reached pass right after the cheer', () => {
    let s = createTutorial();
    const busy = idle({ speed: 25, itemBoxes: 2, itemsUsed: 1 });
    s = feed(s, busy, GO_TIME + 0.1).state;
    expect(s.learned).toEqual(['go']); // one at a time
    s = feed(s, busy, 0.5).state;
    expect(s.learned).toEqual(['go']); // still cheering
    s = feed(s, { ...busy, steer: 1 }, CHEER_TIME).state;
    s = feed(s, { ...busy, steer: -1 }, 0.1).state;
    expect(s.learned).toEqual(['go', 'steer']);
  });

  it('crossing the line early ends the lesson: tricks not done are just not learned', () => {
    let s = feed(createTutorial(), idle({ speed: 25 }), GO_TIME + 0.1).state;
    const r = tutorialStep(s, idle({ finished: true }), 1 / 30);
    expect(r.events).toEqual(['step', 'complete']);
    expect(tutorialResult(r.state)).toMatchObject({ learned: ['go', 'finish'], done: false, complete: true });
    // after the end nothing changes
    expect(tutorialStep(r.state, idle({ itemsUsed: 5 }), 1).state).toBe(r.state);
    expect(tutorialStep(s, null, 1).state).toBe(s);
    // finishing while a cheer is showing still cheers the finish
    s = feed(createTutorial(), idle({ speed: 25 }), GO_TIME + 0.1).state;
    expect(s.cheer).toBeGreaterThan(0);
    expect(tutorialStep(s, idle({ finished: true }), 1 / 30).events).toEqual(['step', 'complete']);
  });

  it('tutorialObserve reads P1 kart + tally (with safe defaults)', () => {
    const kart = { speed: 12, stats: { maxSpeed: 26 }, phys: { steerSmoothed: -0.5 }, drifting: true, item: 'gumdrop', finished: false };
    expect(tutorialObserve(kart, { miniTurbos: 2, itemBoxes: 3, itemsUsed: 1 })).toEqual({
      speed: 12, maxSpeed: 26, steer: -0.5, drifting: true, miniTurbos: 2, itemBoxes: 3, itemsUsed: 1, hasItem: true, finished: false,
    });
    expect(tutorialObserve(null)).toEqual(idle());
  });
});

describe('How to Play: coach bubble + buttons', () => {
  it('button names follow P1\'s controller', () => {
    expect(controlLabel('kb1', 'accel')).toBe('W');
    expect(controlLabel('kb1', 'drift')).toBe('Space');
    expect(controlLabel('kb2', 'item')).toBe('/');
    expect(controlLabel({ id: 'gp0', kind: 'playstation' }, 'drift')).toBe('R1');
    expect(controlLabel({ id: 'gp1' }, 'item')).toBe('LB');
    expect(controlLabel({ id: 'x', labels: { item: 'Zz' } }, 'item')).toBe('Zz');
    expect(controlLabel({ type: 'keyboard' }, 'accel')).toBe('W');
    expect(controlLabel('kb1', null)).toBe('');
    expect(controlLabel(null, 'accel')).toBe('A');
  });

  it('the coach says the trick + button, cheers, then says well done', () => {
    let s = createTutorial();
    let c = tutorialCoach(s, 'kb1');
    expect(c).toMatchObject({ emoji: '🚗', text: 'Hold GAS to zoom!', key: 'W', index: 0, total: 6, cheering: false, done: false });
    s = feed(s, idle({ speed: 25 }), GO_TIME + 0.1).state;
    c = tutorialCoach(s, 'kb1');
    expect(c).toMatchObject({ emoji: '🎉', text: 'Vroom vroom!', key: '', index: 1, cheering: true });
    s = rest(s);
    expect(tutorialCoach(s, 'kb1')).toMatchObject({ text: 'Steer left AND right!', key: 'A/D' });
    expect(tutorialCoach({ ...s, index: 3 }, 'kb1').key).toBe(''); // "drive into a box" needs no button
    const end = { ...s, complete: true, cheer: 0, index: 6 };
    expect(tutorialCoach(end, 'kb1')).toMatchObject({ emoji: '🎓', done: true, index: 6 });
    // the sig changes whenever something visible changes
    expect(tutorialCoach(createTutorial(), 'kb1').sig).not.toBe(tutorialCoach(createTutorial(), 'kb2').sig);
  });

  it('the HUD model only shows for P1 and only in a tutorial', () => {
    const race = { modeInfo: { tutorial: tutorialCoach(createTutorial(), 'kb1') } };
    expect(tutorialHudModel({ playerIndex: 0 }, race)).toBe(race.modeInfo.tutorial);
    expect(tutorialHudModel({ playerIndex: 1 }, race)).toBeNull();
    expect(tutorialHudModel({ playerIndex: 0 }, { modeInfo: {} })).toBeNull();
    expect(tutorialHudModel(null, race)).toBe(race.modeInfo.tutorial);
    expect(TUTORIAL_WIDGET).toMatchObject({ id: 'tutorial-hud', anchor: 'bottom-center' }); // clear of the centre flashes
    // headless (no DOM): a safe no-op widget
    const w = TUTORIAL_WIDGET.create(null);
    expect(() => { w.update({}, race); w.reset(); w.destroy(); }).not.toThrow();
  });

  it('the showcase HUD system installs the coach widget', () => {
    const added = [];
    const off = showcaseHud.install(null, { hud: { addWidget: (w) => { added.push(w.id); return () => {}; } } });
    expect(added).toContain('tutorial-hud');
    off();
  });

  it('cards for the How to Play screen', () => {
    const cards = tutorialCards('kb1');
    expect(cards).toHaveLength(6);
    expect(cards[0]).toEqual({ id: 'go', n: 1, emoji: '🚗', text: 'Hold GAS to zoom!', key: 'W' });
    expect(cards[3].key).toBe('');
    expect(cards[4].key).toBe('E');
  });
});

describe('How to Play: setup, mode and progress', () => {
  it('practice track: the friendliest available one', () => {
    expect(tutorialTrackId(['sundae-slopes', 'gumdrop-meadow'])).toBe('gumdrop-meadow');
    expect(tutorialTrackId(['sundae-slopes', 'cotton-candy-castle'])).toBe('cotton-candy-castle');
    expect(tutorialTrackId(['sundae-slopes'])).toBe('sundae-slopes');
    expect(tutorialTrackId([])).toBeNull();
    expect(TRACKS.some((t) => t.id === 'gumdrop-meadow')).toBe(true);
  });

  it('tutorialSetup: P1 alone, cozy, 2 laps', () => {
    expect(tutorialSetup({ deviceId: 'gp0', characterId: 'rocco' }, ['gumdrop-meadow'])).toEqual({
      players: [{ playerIndex: 0, deviceId: 'gp0', characterId: 'rocco', easyDrive: false }],
      trackId: 'gumdrop-meadow', speedClass: 'cozy', laps: 2, mode: 'tutorial',
    });
    expect(finalizeSetup(tutorialSetup({ deviceId: 'kb1', characterId: 'rocco' }, ['gumdrop-meadow']), {}).mode).toBe('tutorial');
  });

  it('pickTutorialRacer: your racer if unlocked, else the first unlocked one', () => {
    const chars = [{ id: 'a' }, { id: 'b', locked: true }, { id: 'c' }];
    const locked = (c) => !!c.locked;
    expect(pickTutorialRacer(chars, locked, 'c')).toBe('c');
    expect(pickTutorialRacer(chars, locked, 'b')).toBe('a');
    expect(pickTutorialRacer(chars, () => true)).toBe('a');
    expect(pickTutorialRacer(chars, () => { throw new Error('x'); }, 'c')).toBe('c');
    expect(pickTutorialRacer([], locked)).toBeNull();
  });

  it('is a known mode: solo rules with surprise boxes', () => {
    expect(modeId('tutorial')).toBe('tutorial');
    expect(MODES).toContain('tutorial');
    expect(rulesForMode('tutorial')).toMatchObject({ items: true, cpus: false, battle: false, startItem: null });
  });

  it('?mode=tutorial quick-starts P1 on the practice track', () => {
    const p = parseDebugParams('?mode=tutorial&players=3');
    expect(p.mode).toBe('tutorial');
    expect(parseDebugParams('?mode=how-to-play').mode).toBe('tutorial');
    expect(parseDebugParams('?mode=practice').mode).toBe('tutorial');
    expect(wantsQuickStart(p)).toBe(true);
    const s = quickSetup(p, null, CHARACTERS, TRACKS);
    expect(s).toMatchObject({ mode: 'tutorial', trackId: null, laps: null });
    expect(s.players).toHaveLength(1);
    const named = quickSetup(parseDebugParams('?mode=tutorial&quick=sundae-slopes&laps=1'), null, CHARACTERS, TRACKS);
    expect(named).toMatchObject({ trackId: 'sundae-slopes', laps: 1 });
  });

  it('a practice race never counts as a race win / finish (only the fun counters)', () => {
    const p = mergeProgress(emptyProgress());
    applyRaceSummary(p, {
      mode: 'tutorial', trackId: 'gumdrop-meadow', humanCount: 1,
      humans: [{ playerIndex: 0, characterId: 'rocco', place: 1, finished: true, estimated: false, stats: { itemBoxes: 2, itemsUsed: 1, miniTurbos: 1, driftBoosts: [1, 0, 0], boosts: 1, bonked: 0, bonksGiven: 0 } }],
    });
    expect(p.stats.wins).toBe(0);
    expect(p.stats.racesFinished).toBe(0);
    expect(p.tracks['gumdrop-meadow']?.wins ?? 0).toBe(0);
  });

  it('learning every trick earns the Sprinkle Scholar sticker (once per lesson), a partial lesson does not', () => {
    expect(GOAL_COUNTERS).toContain('tutorialsDone');
    expect(getGoal('sprinkle-scholar')).toMatchObject({ emoji: '🎓', name: 'Sprinkle Scholar' });
    expect(GOALS.filter((g) => g.rule.counter === 'tutorialsDone')).toHaveLength(1);
    const humans = [{ playerIndex: 0, characterId: 'rocco', place: 1, finished: true, estimated: false, stats: { bonked: 0 } }];
    let p = mergeProgress(emptyProgress());
    applyGoalCounters(p, { mode: 'tutorial', humans, tutorial: { learned: ['go', 'finish'], total: 6, done: false } });
    expect(p.goals.counters.tutorialsDone).toBe(0);
    expect(p.goals.counters.cleanWins).toBe(0); // a solo practice "win" is not a clean win
    expect(earnGoals(p, '2026-09-25').map((g) => g.id)).not.toContain('sprinkle-scholar');
    applyGoalCounters(p, { mode: 'tutorial', humans, tutorial: { learned: TUTORIAL_STEPS.map((s) => s.id), total: 6, done: true } });
    expect(p.goals.counters.tutorialsDone).toBe(1);
    expect(earnGoals(p, '2026-09-25').map((g) => g.id)).toContain('sprinkle-scholar');
    // a free race never counts as a lesson
    p = mergeProgress(emptyProgress());
    applyGoalCounters(p, { mode: 'free', humans, tutorial: { done: true } });
    expect(p.goals.counters.tutorialsDone).toBe(0);
  });

  it('the How to Play screen is a title menu entry (not part of the race flow)', () => {
    const s = SCREENS.get('how-to-play');
    expect(typeof s?.mount).toBe('function');
    expect(s.flow).toBeUndefined();
    const entries = menuEntries(SCREENS, 'title');
    expect(entries.find((e) => e.id === 'how-to-play')).toMatchObject({ label: 'How to Play', emoji: '🎓' });
    expect(menuEntries(SCREENS, 'mode-select').map((e) => e.id)).not.toContain('how-to-play');
  });
});

describe('How to Play session (headless race)', () => {
  function runLesson({ seed = 3, laps = 1, drive = aiDriveInput } = {}) {
    const { def, path } = trackFixture('gumdrop-meadow');
    const stats = createRaceStats();
    const race = new Race({
      scene: new THREE.Scene(), trackDef: def, path, laps, seed, buildKartModel: stubKartModel(),
      participants: defaultRacerIds(1).map((c) => ({ characterId: c, playerIndex: 0 })),
      rules: rulesForMode('tutorial'),
      onEvent: (e) => stats.onEvent(e),
    });
    const flashes = [];
    const sounds = [];
    const session = { stats, flash: (k, t) => flashes.push(t), sfx: (n) => sounds.push(n) };
    const ctrl = createTutorialSession({ race, session, device: 'kb1' });
    const seen = new Set();
    while (race.state !== 'finished' && race.clock < 300) {
      race.update(1 / 30, [drive(race, race.karts[0], race.lastDt)]);
      ctrl.update(1 / 30);
      seen.add(race.modeInfo.tutorial?.text);
    }
    const hm = [{ playerIndex: 0, deviceId: 'kb1', characterId: race.karts[0].characterId }];
    const summary = buildRaceSummary({ setup: { mode: 'tutorial', speedClass: 'cozy' }, trackDef: def, humans: hm, standings: race.getStandings(), stats, laps, raceTime: race.time });
    ctrl.decorateSummary(summary);
    race.dispose();
    return { race, ctrl, summary, flashes, sounds, seen };
  }

  it('a solo lesson: the coach moves on as P1 drives, cheers, and the summary says what was learned', () => {
    const r = runLesson();
    expect(r.race.karts).toHaveLength(1);
    expect(r.summary.mode).toBe('tutorial');
    expect(r.summary.tutorial.complete).toBe(true);
    expect(r.summary.tutorial.total).toBe(6);
    expect(r.summary.tutorial.learned).toEqual(expect.arrayContaining(['go', 'steer', 'finish']));
    // the coach bubble does the cheering (no big flash banner on top of it) + a happy sound per trick
    expect(r.flashes).toEqual([]);
    expect(r.sounds.length).toBe(r.summary.tutorial.learned.length);
    expect(r.sounds.every((n) => n === 'goal-sticker')).toBe(true);
    expect(r.seen).toContain('Vroom vroom!');
    expect(r.seen).toContain('Hold GAS to zoom!');
    expect(r.ctrl.kind).toBe('tutorial');
    r.ctrl.dispose();
    expect(r.race.modeInfo.tutorial).toBeUndefined();
  });

  it('standing still teaches nothing (and the coach keeps asking for GAS)', () => {
    const { def, path } = trackFixture('gumdrop-meadow');
    const race = new Race({
      scene: new THREE.Scene(), trackDef: def, path, laps: 1, seed: 1, buildKartModel: stubKartModel(),
      participants: [{ characterId: defaultRacerIds(1)[0], playerIndex: 0 }], rules: rulesForMode('tutorial'),
    });
    const ctrl = createTutorialSession({ race, session: null, device: 'kb2' });
    for (let i = 0; i < 300; i++) { race.update(1 / 30, [{}]); ctrl.update(1 / 30); }
    expect(race.modeInfo.tutorial).toMatchObject({ text: 'Hold GAS to zoom!', key: '↑', index: 0 });
    expect(ctrl.decorateSummary({}).tutorial).toMatchObject({ learned: [], done: false, complete: false });
    expect(ctrl.decorateSummary(null)).toBeNull();
    race.dispose();
  });

  it('no race / no kart is harmless', () => {
    const race = { karts: [], state: 'racing', modeInfo: {} };
    const ctrl = createTutorialSession({ race });
    expect(() => ctrl.update(0.1)).not.toThrow();
    expect(race.modeInfo.tutorial.index).toBe(0);
  });
});

describe('How to Play results', () => {
  it('a full lesson: star title, every trick ticked', () => {
    const m = tutorialResultModel({ learned: TUTORIAL_STEPS.map((s) => s.id) });
    expect(m).toMatchObject({ star: true, learned: 6, total: 6, title: "You're a Sprinkle Star! 🎓" });
    expect(m.rows.every((r) => r.learned)).toBe(true);
  });

  it('a partial lesson: encouraging, shows what is left', () => {
    const m = tutorialResultModel({ learned: ['go', 'steer', 'finish', 'bogus'] });
    expect(m).toMatchObject({ star: false, learned: 3, total: 6, title: 'Practice done! 🌟' });
    expect(m.sub).toBe('You learned 3 of 6 tricks. Practice again to learn them all!');
    expect(m.rows.map((r) => r.learned)).toEqual([true, true, false, false, false, true]);
    expect(tutorialResultModel(null)).toMatchObject({ learned: 0, star: false });
    for (const t of [m.title, m.sub, tutorialResultModel(null).sub]) expect(t).not.toMatch(BAD_WORDS);
  });

  it('options: practice again or go race', () => {
    expect(TUTORIAL_OPTIONS.map((o) => o[0])).toEqual(['again', 'menu']);
    expect(SCREENS.get('tutorial-results')?.mount).toBeTypeOf('function');
    expect(SCREENS.get('tutorial-results').menuEntry).toBeUndefined();
  });

  it('the controller opens the practice results screen with P1\'s racer', () => {
    const race = { karts: [{ isCPU: false, playerIndex: 0, characterId: 'peachy' }], state: 'finished', modeInfo: {} };
    const ctrl = createTutorialSession({ race });
    const calls = [];
    const menus = { open: (id, p) => { calls.push([id, p]); return Promise.resolve('menu'); } };
    const summary = ctrl.decorateSummary({ mode: 'tutorial' });
    expect(ctrl.showResults({ menus, summary, unlocks: [] })).toBeInstanceOf(Promise);
    expect(calls[0][0]).toBe('tutorial-results');
    expect(calls[0][1]).toMatchObject({ characterId: 'peachy', unlocks: [], summary: { tutorial: { total: 6 } } });
    expect(ctrl.showResults({})).toBeNull();
  });
});