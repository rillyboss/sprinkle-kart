/**
 * Race-flow / timing sounds (modes + timing workstream). New names only for
 * now (the built-in countdown / go / lap / final-lap / finish stay as they are).
 */
import { tone } from '../synth.js';
import { midiToFreq } from '../theory.js';

const N = (m) => midiToFreq(m);

function chime(core, t, notes, { step = 0.07, vol = 0.12, dur = 0.45, pan = 0, type = 'triangle' } = {}) {
  notes.forEach((m, i) => {
    const tt = t + i * step;
    tone(core.ctx, core.out, { t: tt, freq: N(m), dur, vol, attack: 0.003, shape: 'perc', type, pan });
    if (core.wet) tone(core.ctx, core.wet, { t: tt, freq: N(m + 12), dur: dur * 0.6, vol: vol * 0.35, attack: 0.002, shape: 'perc', pan });
  });
}

export default {
  recipes: {
    /** "Best lap!" — a quick twinkly up-chime. */
    'timing-best-lap'(core, t, o) {
      chime(core, t, [88, 91, 95], { step: 0.06, vol: 0.1, pan: o.pan });
    },
    /** "New record!" — a bright little fanfare with sparkles. */
    'timing-record'(core, t, o) {
      chime(core, t, [84, 88, 91, 96, 100], { step: 0.07, vol: 0.12, dur: 0.55, pan: o.pan });
      [96, 100, 103].forEach((m, i) => tone(core.ctx, core.wet || core.out, { t: t + 0.4 + i * 0.05, freq: N(m), dur: 0.25, vol: 0.05, attack: 0.002, shape: 'perc', pan: (o.pan || 0) + (i - 1) * 0.3 }));
    },
    /** GP standings tally tick (plays while points count up). */
    'gp-tally'(core, t, o) {
      tone(core.ctx, core.out, { t, freq: 1568 * (o.pitch || 1), dur: 0.05, vol: 0.05, attack: 0.001, shape: 'perc', pan: o.pan });
    },
    /** Trophy ceremony: a warm "ta-da!". */
    'gp-trophy'(core, t, o) {
      chime(core, t, [72, 76, 79, 84], { step: 0.11, vol: 0.13, dur: 0.6, pan: o.pan });
      [72, 76, 79, 84].forEach((m) => tone(core.ctx, core.out, { t: t + 0.5, freq: N(m), dur: 1.2, vol: 0.05, attack: 0.02, release: 0.5, type: 'triangle' }));
    },
    /** Ghost appears at GO — a soft "wooo" shimmer. */
    'timing-ghost'(core, t, o) {
      tone(core.ctx, core.wet || core.out, { t, freq: N(79), freqEnd: N(91), glideTime: 0.5, dur: 0.6, vol: 0.05, attack: 0.1, release: 0.3, type: 'sine', pan: o.pan, vibrato: { rate: 6, depth: 0.01 } });
    },
  },
  throttle: { 'gp-tally': 0.045, 'timing-best-lap': 0.3 },
};
