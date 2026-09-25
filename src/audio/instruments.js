/**
 * Synthesized instruments for the sequencer. All soft-edged and rounded:
 * sine/triangle bodies, gentle filters, no harsh buzz.
 *
 * Signature: (core, dest, t, freq, dur, vel) where core = { ctx, noise }.
 */
import { tone, noise } from './synth.js';

function partials(core, dest, t, freq, vel, list) {
  for (const [ratio, amp, decay] of list) {
    const f = freq * ratio;
    if (f > 12000) continue;
    tone(core.ctx, dest, { t, freq: f, dur: decay, vol: vel * amp, attack: 0.002, shape: 'perc' });
  }
}

export const INSTRUMENTS = {
  /** Glockenspiel: bright, bell-like, quick sparkle. */
  bell(core, dest, t, freq, dur, vel) {
    partials(core, dest, t, freq, vel * 0.32, [
      [1, 1, 1.1],
      [2.76, 0.22, 0.35],
      [5.4, 0.07, 0.15],
    ]);
  },

  /** Soft glassy bell with long ring (galaxy). */
  glass(core, dest, t, freq, dur, vel) {
    partials(core, dest, t, freq, vel * 0.26, [
      [1, 1, Math.max(1.4, dur * 1.2)],
      [2, 0.25, 0.8],
      [3.01, 0.1, 0.4],
    ]);
    tone(core.ctx, dest, { t, freq, dur, vol: vel * 0.06, attack: 0.06, release: 0.4, type: 'triangle', vibrato: { rate: 4.5, depth: 0.004, delay: 0.2 } });
  },

  /** Music box: tinkly sine with a hint of odd harmonic. */
  musicbox(core, dest, t, freq, dur, vel) {
    partials(core, dest, t, freq, vel * 0.3, [
      [1, 1, 0.9],
      [3, 0.12, 0.25],
      [6.02, 0.04, 0.1],
    ]);
  },

  /** Friendly whistle with delayed vibrato and a little scoop into the note. */
  whistle(core, dest, t, freq, dur, vel) {
    tone(core.ctx, dest, {
      t, freq: freq * 0.97, freqEnd: freq, glideTime: 0.04, dur: Math.max(0.08, dur * 0.92), vol: vel * 0.24,
      attack: 0.025, release: 0.07, sustain: 0.8, decay: 0.2,
      vibrato: { rate: 5.6, depth: 0.012, delay: 0.12 },
    });
    noise(core.ctx, dest, core.noise, { t, dur: 0.05, vol: vel * 0.012, filter: { type: 'bandpass', freq: freq * 2, Q: 4 } });
  },

  /** Vibraphone: round sine + 4th harmonic, tremolo, long decay. */
  vibes(core, dest, t, freq, dur, vel) {
    const d = Math.max(0.6, dur * 1.6);
    tone(core.ctx, dest, { t, freq, dur: d, vol: vel * 0.3, attack: 0.003, shape: 'perc', vibrato: { rate: 5, depth: 0.002 } });
    tone(core.ctx, dest, { t, freq: freq * 4, dur: 0.25, vol: vel * 0.05, attack: 0.002, shape: 'perc' });
  },

  /** Soft lead: triangle + a touch of filtered square. */
  lead(core, dest, t, freq, dur, vel) {
    const o = { t, dur: Math.max(0.06, dur * 0.9), attack: 0.01, release: 0.08, sustain: 0.75, decay: 0.2, vibrato: { rate: 5.5, depth: 0.008, delay: 0.15 } };
    tone(core.ctx, dest, { ...o, freq, type: 'triangle', vol: vel * 0.22 });
    tone(core.ctx, dest, { ...o, freq, type: 'square', vol: vel * 0.035, filter: { type: 'lowpass', freq: 2200, Q: 0.5 } });
  },

  /** Cheerful soft brass for fanfares. */
  brass(core, dest, t, freq, dur, vel) {
    const d = Math.max(0.08, dur * 0.92);
    tone(core.ctx, dest, {
      t, freq, dur: d, type: 'sawtooth', vol: vel * 0.12, attack: 0.03, release: 0.1, sustain: 0.8, decay: 0.2,
      filter: { type: 'lowpass', freq: 700, freqEnd: 2600, time: 0.06, Q: 0.7 },
      vibrato: { rate: 5, depth: 0.006, delay: 0.18 },
    });
    tone(core.ctx, dest, { t, freq, dur: d, type: 'triangle', vol: vel * 0.12, attack: 0.02, release: 0.1 });
  },

  /** Plucky ukulele / harp-ish note. */
  pluck(core, dest, t, freq, dur, vel) {
    const d = Math.min(0.5, 0.18 + dur * 0.5);
    tone(core.ctx, dest, { t, freq, dur: d, type: 'triangle', vol: vel * 0.24, attack: 0.002, shape: 'perc' });
    tone(core.ctx, dest, {
      t, freq, dur: d * 0.6, type: 'sawtooth', vol: vel * 0.05, attack: 0.002, shape: 'perc',
      filter: { type: 'lowpass', freq: 3000, freqEnd: 600, time: d * 0.6 },
    });
  },

  /** Warm string pad: two detuned saws through a low-pass, slow swell. */
  pad(core, dest, t, freq, dur, vel) {
    const o = { t, freq, dur, attack: Math.min(0.35, dur * 0.4), release: 0.5, vol: vel * 0.06, type: 'sawtooth', filter: { type: 'lowpass', freq: 1100, Q: 0.3 } };
    tone(core.ctx, dest, { ...o, detune: -8 });
    tone(core.ctx, dest, { ...o, detune: 8 });
  },

  /** Round, bouncy bass. */
  bass(core, dest, t, freq, dur, vel) {
    const d = Math.max(0.06, dur * 0.85);
    tone(core.ctx, dest, { t, freq, dur: d, type: 'triangle', vol: vel * 0.36, attack: 0.006, release: 0.06, sustain: 0.7, decay: 0.18, filter: { type: 'lowpass', freq: 900, Q: 0.6 } });
    tone(core.ctx, dest, { t, freq, dur: d, type: 'sine', vol: vel * 0.24, attack: 0.006, release: 0.06, sustain: 0.8, decay: 0.2 });
  },
};

