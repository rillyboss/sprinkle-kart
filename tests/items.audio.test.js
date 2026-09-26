/**
 * Item sounds render cleanly (strict mock Web Audio), stay gentle, and the
 * music ducks (then recovers) for important cues. The rocket whistle builds
 * and tears down its nodes safely.
 */
import { describe, it, expect } from 'vitest';
import { AudioManager } from '../src/audio/AudioManager.js';
import { SFX, SFX_THROTTLE } from '../src/audio/sfx.js';
import { ITEM_SFX_NAMES } from '../src/audio/sfx/items.js';
import itemLoops from '../src/systems/itemLoops.js';
import itemReactions, { duck } from '../src/systems/itemReactions.js';
import { createEventBus } from '../src/game/events.js';
import { createSessionHelpers } from '../src/game/session.js';

function makeMockContext() {
  const stats = { nodes: 0, started: 0, errors: [], gains: [], oscs: [] };
  let now = 0;
  const check = (cond, msg) => { if (!cond) { stats.errors.push(msg); throw new Error(msg); } };
  const finite = (v, what) => check(Number.isFinite(v), `${what} not finite: ${v}`);
  class Param {
    constructor(v = 0) { this.value = v; this.events = []; }
    _t(t, name) { finite(t, `${name} time`); check(t >= 0, `${name} negative time`); }
    setValueAtTime(v, t) { finite(v, 'setValueAtTime value'); this._t(t, 'setValueAtTime'); this.events.push(['set', v, t]); return this; }
    linearRampToValueAtTime(v, t) { finite(v, 'linearRamp value'); this._t(t, 'linearRamp'); this.events.push(['lin', v, t]); return this; }
    exponentialRampToValueAtTime(v, t) { finite(v, 'expRamp value'); this._t(t, 'expRamp'); check(v > 0, `expRamp to non-positive ${v}`); this.events.push(['exp', v, t]); return this; }
    setTargetAtTime(v, t, tc) { finite(v, 'setTarget value'); this._t(t, 'setTarget'); finite(tc, 'timeConstant'); check(tc > 0, 'timeConstant <= 0'); this.events.push(['target', v, t, tc]); return this; }
    cancelScheduledValues(t) { this._t(t, 'cancel'); this.events.push(['cancel', t]); return this; }
  }
  class Node {
    constructor() { stats.nodes++; this.outputs = []; }
    connect(n) { check(n && (n instanceof Node || n instanceof Param), 'connect to non-node'); this.outputs.push(n); return n; }
    disconnect() { this.outputs = []; }
  }
  class Source extends Node {
    start(t = 0) { finite(t, 'start'); check(!this._started, 'start twice'); this._started = true; this._startT = t; stats.started++; }
    stop(t = 0) { finite(t, 'stop'); check(this._started, 'stop before start'); check(t >= this._startT, 'stop before start time'); this._stopped = t; }
  }
  const ctx = {
    sampleRate: 44100,
    state: 'suspended',
    get currentTime() { return now; },
    destination: new Node(),
    advance(dt) { now += dt; },
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
    close() { ctx.state = 'closed'; return Promise.resolve(); },
    createGain() { const n = new Node(); n.gain = new Param(1); stats.gains.push(n); return n; },
    createOscillator() { const n = new Source(); n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0); stats.oscs.push(n); return n; },
    createBufferSource() { const n = new Source(); n.buffer = null; n.loop = false; n.playbackRate = new Param(1); return n; },
    createBiquadFilter() { const n = new Node(); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); return n; },
    createStereoPanner() { const n = new Node(); n.pan = new Param(0); return n; },
    createDelay() { const n = new Node(); n.delayTime = new Param(0); return n; },
    createConvolver() { const n = new Node(); n.buffer = null; return n; },
    createDynamicsCompressor() { const n = new Node(); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0); return n; },
    createBuffer(ch, len, sr) {
      check(len > 0, 'empty buffer');
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
    },
  };
  return { ctx, stats };
}

