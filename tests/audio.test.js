import { describe, it, expect } from 'vitest';
import { AudioManager, SFX_NAMES, SONG_IDS, VOICE_KINDS } from '../src/audio/AudioManager.js';

const REQUIRED_SFX = ['move', 'confirm', 'back', 'join', 'countdown', 'go', 'item-roulette', 'item-get',
  'boost', 'bonk', 'bump', 'lap', 'final-lap', 'finish', 'win', 'unlock', 'drift-spark',
  'drift-boost', 'bubble', 'gumdrop', 'rocket', 'star', 'cheer'];

const CHARS = [
  { id: 'rocco', voice: { pitch: 0.9, style: 'hoho' } },
  { id: 'muffin', voice: { pitch: 2.0, style: 'giggle' } },
  { id: 'gumbo', voice: { pitch: 0.5, style: 'hoho' } },
  { id: 'bizzy', voice: { pitch: 1.4, style: 'boing' } },
  { id: 'stella', voice: { pitch: 1.1, style: 'hum' } },
  { id: 'peachy', voice: { pitch: 1.5, style: 'yay' } },
  { id: 'weird' }, // no voice data at all
];

// ------------------------------------------------------------------ strict mock Web Audio
// Validates the arguments real browsers would reject so bugs surface in node.
function makeMockContext() {
  const stats = { nodes: 0, started: 0, errors: [] };
  let now = 0;
  const check = (cond, msg) => { if (!cond) { stats.errors.push(msg); throw new Error(msg); } };
  const finite = (v, what) => check(Number.isFinite(v), `${what} not finite: ${v}`);

  class Param {
    constructor(v = 0) { this.value = v; this.events = []; }
    _t(t, name) { finite(t, `${name} time`); check(t >= 0, `${name} negative time`); }
    setValueAtTime(v, t) { finite(v, 'setValueAtTime value'); this._t(t, 'setValueAtTime'); this.events.push(['set', v, t]); return this; }
    linearRampToValueAtTime(v, t) { finite(v, 'linearRamp value'); this._t(t, 'linearRamp'); this.events.push(['lin', v, t]); return this; }
    exponentialRampToValueAtTime(v, t) {
      finite(v, 'expRamp value'); this._t(t, 'expRamp');
      check(v !== 0 && v > 0, `expRamp to non-positive ${v}`);
      this.events.push(['exp', v, t]); return this;
    }
    setTargetAtTime(v, t, tc) { finite(v, 'setTarget value'); this._t(t, 'setTarget'); finite(tc, 'timeConstant'); check(tc > 0, 'timeConstant <= 0'); return this; }
    cancelScheduledValues(t) { this._t(t, 'cancel'); return this; }
  }
  class Node {
    constructor() { stats.nodes++; this.outputs = []; }
    connect(n) { check(n && (n instanceof Node || n instanceof Param), 'connect to non-node'); this.outputs.push(n); return n; }
    disconnect() { this.outputs = []; }
  }
  class Source extends Node {
    start(t = 0) { finite(t, 'start'); check(!this._started, 'start twice'); this._started = true; this._startT = t; stats.started++; }
    stop(t = 0) { finite(t, 'stop'); check(this._started, 'stop before start'); check(t >= this._startT, 'stop before start time'); }
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
    createGain() { const n = new Node(); n.gain = new Param(1); return n; },
    createOscillator() { const n = new Source(); n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0); return n; },
    createBufferSource() { const n = new Source(); n.buffer = null; n.loop = false; n.playbackRate = new Param(1); return n; },
    createBiquadFilter() { const n = new Node(); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); return n; },
    createStereoPanner() { const n = new Node(); n.pan = new Param(0); return n; },
    createDelay() { const n = new Node(); n.delayTime = new Param(0); return n; },
    createConvolver() { const n = new Node(); n.buffer = null; return n; },
    createDynamicsCompressor() {
      const n = new Node();
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
      return n;
    },
    createBuffer(ch, len, sr) {
      check(len > 0, 'empty buffer');
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
    },
  };
  return { ctx, stats };
}

