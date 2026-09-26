import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  dailyChallenge, dailyRules, dailyProgress, dailyResult, summaryTally, recordDaily, mergeDailyStore, emptyDailyStore,
  currentStreak, doneToday, dayDiff, seededRng, dailyScreenReduce, DAILY_GOALS, DAILY_TWISTS,
} from '../src/modes/daily.js';
import { createDailySession, dailyStore, liveTally, DAILY_KEY } from '../src/modes/dailySession.js';
import { memoryBackend } from '../src/modes/storage.js';
import { dailyHudModel, DAILY_WIDGET } from '../src/ui/widgets/showcaseModes.js';
import { timerModel } from '../src/ui/widgets/timer.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { menuEntries, flowOrder } from '../src/ui/screenFlow.js';
import { dailyRaceSetup, todaysChallenge } from '../src/ui/screens/daily.js';
import { applyModeChoice } from '../src/modes/flow.js';
import { parseDebugParams, wantsQuickStart } from '../src/game/setup.js';
import { modeId } from '../src/modes/rules.js';
import { MODES, buildRaceSummary } from '../src/game/summary.js';
import { Race, aiDriveInput } from '../src/race/Race.js';
import { createRaceStats } from '../src/game/raceStats.js';
import { TRACKS } from '../src/data/tracks.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';

const BAD_WORDS = /\b(hit|kill|crash|destroy|die|dead|loser|fail)\b/i;
const IDS = TRACKS.map((t) => t.id);

describe('dailyChallenge', () => {
  it('is the same all day, different across days', () => {
    const a = dailyChallenge('2026-09-25', IDS);
    expect(dailyChallenge('2026-09-25', IDS)).toEqual(a);
    const days = Array.from({ length: 30 }, (_, i) => dailyChallenge(`2026-10-${String(i + 1).padStart(2, '0')}`, IDS));
    expect(new Set(days.map((c) => `${c.trackId}|${c.goal.kind}|${c.twist.id}`)).size).toBeGreaterThan(15);
  });

  it('only picks tracks from the given list, with friendly goals and twists', () => {
    const allowed = ['gumdrop-meadow', 'sundae-slopes'];
    const kinds = new Set();
    const twists = new Set();
    for (let d = 1; d <= 120; d++) {
      const c = dailyChallenge(`2026-${String(1 + (d % 12)).padStart(2, '0')}-${String(1 + (d % 28)).padStart(2, '0')}x${d}`, allowed);
      expect(allowed).toContain(c.trackId);
      expect(['cozy', 'zippy', 'zoomy']).toContain(c.speedClass);
      if (c.goal.kind === 'win') expect(c.speedClass).not.toBe('zoomy');
      const def = DAILY_GOALS.find((g) => g.kind === c.goal.kind);
      if (def.min) { expect(c.goal.target).toBeGreaterThanOrEqual(def.min); expect(c.goal.target).toBeLessThanOrEqual(def.max); } else expect(c.goal.target).toBe(1);
      expect(`${c.goal.text} ${c.twist.text}`).not.toMatch(BAD_WORDS);
      kinds.add(c.goal.kind);
      twists.add(c.twist.id);
    }
    expect(kinds.size).toBe(DAILY_GOALS.length);
    expect(twists.size).toBe(DAILY_TWISTS.length);
  });

  it('no tracks: a challenge without a track (main.js falls back to the first one)', () => {
    expect(dailyChallenge('2026-01-01', []).trackId).toBe(null);
    expect(dailyChallenge('2026-01-01').trackId).toBe(null);
  });

  it('seededRng is deterministic and in [0, 1)', () => {
    const a = seededRng('x');
    const b = seededRng('x');
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v >= 0 && v < 1).toBe(true);
    }
  });
});

