/**
 * Cute character voices: gibberish babble / giggles / "yay!" made from a
 * buzzy source through three formant band-pass filters that glide between
 * vowels. `buildUtterance` is pure (testable); `playUtterance` renders it.
 */
import { makeRng, hashString } from './theory.js';

/** Formant frequencies (F1, F2, F3) in Hz — slightly "small person" flavoured. */
export const VOWELS = {
  a: [820, 1250, 2700],
  e: [520, 1950, 2750],
  i: [330, 2500, 3200],
  o: [500, 880, 2500],
  u: [360, 820, 2400],
  uh: [650, 1250, 2600],
  m: [280, 1050, 2400],
};

export const VOICE_KINDS = ['select', 'yay', 'oops', 'win'];
export const VOICE_STYLES = ['giggle', 'hoho', 'yay', 'boing', 'hum'];

// Syllable shorthand: [fromVowel, toVowel, duration s, f0 start mult, f0 end mult, consonant, amp]
const S = (from, to, d, p0, p1, c = null, a = 1) => ({ from, to, d, p0, p1, c, a });

const HEE = (p = 1.4) => S('i', 'i', 0.085, p, p * 0.93, 'h', 0.8);
const HO = (p = 0.95) => S('o', 'o', 0.13, p, p * 0.9, 'h', 0.9);

