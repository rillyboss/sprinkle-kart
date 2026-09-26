/**
 * Showcase presentation sounds (OWNER: showcase presentation). All soft and cute.
 *
 *   skx-intro     a sparkly harp glide when the track intro card slides in
 *   skx-whoosh    an airy swoosh as the finish camera swings round
 *   skx-confetti  a party-popper "pop!" + twinkles (finish line, podium)
 *   skx-photo     a camera "click-chk" + chime for a photo finish
 *   skx-bubble    a tiny "blip" when a speech bubble pops up
 *   skx-podium    a warm three-note "ta-da-daa" for the 3D podium
 *   skx-attract   a soft chime when the title show cuts to a new camera
 */
import { tone, noise } from '../synth.js';

const N = (m) => 440 * 2 ** ((m - 69) / 12);

export default {
  recipes: {
    'skx-intro'(core, t, o) {
      const dest = core.wet || core.out;
      [72, 76, 79, 84, 88, 91].forEach((m, i) => tone(core.ctx, dest, {
        t: t + i * 0.045, freq: N(m) * o.pitch, dur: 0.5, vol: 0.045, attack: 0.003, shape: 'perc', type: 'triangle', pan: o.pan,
      }));
    },
    'skx-whoosh'(core, t, o) {
      noise(core.ctx, core.out, core.noise, {
        t, dur: 0.7, vol: 0.05, attack: 0.25, filter: { type: 'bandpass', freq: 500, freqEnd: 2600, time: 0.6, Q: 1.2 }, pan: o.pan,
      });
    },
    'skx-confetti'(core, t, o) {
      noise(core.ctx, core.out, core.noise, { t, dur: 0.08, vol: 0.09, attack: 0.002, filter: { type: 'bandpass', freq: 1400, Q: 0.9 }, pan: o.pan });
      tone(core.ctx, core.out, { t, freq: N(60) * o.pitch, freqEnd: N(48) * o.pitch, glideTime: 0.08, dur: 0.1, vol: 0.09, attack: 0.002, shape: 'perc', pan: o.pan });
      const dest = core.wet || core.out;
      [88, 91, 95, 100, 96].forEach((m, i) => tone(core.ctx, dest, {
        t: t + 0.08 + i * 0.06, freq: N(m) * o.pitch, dur: 0.22, vol: 0.035, attack: 0.002, shape: 'perc', pan: (o.pan || 0) + (i % 2 ? 0.2 : -0.2),
      }));
    },
    'skx-photo'(core, t, o) {
      noise(core.ctx, core.out, core.noise, { t, dur: 0.03, vol: 0.1, attack: 0.001, filter: { type: 'highpass', freq: 3000 }, pan: o.pan });
      noise(core.ctx, core.out, core.noise, { t: t + 0.07, dur: 0.05, vol: 0.07, attack: 0.001, filter: { type: 'bandpass', freq: 1800, Q: 1.5 }, pan: o.pan });
      tone(core.ctx, core.wet || core.out, { t: t + 0.12, freq: N(93) * o.pitch, dur: 0.45, vol: 0.05, attack: 0.003, shape: 'perc', pan: o.pan });
    },
    'skx-bubble'(core, t, o) {
      tone(core.ctx, core.out, { t, freq: N(79) * o.pitch, freqEnd: N(86) * o.pitch, glideTime: 0.05, dur: 0.07, vol: 0.05, attack: 0.002, shape: 'perc', type: 'sine', pan: o.pan });
    },
    'skx-podium'(core, t, o) {
      const dest = core.wet || core.out;
      [[67, 0], [71, 0.14], [74, 0.28], [79, 0.28]].forEach(([m, dt]) => tone(core.ctx, dest, {
        t: t + dt, freq: N(m) * o.pitch, dur: dt > 0.2 ? 0.7 : 0.18, vol: 0.06, attack: 0.004, shape: dt > 0.2 ? 'sustain' : 'perc', release: 0.3, type: 'triangle', pan: o.pan,
      }));
    },
    'skx-attract'(core, t, o) {
      tone(core.ctx, core.wet || core.out, { t, freq: N(84) * o.pitch, dur: 0.4, vol: 0.025, attack: 0.003, shape: 'perc', pan: o.pan });
    },
  },
  throttle: { 'skx-whoosh': 0.4, 'skx-confetti': 0.15, 'skx-photo': 1, 'skx-bubble': 0.2, 'skx-intro': 1, 'skx-podium': 1, 'skx-attract': 1.5 },
};