describe('dailyRules (the twist)', () => {
  it('maps every twist to race rules', () => {
    expect(dailyRules({ twist: { id: 'none' } })).toMatchObject({ items: true, cpus: true, startItem: null });
    expect(dailyRules({ twist: { id: 'star-start' } }).startItem).toBe('rainbow-star');
    expect(dailyRules({ twist: { id: 'triple-boost' } })).toMatchObject({ startItem: 'triple-sprinkle', startItemCharges: 3 });
    expect(dailyRules({ twist: { id: 'bubble-start' } }).startItem).toBe('bubble-shield');
    expect(dailyRules({ twist: { id: 'rocket-start' } }).startItem).toBe('cupcake-rocket');
    expect(dailyRules(null).startItem).toBe(null);
  });
});

describe('dailyProgress / dailyResult', () => {
  const ch = (kind, target = 1) => ({ id: '2026-09-25', goal: { kind, target, text: 'x', emoji: '⭐' } });

  it('counting goals', () => {
    expect(dailyProgress(ch('drifts', 4), { miniTurbos: 2 })).toMatchObject({ current: 2, target: 4, done: false, text: '2/4' });
    expect(dailyProgress(ch('drifts', 4), { miniTurbos: 9 })).toMatchObject({ current: 4, done: true, text: '4/4' });
    expect(dailyProgress(ch('items', 3), { itemsUsed: 3 }).done).toBe(true);
    expect(dailyProgress(ch('boxes', 5), { itemBoxes: 4 }).done).toBe(false);
    expect(dailyProgress(ch('bonks', 2), { bonksGiven: 2 }).done).toBe(true);
    expect(dailyProgress(ch('boosts', 6), { boosts: 7 }).done).toBe(true);
  });

  it('place and clean goals need a real finish', () => {
    expect(dailyProgress(ch('podium'), { finished: true, bestPlace: 3 })).toMatchObject({ done: true, text: '✔' });
    expect(dailyProgress(ch('podium'), { finished: true, bestPlace: 4 }).done).toBe(false);
    expect(dailyProgress(ch('podium'), { finished: false, bestPlace: 1 }).done).toBe(false);
    expect(dailyProgress(ch('win'), { finished: true, bestPlace: 1 }).done).toBe(true);
    expect(dailyProgress(ch('win'), { finished: true, bestPlace: 2 })).toMatchObject({ done: false, text: '' });
    expect(dailyProgress(ch('clean'), { clean: true }).done).toBe(true);
    expect(dailyProgress({ goal: { kind: 'mystery' } }, {}).done).toBe(false);
    expect(dailyProgress(null, null).done).toBe(false);
  });

  it('summaryTally + dailyResult from a RaceSummary (counting goals still need a finish)', () => {
    const summary = {
      humans: [
        { place: 2, finished: true, estimated: false, stats: { miniTurbos: 3, itemsUsed: 1, itemBoxes: 2, bonksGiven: 1, boosts: 4, bonked: 0 } },
        { place: 6, finished: true, estimated: true, stats: { miniTurbos: 2, itemsUsed: 2, itemBoxes: 1, bonksGiven: 0, boosts: 1, bonked: 3 } },
      ],
    };
    const t = summaryTally(summary);
    expect(t).toMatchObject({ miniTurbos: 5, itemsUsed: 3, itemBoxes: 3, bonksGiven: 1, boosts: 5, bonked: 3, finished: true, bestPlace: 2, clean: true });
    expect(dailyResult(ch('drifts', 5), summary).done).toBe(true);
    expect(dailyResult(ch('win'), summary).done).toBe(false);
    const dnf = { humans: [{ place: 5, finished: false, stats: { miniTurbos: 9 } }] };
    expect(dailyResult(ch('drifts', 3), dnf).done).toBe(false);
    expect(summaryTally(null)).toMatchObject({ finished: false, bestPlace: null, clean: false });
  });
});

