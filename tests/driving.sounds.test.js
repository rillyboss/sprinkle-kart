import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import drivingPack, { BOOST_VARIANT, recipes, createEngineVoice, createSlideVoice, createRustleVoice, CHARGE_CHIMES, SLIDE_PITCH } from '../src/audio/sfx/driving.js';
import { SFX, SFX_OWNERS, mergeSfxPacks } from '../src/audio/sfx.js';
import drivingSounds, {
  engineMix, engineParams, cpuEngineGain, slideParams, surfaceFor, rustleParams, SURFACES,
  createKartSoundState, stepKartSound, CUES, shouldBeSilent, nearestCpus, createDrivingMixer,
} from '../src/systems/drivingSounds.js';
import drivingReactions from '../src/systems/drivingReactions.js';
import { createEventBus } from '../src/game/events.js';
import { createSessionHelpers } from '../src/game/session.js';
import { TRACKS } from '../src/data/tracks.js';
import { makeMockAudio } from './drivingAudioMock.js';

const finiteDeep = (o) => Object.values(o).every((v) => Number.isFinite(v));

describe('engine pitch / volume mapping', () => {
  it('pitch and loudness rise with speed and throttle, and stay in a soft range', () => {
    let prev = null;
    for (let s = 0; s <= 40; s += 4) {
      const p = engineParams({ speed: s, maxSpeed: 33, throttle: 1 });
      expect(finiteDeep(p)).toBe(true);
      if (prev) {
        expect(p.freq).toBeGreaterThan(prev.freq);
        expect(p.gain).toBeGreaterThanOrEqual(prev.gain);
        expect(p.putt).toBeGreaterThanOrEqual(prev.putt);
        expect(p.depth).toBeLessThanOrEqual(prev.depth); // putt-putt blurs into a whirr
      }
      prev = p;
    }
    const idle = engineParams({ speed: 0, maxSpeed: 33, throttle: 0 });
    const top = engineParams({ speed: 33, maxSpeed: 33, throttle: 1 });
    expect(idle.freq).toBeGreaterThan(55); // an audible putt-putt, not a rumble
    expect(top.freq).toBeLessThan(260); // never a whine
    expect(top.gain).toBeLessThan(0.1); // soft, sits under the music
    expect(engineParams({ speed: 20, maxSpeed: 33, throttle: 1 }).freq).toBeGreaterThan(engineParams({ speed: 20, maxSpeed: 33, throttle: 0 }).freq);
    expect(engineParams({ speed: 20, maxSpeed: 33, throttle: 1, boosting: true }).freq).toBeGreaterThan(engineParams({ speed: 20, maxSpeed: 33, throttle: 1 }).freq);
  });

  it('reverse speed sounds like forward speed; junk input stays finite', () => {
    expect(engineParams({ speed: -8, maxSpeed: 33 }).freq).toBeCloseTo(engineParams({ speed: 8, maxSpeed: 33 }).freq, 6);
    for (const junk of [{}, { speed: NaN, maxSpeed: 0, throttle: Infinity }, { speed: 1e9 }, undefined]) {
      expect(finiteDeep(engineParams(junk))).toBe(true);
    }
    expect(engineParams({ speed: 1e9, maxSpeed: 33, throttle: 1 }).freq).toBeLessThan(300);
  });

  it('mixes down with 3-4 players', () => {
    expect(engineMix(1)).toBe(1);
    expect(engineMix(2)).toBeLessThan(1);
    expect(engineMix(3)).toBeLessThan(engineMix(2));
    expect(engineMix(4)).toBeLessThan(engineMix(3));
    expect(engineMix(4) * 4).toBeLessThan(2.5); // four engines together stay polite
    expect(engineMix(0)).toBe(1);
    expect(engineMix(99)).toBe(engineMix(4));
    expect(engineMix(NaN)).toBe(1);
  });

  it('CPU engines are faint and only nearby', () => {
    expect(cpuEngineGain(0)).toBeCloseTo(0.35, 6);
    expect(cpuEngineGain(10)).toBeGreaterThan(cpuEngineGain(20));
    expect(cpuEngineGain(30)).toBe(0);
    expect(cpuEngineGain(500)).toBe(0);
    expect(cpuEngineGain(NaN)).toBe(0);
  });

  it('drift slide sings higher per turbo level', () => {
    for (let l = 1; l <= 3; l++) {
      expect(slideParams(l).sing).toBeGreaterThan(slideParams(l - 1).sing);
      expect(slideParams(l).gain).toBeGreaterThan(slideParams(l - 1).gain);
    }
    expect(slideParams(9).sing).toBe(SLIDE_PITCH[3]);
    expect(slideParams(-2).sing).toBe(SLIDE_PITCH[0]);
    expect(slideParams(1, 0).gain).toBeLessThan(slideParams(1, 1).gain);
    expect(CHARGE_CHIMES[1].length).toBeLessThan(CHARGE_CHIMES[3].length);
    expect(Math.max(...CHARGE_CHIMES[3])).toBeGreaterThan(Math.max(...CHARGE_CHIMES[1]));
  });
});

