/**
 * Sprinkle Kart audio: synthesized music (lookahead sequencer), SFX and
 * character voices. Everything is created lazily; before the first user
 * gesture — or where Web Audio doesn't exist (node tests) — every method is a
 * silent no-op.
 *
 * Graph:  song faders ─▶ musicBus ─┐
 *         sfx / voices ─▶ sfxBus ──┼─▶ master ─▶ soft low-pass ─▶ compressor ─▶ limiter ─▶ out
 *         (each bus has its own convolver reverb return feeding back into it)
 */
import { SONGS } from './songs.js';
import { getCompiledSong } from './compile.js';
import { Sequencer } from './Sequencer.js';
import { SFX, SFX_THROTTLE } from './sfx.js';
import { createNoiseBuffer, createImpulse } from './synth.js';
import { buildUtterance, playUtterance, voiceSeed } from './voice.js';

export { SFX_NAMES } from './sfx.js';
export { SONG_IDS } from './songs.js';
export { VOICE_KINDS } from './voice.js';

const LOOKAHEAD = 0.15; // seconds scheduled ahead
const TICK_MS = 25;

function defaultCreateContext() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    return new AC({ latencyHint: 'interactive' });
  } catch {
    try { return new AC(); } catch { return null; }
  }
}

function hasUserActivation() {
  const ua = globalThis.navigator && globalThis.navigator.userActivation;
  return !ua || ua.hasBeenActive || ua.isActive;
}

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

