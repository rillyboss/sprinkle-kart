/**
 * Driving sounds (OWNER: driving-feel workstream). Everything is soft, cute
 * and synthesized: putt-putt engines, "wheee" drift squeals, sparkly turbo
 * chimes, springy fence boings and friendly honks.
 *
 * Default export = SFX pack (merged into the SFX book by src/audio/sfx.js):
 *   one-shots   drive-rev, drive-rocket-sparkle, drive-brake-squeak, drive-reverse-beep,
 *               drive-hop, drive-drift-squeal, drive-land, drive-wall-boing, drive-honk,
 *               drive-pad-zing
 *   overrides   boost (whoosh; level BOOST_VARIANT.pad adds the pad zing, .start the Rocket Start sparkle),
 *               drift-spark (mini-turbo charge chime, rising per level),
 *               drift-boost (turbo release whoosh) — allowed by SFX_OWNERS.driving
 *
 * Named exports = continuous voices for src/systems/drivingSounds.js, built on
 * audio.sfxCore() ({ ctx, noise, out, wet }):
 *   createEngineVoice(core)  createSlideVoice(core)  createRustleVoice(core)
 * each -> { set(params, t), silence(t), stop() }.
 */
import { tone, noise } from '../synth.js';
import { midiToFreq } from '../theory.js';

const N = (m) => midiToFreq(m);
const lvl = (o) => Math.max(1, Math.min(3, (o.level | 0) || 1));

function both(core, fn) {
  fn(core.out, 1);
  if (core.wet) fn(core.wet, 0.45);
}

function twinkles(core, t, notes, { step = 0.05, vol = 0.06, pan = 0, pitch = 1, dur = 0.22 } = {}) {
  notes.forEach((m, i) => {
    both(core, (dest, k) => tone(core.ctx, dest, {
      t: t + i * step, freq: N(m) * pitch, dur, vol: vol * k, attack: 0.002, shape: 'perc', type: i % 2 ? 'sine' : 'triangle', pan,
    }));
  });
}

/** Mini-turbo charge chime notes per level (blue, pink, rainbow): each level climbs higher. */
export const CHARGE_CHIMES = Object.freeze([
  Object.freeze([]),
  Object.freeze([84, 88]),
  Object.freeze([88, 91, 96]),
  Object.freeze([91, 96, 100, 103]),
]);

/** Slide "sing" pitch (Hz) per drift level 0..3 — rises as the sparks change colour. */
export const SLIDE_PITCH = Object.freeze([620, 740, 880, 1046]);

/** `level` values of the driving 'boost' recipe: plain (item / default), boost pad, Rocket Start. */
export const BOOST_VARIANT = Object.freeze({ pad: 11, start: 12 });

function boostWhoosh(core, t, o) {
  noise(core.ctx, core.out, core.noise, { t, dur: 0.55, vol: 0.13, attack: 0.16, filter: { type: 'bandpass', freq: 300, freqEnd: 2500, time: 0.55, Q: 1.4 }, pan: o.pan });
  tone(core.ctx, core.out, { t, freq: 220 * o.pitch, freqEnd: 880 * o.pitch, glideTime: 0.4, dur: 0.45, vol: 0.09, type: 'triangle', attack: 0.02, release: 0.15, pan: o.pan });
}

