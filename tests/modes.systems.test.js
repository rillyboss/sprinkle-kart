import { describe, it, expect } from 'vitest';
import { createEventBus } from '../src/game/events.js';
import { createSessionHelpers } from '../src/game/session.js';
import { listSystems } from '../src/systems/index.js';
import { createTimingRecords } from '../src/systems/timingRecords.js';
import timingHud from '../src/systems/timingHud.js';
import { createRecordHolders } from '../src/modes/recordHolders.js';
import { memoryBackend } from '../src/modes/storage.js';
import { SFX } from '../src/audio/sfx.js';
import raceFlowPack from '../src/audio/sfx/race-flow.js';

function fakeProgress(initial = {}) {
  const records = { ...initial };
  const calls = [];
  return {
    calls,
    getRecord: (id) => records[id] ?? { bestRace: null, bestLap: null },
    submitRecord(id, { raceTime, bestLap }) {
      calls.push([id, raceTime, bestLap]);
      const previous = this.getRecord(id);
      const newBestRace = raceTime > 0 && (previous.bestRace === null || raceTime < previous.bestRace);
      const newBestLap = bestLap > 0 && (previous.bestLap === null || bestLap < previous.bestLap);
      records[id] = { bestRace: newBestRace ? raceTime : previous.bestRace, bestLap: newBestLap ? bestLap : previous.bestLap };
      return { newBestRace, newBestLap, previous, record: records[id] };
    },
  };
}

function setup({ record = null, laps = 3, humans = 1 } = {}) {
  const log = [];
  const bus = createEventBus({ onError: (err) => { throw err; } });
  const hp = Array.from({ length: humans }, (_, i) => ({ playerIndex: i, deviceId: `gp${i}`, characterId: 'rocco' }));
  const audio = { sfx: (name) => log.push(['sfx', name]), voice() {} };
  const hud = { flash: (pi, text) => log.push(['flash', pi, text]) };
  const trackDef = { id: 'gumdrop-meadow', laps: 3 };
  const session = { ...createSessionHelpers({ humans: hp, audio, hud }), trackDef, race: { lapsTotal: laps } };
  const progress = fakeProgress(record ? { 'gumdrop-meadow': record } : {});
  const holders = createRecordHolders(memoryBackend());
  createTimingRecords({ holders }).install(bus, { progress, audio, hud });
  bus.emit('race-start', { trackId: 'gumdrop-meadow', laps, mode: 'free' }, session);
  const kart = (pi, lapTimes, extra = {}) => ({ playerIndex: pi, isCPU: false, characterId: 'rocco', lapTimes, ...extra });
  const lap = (k) => bus.emit('race:lap', { type: 'lap', kart: k, lap: k.lapTimes.length + 1 }, session);
  const finish = (k) => bus.emit('race:finish', { type: 'finish', kart: k, place: 1 }, session);
  return { bus, log, session, progress, holders, kart, lap, finish };
}

const flashes = (log) => log.filter((l) => l[0] === 'flash').map((l) => l[2]);

