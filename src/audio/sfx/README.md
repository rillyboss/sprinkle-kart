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

Play with `audio.sfx('brake-squeak', { pan, volume })`. New names are free
to add (prefix them, e.g. `item-`, `drive-`); on a clash with a built-in name
the built-in wins.

**Restyling a built-in sound.** A pack whose file name is an owner in
`SFX_OWNERS` (`src/audio/sfx.js`) and that sets `override: true` replaces the
built-ins listed for that owner, and only those:

| File | Workstream | May override |
|---|---|---|
| `items.js` | power-up clarity | item-roulette, item-get, bonk, bubble, gumdrop, rocket, star |
| `driving.js` | driving feel | boost, bump, drift-spark, drift-boost |
| `race-flow.js` | modes + timing | countdown, go, lap, final-lap, finish |
| `progress.js` | progression | unlock |

```js
// src/audio/sfx/items.js
export default { override: true, recipes: { bonk(core, t, o) { /* clearer bonk */ } } };
```

Note `boost` is played for pad / start boosts by `drivingReactions.js` and for
item boosts by `itemReactions.js`; the item side may switch to its own
`item-boost` name without touching driving. For continuous sounds (engine hum)
use `audio.sfxCore()` from a system's `race-frame` handler. Keep everything
soft, cute and never harsh.
