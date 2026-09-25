/**
 * Sound effects — sparkly, boingy, cute. Every recipe is synthesized.
 * Recipe signature: (core, t, opts) where core = { ctx, noise, out, wet }
 *   out: dry SFX bus, wet: reverb send for sparkle tails.
 * opts: { pitch (mult, default 1), volume (0..1), pan (-1..1), level, n }
 */
import { tone, noise, semi } from './synth.js';
import { midiToFreq } from './theory.js';

/** Minimum seconds between two plays of the same effect (stops spammy stacking). */
export const SFX_THROTTLE = {
  move: 0.035,
  bump: 0.15,
  'drift-spark': 0.09,
  'item-roulette': 0.8,
  boost: 0.12,
  bonk: 0.2,
  bubble: 0.15,
  cheer: 0.6,
};

const N = (m) => midiToFreq(m);

function both(core, fn) {
  // Play into the dry bus and a quieter copy into the reverb.
  fn(core.out, 1);
  if (core.wet) fn(core.wet, 0.5);
}

function arpeggio(core, t, notes, { step = 0.07, vol = 0.22, dur = 0.5, type = 'sine', pan = 0, pitch = 1, bell = true } = {}) {
  notes.forEach((m, i) => {
    const f = N(m) * pitch;
    const tt = t + i * step;
    both(core, (dest, k) => {
      tone(core.ctx, dest, { t: tt, freq: f, dur, vol: vol * k, attack: 0.003, shape: 'perc', type, pan });
      if (bell) tone(core.ctx, dest, { t: tt, freq: f * 2.76, dur: dur * 0.3, vol: vol * 0.15 * k, attack: 0.002, shape: 'perc', pan });
    });
  });
  return t + notes.length * step + dur;
}

function sparkles(core, t, count, { spread = 0.4, low = 84, high = 100, vol = 0.07, pan = 0, pitch = 1 } = {}) {
  // Deterministic-ish twinkles across a pentatonic set.
  const penta = [0, 2, 4, 7, 9];
  for (let i = 0; i < count; i++) {
    const oct = Math.floor(((i * 7) % 3));
    const m = Math.min(high, low + penta[(i * 3) % 5] + oct * 12);
    const tt = t + (i / Math.max(1, count - 1)) * spread + ((i * 37) % 10) * 0.004;
    both(core, (dest, k) => tone(core.ctx, dest, { t: tt, freq: N(m) * pitch, dur: 0.18, vol: vol * k, attack: 0.002, shape: 'perc', pan: pan + ((i % 3) - 1) * 0.3 }));
  }
}

function whoosh(core, t, { dur = 0.5, from = 400, to = 3000, vol = 0.12, pan = 0 } = {}) {
  noise(core.ctx, core.out, core.noise, { t, dur, vol, attack: dur * 0.3, filter: { type: 'bandpass', freq: from, freqEnd: to, time: dur, Q: 1.4 }, pan });
}