describe('off-road surfaces', () => {
  it('picks a surface per theme', () => {
    expect(surfaceFor({ id: 'gumdrop-meadow' })).toBe('squish');
    expect(surfaceFor({ id: 'peppermint-village' })).toBe('snow');
    expect(surfaceFor({ id: 'bubblegum-bay' })).toBe('sand');
    expect(surfaceFor({ id: 'starlight-galaxy' })).toBe('space');
    expect(surfaceFor({ id: 'cotton-candy-castle' })).toBe('grass');
    expect(surfaceFor({ id: 'x', theme: { surface: 'snow' } })).toBe('snow');
    expect(surfaceFor({ id: 'x', theme: { surface: 'lava' } })).toBe('grass');
    expect(surfaceFor(null)).toBe('grass');
    for (const t of TRACKS) expect(Object.keys(SURFACES)).toContain(surfaceFor(t));
  });

  it('rustles only off-road and when moving', () => {
    expect(rustleParams('grass', { offRoad: false, speed: 30, maxSpeed: 33 }).gain).toBe(0);
    expect(rustleParams('grass', { offRoad: true, speed: 0.5, maxSpeed: 33 }).gain).toBe(0);
    const slow = rustleParams('grass', { offRoad: true, speed: 8, maxSpeed: 33 });
    const fast = rustleParams('grass', { offRoad: true, speed: 30, maxSpeed: 33 });
    expect(fast.gain).toBeGreaterThan(slow.gain);
    expect(finiteDeep(rustleParams('nope', { offRoad: true, speed: 10 }))).toBe(true);
    expect(rustleParams('squish', { offRoad: true, speed: 20 }).freq).toBeLessThan(rustleParams('sand', { offRoad: true, speed: 20 }).freq);
  });
});

describe('brake / reverse sound state machine', () => {
  const kart = (o = {}) => ({ speed: 20, spinning: false, phys: { braking: false, reversing: false, ...o.phys }, ...o, phys: { braking: false, reversing: false, ...(o.phys || {}) } });
  const run = (st, frames, k, dt = 1 / 60) => {
    const cues = [];
    for (let i = 0; i < frames; i++) cues.push(...stepKartSound(st, k, dt));
    return cues;
  };

  it('squeaks once when braking starts from speed', () => {
    const st = createKartSoundState();
    expect(run(st, 10, kart())).toEqual([]);
    expect(run(st, 30, kart({ phys: { braking: true } }))).toEqual(['drive-brake-squeak']);
  });

  it('no squeak when crawling, and a cooldown between squeaks', () => {
    const st = createKartSoundState();
    expect(run(st, 5, kart({ speed: 3, phys: { braking: true } }))).toEqual([]);
    const st2 = createKartSoundState();
    const cues = [];
    for (let i = 0; i < 12; i++) {
      cues.push(...run(st2, 2, kart({ phys: { braking: true } })));
      cues.push(...run(st2, 2, kart()));
    }
    const squeaks = cues.filter((c) => c === 'drive-brake-squeak').length;
    expect(squeaks).toBeGreaterThanOrEqual(1);
    expect(squeaks).toBeLessThanOrEqual(Math.ceil((48 / 60) / CUES.squeakCooldown) + 1);
  });

  it('reverse goes beep-beep at a steady interval, and stops when driving forward', () => {
    const st = createKartSoundState();
    const cues = run(st, 60 * 2, kart({ speed: -4, phys: { reversing: true } }));
    const beeps = cues.filter((c) => c === 'drive-reverse-beep').length;
    expect(beeps).toBeGreaterThanOrEqual(3);
    expect(beeps).toBeLessThanOrEqual(4);
    expect(run(st, 60, kart())).toEqual([]);
    expect(st.reverseFor).toBe(0);
  });

  it('a twirl (spin) never squeaks; junk dt is safe', () => {
    const st = createKartSoundState();
    expect(run(st, 10, kart({ spinning: true, phys: { braking: true } }))).toEqual([]);
    expect(() => stepKartSound(createKartSoundState(), {}, NaN)).not.toThrow();
    expect(() => stepKartSound(createKartSoundState(), null, 1)).not.toThrow();
  });

  it('silent while paused, on results and after the race', () => {
    expect(shouldBeSilent(null)).toBe(true);
    expect(shouldBeSilent({ paused: true, race: { state: 'racing' } })).toBe(true);
    expect(shouldBeSilent({ resultsShown: true, race: { state: 'racing' } })).toBe(true);
    expect(shouldBeSilent({ race: { state: 'finished' } })).toBe(true);
    expect(shouldBeSilent({ race: { state: 'racing' } })).toBe(false);
    expect(shouldBeSilent({ race: { state: 'countdown' } })).toBe(false);
  });
});