export class AudioManager {
  /**
   * @param {{createContext?: () => BaseAudioContext|null, autoUnlock?: boolean,
   *          startTimer?: boolean}} [opts]
   *   createContext: override (e.g. OfflineAudioContext for rendering tests).
   *   autoUnlock (default true in browsers): listen for the first pointer/key/touch
   *     on `document` and call unlock() automatically.
   *   startTimer (default true): run the scheduler timer (disable when rendering offline).
   */
  constructor(opts = {}) {
    this._createContext = opts.createContext || defaultCreateContext;
    this._startTimer = opts.startTimer !== false;
    this.ctx = null;
    this._failed = false;
    this._volumes = { music: 0.7, sfx: 0.85 };
    this._wantedMusic = null;
    this._currentId = null;
    this._seq = null;
    this._fading = [];
    this._tempo = 1;
    this._lastPlayed = new Map();
    this._voiceCounter = 0;
    this._timer = null;
    this._onVisibility = null;
    this._gestureHandler = null;

    if (opts.autoUnlock !== false && typeof document !== 'undefined' && document.addEventListener) {
      this._gestureHandler = () => {
        this.unlock();
        if (this.unlocked) this._removeGestureListeners();
      };
      for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) {
        document.addEventListener(ev, this._gestureHandler, { passive: true, capture: true });
      }
    }
  }

  /** True if Web Audio exists at all in this environment. */
  get available() {
    return !this._failed && !!(this.ctx || globalThis.AudioContext || globalThis.webkitAudioContext || this._createContext !== defaultCreateContext);
  }

  /** Resume (creating if needed) the AudioContext. Call from a user gesture; safe to call often. */
  unlock() {
    if (!this.ctx) {
      if (this._createContext === defaultCreateContext && !hasUserActivation()) return;
      if (!this._init()) return;
    }
    const ctx = this.ctx;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function' && !this._hidden()) {
      try {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      } catch { /* ignore */ }
    }
  }

  get unlocked() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Id of the song currently playing (or requested before unlock). */
  get currentMusic() {
    return this._wantedMusic;
  }

  get volume() {
    return { ...this._volumes };
  }

  /**
   * Crossfade to a song ('menu'|'castle'|'meadow'|'galaxy'|'sundae'|'victory'), or stop with null.
   * Requesting the song that is already playing does nothing (tempo is kept).
   * Before unlock the request is remembered and starts on unlock.
   */
  playMusic(id) {
    if (id != null && !SONGS[id]) id = null;
    this._wantedMusic = id;
    if (!this.ctx) return;
    if (id === this._currentId && (id === null || this._seq)) return;
    const now = this.ctx.currentTime;
    const quick = id === 'victory';
    if (this._seq) {
      this._seq.stop(now, quick ? 0.25 : 0.8);
      this._fading.push(this._seq);
      this._seq = null;
    }
    this._currentId = id;
    this._tempo = 1;
    if (id === null) return;
    try {
      const song = getCompiledSong(SONGS, id);
      this._seq = new Sequencer(this._core, song, { output: this._musicBus, tempo: 1 });
      this._seq.start(now + (quick ? 0.05 : 0.12), quick ? 0.05 : 0.6);
      this._seq.scheduleUntil(now + LOOKAHEAD);
    } catch {
      this._seq = null;
    }
  }

  /** Speed the music up/down (e.g. 1.15 on the final lap). Reset by switching songs. */
  setMusicTempo(mult) {
    const m = Number(mult);
    this._tempo = Number.isFinite(m) ? Math.max(0.5, Math.min(2, m)) : 1;
    if (this._seq) this._seq.setTempo(this._tempo);
  }

  /**
   * Play a sound effect.
   * @param {string} name see SFX_NAMES
   * @param {{volume?:number, pitch?:number, pan?:number, level?:number, n?:number}} [opts]
   */
  sfx(name, opts = {}) {
    if (!this._ready()) return;
    const recipe = SFX[name];
    if (!recipe) return;
    const now = this.ctx.currentTime;
    const gap = SFX_THROTTLE[name];
    if (gap) {
      const last = this._lastPlayed.get(name);
      if (last != null && now - last < gap) return;
      this._lastPlayed.set(name, now);
    }
    const o = {
      pitch: Number.isFinite(opts.pitch) && opts.pitch > 0 ? opts.pitch : 1,
      pan: Number.isFinite(opts.pan) ? Math.max(-1, Math.min(1, opts.pan)) : 0,
      level: opts.level,
      n: opts.n,
    };
    const volume = Number.isFinite(opts.volume) ? Math.max(0, Math.min(1.5, opts.volume)) : 1;
    try {
      const { out, wet } = this._makeVoiceBus(volume, now, 4);
      recipe({ ctx: this.ctx, noise: this._noise, out, wet }, now + 0.005, o);
    } catch { /* never let a sound break the game */ }
  }

  /**
   * Cute synthesized babble for a character.
   * @param {{id?:string, voice?:{pitch:number, style:string}}} charDef
   * @param {'select'|'yay'|'oops'|'win'} kind
   * @param {{volume?:number, pan?:number}} [opts]
   */
  voice(charDef, kind = 'select', opts = {}) {
    if (!this._ready()) return;
    const now = this.ctx.currentTime;
    // One babble per character at a time is plenty.
    const key = `voice:${charDef && charDef.id}`;
    const last = this._lastPlayed.get(key);
    if (last != null && now - last < 0.35) return;
    this._lastPlayed.set(key, now);
    try {
      const utt = buildUtterance((charDef && charDef.voice) || {}, kind, voiceSeed(charDef, kind, this._voiceCounter++));
      const volume = Number.isFinite(opts.volume) ? Math.max(0, Math.min(1.5, opts.volume)) : 1;
      const { out } = this._makeVoiceBus(1, now, utt.duration + 1);
      playUtterance({ ctx: this.ctx, noise: this._noise }, out, utt, now + 0.01, { volume, pan: opts.pan || 0 });
    } catch { /* ignore */ }
  }

  /**
   * Low-level access for custom sounds that outlive a one-shot (an engine hum,
   * a star-power loop): { ctx, noise, out: SFX bus input, wet: SFX reverb send },
   * or null before the first unlock (and in node tests). Connect your own nodes
   * to `out` (they follow the SFX volume) and stop/disconnect them yourself.
   */
  sfxCore() {
    if (!this._ready()) return null;
    return { ctx: this.ctx, noise: this._noise, out: this._sfxBus, wet: this._sfxReverbSend };
  }

  /** @param {{music?: number, sfx?: number}} v 0..1 each */
  setVolume({ music, sfx } = {}) {
    if (music != null) this._volumes.music = clamp01(music);
    if (sfx != null) this._volumes.sfx = clamp01(sfx);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._musicBus.gain.setTargetAtTime(this._musicLevel(), t, 0.05);
    this._sfxBus.gain.setTargetAtTime(this._sfxLevel(), t, 0.05);
  }

  /** Stop music & timers and close the context. */
  dispose() {
    this._removeGestureListeners();
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._onVisibility && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
    for (const s of [this._seq, ...this._fading]) if (s) s.dispose();
    this._seq = null;
    this._fading = [];
    if (this.ctx && typeof this.ctx.close === 'function') {
      try { const p = this.ctx.close(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ }
    }
    this.ctx = null;
    this._currentId = null;
  }

  /**
   * Advance the music scheduler manually. Normally driven by an internal timer;
   * useful with an OfflineAudioContext: `am.tick(untilSeconds)`.
   */
  tick(until) {
    if (!this.ctx) return;
    const horizon = until ?? this.ctx.currentTime + LOOKAHEAD;
    if (this._seq) this._seq.scheduleUntil(horizon);
    if (this._fading.length) {
      for (const s of this._fading) s.scheduleUntil(horizon);
      const keep = [];
      for (const s of this._fading) {
        if (s.done) s.dispose();
        else keep.push(s);
      }
      this._fading = keep;
    }
  }

  // ---------------------------------------------------------------- private

  _musicLevel() {
    return 0.55 * this._volumes.music * this._volumes.music;
  }

  _sfxLevel() {
    return 0.8 * this._volumes.sfx * this._volumes.sfx;
  }

  _ready() {
    return !!this.ctx && this.ctx.state !== 'closed';
  }

  _hidden() {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  _removeGestureListeners() {
    if (!this._gestureHandler || typeof document === 'undefined') return;
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) {
      document.removeEventListener(ev, this._gestureHandler, { capture: true });
    }
    this._gestureHandler = null;
  }

  /** Per-sound gain feeding the SFX bus (and reverb), auto-disconnected later. */
  _makeVoiceBus(volume, now, lifetime) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(this._sfxBus);
    const wet = ctx.createGain();
    wet.gain.value = volume * 0.5;
    wet.connect(this._sfxReverbSend);
    if (typeof setTimeout === 'function' && this._startTimer) {
      setTimeout(() => {
        try { out.disconnect(); wet.disconnect(); } catch { /* ignore */ }
      }, (lifetime + 1.5) * 1000);
    }
    return { out, wet };
  }

  _init() {
    if (this._failed) return false;
    let ctx = null;
    try {
      ctx = this._createContext();
    } catch {
      ctx = null;
    }
    if (!ctx) {
      this._failed = true;
      return false;
    }
    try {
      this.ctx = ctx;
      // Master chain: gentle top-end roll-off, glue compressor, brickwall-ish limiter.
      const master = ctx.createGain();
      master.gain.value = 0.9;
      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 11000;
      soften.Q.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 12;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.006;
      comp.release.value = 0.25;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.12;
      const outGain = ctx.createGain();
      outGain.gain.value = 0.85;
      master.connect(soften);
      soften.connect(comp);
      comp.connect(limiter);
      limiter.connect(outGain);
      outGain.connect(ctx.destination);

      this._musicBus = ctx.createGain();
      this._musicBus.gain.value = this._musicLevel();
      this._musicBus.connect(master);
      this._sfxBus = ctx.createGain();
      this._sfxBus.gain.value = this._sfxLevel();
      this._sfxBus.connect(master);

      this._noise = createNoiseBuffer(ctx, 2);
      // Reverb returns feed their own bus, so volume sliders scale the tails too.
      const impulse = createImpulse(ctx, 1.8, 3.2);
      const makeReverb = (bus, level) => {
        const conv = ctx.createConvolver();
        conv.buffer = impulse;
        const ret = ctx.createGain();
        ret.gain.value = level;
        conv.connect(ret);
        ret.connect(bus);
        return conv;
      };
      this._sfxReverbSend = makeReverb(this._sfxBus, 0.5);
      this._core = { ctx, noise: this._noise, reverbIn: makeReverb(this._musicBus, 0.6) };
    } catch {
      this.ctx = null;
      this._failed = true;
      return false;
    }

    if (this._startTimer && typeof setInterval === 'function') {
      this._timer = setInterval(() => this.tick(), TICK_MS);
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      this._onVisibility = () => {
        if (!this.ctx) return;
        try {
          if (document.visibilityState === 'hidden') { if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
          else if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
        } catch { /* ignore */ }
      };
      document.addEventListener('visibilitychange', this._onVisibility);
    }
    if (this._wantedMusic) {
      const id = this._wantedMusic;
      this._currentId = null;
      this.playMusic(id);
    }
    return true;
  }
}
