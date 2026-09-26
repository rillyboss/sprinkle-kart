// Layout iteration helper: node dev/tracks-superstar/lay.mjs [ids...]
globalThis.__SPRINKLE_TRACK_DEV__ = true;
import fs from 'node:fs';
const { analyze } = await import('../tracks/analyze.mjs');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['cupcake-carnival', 'aurora-palace', 'moonbounce-base', 'ribbon-sky'];
let svgs = '';
for (const id of ids) {
  const mod = await import(`../../src/tracks/${id}.js`);
  const t = mod.def;
  const a = analyze(t);
  const info = globalThis.__SPRINKLE_TRACK_DEV_INFO__[id];
  console.log(id, 'len', a.length.toFixed(0), 'flex', info.flex.map((v) => v.toFixed(1)), 'minR', a.minR.toFixed(1), '@', a.minRAt.toFixed(0), 'minSep', a.minSep.toFixed(1), a.sepAt?.map((v) => v.toFixed(0)), 'y', a.ymin.toFixed(1), a.ymax.toFixed(1), 'slope', a.maxSlope.toFixed(3));
  const marks = Object.entries(info.marks).map(([k, m]) => `${k}:${(m.start / info.length).toFixed(3)}-${(m.end / info.length).toFixed(3)}`).join(' ');
  console.log('  marks', marks);
  const b = a.p.getBounds(); const pad = 40;
  const W = b.maxX - b.minX + pad * 2, H = b.maxZ - b.minZ + pad * 2;
  const pts = a.p.getMinimapPoints(2).map(([x, z]) => `${(x - b.minX + pad).toFixed(1)},${(z - b.minZ + pad).toFixed(1)}`).join(' ');
  let lab = '';
  for (let s = 0; s < a.length; s += 100) { const q = a.p.pointAt(s); lab += `<text x="${q.x - b.minX + pad}" y="${q.z - b.minZ + pad}" font-size="10">${s}/${q.y.toFixed(0)}</text>`; }
  const s0 = a.p.pointAt(0);
  svgs += `<div><h3>${id} ${a.length.toFixed(0)}</h3><svg width="${W * 1.2}" height="${H * 1.2}" viewBox="0 0 ${W} ${H}"><polyline points="${pts}" fill="none" stroke="#999" stroke-width="${t.width}" stroke-linejoin="round"/><polyline points="${pts}" fill="none" stroke="red" stroke-width="1"/><circle cx="${s0.x - b.minX + pad}" cy="${s0.z - b.minZ + pad}" r="5" fill="blue"/>${lab}</svg></div>`;
}
fs.writeFileSync('dev/tracks-superstar/layouts.html', `<html><body style="display:flex;flex-wrap:wrap">${svgs}</body></html>`);
