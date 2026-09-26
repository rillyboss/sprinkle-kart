// Trace a track's ops without solving flex: prints where each op ends.
// node dev/tracks-superstar/trace.mjs <id>
globalThis.__SPRINKLE_TRACK_DEV__ = true;
const id = process.argv[2];
const src = (await import('node:fs')).readFileSync(`src/tracks/${id}.js`, 'utf8');
const m = /ops:\s*(\[[\s\S]*?\n\s*\]),/.exec(src);
const ops = eval(m[1]);
const hm = /heading:\s*(-?\d+)/.exec(src);
let x = 0, z = 0, h = +hm[1] * Math.PI / 180;
for (const op of ops) {
  if (op.turn !== undefined) {
    const n = 200, len = Math.abs(op.turn * Math.PI / 180) * op.r, rate = op.turn * Math.PI / 180 / len;
    for (let i = 0; i < n; i++) { const ds = len / n; const hmid = h + rate * ds / 2; x += Math.sin(hmid) * ds; z += Math.cos(hmid) * ds; h += rate * ds; }
  } else { x += Math.sin(h) * op.s; z += Math.cos(h) * op.s; }
  console.log((op.mark || '').padEnd(16), x.toFixed(1).padStart(8), z.toFixed(1).padStart(8), ((h * 180 / Math.PI) % 360).toFixed(0).padStart(6), op.flex ? 'flex' : '');
}