describe('daily store: once a day, streaks', () => {
  it('first completion of a day counts; the streak grows on consecutive days', () => {
    let s = emptyDailyStore();
    let r = recordDaily(s, '2026-09-24', true);
    expect(r).toMatchObject({ counted: true, store: { lastDone: '2026-09-24', streak: 1, best: 1 } });
    s = r.store;
    expect(recordDaily(s, '2026-09-24', true).counted).toBe(false);
    expect(recordDaily(s, '2026-09-25', false).counted).toBe(false);
    r = recordDaily(s, '2026-09-25', true);
    expect(r.store).toMatchObject({ streak: 2, best: 2 });
    s = r.store;
    r = recordDaily(s, '2026-09-28', true); // a gap: starts again
    expect(r.store).toMatchObject({ streak: 1, best: 2 });
    expect(r.store.days).toEqual(['2026-09-24', '2026-09-25', '2026-09-28']);
  });

  it('currentStreak only counts if the last completion was today or yesterday', () => {
    const s = { lastDone: '2026-09-24', streak: 3, best: 3, days: ['2026-09-24'] };
    expect(currentStreak(s, '2026-09-24')).toBe(3);
    expect(currentStreak(s, '2026-09-25')).toBe(3);
    expect(currentStreak(s, '2026-09-26')).toBe(0);
    expect(currentStreak(null, '2026-09-26')).toBe(0);
    expect(doneToday(s, '2026-09-24')).toBe(true);
    expect(doneToday(s, '2026-09-25')).toBe(false);
  });

  it('dayDiff across months / years, bad input', () => {
    expect(dayDiff('2026-02-28', '2026-03-01')).toBe(1);
    expect(dayDiff('2025-12-31', '2026-01-01')).toBe(1);
    expect(dayDiff('2026-01-01', '2026-01-01')).toBe(0);
    expect(Number.isNaN(dayDiff('bad', '2026-01-01'))).toBe(true);
  });

  it('mergeDailyStore sanitises junk and keeps the last 60 days', () => {
    expect(mergeDailyStore(null)).toEqual(emptyDailyStore());
    const m = mergeDailyStore({ lastDone: 'nope', streak: -2, best: 'x', days: ['2026-01-01', 5, null] });
    expect(m).toEqual({ lastDone: null, streak: 0, best: 0, days: ['2026-01-01'] });
    const many = Array.from({ length: 80 }, (_, i) => `d${i}`);
    expect(mergeDailyStore({ days: many }).days).toHaveLength(60);
    expect(mergeDailyStore({ streak: 4, best: 2 }).best).toBe(4);
  });

  it('dailyStore saves to its own storage key', () => {
    const backend = memoryBackend();
    const store = dailyStore(backend);
    expect(store.load()).toEqual(emptyDailyStore());
    store.save({ lastDone: '2026-09-25', streak: 1, best: 1, days: ['2026-09-25'] });
    expect(JSON.parse(backend.getItem(DAILY_KEY)).days).toEqual(['2026-09-25']);
    expect(dailyStore(backend).load().streak).toBe(1);
    store.clear();
    expect(dailyStore(backend).load()).toEqual(emptyDailyStore());
  });
});