export const recipes = {
  // ---- overrides (SFX_OWNERS.driving) ------------------------------------
  boost(core, t, o) {
    // The classic whoosh; boost pads add a bright "zing!", a Rocket Start a twinkly glissando.
    boostWhoosh(core, t, o);
    if (o.level === BOOST_VARIANT.pad) recipes['drive-pad-zing'](core, t, o);
    else if (o.level === BOOST_VARIANT.start) recipes['drive-rocket-sparkle'](core, t + 0.05, o);
    else twinkles(core, t + 0.1, [91, 96, 100], { step: 0.07, vol: 0.045, pan: o.pan });
  },

  'drift-spark'(core, t, o) {
    // Mini-turbo charged: a rising little bell run, higher and longer per level.
    const level = lvl(o);
    twinkles(core, t, CHARGE_CHIMES[level], { step: 0.045, vol: 0.075, pan: o.pan, pitch: o.pitch });
    noise(core.ctx, core.out, core.noise, { t, dur: 0.05, vol: 0.02, filter: { type: 'highpass', freq: 7000 }, pan: o.pan });
  },

  'drift-boost'(core, t, o) {
    // Turbo release: soft whoosh + rising glide, sparkles for pink / rainbow.
    const level = lvl(o);
    noise(core.ctx, core.out, core.noise, {
      t, dur: 0.32 + level * 0.1, vol: 0.1, attack: 0.08,
      filter: { type: 'bandpass', freq: 500, freqEnd: 1800 + level * 700, time: 0.35 + level * 0.1, Q: 1.3 }, pan: o.pan,
    });
    const top = [0, 79, 84, 91][level];
    tone(core.ctx, core.out, { t, freq: N(top - 12), freqEnd: N(top), glideTime: 0.22, dur: 0.3, vol: 0.1, type: 'triangle', attack: 0.01, release: 0.12, pan: o.pan });
    if (level >= 2) twinkles(core, t + 0.12, level === 3 ? [96, 100, 103, 108] : [91, 96], { step: 0.05, vol: 0.05, pan: o.pan });
  },

  // ---- new one-shots ------------------------------------------------------
  'drive-rev'(core, t, o) {
    // GO! A happy little "vrrrm" rev: putt-putt that speeds up and climbs.
    const p = o.pitch;
    tone(core.ctx, core.out, {
      t, freq: 85 * p, freqEnd: 240 * p, glideTime: 0.55, dur: 0.6, vol: 0.09, type: 'triangle', attack: 0.02, release: 0.18,
      vibrato: { rate: 18, depth: 0.08 }, filter: { type: 'lowpass', freq: 700, freqEnd: 2200, time: 0.5, Q: 2 }, pan: o.pan,
    });
    tone(core.ctx, core.out, { t: t + 0.05, freq: 170 * p, freqEnd: 480 * p, glideTime: 0.5, dur: 0.5, vol: 0.03, attack: 0.02, release: 0.15, pan: o.pan });
  },

  'drive-rocket-sparkle'(core, t, o) {
    // Rocket Start: a quick twinkly glissando on top of the boost whoosh.
    twinkles(core, t, [84, 88, 91, 96, 100, 103], { step: 0.035, vol: 0.06, pan: o.pan, pitch: o.pitch, dur: 0.3 });
    tone(core.ctx, core.wet || core.out, { t: t + 0.2, freq: N(108), dur: 0.5, vol: 0.03, attack: 0.002, shape: 'perc', pan: o.pan });
  },

  'drive-brake-squeak'(core, t, o) {
    // Tiny cartoon "eek!" — two soft squeaks, never harsh.
    [0, 0.07].forEach((dt, i) => tone(core.ctx, core.out, {
      t: t + dt, freq: (1500 - i * 180) * o.pitch, freqEnd: (1250 - i * 180) * o.pitch, glideTime: 0.07, dur: 0.07,
      vol: 0.035, attack: 0.004, shape: 'perc', vibrato: { rate: 30, depth: 0.02 }, pan: o.pan,
    }));
  },

  'drive-reverse-beep'(core, t, o) {
    // "beep-beep" like a friendly little truck backing up.
    [0, 0.14].forEach((dt) => tone(core.ctx, core.out, {
      t: t + dt, freq: 988 * o.pitch, dur: 0.075, vol: 0.04, type: 'triangle', attack: 0.004, release: 0.03, pan: o.pan,
    }));
  },

  'drive-hop'(core, t, o) {
    tone(core.ctx, core.out, { t, freq: 380 * o.pitch, freqEnd: 720 * o.pitch, glideTime: 0.08, dur: 0.09, vol: 0.05, type: 'triangle', attack: 0.003, shape: 'perc', pan: o.pan });
  },

  'drive-drift-squeal'(core, t, o) {
    // A cute rising "wheee!" as the slide begins (sine, gentle vibrato).
    tone(core.ctx, core.out, {
      t, freq: 820 * o.pitch, freqEnd: 1180 * o.pitch, glideTime: 0.22, dur: 0.26, vol: 0.045, attack: 0.03, release: 0.1,
      vibrato: { rate: 11, depth: 0.025 }, pan: o.pan,
    });
    noise(core.ctx, core.out, core.noise, { t, dur: 0.18, vol: 0.025, attack: 0.03, filter: { type: 'bandpass', freq: 2600, Q: 3 }, pan: o.pan });
  },

  'drive-land'(core, t, o) {
    // Soft "pomf" landing thump.
    const v = Math.min(1.2, Math.max(0.3, Number.isFinite(o.level) ? o.level : 0.6));
    tone(core.ctx, core.out, { t, freq: 150, freqEnd: 70, glideTime: 0.1, dur: 0.12, vol: 0.12 * v, attack: 0.003, shape: 'perc', pan: o.pan });
    noise(core.ctx, core.out, core.noise, { t, dur: 0.08, vol: 0.04 * v, filter: { type: 'lowpass', freq: 900 }, pan: o.pan });
  },

  'drive-wall-boing'(core, t, o) {
    // Springy fence "boi-oing" (the fences are made of candy, after all).
    tone(core.ctx, core.out, {
      t, freq: 240 * o.pitch, freqEnd: 520 * o.pitch, glideTime: 0.09, dur: 0.32, vol: 0.09, type: 'triangle', attack: 0.004, release: 0.1,
      vibrato: { rate: 16, depth: 0.07 }, pan: o.pan,
    });
    tone(core.ctx, core.out, { t, freq: 120, freqEnd: 70, glideTime: 0.06, dur: 0.08, vol: 0.07, attack: 0.002, shape: 'perc', pan: o.pan });
  },

  'drive-honk'(core, t, o) {
    // Friendly "meep-meep!" bicycle-horn honk when karts bump.
    [0, 0.12].forEach((dt, i) => tone(core.ctx, core.out, {
      t: t + dt, freq: (i ? 660 : 587) * o.pitch, dur: 0.09, vol: 0.05, type: 'square', attack: 0.006, release: 0.04,
      filter: { type: 'lowpass', freq: 1800, Q: 1 }, pan: o.pan,
    }));
  },

  'drive-pad-zing'(core, t, o) {
    // Boost pad: a bright "zing!" sweep with a sparkle on top.
    tone(core.ctx, core.out, { t, freq: 520 * o.pitch, freqEnd: 2100 * o.pitch, glideTime: 0.14, dur: 0.18, vol: 0.06, type: 'triangle', attack: 0.004, release: 0.06, pan: o.pan });
    twinkles(core, t + 0.08, [96, 100], { step: 0.04, vol: 0.04, pan: o.pan });
  },
};

