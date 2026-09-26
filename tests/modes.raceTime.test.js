// Race-time tracking: race.time is SIMULATION time (the sum of the clamped dt the game
// loop hands to Race.update), not wall time. It freezes while paused (main.js simply
// stops calling race.update), skips the countdown, and a dt spike or a very slow frame
// (< 10 fps in 4-player split-screen) is clamped to TUNING.maxFrameDt, so the race clock
// then runs slower than the wall clock — on purpose: every kart gets the same clamped
// step, so a hiccup never teleports anyone and lap times stay fair. The in-race timer
// widget (src/ui/widgets/timer.js) shows exactly that clock.
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Race } from '../src/race/Race.js';
import { TUNING } from '../src/race/tuning.js';
import { TIMER_WIDGET, timerModel, SPLITS_SHOWN } from '../src/ui/widgets/timer.js';
import { formatTime } from '../src/modes/timing.js';
import timingHud from '../src/systems/timingHud.js';
import { createEventBus } from '../src/game/events.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';
import { runHeadlessSession, createFakeHud } from './helpers/headlessSession.js';
import { createFakeDocument } from './helpers/fakeDom.js';

const COUNTDOWN = 3;

function makeRace({ humans = 1, rules, laps = 3 } = {}) {
  const { def, path } = trackFixture('gumdrop-meadow');
  const ids = defaultRacerIds(8);
  const participants = ids.map((characterId, i) => ({ characterId, playerIndex: i < humans ? i : null, easyDrive: false }));
  return new Race({ scene: new THREE.Scene(), trackDef: def, path, participants, speedClass: 'zippy', buildKartModel: stubKartModel(), laps, seed: 3, rules });
}

/** Step the race by `seconds` of frames of `dt`. */
function run(race, seconds, dt = 1 / 60, inputs = [{ accel: 1, steer: 0 }]) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) race.update(dt, inputs);
}

describe('race time is simulation time', () => {
  it('the countdown advances the clock but not the race time', () => {
    const race = makeRace();
    run(race, COUNTDOWN - 0.25);
    expect(race.state).toBe('countdown');
    expect(race.time).toBe(0);
    expect(race.clock).toBeCloseTo(COUNTDOWN - 0.25, 5);
    run(race, 0.5);
    expect(race.state).toBe('racing');
    expect(race.time).toBeGreaterThan(0);
    expect(race.time).toBeLessThanOrEqual(0.25 + 1e-6);
  });

  it('race time is the sum of the dt it was stepped with', () => {
    const race = makeRace();
    run(race, COUNTDOWN + 1 / 60);
    const t0 = race.time;
    const steps = [1 / 60, 1 / 30, 0.05, 1 / 144, 0.02];
    for (const dt of steps) race.update(dt, [{ accel: 1 }]);
    expect(race.time - t0).toBeCloseTo(steps.reduce((a, b) => a + b, 0), 9);
  });

  it('a dt spike (tab switch, GC) is clamped to TUNING.maxFrameDt', () => {
    const race = makeRace();
    run(race, COUNTDOWN + 0.1);
    for (const spike of [0.5, 3, 60]) {
      const t0 = race.time;
      const c0 = race.clock;
      race.update(spike, [{ accel: 1 }]);
      expect(race.time - t0).toBeCloseTo(TUNING.maxFrameDt, 9);
      expect(race.clock - c0).toBeCloseTo(TUNING.maxFrameDt, 9);
    }
    expect(TUNING.maxFrameDt).toBe(0.1);
  });

  it('a slow 8 fps frame rate runs the race clock slower than the wall clock (intended)', () => {
    const race = makeRace();
    run(race, COUNTDOWN + 0.1);
    const t0 = race.time;
    const wall = 5; // seconds of wall time at 8 fps = 40 frames of 0.125 s
    for (let i = 0; i < wall * 8; i++) race.update(1 / 8, [{ accel: 1 }]);
    expect(race.time - t0).toBeCloseTo(wall * 8 * TUNING.maxFrameDt, 6); // 4 s of race for 5 s of wall
    expect(race.time - t0).toBeLessThan(wall);
  });

  it('zero, negative and non-finite dt never move the clock (a paused loop is a frozen race)', () => {
    const race = makeRace();
    run(race, COUNTDOWN + 1);
    const snap = { time: race.time, clock: race.clock, s: race.karts.map((k) => k.s) };
    for (const dt of [0, -0.016, NaN, undefined, null, -Infinity]) race.update(dt, [{ accel: 1 }]);
    expect(race.time).toBe(snap.time);
    expect(race.clock).toBe(snap.clock);
    expect(race.karts.map((k) => k.s)).toEqual(snap.s);
  });

  it('lap times and finish times add up to the race time', () => {
    const { race, summary } = runHeadlessSession('gumdrop-meadow', { humans: 1, laps: 2 });
    const me = race.getPlayerKart(0);
    expect(me.finished).toBe(true);
    expect(me.lapTimes).toHaveLength(2);
    const sum = me.lapTimes.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(me.finishTime, 1);
    expect(me.finishTime).toBeLessThanOrEqual(race.time + 1e-6);
    expect(summary.raceTime).toBeCloseTo(race.time, 6);
  });
});

