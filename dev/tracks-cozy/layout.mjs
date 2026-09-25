// Layout lab for the Cozy Cup: node dev/tracks-cozy/layout.mjs [id...]
// Prints the shared-test metrics for each track module and writes layouts.html (+ .png via playwright).
globalThis.__SPRINKLE_TRACK_DEV__ = true;
import fs from 'node:fs';
const { analyze } = await import('../tracks/analyze.mjs');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['pumpkin-patch', 'teacup-garden', 'peppermint-village', 'pillow-fort'];
let svgs = '';
for (const id of ids) {
  const mod = await import(`../../src/tracks/${id}.js?${Date.now()}`);
  const t = mod.def;
  const a = analyze(t);
  const info = globalThis.__SPRINKLE_TRACK_DEV_INFO__[t.id];
  console.log(id, 'flex', info.flex.map((v) => v.toFixed(1)).join(','), 'len', a.length.toFixed(0), 'minR', a.minR.toFixed(1), '@', a.minRAt.toFixed(0),
    'minSep', a.minSep.toFixed(1), '(need', (t.width * 1.5).toFixed(1) + ')', a.sepAt?.map((v) => v.toFixed(0)), 'y', a.ymin.toFixed(1), a.ymax.toFixed(1), 'slope', a.maxSlope.toFixed(3));
  const b = a.p.getBounds(); const pad = 40;
  const W = b.maxX - b.minX + pad * 2, H = b.maxZ - b.minZ + pad * 2;
  const X = (x) => (x - b.minX + pad).toFixed(1), Z = (z) => (b.maxZ - z + pad).toFixed(1); // north up, x right
  const pts = a.p.getMinimapPoints(2).map(([x, z]) => `${X(x)},${Z(z)}`).join(' ');
  let marks = '';
  for (const [name, m] of Object.entries(info.marks)) {
    const q = a.p.pointAt((m.start + m.end) / 2 - (info.length - a.length) * 0);
    marks += `<text x="${X(q.x)}" y="${Z(q.z)}" font-size="9" fill="#036">${name}</text>`;
  }
  const s0 = a.p.pointAt(0);
  const s1 = a.p.pointAt(30);
  let extra = '';
  for (const it of t.itemBoxRows) { const q = a.p.pointAt(it * a.length); extra += `<circle cx="${X(q.x)}" cy="${Z(q.z)}" r="4" fill="orange"/>`; }
  for (const bp of t.boostPads) { const q = a.p.pointAt(bp.at * a.length); extra += `<rect x="${X(q.x) - 3}" y="${Z(q.z) - 3}" width="6" height="6" fill="magenta"/>`; }
  svgs += `<div><h3>${t.id} ${a.length.toFixed(0)}</h3><svg width="${W * 1.4}" height="${H * 1.4}" viewBox="0 0 ${W} ${H}"><polyline points="${pts}" fill="none" stroke="#bbb" stroke-width="${t.width}" stroke-linejoin="round"/><polyline points="${pts}" fill="none" stroke="red" stroke-width="1"/><circle cx="${X(s0.x)}" cy="${Z(s0.z)}" r="5" fill="blue"/><circle cx="${X(s1.x)}" cy="${Z(s1.z)}" r="3" fill="green"/>${extra}${marks}</svg></div>`;
}
fs.writeFileSync('dev/tracks-cozy/layouts.html', `<html><body style="display:flex;flex-wrap:wrap;font-family:sans-serif">${svgs}</body></html>`);
if (process.env.PNG) {
  const { chromium } = await import('playwright');
  const br = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await br.newPage({ viewport: { width: 1800, height: 1000 } });
  await pg.goto('file://' + process.cwd().replace(/\\/g, '/') + '/dev/tracks-cozy/layouts.html');
  await pg.screenshot({ path: 'dev/tracks-cozy/layouts.png', fullPage: true });
  await br.close();
}
