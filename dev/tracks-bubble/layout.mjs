// Layout check for Bubble Cup tracks: node dev/tracks-bubble/layout.mjs [ids...]
// Prints the shared-test metrics and writes dev/tracks-bubble/layouts.html (+ .png).
globalThis.__SPRINKLE_TRACK_DEV__ = true;
import fs from 'node:fs';
const { analyze } = await import('../tracks/analyze.mjs');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['bubblegum-bay', 'mermaid-lagoon', 'teddy-toyland', 'honeycomb-hive'];
let html = '';
for (const id of ids) {
  const mod = (await import(`../../src/tracks/${id}.js?${Date.now()}`)).default;
  const t = mod.def;
  const a = analyze(t);
  const info = globalThis.__SPRINKLE_TRACK_DEV_INFO__[t.id];
  console.log(t.id, 'len', a.length.toFixed(0), 'minR', a.minR.toFixed(1), '@', a.minRAt.toFixed(0),
    'minSep', a.minSep.toFixed(1), a.sepAt?.map((v) => v.toFixed(0)), 'y', a.ymin.toFixed(1), a.ymax.toFixed(1),
    'slope', a.maxSlope.toFixed(3), 'flex', info.flex.map((v) => v.toFixed(1)));
  const p = a.p;
  // start straightness
  const t0 = p.tangentAt(-45); let straight = 1;
  for (let s = -45; s <= 10; s += 5) { const tt = p.tangentAt(s); straight = Math.min(straight, t0.x * tt.x + t0.z * tt.z); }
  const rows = [...t.itemBoxRows].sort((x, y) => x - y);
  let rowGap = Infinity;
  rows.forEach((r, i) => { const n = i + 1 < rows.length ? rows[i + 1] : rows[0] + 1; rowGap = Math.min(rowGap, (n - r) * p.length); });
  console.log('   start-straight', straight.toFixed(3), 'rowGap', rowGap.toFixed(0), 'minR>', (t.width * 1.15).toFixed(1), 'sep>', (t.width * 1.5).toFixed(0));
  const b = p.getBounds(); const pad = 60;
  const W = b.maxX - b.minX + pad * 2, H = b.maxZ - b.minZ + pad * 2;
  const X = (x) => (x - b.minX + pad).toFixed(1), Z = (z) => (z - b.minZ + pad).toFixed(1);
  const pts = p.getMinimapPoints(2).map(([x, z]) => `${X(x)},${Z(z)}`).join(' ');
  let extra = '';
  const bs = t.scenery.basin;
  if (bs) extra += `<circle cx="${X(bs.center[0])}" cy="${Z(bs.center[1])}" r="${bs.moatOuter}" fill="#9ee" stroke="none"/>`;
  for (const [k, v] of Object.entries(t.scenery.spots || {})) extra += `<circle cx="${X(v[0])}" cy="${Z(v[1])}" r="${v[2] || 8}" fill="#fc6" opacity="0.7"/><text x="${X(v[0])}" y="${Z(v[1])}" font-size="9">${k}</text>`;
  for (const [name, m] of Object.entries(info.marks)) {
    const q = p.pointAt((m.start + m.end) / 2 - (t.controlPoints.length && 0));
    extra += `<text x="${X(q.x)}" y="${Z(q.z)}" font-size="8" fill="#036">${name}</text>`;
  }
  for (const f of t.itemBoxRows) { const q = p.pointAt(f * p.length); extra += `<circle cx="${X(q.x)}" cy="${Z(q.z)}" r="4" fill="gold"/>`; }
  for (const bp of t.boostPads) { const q = p.pointAt(bp.at * p.length); extra += `<circle cx="${X(q.x)}" cy="${Z(q.z)}" r="4" fill="orange" stroke="black"/>`; }
  const s0 = p.pointAt(0);
  html += `<div><h3>${t.id} ${a.length.toFixed(0)}</h3><svg width="${W * 1.4}" height="${H * 1.4}" viewBox="0 0 ${W} ${H}" style="background:#fff">${extra}<polyline points="${pts}" fill="none" stroke="#bbb" stroke-width="${t.width}" stroke-linejoin="round"/><polyline points="${pts}" fill="none" stroke="red" stroke-width="1"/><circle cx="${X(s0.x)}" cy="${Z(s0.z)}" r="5" fill="blue"/></svg></div>`;
  // marks are wrapped by startAt; the names are placed at mark centres (lap distance from the start line)
  void 0;
}
fs.writeFileSync('dev/tracks-bubble/layouts.html', `<html><body style="display:flex;flex-wrap:wrap;gap:10px;background:#eee">${html}</body></html>`);
if (process.env.PNG) {
  const { chromium } = await import('playwright');
  const br = await chromium.launch({ channel: 'chrome', headless: true });
  const pg = await br.newPage({ viewport: { width: 1800, height: 1100 } });
  await pg.goto('file://' + process.cwd().replace(/\\/g, '/') + '/dev/tracks-bubble/layouts.html');
  await pg.screenshot({ path: 'dev/tracks-bubble/layouts.png', fullPage: true });
  await br.close();
}
