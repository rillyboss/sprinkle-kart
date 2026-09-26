/**
 * Item sounds — one DISTINCT, recognisable, cute sound per item event.
 * OWNER: power-up clarity workstream. `override: true` restyles the built-ins
 * this file owns in SFX_OWNERS (item-roulette, item-get, bonk, bubble,
 * gumdrop, rocket, star); every other name here is new (item-*).
 *
 * Design notes (so each item is recognisable with eyes closed):
 *   roulette   one soft wood-block "tick" (played per slot tick, slowing down)
 *   get        "ta-da!" two-note brass-ish fanfare + sparkle
 *   sprinkle   rising slide whistle + sugar shaker
 *   triple     three quick rising "pip-pip-pip" + the slide
 *   gumdrop    wet "plop!" as it lands
 *   shield     bubbly glug rising into a glassy chime
 *   rocket     party-popper "fwoomp" + rising whistle
 *   star       sparkly harp run + bright major chord
 *   bonks      each cause has its own "boing" colour (jelly / frosting / twinkle)
 *   block      big glassy bubble POP + "ding!"
 *   dodge      cheeky "whee!" up-down slide
 *   threat     soft two-tone "bip" (played faster as a rocket closes in)
 * Everything goes through the master limiter; volumes are kept gentle.
 */
import { tone, noise } from '../synth.js';
import { midiToFreq } from '../theory.js';

const N = (m) => midiToFreq(m);

function both(core, fn) {
  fn(core.out, 1);
  if (core.wet) fn(core.wet, 0.5);
}

function twinkles(core, t, notes, { step = 0.05, vol = 0.07, pan = 0, pitch = 1, dur = 0.2 } = {}) {
  notes.forEach((m, i) => both(core, (d, k) => tone(core.ctx, d, {
    t: t + i * step, freq: N(m) * pitch, dur, vol: vol * k, attack: 0.002, shape: 'perc', pan: pan + ((i % 3) - 1) * 0.2,
  })));
}

function boing(core, t, o, { from = 620, to = 180, dur = 0.55, type = 'triangle', vib = 13, vol = 0.2 } = {}) {
  tone(core.ctx, core.out, {
    t, freq: from * o.pitch, freqEnd: to * o.pitch, glideTime: dur, dur, vol, type, attack: 0.004, release: 0.1,
    vibrato: { rate: vib, depth: 0.09 }, pan: o.pan,
  });
}