export default {
  override: true,
  recipes,
  throttle: {
    'drive-brake-squeak': 0.25,
    'drive-reverse-beep': 0.2,
    'drive-land': 0.08,
    'drive-wall-boing': 0.18,
    'drive-honk': 0.3,
    'drive-pad-zing': 0.15,
    'drive-drift-squeal': 0.12,
    'drive-hop': 0.06,
    'drive-rev': 0.1,
  },
};

// ============================================================ continuous voices

const TC = 0.06; // smoothing time constant for parameter changes (seconds)

function setP(param, v, t, tc = TC) {
  if (!param || !Number.isFinite(v)) return;
  param.setTargetAtTime(v, t, tc);
}

function makePanner(ctx, dest) {
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.connect(dest);
    return p;
  }
  return null;
}

function voice(core, build) {
  const { ctx } = core;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, ctx.currentTime);
  const panner = makePanner(ctx, core.out);
  out.connect(panner || core.out);
  const sources = [];
  const extra = build(ctx, out, sources);
  const t0 = ctx.currentTime;
  for (const s of sources) s.start(t0);
  let stopped = false;
  return {
    out, panner, sources, ...extra,
    silence(t = ctx.currentTime) { setP(out.gain, 0, t, 0.05); },
    stop() {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      try { out.gain.setTargetAtTime(0, t, 0.03); } catch { /* ignore */ }
      for (const s of sources) { try { s.stop(t + 0.15); } catch { /* ignore */ } }
      try { out.disconnect(); } catch { /* ignore */ }
      try { panner?.disconnect(); } catch { /* ignore */ }
    },
    get stopped() { return stopped; },
  };
}

function loopNoise(ctx, buffer, sources) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  sources.push(src);
  return src;
}

/**
 * Cute engine: triangle + soft octave sine through a low-pass, with an
 * amplitude "putt-putt" LFO that blurs into a whirr at speed.
 * set({ freq, gain, putt, depth, cutoff, pan }, t)
 */