const TEMPLATES = {
  select: {
    giggle: [HEE(1.3), HEE(1.42), S('i', 'e', 0.14, 1.55, 1.4, 'h', 0.85)],
    hoho: [HO(0.95), S('o', 'u', 0.22, 1.0, 0.82, 'h')],
    yay: [S('a', 'i', 0.13, 1.0, 1.15, 'h'), S('i', 'a', 0.24, 1.3, 1.12)],
    boing: [S('o', 'i', 0.17, 0.85, 1.55, 'b'), S('o', 'i', 0.22, 1.6, 0.95)],
    hum: [S('m', 'm', 0.15, 1.0, 1.1, null, 0.8), S('m', 'uh', 0.24, 1.2, 0.95, 'h', 0.85)],
  },
  yay: {
    giggle: [S('i', 'a', 0.12, 1.1, 1.3), S('a', 'e', 0.3, 1.4, 1.6), HEE(1.6), HEE(1.7)],
    hoho: [S('u', 'a', 0.14, 0.9, 1.1), S('o', 'u', 0.32, 1.2, 1.0, 'h')],
    yay: [S('i', 'a', 0.12, 1.0, 1.25), S('a', 'e', 0.42, 1.35, 1.6)],
    boing: [S('i', 'a', 0.12, 0.9, 1.3), S('a', 'e', 0.4, 1.9, 1.2)],
    hum: [S('m', 'm', 0.1, 1.0, 1.05, null, 0.7), S('i', 'a', 0.1, 1.1, 1.25), S('a', 'e', 0.34, 1.35, 1.5)],
  },
  oops: {
    giggle: [S('uh', 'uh', 0.13, 1.25, 1.2), S('o', 'u', 0.22, 1.0, 0.85), HEE(1.3), HEE(1.35)],
    hoho: [S('uh', 'uh', 0.15, 1.05, 1.0), S('o', 'u', 0.32, 0.9, 0.72)],
    yay: [S('uh', 'uh', 0.13, 1.2, 1.15), S('o', 'u', 0.3, 1.0, 0.82)],
    boing: [S('u', 'o', 0.16, 1.3, 0.9, null), S('a', 'o', 0.32, 1.2, 0.7)],
    hum: [S('m', 'm', 0.14, 1.15, 1.1, null, 0.8), S('m', 'm', 0.26, 0.95, 0.8, null, 0.8)],
  },
  win: {
    giggle: [S('u', 'u', 0.15, 1.1, 1.4), S('u', 'u', 0.28, 1.5, 1.7, 'h'), HEE(1.6), HEE(1.7), HEE(1.8)],
    hoho: [S('u', 'u', 0.16, 0.95, 1.2), S('u', 'u', 0.28, 1.25, 1.35, 'h'), HO(1.0), HO(0.95), HO(0.9)],
    yay: [S('u', 'u', 0.15, 1.1, 1.4), S('u', 'u', 0.28, 1.5, 1.7, 'h'), S('i', 'a', 0.12, 1.2, 1.4), S('a', 'e', 0.42, 1.5, 1.75)],
    boing: [S('u', 'u', 0.15, 1.0, 1.4), S('u', 'u', 0.28, 1.5, 1.7, 'h'), S('o', 'i', 0.16, 0.9, 1.8, 'b'), S('o', 'i', 0.3, 1.8, 1.0)],
    hum: [S('u', 'u', 0.15, 1.05, 1.3), S('u', 'u', 0.26, 1.4, 1.6, 'h'), S('m', 'm', 0.12, 1.3, 1.25, null, 0.8), S('m', 'm', 0.12, 1.4, 1.35, 'h', 0.8), S('m', 'm', 0.2, 1.5, 1.3, 'h', 0.8)],
  },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Build a (deterministic for a given seed) utterance description.
 * @param {{pitch?:number, style?:string}} voice charDef.voice
 * @param {'select'|'yay'|'oops'|'win'} kind
 * @param {number} [seed]
 */
export function buildUtterance(voice = {}, kind = 'select', seed = 1) {
  const pitch = clamp(Number(voice.pitch) || 1, 0.5, 2);
  const style = VOICE_STYLES.includes(voice.style) ? voice.style : 'yay';
  const table = TEMPLATES[kind] || TEMPLATES.select;
  const template = table[style];
  const rand = makeRng(seed);
  const f0Base = 250 * pitch;
  const formantScale = clamp(1 + (pitch - 1) * 0.22, 0.85, 1.3);
  const tempo = clamp(1.15 - (pitch - 1) * 0.15, 0.9, 1.3); // low voices talk a bit slower
  const jitter = 0.95 + rand() * 0.1;

  let t = 0;
  const syllables = template.map((s) => {
    const dur = s.d * tempo * (0.9 + rand() * 0.2);
    const f0Start = clamp(f0Base * s.p0 * jitter, 80, 1100);
    const f0End = clamp(f0Base * s.p1 * jitter, 80, 1100);
    const syl = {
      t,
      dur,
      f0Start,
      f0End,
      from: VOWELS[s.from].map((f) => f * formantScale),
      to: VOWELS[s.to].map((f) => f * formantScale),
      amp: s.a,
      consonant: s.c,
    };
    t += dur + 0.03 + rand() * 0.02;
    return syl;
  });
  return {
    style,
    kind,
    syllables,
    duration: t,
    wobble: style === 'boing' ? 0.05 : style === 'giggle' ? 0.02 : 0.012,
    wobbleRate: style === 'boing' ? 9 : 6,
  };
}

/** Seed from character id so each character sounds consistent-but-varied. */
export function voiceSeed(charDef, kind, counter = 0) {
  return hashString(`${charDef && charDef.id ? charDef.id : 'kart'}:${kind}:${counter}`);
}

/**
 * Render an utterance into `dest` at time `t`.
 * @param {{ctx: BaseAudioContext, noise: AudioBuffer}} core
 */
export function playUtterance(core, dest, utt, t, { volume = 1, pan = 0 } = {}) {
  const { ctx } = core;
  if (!utt.syllables.length) return t;
  const end = t + utt.duration + 0.1;
  const first = utt.syllables[0];

  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  const body = ctx.createOscillator(); // sine at f0 for roundness
  body.type = 'sine';

  const lfo = ctx.createOscillator();
  lfo.frequency.setValueAtTime(utt.wobbleRate, t);
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.setValueAtTime(first.f0Start * utt.wobble, t);
  lfo.connect(lfoAmt);
  lfoAmt.connect(src.frequency);
  lfoAmt.connect(body.frequency);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, t);
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.18;
  body.connect(bodyGain);
  bodyGain.connect(amp);

  const formantGains = [1.0, 0.75, 0.32];
  const filters = formantGains.map((g, i) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = [6, 11, 14][i];
    bp.frequency.setValueAtTime(first.from[i], t);
    const fg = ctx.createGain();
    fg.gain.value = g * 2.2;
    src.connect(bp);
    bp.connect(fg);
    fg.connect(amp);
    return bp;
  });

  const soften = ctx.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 4800;
  amp.connect(soften);
  let out = soften;
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    soften.connect(p);
    out = p;
  }
  out.connect(dest);

  const vol = 0.24 * clamp(volume, 0, 1.5);
  for (const s of utt.syllables) {
    const st = t + s.t;
    const att = Math.min(0.025, s.dur * 0.25);
    const rel = Math.min(0.05, s.dur * 0.3);
    for (const osc of [src, body]) {
      osc.frequency.setValueAtTime(s.f0Start, st);
      osc.frequency.exponentialRampToValueAtTime(s.f0End, st + s.dur);
    }
    filters.forEach((bp, i) => {
      bp.frequency.setValueAtTime(s.from[i], st);
      bp.frequency.linearRampToValueAtTime(s.to[i], st + s.dur);
    });
    const a = vol * s.amp;
    amp.gain.setValueAtTime(0, st);
    amp.gain.linearRampToValueAtTime(a, st + att);
    amp.gain.linearRampToValueAtTime(a * 0.85, st + s.dur - rel);
    amp.gain.linearRampToValueAtTime(0, st + s.dur);

    if (s.consonant === 'h') consonant(core, dest, st - 0.02, 0.05, vol * 0.25, 'bandpass', 2200, pan);
    else if (s.consonant === 't') consonant(core, dest, st - 0.01, 0.02, vol * 0.3, 'highpass', 4000, pan);
    else if (s.consonant === 'b') {
      const th = ctx.createOscillator();
      th.frequency.setValueAtTime(s.f0Start * 0.6, st);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(vol * 0.4, st + 0.005);
      g.gain.linearRampToValueAtTime(0, st + 0.035);
      th.connect(g);
      g.connect(dest);
      th.start(st);
      th.stop(st + 0.05);
    }
  }

  for (const osc of [src, body, lfo]) {
    osc.start(t);
    osc.stop(end);
  }
  return end;
}

function consonant(core, dest, t, dur, vol, type, freq, pan) {
  const { ctx } = core;
  const n = ctx.createBufferSource();
  n.buffer = core.noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  const tt = Math.max(ctx.currentTime, t);
  g.gain.setValueAtTime(0, tt);
  g.gain.linearRampToValueAtTime(vol, tt + dur * 0.3);
  g.gain.linearRampToValueAtTime(0, tt + dur);
  n.connect(f);
  f.connect(g);
  if (pan && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    g.connect(p);
    p.connect(dest);
  } else g.connect(dest);
  n.start(tt, Math.random() * 0.5);
  n.stop(tt + dur + 0.02);
}