export const SFX = {
  move(core, t, o) {
    tone(core.ctx, core.out, { t, freq: 1175 * o.pitch, freqEnd: 1480 * o.pitch, glideTime: 0.04, dur: 0.06, vol: 0.09, attack: 0.002, shape: 'perc', pan: o.pan });
  },

  confirm(core, t, o) {
    arpeggio(core, t, [84, 88, 91], { step: 0.055, vol: 0.18, dur: 0.35, pan: o.pan, pitch: o.pitch });
  },

  back(core, t, o) {
    [76, 72].forEach((m, i) => tone(core.ctx, core.out, { t: t + i * 0.07, freq: N(m) * o.pitch, dur: 0.14, vol: 0.14, type: 'triangle', attack: 0.004, shape: 'perc', pan: o.pan }));
  },

  join(core, t, o) {
    // "bloop" up + happy ding
    tone(core.ctx, core.out, { t, freq: 300 * o.pitch, freqEnd: 900 * o.pitch, glideTime: 0.12, dur: 0.14, vol: 0.18, type: 'triangle', attack: 0.005, release: 0.05, pan: o.pan });
    arpeggio(core, t + 0.1, [84, 91, 96], { step: 0.06, vol: 0.16, dur: 0.4, pan: o.pan, pitch: o.pitch });
  },

  countdown(core, t, o) {
    // Soft bell "bong" — pitch rises a little as the count gets closer to GO.
    const n = o.n || 3;
    const m = 79 + (3 - n) * 2;
    both(core, (dest, k) => {
      tone(core.ctx, dest, { t, freq: N(m), dur: 0.6, vol: 0.24 * k, attack: 0.003, shape: 'perc', pan: o.pan });
      tone(core.ctx, dest, { t, freq: N(m) * 2, dur: 0.3, vol: 0.06 * k, attack: 0.003, shape: 'perc', pan: o.pan });
    });
  },

  go(core, t, o) {
    [84, 88, 91, 96].forEach((m) => {
      both(core, (dest, k) => {
        tone(core.ctx, dest, { t, freq: N(m), dur: 0.7, vol: 0.1 * k, attack: 0.004, shape: 'perc', type: 'triangle', pan: o.pan });
      });
    });
    tone(core.ctx, core.out, { t, freq: N(72), freqEnd: N(84), glideTime: 0.15, dur: 0.35, vol: 0.12, type: 'triangle', attack: 0.01, release: 0.2, vibrato: { rate: 7, depth: 0.01, delay: 0.1 } });
    sparkles(core, t + 0.05, 8, { spread: 0.5 });
  },

  'item-roulette'(core, t, o) {
    // ~0.8 s of quick rising "tick-tick-tick" twinkles
    const scale = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];
    for (let i = 0; i < 11; i++) {
      tone(core.ctx, core.out, { t: t + i * 0.07, freq: N(scale[i]) * o.pitch, dur: 0.06, vol: 0.09, attack: 0.002, shape: 'perc', type: 'triangle', pan: o.pan });
    }
  },

  'item-get'(core, t, o) {
    arpeggio(core, t, [79, 84, 88, 91, 96], { step: 0.045, vol: 0.16, dur: 0.45, pan: o.pan, pitch: o.pitch });
    sparkles(core, t + 0.15, 5, { spread: 0.3, pan: o.pan });
  },

  boost(core, t, o) {
    whoosh(core, t, { dur: 0.55, from: 300, to: 2500, vol: 0.14, pan: o.pan });
    tone(core.ctx, core.out, { t, freq: 220 * o.pitch, freqEnd: 880 * o.pitch, glideTime: 0.4, dur: 0.45, vol: 0.1, type: 'triangle', attack: 0.02, release: 0.15, pan: o.pan });
    sparkles(core, t + 0.1, 5, { spread: 0.35, vol: 0.05, pan: o.pan });
  },

  bonk(core, t, o) {
    // Cartoon "boi-oi-oing": wobbly descending spring + soft thud.
    tone(core.ctx, core.out, {
      t, freq: 620 * o.pitch, freqEnd: 180 * o.pitch, glideTime: 0.6, dur: 0.6, vol: 0.2, type: 'triangle', attack: 0.004, release: 0.1,
      vibrato: { rate: 13, depth: 0.09 }, pan: o.pan,
    });
    tone(core.ctx, core.out, { t, freq: 140, freqEnd: 60, glideTime: 0.1, dur: 0.14, vol: 0.2, attack: 0.002, shape: 'perc', pan: o.pan });
    sparkles(core, t + 0.2, 3, { spread: 0.3, low: 88, vol: 0.04, pan: o.pan });
  },

  bump(core, t, o) {
    // Rubbery "bup!"
    tone(core.ctx, core.out, { t, freq: 260 * o.pitch, freqEnd: 150 * o.pitch, glideTime: 0.08, dur: 0.1, vol: 0.18, type: 'triangle', attack: 0.003, shape: 'perc', pan: o.pan });
    tone(core.ctx, core.out, { t, freq: 520 * o.pitch, freqEnd: 300 * o.pitch, glideTime: 0.06, dur: 0.06, vol: 0.05, attack: 0.002, shape: 'perc', pan: o.pan });
  },

  lap(core, t, o) {
    arpeggio(core, t, [84, 88, 91], { step: 0.09, vol: 0.2, dur: 0.5, pan: o.pan, pitch: o.pitch });
  },

  'final-lap'(core, t, o) {
    arpeggio(core, t, [79, 79, 79, 84, 88, 91, 96], { step: 0.09, vol: 0.17, dur: 0.45, pan: o.pan, pitch: o.pitch, type: 'triangle' });
    sparkles(core, t + 0.6, 6, { spread: 0.4, pan: o.pan });
  },

  finish(core, t, o) {
    arpeggio(core, t, [72, 76, 79, 84, 79, 84, 88], { step: 0.08, vol: 0.18, dur: 0.5, pan: o.pan, type: 'triangle' });
    [84, 88, 91].forEach((m) => tone(core.ctx, core.out, { t: t + 0.6, freq: N(m), dur: 0.8, vol: 0.08, attack: 0.01, release: 0.4, type: 'triangle', pan: o.pan }));
    sparkles(core, t + 0.5, 8, { spread: 0.6, pan: o.pan });
  },

  win(core, t, o) {
    // Big happy fanfare + cheer + sparkles.
    const notes = [72, 72, 72, 76, 79, 84];
    const times = [0, 0.12, 0.24, 0.36, 0.52, 0.7];
    notes.forEach((m, i) => {
      const d = i === notes.length - 1 ? 1.1 : 0.14;
      both(core, (dest, k) => {
        tone(core.ctx, dest, { t: t + times[i], freq: N(m), dur: d, type: 'triangle', vol: 0.16 * k, attack: 0.01, release: 0.2, vibrato: { rate: 5.5, depth: 0.006, delay: 0.2 } });
        tone(core.ctx, dest, { t: t + times[i], freq: N(m + 12), dur: d, vol: 0.06 * k, attack: 0.01, release: 0.2 });
      });
    });
    [72, 76, 79].forEach((m) => tone(core.ctx, core.out, { t: t + 0.7, freq: N(m - 12), dur: 1.1, vol: 0.07, type: 'triangle', attack: 0.02, release: 0.4 }));
    sparkles(core, t + 0.7, 12, { spread: 1.0 });
    SFX.cheer(core, t + 0.6, o);
  },

  unlock(core, t, o) {
    // Magical harp glissando up, shimmering chord, twinkle shower (~2.5 s).
    const gliss = [60, 64, 67, 71, 72, 76, 79, 83, 84, 88, 91, 95, 96];
    gliss.forEach((m, i) => {
      both(core, (dest, k) => tone(core.ctx, dest, { t: t + i * 0.045, freq: N(m), dur: 0.7, vol: 0.1 * k, type: 'triangle', attack: 0.002, shape: 'perc' }));
    });
    const tc = t + gliss.length * 0.045;
    [72, 76, 79, 83, 88].forEach((m, i) => {
      both(core, (dest, k) => tone(core.ctx, dest, {
        t: tc, freq: N(m), dur: 1.6, vol: 0.06 * k, attack: 0.08, release: 0.8, type: i % 2 ? 'sine' : 'triangle',
        vibrato: { rate: 4 + i * 0.5, depth: 0.004 },
      }));
    });
    sparkles(core, tc, 18, { spread: 1.8, low: 84, high: 103, vol: 0.06 });
    whoosh(core, t, { dur: 0.8, from: 800, to: 6000, vol: 0.05 });
  },

  'drift-spark'(core, t, o) {
    const level = Math.max(1, Math.min(3, o.level || 1));
    const base = [0, 88, 93, 98][level];
    tone(core.ctx, core.out, { t, freq: N(base) * o.pitch, dur: 0.05, vol: 0.05, attack: 0.001, shape: 'perc', pan: o.pan });
    noise(core.ctx, core.out, core.noise, { t, dur: 0.03, vol: 0.03, filter: { type: 'highpass', freq: 6000 }, pan: o.pan });
  },

  'drift-boost'(core, t, o) {
    const level = Math.max(1, Math.min(3, o.level || 1));
    whoosh(core, t, { dur: 0.3 + level * 0.12, from: 400, to: 1800 + level * 800, vol: 0.12, pan: o.pan });
    const top = [0, 79, 84, 91][level];
    tone(core.ctx, core.out, { t, freq: N(top - 12), freqEnd: N(top), glideTime: 0.2, dur: 0.3, vol: 0.12, type: 'triangle', attack: 0.01, release: 0.12, pan: o.pan });
    if (level >= 2) sparkles(core, t + 0.12, level * 3, { spread: 0.3, vol: 0.05, pan: o.pan });
  },

  bubble(core, t, o) {
    // A few little bubbly "bloops" rising.
    [0, 0.07, 0.15].forEach((dt, i) => {
      const f = (500 + i * 180) * o.pitch;
      tone(core.ctx, core.out, { t: t + dt, freq: f, freqEnd: f * 2.2, glideTime: 0.07, dur: 0.08, vol: 0.12, attack: 0.003, shape: 'perc', pan: o.pan });
    });
    shimmer(core, t + 0.18, o);
  },

  gumdrop(core, t, o) {
    // Squishy "sploink!"
    tone(core.ctx, core.out, {
      t, freq: 520 * o.pitch, freqEnd: 170 * o.pitch, glideTime: 0.18, dur: 0.2, vol: 0.14, type: 'square', attack: 0.004, release: 0.05,
      filter: { type: 'lowpass', freq: 2200, freqEnd: 400, time: 0.2, Q: 6 }, pan: o.pan,
    });
    tone(core.ctx, core.out, { t: t + 0.05, freq: 180 * o.pitch, freqEnd: 360 * o.pitch, glideTime: 0.1, dur: 0.12, vol: 0.08, type: 'triangle', attack: 0.004, shape: 'perc', pan: o.pan });
  },

  rocket(core, t, o) {
    // Whistly firework-style launch (no bang), then a sprinkle of sparkles.
    tone(core.ctx, core.out, { t, freq: 500 * o.pitch, freqEnd: 1900 * o.pitch, glideTime: 0.7, dur: 0.7, vol: 0.09, attack: 0.03, release: 0.1, vibrato: { rate: 9, depth: 0.02 }, pan: o.pan });
    whoosh(core, t, { dur: 0.75, from: 300, to: 3500, vol: 0.12, pan: o.pan });
    sparkles(core, t + 0.65, 6, { spread: 0.35, pan: o.pan });
  },

  star(core, t, o) {
    // Twinkly rainbow-star shimmer (~1.5 s).
    const run = [84, 88, 91, 96, 91, 88];
    for (let i = 0; i < 18; i++) {
      both(core, (dest, k) => tone(core.ctx, dest, { t: t + i * 0.08, freq: N(run[i % run.length] + (i >= 12 ? 5 : 0)) * o.pitch, dur: 0.16, vol: 0.1 * k, type: 'triangle', attack: 0.002, shape: 'perc', pan: o.pan }));
    }
  },

  cheer(core, t, o) {
    // Crowd "yaaay!" — several cute voices + soft clapping.
    for (let i = 0; i < 6; i++) {
      const f0 = 240 + ((i * 53) % 220);
      const tt = t + i * 0.025;
      tone(core.ctx, core.out, {
        t: tt, freq: f0, freqEnd: f0 * 1.35, glideTime: 0.35, dur: 0.6, vol: 0.045, type: 'sawtooth', attack: 0.05, release: 0.25,
        filter: { type: 'bandpass', freq: 900 + i * 90, Q: 2.5 }, vibrato: { rate: 5 + i * 0.4, depth: 0.02 }, pan: ((i % 3) - 1) * 0.5,
      });
    }
    for (let i = 0; i < 14; i++) {
      const tt = t + 0.05 + i * 0.07 + ((i * 31) % 7) * 0.006;
      noise(core.ctx, core.out, core.noise, { t: tt, dur: 0.045, vol: 0.08, attack: 0.001, filter: { type: 'bandpass', freq: 1100 + ((i * 97) % 700), Q: 1.1 }, pan: ((i % 5) - 2) * 0.25 });
    }
  },
};