describe('driving SFX pack', () => {
  it('overrides only the built-ins the driving owner may restyle', () => {
    expect(drivingPack.override).toBe(true);
    const builtIns = Object.keys(recipes).filter((n) => !n.startsWith('drive-'));
    for (const n of builtIns) expect(SFX_OWNERS.driving).toContain(n);
    expect(SFX['drift-spark']).toBe(recipes['drift-spark']);
    expect(SFX['drift-boost']).toBe(recipes['drift-boost']);
    expect(SFX.boost).toBe(recipes.boost);
    for (const n of Object.keys(recipes)) expect(SFX[n]).toBe(recipes[n]);
    // A pack with the wrong owner name cannot take them.
    const target = { 'drift-spark': () => 'orig' };
    mergeSfxPacks([['items', drivingPack]], target, {});
    expect(target['drift-spark']()).toBe('orig');
  });

  it('every recipe plays cleanly on a strict mock context (all levels, pans, pitches)', () => {
    const { ctx, stats, core } = makeMockAudio();
    for (const [name, fn] of Object.entries(recipes)) {
      for (const level of [undefined, 0, 1, 2, 3, 7, BOOST_VARIANT.pad, BOOST_VARIANT.start]) {
        for (const pan of [0, -0.35, 1]) {
          expect(() => fn(core, ctx.currentTime + 0.01, { pitch: 1, pan, level }), name).not.toThrow();
        }
      }
    }
    expect(stats.errors).toEqual([]);
    expect(stats.started).toBeGreaterThan(50);
  });

  it('has a gentle throttle for repeatable cues', () => {
    for (const n of ['drive-brake-squeak', 'drive-reverse-beep', 'drive-wall-boing', 'drive-honk', 'drive-land']) {
      expect(drivingPack.throttle[n]).toBeGreaterThan(0);
    }
  });
});

describe('continuous voices', () => {
  it('engine / slide / rustle voices build, update and stop without errors', () => {
    const { ctx, stats, core } = makeMockAudio();
    const voices = [createEngineVoice(core), createSlideVoice(core), createRustleVoice(core)];
    const started = stats.started;
    expect(started).toBeGreaterThanOrEqual(7);
    for (let i = 0; i < 30; i++) {
      ctx.advance(1 / 60);
      voices[0].set({ ...engineParams({ speed: i, maxSpeed: 33, throttle: 1 }), pan: 0.35 });
      voices[1].set({ ...slideParams(i % 4), pan: -0.35 });
      voices[2].set({ ...rustleParams('snow', { offRoad: true, speed: 20 }), pan: 0 });
    }
    for (const v of voices) v.silence();
    for (const v of voices) { v.stop(); v.stop(); } // idempotent
    expect(stats.stopped).toBe(started);
    expect(stats.errors).toEqual([]);
    for (const v of voices) expect(v.stopped).toBe(true);
  });
});

// ---------------------------------------------------------------- mixer
function fakeKart(o = {}) {
  return {
    isCPU: false, playerIndex: 0, speed: 20, boosting: false, offRoad: false, drifting: false, driftLevel: 0, lateral: 0,
    position: new THREE.Vector3(), stats: { maxSpeed: 33 }, phys: { throttle: 1, braking: false, reversing: false, hopTime: 0 }, ...o,
  };
}
function fakeSession(karts, humans, extra = {}) {
  const helpers = createSessionHelpers({ humans });
  const played = [];
  return {
    ...helpers,
    humans,
    race: { state: 'racing', karts, getPlayerKart: (pi) => karts.find((k) => k.playerIndex === pi) || null },
    trackDef: { id: 'gumdrop-meadow' },
    paused: false,
    resultsShown: false,
    played,
    sfx: (name, opts) => played.push([name, opts]),
    ...extra,
  };
}
const humansN = (n) => Array.from({ length: n }, (_, i) => ({ playerIndex: i, deviceId: `gp${i}`, characterId: 'rocco' }));