/** Soft drum kit. */
export function playDrum(core, dest, t, drum, vel) {
  const { ctx } = core;
  switch (drum) {
    case 'k':
      tone(ctx, dest, { t, freq: 150, freqEnd: 48, glideTime: 0.11, dur: 0.24, vol: vel * 0.55, attack: 0.003, shape: 'perc' });
      break;
    case 's':
      noise(ctx, dest, core.noise, { t, dur: 0.14, vol: vel * 0.16, attack: 0.002, filter: { type: 'bandpass', freq: 2000, Q: 0.8 } });
      tone(ctx, dest, { t, freq: 240, freqEnd: 170, dur: 0.08, vol: vel * 0.12, type: 'triangle', attack: 0.002, shape: 'perc' });
      break;
    case 'h':
      noise(ctx, dest, core.noise, { t, dur: 0.035, vol: vel * 0.06, attack: 0.001, filter: { type: 'highpass', freq: 7500, Q: 0.5 } });
      break;
    case 'o':
      noise(ctx, dest, core.noise, { t, dur: 0.22, vol: vel * 0.05, attack: 0.002, filter: { type: 'highpass', freq: 6500, Q: 0.5 } });
      break;
    case 'c':
      for (let i = 0; i < 3; i++) {
        noise(ctx, dest, core.noise, { t: t + i * 0.011, dur: i === 2 ? 0.1 : 0.02, vol: vel * 0.1, attack: 0.001, filter: { type: 'bandpass', freq: 1300, Q: 1.2 } });
      }
      break;
    case 't':
      noise(ctx, dest, core.noise, { t, dur: 0.05, vol: vel * 0.05, attack: 0.012, filter: { type: 'bandpass', freq: 5200, Q: 1.5 } });
      break;
    case 'm':
      tone(ctx, dest, { t, freq: 210, freqEnd: 130, dur: 0.22, vol: vel * 0.3, attack: 0.003, shape: 'perc' });
      break;
    default:
      break;
  }
}