const recipes = {
  // ---- box / roulette / reveal -----------------------------------------
  'item-box-pop'(core, t, o) {
    // bright "pop!" + a sparkly spill of candy
    tone(core.ctx, core.out, { t, freq: 380 * o.pitch, freqEnd: 1300 * o.pitch, glideTime: 0.06, dur: 0.09, vol: 0.2, attack: 0.002, shape: 'perc', pan: o.pan });
    noise(core.ctx, core.out, core.noise, { t, dur: 0.06, vol: 0.09, filter: { type: 'bandpass', freq: 2600, Q: 1.2 }, pan: o.pan });
    twinkles(core, t + 0.05, [88, 91, 95, 100], { step: 0.035, vol: 0.06, pan: o.pan, pitch: o.pitch });
  },

  'item-roulette'(core, t, o) {
    // one soft wood-block tick; `level` 0..1 (how far the roulette is) raises it a little
    const lv = Math.max(0, Math.min(1, Number(o.level) || 0));
    const f = (1250 + lv * 450) * o.pitch;
    tone(core.ctx, core.out, { t, freq: f, freqEnd: f * 0.8, glideTime: 0.03, dur: 0.035, vol: 0.12, type: 'triangle', attack: 0.001, shape: 'perc', pan: o.pan });
    tone(core.ctx, core.out, { t, freq: f * 2.1, dur: 0.02, vol: 0.03, attack: 0.001, shape: 'perc', pan: o.pan });
  },

  'item-get'(core, t, o) {
    // "ta-DA!" — short pickup then a held major chord, plus sparkles
    both(core, (d, k) => {
      tone(core.ctx, d, { t, freq: N(79) * o.pitch, dur: 0.1, vol: 0.14 * k, type: 'square', attack: 0.004, shape: 'perc', filter: { type: 'lowpass', freq: 2400 }, pan: o.pan });
      [84, 88, 91].forEach((m) => tone(core.ctx, d, {
        t: t + 0.12, freq: N(m) * o.pitch, dur: 0.42, vol: 0.075 * k, type: 'square', attack: 0.008, release: 0.2,
        filter: { type: 'lowpass', freq: 2600 }, vibrato: { rate: 6, depth: 0.006, delay: 0.12 }, pan: o.pan,
      }));
    });
    twinkles(core, t + 0.18, [96, 100, 103], { step: 0.05, vol: 0.05, pan: o.pan, pitch: o.pitch });
  },

  // ---- use --------------------------------------------------------------
  'item-use-sprinkle'(core, t, o) {
    // slide whistle up + sugar shaker
    tone(core.ctx, core.out, { t, freq: 500 * o.pitch, freqEnd: 1500 * o.pitch, glideTime: 0.28, dur: 0.32, vol: 0.12, attack: 0.01, release: 0.08, vibrato: { rate: 7, depth: 0.012 }, pan: o.pan });
    for (let i = 0; i < 4; i++) noise(core.ctx, core.out, core.noise, { t: t + i * 0.06, dur: 0.05, vol: 0.05, filter: { type: 'highpass', freq: 5000 }, pan: o.pan });
    twinkles(core, t + 0.25, [91, 96], { vol: 0.05, pan: o.pan, pitch: o.pitch });
  },

  'item-use-triple'(core, t, o) {
    // how many are left changes the pitch (o.level = charges left 0..2)
    const left = Math.max(0, Math.min(2, Number(o.level) || 0));
    const base = 84 + (2 - left) * 4;
    [0, 0.07, 0.14].forEach((dt, i) => tone(core.ctx, core.out, { t: t + dt, freq: N(base + i * 4) * o.pitch, dur: 0.07, vol: 0.1, type: 'triangle', attack: 0.002, shape: 'perc', pan: o.pan }));
    tone(core.ctx, core.out, { t: t + 0.12, freq: 600 * o.pitch, freqEnd: 1400 * o.pitch, glideTime: 0.2, dur: 0.24, vol: 0.09, attack: 0.01, release: 0.06, pan: o.pan });
  },

  gumdrop(core, t, o) {
    // wet, squishy "plop!" as the gumdrop lands behind you
    tone(core.ctx, core.out, { t, freq: 900 * o.pitch, freqEnd: 240 * o.pitch, glideTime: 0.09, dur: 0.12, vol: 0.18, attack: 0.002, shape: 'perc', pan: o.pan });
    tone(core.ctx, core.out, {
      t: t + 0.08, freq: 260 * o.pitch, freqEnd: 520 * o.pitch, glideTime: 0.1, dur: 0.16, vol: 0.12, type: 'square', attack: 0.004, release: 0.05,
      filter: { type: 'lowpass', freq: 1400, freqEnd: 500, time: 0.16, Q: 7 }, pan: o.pan,
    });
  },

  bubble(core, t, o) {
    // bubbly glug rising into a glassy chime (shield up)
    [0, 0.06, 0.12, 0.18].forEach((dt, i) => {
      const f = (420 + i * 160) * o.pitch;
      tone(core.ctx, core.out, { t: t + dt, freq: f, freqEnd: f * 2.3, glideTime: 0.06, dur: 0.07, vol: 0.11, attack: 0.003, shape: 'perc', pan: o.pan });
    });
    both(core, (d, k) => [88, 95].forEach((m, i) => tone(core.ctx, d, { t: t + 0.24 + i * 0.05, freq: N(m) * o.pitch, dur: 0.6, vol: 0.06 * k, attack: 0.003, shape: 'perc', pan: o.pan })));
  },

  rocket(core, t, o) {
    // party-popper "fwoomp" then a rising whistle
    noise(core.ctx, core.out, core.noise, { t, dur: 0.18, vol: 0.14, attack: 0.004, filter: { type: 'lowpass', freq: 1800, freqEnd: 300, time: 0.18 }, pan: o.pan });
    tone(core.ctx, core.out, { t, freq: 160 * o.pitch, freqEnd: 90 * o.pitch, glideTime: 0.12, dur: 0.14, vol: 0.14, attack: 0.002, shape: 'perc', pan: o.pan });
    tone(core.ctx, core.out, { t: t + 0.08, freq: 700 * o.pitch, freqEnd: 2000 * o.pitch, glideTime: 0.55, dur: 0.6, vol: 0.07, attack: 0.03, release: 0.1, vibrato: { rate: 10, depth: 0.02 }, pan: o.pan });
    twinkles(core, t + 0.5, [91, 95, 98], { vol: 0.05, pan: o.pan, pitch: o.pitch });
  },

  star(core, t, o) {
    // sparkly harp run up + a bright chord that says "superstar!"
    const run = [72, 76, 79, 84, 88, 91, 96, 100];
    run.forEach((m, i) => both(core, (d, k) => tone(core.ctx, d, { t: t + i * 0.04, freq: N(m) * o.pitch, dur: 0.3, vol: 0.08 * k, type: 'triangle', attack: 0.002, shape: 'perc', pan: o.pan })));
    [84, 88, 91, 96].forEach((m) => both(core, (d, k) => tone(core.ctx, d, {
      t: t + 0.34, freq: N(m) * o.pitch, dur: 0.7, vol: 0.05 * k, type: 'triangle', attack: 0.01, release: 0.35, vibrato: { rate: 6, depth: 0.008 }, pan: o.pan,
    })));
  },

  // ---- active -------------------------------------------------------------
  'item-star-loop'(core, t, o) {
    // one bar of the twinkly invincible tune (the loop system plays it bar after bar)
    const bar = Number(o.n) || 0;
    const tunes = [[84, 88, 91, 88], [86, 89, 93, 89], [84, 88, 91, 96], [83, 86, 91, 86]];
    const notes = tunes[((bar % 4) + 4) % 4];
    notes.forEach((m, i) => tone(core.ctx, core.out, { t: t + i * 0.12, freq: N(m) * o.pitch, dur: 0.11, vol: 0.06, type: 'square', attack: 0.003, shape: 'perc', filter: { type: 'lowpass', freq: 3000 }, pan: o.pan }));
    tone(core.ctx, core.out, { t, freq: N(notes[0] - 24) * o.pitch, dur: 0.44, vol: 0.05, type: 'triangle', attack: 0.005, shape: 'perc', pan: o.pan });
  },

  'item-rocket-whistle'(core, t, o) {
    // one-shot version of the approach whistle (the continuous one lives in itemLoops.js)
    const lv = Math.max(0, Math.min(1, Number(o.level) || 0));
    tone(core.ctx, core.out, { t, freq: (800 + lv * 900) * o.pitch, freqEnd: (1000 + lv * 1100) * o.pitch, glideTime: 0.25, dur: 0.25, vol: 0.05, attack: 0.02, release: 0.05, vibrato: { rate: 11, depth: 0.02 }, pan: o.pan });
  },

  'item-shield-hum'(core, t, o) {
    // a soft glassy shimmer every few seconds while the bubble is up
    both(core, (d, k) => tone(core.ctx, d, { t, freq: N(100) * o.pitch, dur: 0.35, vol: 0.025 * k, attack: 0.01, shape: 'perc', pan: o.pan }));
  },

  'item-gumdrop-wobble'(core, t, o) {
    // jelly "boi-oing" hint that a gumdrop is on the road ahead
    tone(core.ctx, core.out, { t, freq: 300 * o.pitch, freqEnd: 420 * o.pitch, glideTime: 0.2, dur: 0.24, vol: 0.07, type: 'triangle', attack: 0.01, release: 0.06, vibrato: { rate: 16, depth: 0.08 }, pan: o.pan });
  },

  // ---- impacts ------------------------------------------------------------
  bonk(core, t, o) {
    // generic cartoon "boi-oi-oing" + soft thud + dizzy tweets
    boing(core, t, o);
    tone(core.ctx, core.out, { t, freq: 140, freqEnd: 60, glideTime: 0.1, dur: 0.14, vol: 0.2, attack: 0.002, shape: 'perc', pan: o.pan });
    twinkles(core, t + 0.25, [91, 88, 91], { step: 0.09, vol: 0.04, pan: o.pan });
  },

  'item-bonk-gumdrop'(core, t, o) {
    // squelchy jelly boing
    tone(core.ctx, core.out, {
      t, freq: 420 * o.pitch, freqEnd: 140 * o.pitch, glideTime: 0.2, dur: 0.22, vol: 0.14, type: 'square', attack: 0.003, release: 0.05,
      filter: { type: 'lowpass', freq: 1800, freqEnd: 300, time: 0.22, Q: 8 }, pan: o.pan,
    });
    boing(core, t + 0.12, o, { from: 520, to: 200, dur: 0.5, vib: 15, vol: 0.15 });
    twinkles(core, t + 0.4, [91, 88, 91], { step: 0.09, vol: 0.04, pan: o.pan });
  },

  'item-bonk-rocket'(core, t, o) {
    // frosting "SPLAT-boing!" with a party-horn tail
    noise(core.ctx, core.out, core.noise, { t, dur: 0.14, vol: 0.16, attack: 0.002, filter: { type: 'bandpass', freq: 900, freqEnd: 300, time: 0.14, Q: 0.9 }, pan: o.pan });
    boing(core, t + 0.04, o, { from: 700, to: 170, dur: 0.6, vol: 0.18 });
    tone(core.ctx, core.out, { t: t + 0.3, freq: N(79), freqEnd: N(84), glideTime: 0.12, dur: 0.22, vol: 0.06, type: 'sawtooth', attack: 0.01, release: 0.08, filter: { type: 'lowpass', freq: 1800 }, pan: o.pan });
    twinkles(core, t + 0.45, [91, 88, 91], { step: 0.09, vol: 0.04, pan: o.pan });
  },

  'item-bonk-star'(core, t, o) {
    // twinkly "twirl" — the star bumps you into a happy spin
    const run = [96, 91, 88, 84, 88, 91];
    run.forEach((m, i) => tone(core.ctx, core.out, { t: t + i * 0.05, freq: N(m) * o.pitch, dur: 0.12, vol: 0.08, type: 'triangle', attack: 0.002, shape: 'perc', pan: o.pan }));
    boing(core, t, o, { from: 500, to: 250, dur: 0.45, vib: 18, vol: 0.12 });
  },

  'item-bonk-score'(core, t, o) {
    // what the bonker hears: a happy "ding-ding!"
    both(core, (d, k) => [91, 96].forEach((m, i) => tone(core.ctx, d, { t: t + i * 0.08, freq: N(m) * o.pitch, dur: 0.35, vol: 0.09 * k, attack: 0.002, shape: 'perc', pan: o.pan })));
  },

  'item-shield-block'(core, t, o) {
    // BIG glassy bubble pop + reassuring "ding!"
    tone(core.ctx, core.out, { t, freq: 300 * o.pitch, freqEnd: 1800 * o.pitch, glideTime: 0.05, dur: 0.08, vol: 0.22, attack: 0.001, shape: 'perc', pan: o.pan });
    noise(core.ctx, core.out, core.noise, { t, dur: 0.08, vol: 0.12, filter: { type: 'highpass', freq: 2500 }, pan: o.pan });
    both(core, (d, k) => [96, 100, 103].forEach((m, i) => tone(core.ctx, d, { t: t + 0.07 + i * 0.03, freq: N(m) * o.pitch, dur: 0.5, vol: 0.07 * k, attack: 0.002, shape: 'perc', pan: o.pan })));
  },

  'item-dodge'(core, t, o) {
    // cheeky "whee!" slide up and down
    tone(core.ctx, core.out, { t, freq: 600 * o.pitch, freqEnd: 1400 * o.pitch, glideTime: 0.14, dur: 0.16, vol: 0.09, type: 'triangle', attack: 0.01, release: 0.04, pan: o.pan });
    tone(core.ctx, core.out, { t: t + 0.15, freq: 1400 * o.pitch, freqEnd: 900 * o.pitch, glideTime: 0.14, dur: 0.16, vol: 0.07, type: 'triangle', attack: 0.01, release: 0.05, pan: o.pan });
  },

  // ---- endings --------------------------------------------------------------
  'item-boost-end'(core, t, o) {
    tone(core.ctx, core.out, { t, freq: 900 * o.pitch, freqEnd: 500 * o.pitch, glideTime: 0.12, dur: 0.12, vol: 0.035, type: 'triangle', attack: 0.004, shape: 'perc', pan: o.pan });
  },

  'item-shield-fade'(core, t, o) {
    // gentle "bloop… pop" as the bubble floats away
    tone(core.ctx, core.out, { t, freq: 900 * o.pitch, freqEnd: 400 * o.pitch, glideTime: 0.2, dur: 0.22, vol: 0.08, attack: 0.01, release: 0.05, pan: o.pan });
    tone(core.ctx, core.out, { t: t + 0.22, freq: 1500 * o.pitch, dur: 0.05, vol: 0.08, attack: 0.001, shape: 'perc', pan: o.pan });
  },

  'item-star-end'(core, t, o) {
    // descending sparkle "aww, all done"
    twinkles(core, t, [96, 91, 88, 84], { step: 0.08, vol: 0.06, pan: o.pan, pitch: o.pitch, dur: 0.3 });
  },

  'item-gumdrop-poof'(core, t, o) {
    tone(core.ctx, core.out, { t, freq: 700 * o.pitch, freqEnd: 300 * o.pitch, glideTime: 0.1, dur: 0.12, vol: 0.06, type: 'triangle', attack: 0.003, shape: 'perc', pan: o.pan });
    noise(core.ctx, core.out, core.noise, { t, dur: 0.12, vol: 0.04, filter: { type: 'bandpass', freq: 1500 }, pan: o.pan });
  },

  'item-rocket-fizzle'(core, t, o) {
    // soft sparkler fizzle
    noise(core.ctx, core.out, core.noise, { t, dur: 0.35, vol: 0.06, attack: 0.02, filter: { type: 'highpass', freq: 4000, freqEnd: 7000, time: 0.35 }, pan: o.pan });
    twinkles(core, t + 0.1, [96, 93, 91], { step: 0.06, vol: 0.04, pan: o.pan, pitch: o.pitch });
  },

  // ---- warnings -------------------------------------------------------------
  'item-threat-beep'(core, t, o) {
    // soft two-tone "bi-bip"; `level` 0..1 = how close the rocket is (higher + brighter)
    const lv = Math.max(0, Math.min(1, Number(o.level) || 0));
    const f = (880 + lv * 660) * o.pitch;
    tone(core.ctx, core.out, { t, freq: f, dur: 0.05, vol: 0.09, type: 'triangle', attack: 0.002, shape: 'perc', pan: o.pan });
    tone(core.ctx, core.out, { t: t + 0.06, freq: f * 1.26, dur: 0.05, vol: 0.08, type: 'triangle', attack: 0.002, shape: 'perc', pan: o.pan });
  },
};

export default {
  override: true,
  recipes,
  // Ticks and beeps are paced by their systems; keep throttles tiny so 4 players never mute each other.
  throttle: {
    'item-roulette': 0.02,
    'item-threat-beep': 0.04,
    'item-star-loop': 0.05,
    'item-box-pop': 0.05,
    'item-shield-hum': 0.3,
    'item-gumdrop-wobble': 0.25,
    'item-boost-end': 0.1,
    'item-dodge': 0.2,
  },
};

/** Names this pack adds (used by tests + the cue table). */
export const ITEM_SFX_NAMES = Object.freeze(Object.keys(recipes));