describe('driving mixer', () => {
  it('one engine + slide + rustle voice per human, CPUs nearby get at most 2 faint engines', () => {
    const { ctx, stats, core } = makeMockAudio();
    const humans = humansN(4);
    const karts = [
      ...humans.map((h, i) => fakeKart({ playerIndex: h.playerIndex, position: new THREE.Vector3(i * 40, 0, 0) })),
      ...[1, 2, 3, 4].map((i) => fakeKart({ isCPU: true, playerIndex: null, position: new THREE.Vector3(i * 3, 0, 0) })),
    ];
    const m = createDrivingMixer();
    const s = fakeSession(karts, humans);
    for (let i = 0; i < 10; i++) { ctx.advance(1 / 60); m.frame(core, s, 1 / 60); }
    expect(m.voiceCount).toBe(4 * 3 + 2);
    expect(stats.errors).toEqual([]);
    m.reset();
    expect(m.voiceCount).toBe(0);
    expect(stats.stopped).toBe(stats.started);
  });

  it('fades every voice to silence while paused / on results', () => {
    const { ctx, stats, core } = makeMockAudio();
    const humans = humansN(1);
    const karts = [fakeKart({ drifting: true, driftLevel: 2, offRoad: true })];
    const m = createDrivingMixer();
    const s = fakeSession(karts, humans);
    m.frame(core, s, 1 / 60);
    const outs = stats.gains.filter((g) => g.gain.events.some((e) => e[0] === 'target' && e[1] > 0));
    expect(outs.length).toBeGreaterThan(0);
    s.paused = true;
    ctx.advance(0.1);
    m.frame(core, s, 1 / 60);
    // every voice output gain now targets 0
    const lastTargets = stats.gains.map((g) => g.gain.target);
    const voiceOuts = stats.gains.filter((g) => g.outputs.length && g.gain.events.some((e) => e[0] === 'target' && e[2] > 0.05));
    expect(voiceOuts.length).toBeGreaterThan(0);
    for (const g of voiceOuts) expect(g.gain.target).toBe(0);
    expect(lastTargets.every(Number.isFinite)).toBe(true);
  });

  it('plays brake squeak / reverse beeps as one-shots through session.sfx', () => {
    const { ctx, core } = makeMockAudio();
    const humans = humansN(1);
    const k = fakeKart();
    const m = createDrivingMixer();
    const s = fakeSession([k], humans);
    m.frame(core, s, 1 / 60);
    k.phys.braking = true;
    m.frame(core, s, 1 / 60);
    k.phys.braking = false;
    k.speed = -3;
    k.phys.reversing = true;
    for (let i = 0; i < 60; i++) { ctx.advance(1 / 60); m.frame(core, s, 1 / 60); }
    const names = s.played.map((p) => p[0]);
    expect(names.filter((n) => n === 'drive-brake-squeak')).toHaveLength(1);
    expect(names.filter((n) => n === 'drive-reverse-beep').length).toBeGreaterThanOrEqual(1);
  });

  it('rebuilds voices when the audio context changes, and ignores missing core / race', () => {
    const a = makeMockAudio();
    const b = makeMockAudio();
    const humans = humansN(1);
    const m = createDrivingMixer();
    const s = fakeSession([fakeKart()], humans);
    m.frame(a.core, s, 1 / 60);
    m.frame(b.core, s, 1 / 60);
    expect(a.stats.stopped).toBe(a.stats.started);
    expect(b.stats.started).toBeGreaterThan(0);
    expect(() => m.frame(null, s, 1 / 60)).not.toThrow();
    expect(() => m.frame(b.core, {}, 1 / 60)).not.toThrow();
  });

  it('nearestCpus picks the closest CPUs within 30 m', () => {
    const h = fakeKart();
    const c = (x) => fakeKart({ isCPU: true, playerIndex: null, position: new THREE.Vector3(x, 0, 0) });
    const near = nearestCpus([c(25), c(5), c(50), c(12), h], [h]);
    expect(near.map((n) => n.dist)).toEqual([5, 12]);
    expect(nearestCpus([], [h])).toEqual([]);
  });
});

