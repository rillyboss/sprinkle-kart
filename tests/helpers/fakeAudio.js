/**
 * Fake audio for node tests.
 *
 *   // 1) a recording stand-in for AudioManager (systems, session helpers, menus)
 *   const audio = createFakeAudio();
 *   audio.sfx('boost', { pan: -0.3 });
 *   audio.calls.sfx          // [{ name: 'boost', opts: { pan: -0.3 } }]
 *   audio.played('boost')    // 1
 *   audio.sfxCore()          // null until audio.unlock() (like the real one); then a fake core
 *
 *   // 2) a STRICT mock Web Audio context: validates what real browsers reject
 *   //    (non-finite params, negative times, expRamp to 0, start twice, stop before start ...)
 *   const { ctx, stats } = createStrictAudioContext();
 *   const am = new AudioManager({ createContext: () => ctx, startTimer: false, autoUnlock: false });
 *   am.unlock(); am.sfx('go'); ctx.advance(1);
 *   stats.errors            // [] — every violation is recorded AND thrown
 */

/** A strict AudioContext mock (see file header). `ctx.advance(dt)` moves currentTime. */
export function createStrictAudioContext({ sampleRate = 44100 } = {}) {
  const stats = { nodes: 0, started: 0, stopped: 0, errors: [] };
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
      check(v > 0, `expRamp to non-positive ${v}`);
      this.events.push(['exp', v, t]); return this;
    }
    setTargetAtTime(v, t, tc) {
      finite(v, 'setTarget value'); this._t(t, 'setTarget'); finite(tc, 'timeConstant'); check(tc > 0, 'timeConstant <= 0');
      this.events.push(['target', v, t, tc]); return this;
    }
    cancelScheduledValues(t) { this._t(t, 'cancel'); this.events.push(['cancel', t]); return this; }
    cancelAndHoldAtTime(t) { this._t(t, 'cancelAndHold'); this.events.push(['hold', t]); return this; }
  }
  class Node {
    constructor(kind) { stats.nodes++; this.kind = kind; this.outputs = []; }
    connect(n) { check(n && (n instanceof Node || n instanceof Param), 'connect to non-node'); this.outputs.push(n); return n; }
    disconnect() { this.outputs = []; }
  }
  class Source extends Node {
    start(t = 0) { finite(t, 'start'); check(!this._started, 'start twice'); this._started = true; this._startT = t; stats.started++; }
    stop(t = 0) { finite(t, 'stop'); check(this._started, 'stop before start'); check(t >= this._startT, 'stop before start time'); stats.stopped++; }
  }
  const ctx = {
    sampleRate,
    state: 'suspended',
    get currentTime() { return now; },
    destination: new Node('destination'),
    advance(dt) { now += dt; },
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
    close() { ctx.state = 'closed'; return Promise.resolve(); },
    createGain() { const n = new Node('gain'); n.gain = new Param(1); return n; },
    createOscillator() { const n = new Source('osc'); n.type = 'sine'; n.frequency = new Param(440); n.detune = new Param(0); return n; },
    createBufferSource() { const n = new Source('buffer'); n.buffer = null; n.loop = false; n.playbackRate = new Param(1); n.detune = new Param(0); return n; },
    createBiquadFilter() { const n = new Node('biquad'); n.type = 'lowpass'; n.frequency = new Param(350); n.Q = new Param(1); n.gain = new Param(0); n.detune = new Param(0); return n; },
    createStereoPanner() { const n = new Node('panner'); n.pan = new Param(0); return n; },
    createDelay() { const n = new Node('delay'); n.delayTime = new Param(0); return n; },
    createConvolver() { const n = new Node('convolver'); n.buffer = null; return n; },
    createWaveShaper() { const n = new Node('shaper'); n.curve = null; n.oversample = 'none'; return n; },
    createDynamicsCompressor() {
      const n = new Node('compressor');
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(0);
      return n;
    },
    createBuffer(ch, len, sr) {
      check(ch > 0 && len > 0, 'empty buffer');
      finite(sr, 'buffer sampleRate');
      const data = Array.from({ length: ch }, () => new Float32Array(len));
      return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: (i) => data[i] };
    },
  };
  return { ctx, stats };
}

/**
 * Recording fake with the AudioManager API (ARCHITECTURE.md §10).
 * @param {{ unlocked?: boolean }} [opts] start unlocked (sfxCore() returns a core right away)
 */
export function createFakeAudio({ unlocked = false } = {}) {
  const calls = { sfx: [], voice: [], music: [], tempo: [], volume: [] };
  let isUnlocked = unlocked;
  let core = null;
  const makeCore = () => {
    const { ctx } = createStrictAudioContext();
    ctx.state = 'running';
    const out = ctx.createGain();
    const wet = ctx.createGain();
    out.connect(ctx.destination);
    wet.connect(out);
    const noise = ctx.createBuffer(1, 4410, ctx.sampleRate);
    return { ctx, noise, out, wet };
  };
  const audio = {
    calls,
    currentMusic: null,
    tempo: 1,
    volume: { music: 0.7, sfx: 0.85 },
    get unlocked() { return isUnlocked; },
    get available() { return true; },
    unlock() { isUnlocked = true; },
    playMusic(id) { calls.music.push(id); audio.currentMusic = id ?? null; },
    setMusicTempo(m) { calls.tempo.push(m); if (Number.isFinite(m)) audio.tempo = m; },
    sfx(name, opts = {}) { calls.sfx.push({ name, opts }); },
    voice(def, kind, opts = {}) { calls.voice.push({ id: def?.id ?? null, kind, opts }); },
    setVolume(v = {}) { calls.volume.push(v); audio.volume = { ...audio.volume, ...v }; },
    /** `{ ctx, noise, out, wet }` once unlocked, like the real sfxCore(); null before. */
    sfxCore() { if (!isUnlocked) return null; core ??= makeCore(); return core; },
    tick() {},
    dispose() {},
    // ---- assertions ----
    /** How many times an sfx was played. */
    played: (name) => calls.sfx.filter((c) => c.name === name).length,
    /** Names of every sfx played, in order. */
    sfxNames: () => calls.sfx.map((c) => c.name),
    reset() { for (const k of Object.keys(calls)) calls[k].length = 0; },
  };
  return audio;
}