function setup() {
  const { ctx, stats } = makeMockContext();
  const am = new AudioManager({ createContext: () => ctx, startTimer: false, autoUnlock: false });
  am.unlock();
  return { am, ctx, stats };
}

/** Loudest envelope peak any single note of a recipe reaches. */
function peakOf(name, opts = {}) {
  const { am, ctx, stats } = setup();
  const g0 = stats.gains.length;
  am.sfx(name, opts);
  ctx.advance(3);
  let peak = 0;
  // only audio-path gains (vibrato depth gains feed a frequency Param, not a node)
  for (const g of stats.gains.slice(g0)) {
    if (!g.outputs.length || g.outputs.some((o) => !o.outputs)) continue;
    for (const e of g.gain.events) if (e[0] === 'lin') peak = Math.max(peak, e[1]);
  }
  return { peak, errors: stats.errors, started: stats.started };
}

describe('item sound recipes', () => {
  it('every item sound renders without invalid automation, with any options', () => {
    const { am, ctx, stats } = setup();
    for (const n of ITEM_SFX_NAMES) {
      for (const opts of [{}, { volume: 0.4, pan: 0.8, pitch: 1.3, level: 1, n: 1 }, { level: 0.5, n: 7, pan: -2, pitch: -1 }, { level: NaN, n: -3 }]) {
        am.sfx(n, opts);
        ctx.advance(1);
      }
    }
    expect(stats.errors).toEqual([]);
  });

  it('every item sound actually makes sound, and none is harsh (per-note peak <= 0.25)', () => {
    for (const n of ITEM_SFX_NAMES) {
      const r = peakOf(n, { level: 1 });
      expect(r.errors, n).toEqual([]);
      expect(r.started, n).toBeGreaterThan(0);
      expect(r.peak, n).toBeGreaterThan(0.01);
      expect(r.peak, n).toBeLessThanOrEqual(0.25);
    }
  });

  it('roulette ticks and warning beeps are not throttled away between quick ticks', () => {
    expect(SFX_THROTTLE['item-roulette']).toBeLessThanOrEqual(0.03);
    expect(SFX_THROTTLE['item-threat-beep']).toBeLessThanOrEqual(0.1);
    const { am, ctx, stats } = setup();
    let before = stats.started;
    for (let i = 0; i < 10; i++) { am.sfx('item-roulette', { level: i / 10 }); ctx.advance(0.05); }
    expect(stats.started - before).toBeGreaterThanOrEqual(20); // 10 ticks x 2 oscillators
    before = stats.started;
    am.sfx('item-threat-beep'); am.sfx('item-threat-beep');
    expect(stats.started - before).toBe(2); // same instant: second one throttled
  });

  it('recipes are functions registered in the SFX book', () => {
    for (const n of ITEM_SFX_NAMES) expect(typeof SFX[n]).toBe('function');
  });
});

