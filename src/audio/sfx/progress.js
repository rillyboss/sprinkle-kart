/**
 * Progression sounds (OWNER: progression/unlocks workstream).
 *
 *   sticker     a peel-and-stick "fwip-pop!" + twinkle (Sticker Book: poking an unlocked sticker)
 *   gate-oops   a soft, silly "boop-boop" for a wrong parent-gate answer (never harsh)
 *   book-page   a papery flip (Sticker Book page change)
 *
 * The built-in `unlock` fanfare is kept as is (this pack may restyle it with
 * `override: true` — see SFX_OWNERS in src/audio/sfx.js).
 */
import { tone, noise } from '../synth.js';

const N = (m) => 440 * 2 ** ((m - 69) / 12);

export default {
  recipes: {
    sticker(core, t, o) {
      noise(core.ctx, core.out, core.noise, { t, dur: 0.09, vol: 0.05, attack: 0.01, filter: { type: 'bandpass', freq: 1800, freqEnd: 5200, time: 0.09, Q: 2 }, pan: o.pan });
      tone(core.ctx, core.out, { t: t + 0.08, freq: N(84) * o.pitch, freqEnd: N(91) * o.pitch, glideTime: 0.05, dur: 0.12, vol: 0.12, attack: 0.002, shape: 'perc', type: 'triangle', pan: o.pan });
      [96, 100, 103].forEach((m, i) => {
        const dest = core.wet || core.out;
        tone(core.ctx, dest, { t: t + 0.16 + i * 0.05, freq: N(m) * o.pitch, dur: 0.25, vol: 0.05, attack: 0.002, shape: 'perc', pan: o.pan });
      });
    },
    'gate-oops'(core, t, o) {
      [67, 62].forEach((m, i) => tone(core.ctx, core.out, {
        t: t + i * 0.14, freq: N(m) * o.pitch, freqEnd: N(m - 2) * o.pitch, glideTime: 0.1, dur: 0.14, vol: 0.1, attack: 0.01, release: 0.06, type: 'triangle', pan: o.pan,
      }));
    },
    'book-page'(core, t, o) {
      noise(core.ctx, core.out, core.noise, { t, dur: 0.16, vol: 0.05, attack: 0.03, filter: { type: 'highpass', freq: 2400, freqEnd: 900, time: 0.16 }, pan: o.pan });
      tone(core.ctx, core.out, { t: t + 0.05, freq: N(79) * o.pitch, dur: 0.1, vol: 0.04, attack: 0.004, shape: 'perc', pan: o.pan });
    },
  },
  throttle: { sticker: 0.12, 'gate-oops': 0.25, 'book-page': 0.08 },
};
