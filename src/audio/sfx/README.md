# Extra sound effects

Each `*.js` file here default-exports a pack that is merged into the SFX book
(`src/audio/sfx.js`) automatically — no shared file to edit:

```js
// src/audio/sfx/driving.js  (owned by the driving-feel workstream)
import { tone, noise } from '../synth.js';

export default {
  recipes: {
    'brake-squeak'(core, t, o) {
      tone(core.ctx, core.out, { t, freq: 1400 * o.pitch, dur: 0.12, vol: 0.06, attack: 0.004, shape: 'perc', pan: o.pan });
    },
  },
  throttle: { 'brake-squeak': 0.25 }, // optional: min seconds between plays
};
```

Play with `audio.sfx('brake-squeak', { pan, volume })`. Built-in names win on
a clash, so pick fresh names (prefix them, e.g. `item-`, `drive-`). For
continuous sounds (engine hum) use `audio.sfxCore()` from a system's
`race-frame` handler. Keep everything soft, cute and never harsh.