describe('Daily Sprinkle session (headless race)', () => {
  function runDaily(challenge, { humans = 1, seed = 4, backend = memoryBackend(), today = challenge.id } = {}) {
    const { def, path } = trackFixture('gumdrop-meadow');
    const stats = createRaceStats();
    let ctrl = null;
    const race = new Race({
      scene: new THREE.Scene(), trackDef: def, path, laps: 1, seed, buildKartModel: stubKartModel(),
      participants: defaultRacerIds(8).map((c, i) => ({ characterId: c, playerIndex: i < humans ? i : null })),
      rules: dailyRules(challenge),
      onEvent: (e) => stats.onEvent(e),
    });
    const flashes = [];
    const shown = [];
    const session = { stats, flash: (k, t) => flashes.push(t), sfx() {} };
    ctrl = createDailySession({ race, session, challenge, store: dailyStore(backend), today, toasts: { show: (g) => shown.push(...g) } });
    while (race.state !== 'finished' && race.clock < 300) {
      const inputs = [];
      for (const k of race.karts) if (!k.isCPU) inputs[k.playerIndex] = aiDriveInput(race, k, race.lastDt);
      race.update(1 / 30, inputs);
      ctrl.update(1 / 30);
    }
    const hm = race.karts.filter((k) => !k.isCPU).map((k) => ({ playerIndex: k.playerIndex, deviceId: `d${k.playerIndex}`, characterId: k.characterId }));
    const summary = buildRaceSummary({ setup: { mode: 'daily', speedClass: 'zippy' }, trackDef: def, humans: hm, standings: race.getStandings(), stats, laps: 1, raceTime: race.time });
    ctrl.decorateSummary(summary);
    race.dispose();
    return { race, ctrl, summary, flashes, shown, backend };
  }

  it('an easy counting goal is cheered mid-race, recorded once and grows the streak', () => {
    const challenge = { id: '2026-09-25', trackId: 'gumdrop-meadow', speedClass: 'zippy', goal: { kind: 'boosts', target: 1, text: 'Zoom through 1 boost', emoji: '🚀' }, twist: { id: 'triple-boost', text: 't', emoji: '🍬' } };
    const r = runDaily(challenge);
    expect(r.summary.mode).toBe('daily');
    expect(r.summary.daily).toMatchObject({ id: '2026-09-25', done: true, counted: true, streak: 1 });
    expect(r.flashes).toContain('Daily Sprinkle done! ☀️');
    expect(r.shown[0].name).toBe('Daily Sprinkle complete!');
    expect(r.race.modeInfo.daily).toMatchObject({ done: true, emoji: '🚀' });
    // the same day again: done but not counted twice
    const again = runDaily(challenge, { backend: r.backend });
    expect(again.summary.daily).toMatchObject({ done: true, counted: false, streak: 1 });
    expect(again.shown).toEqual([]);
    // the next day: streak 2
    const next = runDaily({ ...challenge, id: '2026-09-26' }, { backend: r.backend });
    expect(next.summary.daily.streak).toBe(2);
  });

  it('an impossible goal is not done, and the twist gives the humans their start item', () => {
    const challenge = { id: '2026-09-25', trackId: 'gumdrop-meadow', speedClass: 'zippy', goal: { kind: 'bonks', target: 99, text: 'x', emoji: '🎯' }, twist: { id: 'star-start', text: 't', emoji: '🌟' } };
    const { def, path } = trackFixture('gumdrop-meadow');
    const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants: defaultRacerIds(3).map((c, i) => ({ characterId: c, playerIndex: i === 0 ? 0 : null })), rules: dailyRules(challenge), seed: 1 });
    expect(race.karts[0].item).toBe('rainbow-star');
    expect(race.karts[1].item).toBe(null);
    race.dispose();
    const r = runDaily(challenge);
    expect(r.summary.daily).toMatchObject({ done: false, counted: false, streak: 0 });
    expect(r.race.modeInfo.daily.text).toMatch(/\/99$/);
  });

  it('liveTally sums the humans and knows the best real place', () => {
    const stats = createRaceStats();
    const human = { isCPU: false, playerIndex: 0, finished: true, finishEstimated: false, finishPlace: 2 };
    stats.onEvent({ type: 'boost', kart: human });
    stats.onEvent({ type: 'drift-boost', kart: human, level: 2 });
    const t = liveTally({ karts: [human, { isCPU: true }] }, { stats });
    expect(t).toMatchObject({ boosts: 1, miniTurbos: 1, finished: true, bestPlace: 2, clean: true });
    expect(liveTally(null, null)).toMatchObject({ finished: false });
  });
});