describe('pause freezes race time, callouts and the timer (headless session)', () => {
  it('race-frame keeps firing while paused but nothing time-based moves', () => {
    const bus = createEventBus({ onError: (e) => { throw e; } });
    const race = makeRace();
    const session = { race, paused: false, humans: [{ playerIndex: 0 }], isHuman: (k) => k && !k.isCPU };
    run(race, COUNTDOWN + 2);
    let frames = 0;
    bus.on('race-frame', () => { frames++; });
    const tick = (dt) => {
      // the same gate as main.js tick(): the race only steps while not paused
      if (!session.paused) race.update(dt, [{ accel: 1 }]);
      bus.emit('race-frame', dt, session);
    };
    const before = race.time;
    session.paused = true;
    bus.emit('race-pause', { label: 'P1' }, session);
    for (let i = 0; i < 90; i++) tick(1 / 60); // 1.5 s of wall time
    expect(frames).toBe(90);
    expect(race.time).toBe(before);
    session.paused = false;
    bus.emit('race-resume', { choice: 'resume' }, session);
    for (let i = 0; i < 30; i++) tick(1 / 60);
    expect(race.time).toBeCloseTo(before + 0.5, 6);
  });
});

describe('race timer widget (DOM)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const mount = () => {
    const doc = createFakeDocument();
    vi.stubGlobal('document', doc);
    const node = doc.createElement('div');
    const w = TIMER_WIDGET.create(node, 0, node);
    const q = (sel) => node.querySelector(sel);
    return { doc, node, w, q };
  };

  it('is a top-center widget and a no-op without a DOM or node', () => {
    expect(TIMER_WIDGET).toMatchObject({ id: 'race-timer', anchor: 'top-center' });
    const w = TIMER_WIDGET.create(null);
    expect(() => { w.update({}, {}); w.reset(); w.destroy(); }).not.toThrow();
  });

  it('builds the clock, lap line, splits and extras', () => {
    const { q } = mount();
    expect(q('.sk-timer')).toBeTruthy();
    expect(q('.sk-timer-t').textContent).toBe('0:00.00');
    expect(q('.sk-timer-lapn').textContent).toBe('LAP 1');
    expect(q('.sk-timer-splits').children).toHaveLength(0);
    expect(q('.sk-timer-extras')).toBeTruthy();
  });

  it('shows the real race clock of a real race, waits during the countdown and freezes while paused', () => {
    const { q, node, w } = mount();
    const race = makeRace();
    const me = race.getPlayerKart(0);
    run(race, 1);
    w.update(me, race);
    expect(q('.sk-timer').classList.contains('sk-timer-wait')).toBe(true);
    expect(q('.sk-timer-t').textContent).toBe('0:00.00');
    run(race, COUNTDOWN + 2.5 - 1);
    w.update(me, race);
    expect(q('.sk-timer').classList.contains('sk-timer-wait')).toBe(false);
    expect(q('.sk-timer-t').textContent).toBe(formatTime(race.time));
    expect(race.time).toBeGreaterThan(2);
    // paused: the loop keeps rendering the HUD but never steps the race
    const shown = q('.sk-timer-t').textContent;
    for (let i = 0; i < 60; i++) w.update(me, race);
    expect(q('.sk-timer-t').textContent).toBe(shown);
    run(race, 1);
    w.update(me, race);
    expect(q('.sk-timer-t').textContent).not.toBe(shown);
    expect(node.children).toHaveLength(1);
  });

  it('only writes text that changed', () => {
    const { doc, w } = mount();
    const kart = { lap: 1, lapTimes: [], phys: { lastLapStart: 0 } };
    const race = { state: 'racing', time: 12.34 };
    w.update(kart, race);
    const writes = doc.writes;
    for (let i = 0; i < 20; i++) w.update(kart, race);
    expect(doc.writes).toBe(writes);
    race.time = 12.5;
    w.update(kart, race);
    expect(doc.writes).toBeGreaterThan(writes);
  });

  it('lap splits: the latest few, fastest one starred, the newest one marked', () => {
    const { q, w } = mount();
    const kart = { lap: 2, lapTimes: [31.2], phys: { lastLapStart: 31.2 } };
    const race = { state: 'racing', time: 40 };
    w.update(kart, race);
    let chips = q('.sk-timer-splits').children;
    expect(chips).toHaveLength(1);
    expect(chips[0].classList.contains('sk-split-best')).toBe(false); // one lap is not "best" yet
    expect(chips[0].textContent).toContain('L1');
    kart.lapTimes = [31.2, 29.9, 30.5, 33.0];
    kart.lap = 5;
    w.update(kart, race);
    chips = q('.sk-timer-splits').children;
    expect(chips).toHaveLength(SPLITS_SHOWN);
    expect(chips.map((c) => c.textContent.slice(0, 2))).toEqual(['L2', 'L3', 'L4']);
    expect(chips.filter((c) => c.classList.contains('sk-split-best')).map((c) => c.textContent)).toEqual([`L2${formatTime(29.9)}⭐`]);
    expect(chips[chips.length - 1].classList.contains('sk-split-new')).toBe(true);
    expect(q('.sk-timer-lapn').textContent).toBe('LAP 5');
  });

  it('finish: FINISH label, the finish time and the done style', () => {
    const { q, w } = mount();
    const kart = { lap: 3, finished: true, finishTime: 95.43, lapTimes: [32, 31.7, 31.73] };
    w.update(kart, { state: 'racing', time: 120 });
    expect(q('.sk-timer-t').textContent).toBe('1:35.43');
    expect(q('.sk-timer-lapn').textContent).toBe('FINISH');
    expect(q('.sk-timer').classList.contains('sk-timer-done')).toBe(true);
  });

  it('ghost gap and sprinkle boosts (Time Trial) show only when there is something to show', () => {
    const { q, w } = mount();
    const kart = { lap: 1, lapTimes: [], phys: { lastLapStart: 0 }, item: 'triple-sprinkle', itemCharges: 2 };
    const race = { state: 'racing', time: 5 };
    w.update(kart, race);
    expect(q('.sk-timer-extras').hidden).toBe(true);
    race.modeInfo = { ghostGap: -0.42 };
    race.rules = { startItem: 'triple-sprinkle' };
    w.update(kart, race);
    expect(q('.sk-timer-extras').hidden).toBe(false);
    expect(q('.sk-timer-ghost').textContent).toMatch(/^👻 /);
    expect(q('.sk-timer-ghost').classList.contains('sk-ahead')).toBe(true);
    expect(q('.sk-timer-boosts').textContent).toBe('🍬 × 2');
    kart.item = null;
    race.modeInfo = { ghostGap: 1.2 };
    w.update(kart, race);
    expect(q('.sk-timer-ghost').classList.contains('sk-ahead')).toBe(false);
    expect(q('.sk-timer-boosts').classList.contains('sk-empty')).toBe(true);
    expect(timerModel(kart, race).boosts).toBe(0);
  });

  it('reset clears the splits and re-renders; destroy removes the widget', () => {
    const { q, w, node } = mount();
    const kart = { lap: 3, lapTimes: [30, 31], phys: { lastLapStart: 61 } };
    w.update(kart, { state: 'racing', time: 70 });
    expect(q('.sk-timer-splits').children).toHaveLength(2);
    w.reset();
    expect(q('.sk-timer-splits').children).toHaveLength(0);
    w.update(kart, { state: 'racing', time: 70 });
    expect(q('.sk-timer-splits').children).toHaveLength(2);
    w.destroy();
    expect(node.children).toHaveLength(0);
  });

  it('the timing-hud system adds the widget to every HUD and removes it again', () => {
    const hud = createFakeHud();
    const bus = createEventBus();
    const off = timingHud.install(bus, { hud });
    expect(hud.widgets.map((x) => x.id)).toEqual(['race-timer']);
    off();
    expect(hud.widgets).toEqual([]);
    expect(timingHud.install(bus, {})).toBeUndefined();
  });
});
