// node dev/tracks-bubble/trace.mjs <id> : print where every op of a layout ends (before flex solving)
globalThis.__SPRINKLE_TRACK_DEV__ = true;
const id = process.argv[2];
const src = (await import('node:fs')).readFileSync(`src/tracks/${id}.js`, 'utf8');
const m = /LAYOUT = (\{[\s\S]*?\n\});/.exec(src);
const spec = eval('(' + m[1] + ')');
const D = Math.PI / 180;
let x = spec.start[0], z = spec.start[1], h = spec.heading * D, y = spec.y0 ?? 0;
for (const op of spec.ops) {
  if (op.turn !== undefined) {
    const n = 200, len = Math.abs(op.turn * D) * op.r, ds = len / n, tr = (op.turn * D) / len;
    for (let k = 0; k < n; k++) { const hm = h + tr * ds / 2; x += Math.sin(hm) * ds; z += Math.cos(hm) * ds; h += tr * ds; }
  } else { x += Math.sin(h) * op.s; z += Math.cos(h) * op.s; }
  console.log((op.mark || '').padEnd(16), (op.turn !== undefined ? `turn ${op.turn} r${op.r}` : `s ${op.s}${op.flex ? ' flex' : ''}`).padEnd(16), 'end', x.toFixed(0), z.toFixed(0), 'h', ((h / D) % 360).toFixed(0));
}
console.log('gap', (spec.start[0] - x).toFixed(1), (spec.start[1] - z).toFixed(1));
