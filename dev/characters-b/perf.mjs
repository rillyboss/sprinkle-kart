import { CHARACTERS } from '../../src/data/characters.js';
import { buildKartModel } from '../../src/render/characterModels.js';
const ms = CHARACTERS.slice(0,8).map(buildKartModel);
const st = { speed: 25, steer: 0.5, drifting: true, driftLevel: 3, boosting: true, shielded: true, time: 0 };
let t0 = performance.now();
for (let f = 0; f < 3000; f++) { st.time = f/60; for (const m of ms) m.update(1/60, st); }
console.log('ms per frame (8 karts, all fx on):', ((performance.now()-t0)/3000).toFixed(3));