function shimmer(core, t, o) {
  tone(core.ctx, core.wet || core.out, { t, freq: 1760 * o.pitch, dur: 0.3, vol: 0.05, attack: 0.002, shape: 'perc', pan: o.pan });
}

/**
 * Who may restyle which BUILT-IN recipe. A pack file named after an owner
 * (src/audio/sfx/<owner>.js) that sets `override: true` replaces the built-in
 * recipes listed for that owner (and only those). Everything else stays
 * built-in; new names are always free to add.
 *   items      power-up clarity workstream
 *   driving    driving-feel workstream
 *   race-flow  modes + timing workstream
 *   progress   progression workstream
 */
export const SFX_OWNERS = Object.freeze({
  items: Object.freeze(['item-roulette', 'item-get', 'bonk', 'bubble', 'gumdrop', 'rocket', 'star']),
  driving: Object.freeze(['boost', 'bump', 'drift-spark', 'drift-boost']),
  'race-flow': Object.freeze(['countdown', 'go', 'lap', 'final-lap', 'finish']),
  progress: Object.freeze(['unlock']),
});

/**
 * Extra SFX packs: every src/audio/sfx/*.js default-exports
 *   { recipes: { 'engine-rev'(core, t, o) {...}, ... }, throttle?: { 'engine-rev': 0.1 }, override?: true }
 * and is merged in automatically, so workstreams add sounds without editing
 * this file. New names are added; an existing name is only replaced when the
 * pack sets `override: true` AND its file name owns that built-in in
 * SFX_OWNERS (anything else is skipped). Recipe signature as above.
 * @param {Array<object|[string, object]>} packs pack objects, or [ownerName, pack] pairs
 * @returns {string[]} names added or overridden
 */
