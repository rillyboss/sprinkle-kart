/**
 * Sounds for the showcase modes (OWNER: showcase features & modes).
 *
 *   battle-pop     a round, wet "bloop-POP!" when a battle bubble pops
 *   battle-out     a soft falling "boo-woo" + twinkle: out of bubbles (never sad-sounding)
 *   battle-win     a bubbly rising arpeggio for the last one bobbing
 *   battle-hurry   two quick ticks for the last seconds of a battle
 *   team-cheer     a bright little "hooray" chord for a team win
 *   goal-sticker   a sparkly "ta-ding!" when a Fun Goal sticker is earned
 */
import { tone, noise } from '../synth.js';

const N = (m) => 440 * 2 ** ((m - 69) / 12);

export default {
  recipes: {
    'battle-pop'(core, t, o) {
      tone(core.ctx, core.out, { t, freq: N(70) * o.pitch, freqEnd: N(86) * o.pitch, glideTime: 0.06, dur: 0.1, vol: 0.14, attack: 0.002, shape: 'perc', type: 'sine', pan: o.pan });
      noise(core.ctx, core.out, core.noise, { t: t + 0.05, dur: 0.07, vol: 0.07, attack: 0.002, filter: { type: 'bandpass', freq: 3200, freqEnd: 1400, time: 0.07, Q: 1.5 }, pan: o.pan });
      const dest = core.wet || core.out;
      tone(core.ctx, dest, { t: t + 0.09, freq: N(96) * o.pitch, dur: 0.18, vol: 0.04, attack: 0.002, shape: 'perc', pan: o.pan });
    },
    'battle-out'(core, t, o) {
      [72, 67, 64].forEach((m, i) => tone(core.ctx, core.out, {
        t: t + i * 0.12, freq: N(m) * o.pitch, freqEnd: N(m - 1) * o.pitch, glideTime: 0.1, dur: 0.16, vol: 0.09, attack: 0.01, release: 0.08, type: 'triangle', pan: o.pan,
      }));
      const dest = core.wet || core.out;
      tone(core.ctx, dest, { t: t + 0.42, freq: N(88) * o.pitch, dur: 0.3, vol: 0.04, attack: 0.004, shape: 'perc', pan: o.pan });
    },
    'battle-win'(core, t, o) {
      const dest = core.wet || core.out;
      [72, 76, 79, 84, 88].forEach((m, i) => tone(core.ctx, i > 2 ? dest : core.out, {
        t: t + i * 0.08, freq: N(m) * o.pitch, dur: 0.22, vol: 0.09, attack: 0.004, shape: 'perc', type: 'triangle', pan: o.pan,
      }));
    },
    'battle-hurry'(core, t, o) {
      [0, 0.12].forEach((d) => tone(core.ctx, core.out, { t: t + d, freq: N(91) * o.pitch, dur: 0.05, vol: 0.06, attack: 0.002, shape: 'perc', pan: o.pan }));
    },
    'team-cheer'(core, t, o) {
      const dest = core.wet || core.out;
      [[72, 76, 79], [74, 77, 81], [76, 79, 84]].forEach((chord, i) => chord.forEach((m) => tone(core.ctx, i === 2 ? dest : core.out, {
        t: t + i * 0.13, freq: N(m) * o.pitch, dur: i === 2 ? 0.4 : 0.12, vol: 0.05, attack: 0.006, shape: 'perc', type: 'triangle', pan: o.pan,
      })));
    },
    'goal-sticker'(core, t, o) {
      noise(core.ctx, core.out, core.noise, { t, dur: 0.08, vol: 0.04, attack: 0.01, filter: { type: 'bandpass', freq: 2200, freqEnd: 6000, time: 0.08, Q: 2 }, pan: o.pan });
      const dest = core.wet || core.out;
      [84, 88, 91, 96].forEach((m, i) => tone(core.ctx, dest, { t: t + 0.06 + i * 0.06, freq: N(m) * o.pitch, dur: 0.24, vol: 0.06, attack: 0.002, shape: 'perc', pan: o.pan }));
    },
  },
  throttle: { 'battle-pop': 0.06, 'battle-out': 0.3, 'battle-win': 0.5, 'battle-hurry': 0.5, 'team-cheer': 0.5, 'goal-sticker': 0.25 },
};
