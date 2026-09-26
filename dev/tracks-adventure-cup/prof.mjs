// node dev/tracks-adventure-cup/prof.mjs <id> — time each top-level build* call in buildScenery
import fs from 'node:fs';
const id = process.argv[2];
const src = `src/tracks/${id}.js`;
const orig = fs.readFileSync(src, 'utf8');
const a = orig.indexOf('export function buildScenery(ctx)');
const body = orig.slice(a);
const patched = orig.slice(0, a) + body.replace(/^( {2})((?:build|backgroundHills|sparkles|floatingShapes|flushRocks)\w*\(.*\);)$/gm, (m, ind, call) => `${ind}{ const __t = performance.now(); ${call} console.log(${JSON.stringify(call.slice(0, 40))}, Math.round(performance.now() - __t)); }`);
fs.writeFileSync(src, patched);
try {
  const { getTrack } = await import('../../src/tracks/index.js');
  const { TrackPath } = await import('../../src/track/TrackPath.js');
  const { buildTrack } = await import('../../src/render/trackBuilder.js');
  const t = getTrack(id);
  for (let k = 0; k < 2; k++) {
    const t0 = performance.now();
    const b = buildTrack(t, new TrackPath(t.controlPoints, t.width));
    console.log('total', Math.round(performance.now() - t0));
    b.dispose();
  }
} finally {
  fs.writeFileSync(src, orig);
}