describe('timing records system', () => {
  it('is auto-installed', () => {
    expect(listSystems().map((s) => s.id)).toEqual(expect.arrayContaining(['timing-records', 'timing-hud', 'race-flow-reactions']));
  });

  it('flashes "Best lap!" when a lap beats your earlier ones', () => {
    const t = setup();
    t.lap(t.kart(0, [21]));
    expect(flashes(t.log)).toEqual([]);
    t.lap(t.kart(0, [21, 20.4]));
    expect(flashes(t.log)).toEqual(['Best lap! ✨ 0:20.40']);
    expect(t.log).toContainEqual(['sfx', 'timing-best-lap']);
    t.lap(t.kart(0, [21, 20.4, 20.9]));
    expect(flashes(t.log)).toHaveLength(1);
  });

  it('flashes "New record lap!" against the saved record, lowering it live', () => {
    const t = setup({ record: { bestRace: 70, bestLap: 20 } });
    t.lap(t.kart(0, [19.8]));
    expect(flashes(t.log)).toEqual(['New record lap! ⭐ 0:19.80']);
    expect(t.log).toContainEqual(['sfx', 'timing-record']);
    // P2 beats the new record too
    t.lap(t.kart(1, [19.5]));
    expect(flashes(t.log)[1]).toMatch(/New record lap/);
    // slower than the live record now: just nothing
    t.lap(t.kart(0, [19.8, 19.7]));
    expect(flashes(t.log)[2]).toMatch(/Best lap/);
  });

  it('flashes "New record!" when the finish beats the best race (normal lap count only)', () => {
    const t = setup({ record: { bestRace: 62, bestLap: 18 } });
    t.finish(t.kart(0, [20, 20, 21], { finishTime: 61 }));
    expect(flashes(t.log)).toContain('New record! 🏆 1:01.00');
    const short = setup({ record: { bestRace: 62, bestLap: 18 }, laps: 1 });
    short.finish(short.kart(0, [20], { finishTime: 20 }));
    expect(flashes(short.log).some((f) => /New record!/.test(f))).toBe(false);
  });

  it('CPUs never flash', () => {
    const t = setup({ record: { bestRace: 62, bestLap: 18 } });
    t.lap({ playerIndex: null, isCPU: true, lapTimes: [10] });
    t.finish({ playerIndex: null, isCPU: true, lapTimes: [10, 10, 10], finishTime: 30 });
    expect(flashes(t.log)).toEqual([]);
  });

  it('on race-end: submits the best human times, remembers who, attaches summary.records', () => {
    const t = setup({ record: { bestRace: 65, bestLap: 19 } });
    const summary = {
      trackId: 'gumdrop-meadow', laps: 3, unlocks: [],
      humans: [
        { playerIndex: 0, characterId: 'luna', finished: true, estimated: false, finishTime: 63, lapTimes: [21, 21, 21] },
        { playerIndex: 1, characterId: 'bruno', finished: true, estimated: false, finishTime: 64, lapTimes: [22, 18.5, 23.5] },
      ],
    };
    t.bus.emit('race-end', summary, t.session);
    expect(t.progress.calls).toEqual([['gumdrop-meadow', 63, 18.5]]);
    expect(summary.records).toMatchObject({ newBestRace: true, newBestLap: true, previous: { bestRace: 65, bestLap: 19 }, record: { bestRace: 63, bestLap: 18.5 } });
    expect(t.holders.holder('gumdrop-meadow', 'race', 63)).toBe('luna');
    expect(t.holders.holder('gumdrop-meadow', 'lap', 18.5)).toBe('bruno');
    expect(summary.unlocks).toEqual([]); // records are not unlocks
  });

  it('a broken progress store never breaks the race end', () => {
    const bus = createEventBus({ onError: (err) => { throw err; } });
    createTimingRecords({ holders: createRecordHolders(memoryBackend()) }).install(bus, { progress: { getRecord() { throw new Error('x'); }, submitRecord() { throw new Error('y'); } } });
    const summary = { trackId: 't', laps: 3, humans: [], unlocks: [] };
    expect(() => {
      bus.emit('race-start', { trackId: 't', laps: 3 }, {});
      bus.emit('race-end', summary, {});
    }).not.toThrow();
    expect(summary.records).toMatchObject({ newBestRace: false, newBestLap: false });
  });

  it('uninstalls cleanly', () => {
    const bus = createEventBus();
    const off = createTimingRecords({ holders: createRecordHolders(memoryBackend()) }).install(bus, { progress: fakeProgress() });
    expect(bus.count('race-end')).toBe(1);
    off();
    expect(bus.count('race-end')).toBe(0);
    expect(bus.count('race:lap')).toBe(0);
  });
});

describe('timing HUD system', () => {
  it('adds the timer widget (top-center) and removes it on uninstall', () => {
    const added = [];
    let removed = 0;
    const hud = { addWidget: (def) => { added.push(def); return () => { removed++; }; } };
    const off = timingHud.install(createEventBus(), { hud });
    expect(added.map((d) => [d.id, d.anchor])).toEqual([['race-timer', 'top-center']]);
    off();
    expect(removed).toBe(1);
    expect(timingHud.install(createEventBus(), {})).toBeUndefined(); // no HUD (tests / headless)
  });
});

describe('race-flow sfx pack', () => {
  it('adds new cute sounds without touching the built-ins', () => {
    const names = Object.keys(raceFlowPack.recipes);
    expect(names).toEqual(expect.arrayContaining(['timing-best-lap', 'timing-record', 'gp-tally', 'gp-trophy', 'timing-ghost']));
    for (const n of names) expect(SFX[n]).toBeTypeOf('function'); // merged into the book
    expect(raceFlowPack.override).toBeFalsy();
  });

  it('every recipe runs against a fake audio core', () => {
    const node = () => ({
      connect: () => node(), disconnect() {}, start() {}, stop() {},
      frequency: param(), gain: param(), pan: param(), Q: param(), detune: param(), type: '', buffer: null,
    });
    function param() { return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }; }
    const ctx = {
      currentTime: 0,
      createOscillator: node, createGain: node, createBiquadFilter: node, createStereoPanner: node,
      createBufferSource: node, createPanner: node,
    };
    const core = { ctx, out: node(), wet: node(), noise: {} };
    for (const [name, fn] of Object.entries(raceFlowPack.recipes)) {
      expect(() => fn(core, 0, { pitch: 1, pan: 0, volume: 1 }), name).not.toThrow();
    }
  });
});