export function mergeSfxPacks(packs, target = SFX, throttle = SFX_THROTTLE, owners = SFX_OWNERS) {
  const added = [];
  const builtIn = new Set(Object.keys(target));
  for (const entry of packs) {
    const [owner, pack] = Array.isArray(entry) ? entry : [entry?.name ?? null, entry];
    if (!pack || typeof pack !== 'object') continue;
    const mayOverride = pack.override === true ? new Set(owners[owner] || []) : new Set();
    for (const [name, fn] of Object.entries(pack.recipes || {})) {
      if (typeof fn !== 'function') continue;
      const replacing = name in target;
      if (replacing && !(builtIn.has(name) && mayOverride.has(name))) continue;
      target[name] = fn;
      added.push(name);
      const gap = pack.throttle?.[name];
      if (Number.isFinite(gap) && (replacing || !(name in throttle))) throttle[name] = gap;
    }
  }
  return added;
}

const SFX_PACKS = import.meta.glob('./sfx/*.js', { eager: true, import: 'default' });
mergeSfxPacks(Object.keys(SFX_PACKS).sort().map((k) => [k.replace(/^.*\//, '').replace(/\.js$/, ''), SFX_PACKS[k]]));

export const SFX_NAMES = Object.keys(SFX);

/** Helper to keep pitch variations musical: random-ish semitone offsets. */
export function pitchVariation(amount = 1) {
  return semi((Math.random() * 2 - 1) * amount);
}