describe('music ducking', () => {
  it('duckMusic lowers the music bus, then eases it back', () => {
    const { am, ctx } = setup();
    ctx.advance(1);
    const bus = am._musicBus.gain;
    bus.events.length = 0;
    am.duckMusic(0.5, 0.4);
    const targets = bus.events.filter((e) => e[0] === 'target');
    expect(targets).toHaveLength(2);
    const full = am._musicLevel();
    expect(targets[0][1]).toBeCloseTo(full * 0.5);
    expect(targets[1][1]).toBeCloseTo(full);
    expect(targets[1][2]).toBeCloseTo(1.4);
  });

  it('clamps silly values and is a safe no-op before unlock / after dispose', () => {
    const { am, ctx } = setup();
    ctx.advance(1);
    const bus = am._musicBus.gain;
    bus.events.length = 0;
    am.duckMusic(0, 99);
    const t = bus.events.filter((e) => e[0] === 'target');
    expect(t[0][1]).toBeCloseTo(am._musicLevel() * 0.2);
    expect(t[1][2]).toBeCloseTo(1 + 3);
    am.duckMusic(NaN, NaN);
    const locked = new AudioManager({ createContext: () => null, startTimer: false, autoUnlock: false });
    expect(() => locked.duckMusic(0.5)).not.toThrow();
    am.dispose();
    expect(() => am.duckMusic(0.5)).not.toThrow();
  });

  it('item reactions duck for impacts and blocks but not for roulette ticks', () => {
    const ducks = [];
    const audio = { sfx() {}, voice() {}, duckMusic: (lv, hold) => ducks.push([lv, hold]) };
    const humans = [{ playerIndex: 0, deviceId: 'kb1', characterId: 'rocco' }];
    const s = { ...createSessionHelpers({ humans, audio }), audio };
    const bus = createEventBus({ onError: (e) => { throw e; } });
    itemReactions.install(bus, {});
    const me = { playerIndex: 0, isCPU: false, charDef: { id: 'rocco' } };
    bus.emit('race:item-box', { kart: me, rolling: true }, s);
    expect(ducks).toEqual([]);
    bus.emit('race:bonked', { kart: me, cause: 'gumdrop' }, s);
    bus.emit('race:shield-pop', { kart: me, cause: 'cupcake-rocket' }, s);
    expect(ducks).toHaveLength(2);
    expect(() => duck({}, { duck: 0.5 })).not.toThrow();
    expect(() => duck({ audio: { duckMusic() { throw new Error('x'); } } }, { duck: 0.5 })).not.toThrow();
  });
});

describe('rocket whistle', () => {
  it('builds one whistle per targeted player, retunes it every frame and stops it on exit', () => {
    const { ctx, stats } = makeMockContext();
    ctx.state = 'running';
    const out = ctx.createGain();
    const app = { audio: { sfxCore: () => ({ ctx, out, noise: null, wet: null }) } };
    const bus = createEventBus({ onError: (e) => { throw e; } });
    const off = itemLoops.install(bus, app);
    const k = { playerIndex: 0, isCPU: false, heading: 0, position: { x: 0, y: 0, z: 0 }, distance: 500, finished: false, itemRoulette: 0, starPower: 0, shielded: false };
    const rocket = { target: k, distance: 400, mesh: { position: { x: 0, y: 0, z: -100 } } };
    const race = { state: 'racing', items: { rockets: [rocket], gumdrops: [] }, getPlayerKart: () => k };
    const s = { humans: [{ playerIndex: 0 }], race, sfx() {}, panFor: () => 0, paused: false, resultsShown: false };
    bus.emit('race-start', {}, s);
    const oscBefore = stats.oscs.length;
    for (let i = 0; i < 30; i++) {
      rocket.distance += 3;
      ctx.advance(1 / 60);
      bus.emit('race-frame', 1 / 60, s);
    }
    expect(stats.oscs.length - oscBefore).toBe(2); // tone + wobble LFO, created once
    const tone = stats.oscs[oscBefore];
    const freqs = tone.frequency.events.filter((e) => e[0] === 'target').map((e) => e[1]);
    expect(freqs[freqs.length - 1]).toBeGreaterThan(freqs[0]); // rises as it closes in
    bus.emit('race-exit', {}, s);
    expect(tone._stopped).toBeDefined();
    expect(stats.errors).toEqual([]);
    off();
  });

  it('does nothing without Web Audio', () => {
    const bus = createEventBus({ onError: (e) => { throw e; } });
    const off = itemLoops.install(bus, { audio: { sfxCore: () => null } });
    const k = { playerIndex: 0, isCPU: false, heading: 0, position: { x: 0, y: 0, z: 0 }, distance: 500 };
    const race = { state: 'racing', items: { rockets: [{ target: k, distance: 450 }], gumdrops: [] }, getPlayerKart: () => k };
    expect(() => bus.emit('race-frame', 1 / 60, { humans: [{ playerIndex: 0 }], race, sfx() {}, panFor: () => 0 })).not.toThrow();
    off();
  });
});