describe('Daily Sprinkle menus + HUD', () => {
  it('a mode-select button and a flow screen at 40 (daily only)', () => {
    expect(menuEntries(SCREENS, 'mode-select').map((e) => e.id)).toEqual(expect.arrayContaining(['daily', 'records']));
    expect(menuEntries(SCREENS, 'title').map((e) => e.id)).not.toContain('daily');
    const s = SCREENS.get('daily');
    expect(s.flow.order).toBe(40);
    expect(s.flow.when({ draft: { mode: 'daily' } })).toBe(true);
    expect(s.flow.when({ draft: { mode: 'free' } })).toBe(false);
    const d = applyModeChoice({ joinState: { players: [] } }, 'daily');
    expect(flowOrder(SCREENS, { draft: d })).toEqual(['title', 'join', 'mode-select', 'character-select', 'daily']);
  });

  it('the screen reducer: A goes, B backs out, other pads are ignored', () => {
    const st = { controllerId: 'kb1' };
    expect(dailyScreenReduce(st, { deviceId: 'kb1', action: 'confirm' })).toMatchObject({ go: 'go', fx: ['confirm'] });
    expect(dailyScreenReduce(st, { deviceId: 'mouse', action: 'select' }).go).toBe('go');
    expect(dailyScreenReduce(st, { deviceId: 'kb1', action: 'back' })).toMatchObject({ go: 'back', fx: ['back'] });
    expect(dailyScreenReduce(st, { deviceId: 'gp2', action: 'confirm' }).go).toBe(null);
    expect(dailyScreenReduce({}, { deviceId: 'x', action: 'left' }).go).toBe(null);
  });

  it('todaysChallenge only uses unlocked tracks; dailyRaceSetup carries the challenge', () => {
    const ctx = { tracks: TRACKS, isTrackLocked: (t) => t.id !== 'sundae-slopes' };
    const c = todaysChallenge(ctx, '2026-09-25');
    expect(c.trackId).toBe('sundae-slopes');
    const draft = { joinState: { players: [{ playerIndex: 0, deviceId: 'kb1', easyDrive: false }] }, charPicks: [{ playerIndex: 0, characterId: 'muffin' }] };
    expect(dailyRaceSetup(draft, c)).toMatchObject({ mode: 'daily', trackId: 'sundae-slopes', speedClass: c.speedClass, daily: c, players: [{ characterId: 'muffin' }] });
    const kid = { ...draft, joinState: { players: [{ playerIndex: 0, deviceId: 'kb1', easyDrive: true }] } };
    expect(dailyRaceSetup(kid, { ...c, speedClass: 'zoomy' }).speedClass).toBe('zippy');
    expect(dailyRaceSetup(draft, { ...c, speedClass: 'zoomy' }).speedClass).toBe('zoomy');
  });

  it('?mode=daily quick-starts; daily is a known mode', () => {
    expect(wantsQuickStart(parseDebugParams('?mode=daily'))).toBe(true);
    expect(parseDebugParams('?mode=daily-sprinkle').mode).toBe('daily');
    expect(modeId('daily')).toBe('daily');
    expect(MODES).toContain('daily');
  });

  it('HUD: hidden outside a daily race, goal + count inside, a green tick when done', () => {
    expect(dailyHudModel({ modeInfo: {} })).toBe(null);
    expect(dailyHudModel({ modeInfo: { daily: { emoji: '🌀', goal: 'Do 4 drift turbos', current: 1, target: 4, done: false } } })).toMatchObject({ text: '☀️ 🌀 Do 4 drift turbos', count: '1/4', done: false });
    expect(dailyHudModel({ modeInfo: { daily: { emoji: '🥉', goal: 'Top 3', current: 1, target: 1, done: true } } })).toMatchObject({ text: '🥉 Daily done! ☀️', count: '', done: true });
    const inst = DAILY_WIDGET.create(null);
    expect(() => inst.update({}, {})).not.toThrow();
  });

  it('a twist start item is not shown as sprinkle boosts on the race timer', () => {
    const race = (startItem) => ({ state: 'racing', time: 3, modeInfo: {}, rules: { startItem } });
    expect(timerModel({ item: 'rainbow-star', itemCharges: 1, lapTimes: [] }, race('rainbow-star')).boosts).toBe(null);
    expect(timerModel({ item: 'triple-sprinkle', itemCharges: 2, lapTimes: [] }, race('triple-sprinkle')).boosts).toBe(2);
  });
});
