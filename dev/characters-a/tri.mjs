import { CHARACTERS } from '../../src/data/characters.js';
import { buildKartModel } from '../../src/render/characterModels.js';
for (const c of CHARACTERS) {
  const m = buildKartModel(c);
  let meshes = 0; m.group.traverse(o => { if (o.isMesh) meshes++; });
  for (let i = 0; i < 60; i++) m.update(1/60, { speed: 20, steer: 0.5, drifting: true, driftLevel: i%4, boosting: true, shielded: true, spinning: i>30, time: i/60 });
  console.log(c.id.padEnd(20), 'tris', m.triangles, 'meshes', meshes);
  m.dispose();
}