describe('driving-sounds system on the bus', () => {
  it('installs, follows the race lifecycle and stops everything on race-exit', () => {
    const mock = makeMockAudio();
    const bus = createEventBus({ onError: (err) => { throw err; } });
    const off = drivingSounds.install(bus, { audio: { sfxCore: () => mock.core } });
    const humans = humansN(2);
    const karts = humans.map((h) => fakeKart({ playerIndex: h.playerIndex }));
    const s = fakeSession(karts, humans);
    bus.emit('race-start', { trackId: 'gumdrop-meadow' }, s);
    for (let i = 0; i < 5; i++) bus.emit('race-frame', 1 / 60, s);
    expect(mock.stats.started).toBeGreaterThan(0);
    bus.emit('race-pause', { label: 'Paused' }, s);
    bus.emit('race-exit', { outcome: 'menu' }, s);
    expect(mock.stats.stopped).toBe(mock.stats.started);
    off();
    expect(mock.stats.errors).toEqual([]);
  });

  it('is a silent no-op without Web Audio (node / before unlock)', () => {
    const bus = createEventBus({ onError: (err) => { throw err; } });
    const off = drivingSounds.install(bus, { audio: { sfx() {} } });
    const humans = humansN(1);
    const s = fakeSession([fakeKart()], humans);
    expect(() => { bus.emit('race-start', {}, s); bus.emit('race-frame', 1 / 60, s); bus.emit('race-exit', {}, s); }).not.toThrow();
    off();
  });
});

describe('driving reactions (one-shots)', () => {
  function setup(n = 1) {
    const log = [];
    const bus = createEventBus({ onError: (err) => { throw err; } });
    const humans = humansN(n);
    const helpers = createSessionHelpers({ humans, audio: { sfx: (name, opts) => log.push([name, opts]) }, input: { rumble() {} }, hud: { flash: (pi, t) => log.push(['flash', t]) } });
    const karts = humans.map((h) => fakeKart({ playerIndex: h.playerIndex }));
    const session = { ...helpers, humans, race: { getPlayerKart: (pi) => karts.find((k) => k.playerIndex === pi) } };
    drivingReactions.install(bus);
    const fire = (type, e) => bus.emit(`race:${type}`, { type, ...e }, session);
    return { log, fire, karts, bus, session };
  }
  const cpuK = () => fakeKart({ isCPU: true, playerIndex: null });

  it('GO revs the engine of humans who are on the gas', () => {
    const { log, fire, karts } = setup(2);
    karts[0].phys.prevAccel = true;
    fire('go', {});
    expect(log.filter((l) => l[0] === 'drive-rev')).toHaveLength(1);
  });

  it('rocket start sparkles, pads zing, items stay with itemReactions', () => {
    const { log, fire, karts } = setup();
    fire('boost', { kart: karts[0], source: 'start' });
    fire('boost', { kart: karts[0], source: 'pad' });
    fire('boost', { kart: karts[0], source: 'item' });
    fire('boost', { kart: cpuK(), source: 'pad' });
    const names = log.map((l) => l[0]);
    expect(names).toEqual(['boost', 'flash', 'boost']); // exactly one 'boost' each (contract)
    expect(log[0][1].level).toBe(BOOST_VARIANT.start);
    expect(log[2][1].level).toBe(BOOST_VARIANT.pad);
  });

  it('hop, landing thump and drift squeal for humans only', () => {
    const { log, fire, karts } = setup();
    for (const t of ['hop', 'land', 'drift-start']) { fire(t, { kart: karts[0], strength: 0.4 }); fire(t, { kart: cpuK() }); }
    expect(log.map((l) => l[0])).toEqual(['drive-hop', 'drive-land', 'drive-drift-squeal']);
    expect(log[1][1].level).toBe(0.4);
  });

  it('fences go boing, kart bumps honk', () => {
    const { log, fire, karts } = setup(2);
    fire('bump', { kart: karts[0], wall: true, strength: 0.5 });
    fire('bump', { kart: cpuK(), other: karts[1], strength: 0.5 });
    fire('bump', { kart: cpuK(), other: cpuK(), strength: 0.5 });
    expect(log.map((l) => l[0])).toEqual(['drive-wall-boing', 'bump', 'drive-honk']);
    expect(log[1][1].pan).toBe(0); // 2 players: centred
  });
});