describe('AudioManager without Web Audio (node)', () => {
  it('constructs and every method is a graceful no-op', () => {
    const am = new AudioManager();
    expect(am.unlocked).toBe(false);
    expect(() => {
      am.unlock();
      am.unlock();
      for (const id of [...SONG_IDS, null, 'nope']) am.playMusic(id);
      am.setMusicTempo(1.15);
      am.setMusicTempo(NaN);
      for (const n of REQUIRED_SFX) am.sfx(n, { volume: 0.5, pan: -1, level: 3, n: 2 });
      am.sfx('does-not-exist');
      am.sfx('boost');
      for (const c of CHARS) for (const k of VOICE_KINDS) am.voice(c, k);
      am.voice(null, 'yay');
      am.voice(undefined);
      am.setVolume({ music: 0.3, sfx: 2 });
      am.setVolume();
      am.tick();
      am.dispose();
    }).not.toThrow();
    expect(am.unlocked).toBe(false);
    expect(am.volume).toEqual({ music: 0.3, sfx: 1 });
  });

  it('remembers the requested song before unlock', () => {
    const am = new AudioManager();
    am.playMusic('castle');
    expect(am.currentMusic).toBe('castle');
    am.playMusic('bogus');
    expect(am.currentMusic).toBe(null);
  });

  it('defines every SFX named in the architecture contract', () => {
    for (const n of REQUIRED_SFX) expect(SFX_NAMES).toContain(n);
    for (const id of ['menu', 'castle', 'meadow', 'galaxy', 'sundae', 'victory']) expect(SONG_IDS).toContain(id);
  });

  it('marks itself unavailable if the context factory fails', () => {
    const am = new AudioManager({ createContext: () => { throw new Error('nope'); }, startTimer: false });
    expect(() => { am.unlock(); am.sfx('go'); am.playMusic('menu'); }).not.toThrow();
    expect(am.unlocked).toBe(false);
    expect(am.available).toBe(false);
  });
});

describe('AudioManager with a strict mock AudioContext', () => {
  function setup() {
    const { ctx, stats } = makeMockContext();
    const am = new AudioManager({ createContext: () => ctx, startTimer: false, autoUnlock: false });
    return { am, ctx, stats };
  }

  it('unlocks, plays and crossfades every song, including tempo changes', async () => {
    const { am, ctx, stats } = setup();
    am.playMusic('menu'); // requested before unlock
    am.unlock();
    await Promise.resolve();
    expect(am.unlocked).toBe(true);
    for (const id of [...SONG_IDS, 'castle', null, 'galaxy']) {
      am.playMusic(id);
      for (let i = 0; i < 40; i++) {
        ctx.advance(0.1);
        if (i === 20) am.setMusicTempo(1.15);
        am.tick();
      }
    }
    expect(stats.errors).toEqual([]);
    expect(stats.started).toBeGreaterThan(500);
    expect(am.currentMusic).toBe('galaxy');
  });

  it('resyncs instead of bursting after a long stall', () => {
    const { am, ctx, stats } = setup();
    am.unlock();
    am.playMusic('meadow');
    am.tick();
    const before = stats.started;
    ctx.advance(30); // tab was hidden for 30 s
    am.tick();
    // Only ~one lookahead window of notes, not 30 s worth.
    expect(stats.started - before).toBeLessThan(80);
    expect(stats.errors).toEqual([]);
  });

  it('plays every SFX with various options without invalid automation', () => {
    const { am, ctx, stats } = setup();
    am.unlock();
    for (const n of REQUIRED_SFX) {
      for (const opts of [{}, { volume: 0.4, pan: 0.8, pitch: 1.3, level: 1, n: 1 }, { level: 3, n: 3, pan: -2, pitch: -1 }]) {
        am.sfx(n, opts);
        ctx.advance(1);
      }
    }
    expect(stats.errors).toEqual([]);
  });

  it('throttles spammy effects', () => {
    const { am, stats } = setup();
    am.unlock();
    am.sfx('drift-spark');
    const after1 = stats.started;
    for (let i = 0; i < 20; i++) am.sfx('drift-spark');
    expect(stats.started).toBe(after1);
  });

  it('speaks for every voice style and kind', () => {
    const { am, ctx, stats } = setup();
    am.unlock();
    for (const c of CHARS) {
      for (const k of VOICE_KINDS) {
        am.voice(c, k, { pan: 0.5 });
        ctx.advance(2);
      }
    }
    expect(stats.errors).toEqual([]);
    expect(stats.started).toBeGreaterThan(CHARS.length * VOICE_KINDS.length * 3 - 1);
  });

  it('setVolume clamps and dispose closes the context', () => {
    const { am, ctx } = setup();
    am.unlock();
    am.setVolume({ music: -1, sfx: 0.5 });
    expect(am.volume).toEqual({ music: 0, sfx: 0.5 });
    am.dispose();
    expect(ctx.state).toBe('closed');
    expect(() => { am.sfx('go'); am.voice(CHARS[0], 'yay'); am.playMusic('menu'); }).not.toThrow();
  });
});