export function createEngineVoice(core) {
  return voice(core, (ctx, out, sources) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(160, ctx.currentTime);
    const o2g = ctx.createGain();
    o2g.gain.setValueAtTime(0.35, ctx.currentTime);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(600, ctx.currentTime);
    filt.Q.value = 0.8;
    const am = ctx.createGain();
    am.gain.setValueAtTime(0.7, ctx.currentTime);
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(8, ctx.currentTime);
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.setValueAtTime(0.3, ctx.currentTime);
    lfo.connect(lfoDepth);
    lfoDepth.connect(am.gain);
    osc.connect(filt);
    osc2.connect(o2g);
    o2g.connect(filt);
    filt.connect(am);
    am.connect(out);
    sources.push(osc, osc2, lfo);
    return {
      set(p, t = ctx.currentTime) {
        setP(osc.frequency, p.freq, t);
        setP(osc2.frequency, p.freq * 2.01, t);
        setP(filt.frequency, p.cutoff, t);
        setP(lfo.frequency, p.putt, t);
        const depth = Math.max(0, Math.min(0.5, p.depth ?? 0.3));
        setP(lfoDepth.gain, depth, t);
        setP(am.gain, 1 - depth, t);
        setP(out.gain, p.gain, t, 0.08);
        if (this.panner && Number.isFinite(p.pan)) setP(this.panner.pan, p.pan, t);
      },
    };
  });
}

/**
 * Drift slide: soft band-passed tyre hiss plus a quiet "sing" whose pitch
 * rises with the drift level. set({ gain, sing, hiss, pan }, t)
 */
export function createSlideVoice(core) {
  return voice(core, (ctx, out, sources) => {
    const src = loopNoise(ctx, core.noise, sources);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, ctx.currentTime);
    bp.Q.value = 2.2;
    const hissG = ctx.createGain();
    hissG.gain.setValueAtTime(0.5, ctx.currentTime);
    src.connect(bp);
    bp.connect(hissG);
    hissG.connect(out);
    const sing = ctx.createOscillator();
    sing.type = 'sine';
    sing.frequency.setValueAtTime(SLIDE_PITCH[0], ctx.currentTime);
    const wob = ctx.createOscillator();
    wob.frequency.setValueAtTime(6, ctx.currentTime);
    const wobG = ctx.createGain();
    wobG.gain.setValueAtTime(12, ctx.currentTime);
    wob.connect(wobG);
    wobG.connect(sing.frequency);
    const singG = ctx.createGain();
    singG.gain.setValueAtTime(0.35, ctx.currentTime);
    sing.connect(singG);
    singG.connect(out);
    sources.push(sing, wob);
    return {
      set(p, t = ctx.currentTime) {
        setP(sing.frequency, p.sing, t, 0.08);
        setP(bp.frequency, p.hiss, t, 0.08);
        setP(out.gain, p.gain, t, 0.05);
        if (this.panner && Number.isFinite(p.pan)) setP(this.panner.pan, p.pan, t);
      },
    };
  });
}

/**
 * Off-road rustle / squish: filtered noise with a flutter LFO, voiced per
 * surface. set({ gain, freq, q, flutter, pan }, t)
 */
export function createRustleVoice(core) {
  return voice(core, (ctx, out, sources) => {
    const src = loopNoise(ctx, core.noise, sources);
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.setValueAtTime(900, ctx.currentTime);
    filt.Q.value = 1.2;
    const am = ctx.createGain();
    am.gain.setValueAtTime(0.6, ctx.currentTime);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(11, ctx.currentTime);
    const lfoG = ctx.createGain();
    lfoG.gain.setValueAtTime(0.4, ctx.currentTime);
    lfo.connect(lfoG);
    lfoG.connect(am.gain);
    src.connect(filt);
    filt.connect(am);
    am.connect(out);
    sources.push(lfo);
    return {
      set(p, t = ctx.currentTime) {
        setP(filt.frequency, p.freq, t, 0.1);
        if (Number.isFinite(p.q)) setP(filt.Q, p.q, t, 0.1);
        setP(lfo.frequency, p.flutter, t, 0.1);
        setP(out.gain, p.gain, t, 0.06);
        if (this.panner && Number.isFinite(p.pan)) setP(this.panner.pan, p.pan, t);
      },
    };
  });
}
