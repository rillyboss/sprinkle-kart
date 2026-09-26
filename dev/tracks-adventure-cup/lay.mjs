// Layout explorer: node dev/tracks-adventure-cup/lay.mjs <specfile.mjs>
// spec module default-exports { name: {width, spec} }
import { runLayout } from '../../src/tracks/layout.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
globalThis.__SPRINKLE_TRACK_DEV__ = true;
const specs = (await import(pathToFileURL(path.resolve(process.argv[2])).href + '?' + Date.now())).default;
let html = '';
for (const [name, { width, spec }] of Object.entries(specs)) {
  const lay = runLayout(spec);
  if (lay.flexLengths.some((v) => v < 5)) { console.log(name, 'BAD flex', lay.flexLengths.map((v) => v.toFixed(1))); continue; }
  const p = new TrackPath(lay.points, width);
  const n = p.count, step = p.step;
  let minR = Infinity, minRAt = 0;
  const w = Math.max(1, Math.round(3 / step));
  for (let i = 0; i < n; i++) {
    const a = (i - w + n) % n, b = (i + w) % n;
    let d = Math.atan2(p.tx[b], p.tz[b]) - Math.atan2(p.tx[a], p.tz[a]);
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const r = (2 * w * step) / Math.abs(d || 1e-9);
    if (r < minR) { minR = r; minRAt = i * step; }
  }
  let minSep = Infinity, sepAt = null;
  for (let i = 0; i < n; i += 2) for (let j = i + 2; j < n; j += 2) {
    let ds = Math.abs(i - j) * step; ds = Math.min(ds, p.length - ds);
    if (ds <= 60) continue;
    if (Math.abs(p.py[i] - p.py[j]) >= 8) continue;
    const d = Math.hypot(p.px[i] - p.px[j], p.pz[i] - p.pz[j]);
    if (d < minSep) { minSep = d; sepAt = [i * step, j * step]; }
  }
  let ymin = Infinity, ymax = -Infinity, maxSlope = 0;
  for (let i = 0; i < n; i++) { ymin = Math.min(ymin, p.py[i]); ymax = Math.max(ymax, p.py[i]); maxSlope = Math.max(maxSlope, Math.abs(p.py[(i + 1) % n] - p.py[i]) / step); }
  const t0 = p.tangentAt(-45); let straight = 1;
  for (let s = -45; s <= 10; s += 5) { const tt = p.tangentAt(s); straight = Math.min(straight, t0.x * tt.x + t0.z * tt.z); }
  const ok = (c) => (c ? 'ok ' : 'BAD');
  console.log(`${name}: len ${p.length.toFixed(0)} ${ok(p.length >= 900 && p.length <= 1600)} | minR ${minR.toFixed(1)}@${minRAt.toFixed(0)} ${ok(minR > width * 1.15 && minR > width / 2 + 3.8 + 5)} | minSep ${minSep.toFixed(1)} ${sepAt?.map((v) => v.toFixed(0))} ${ok(minSep > width * 1.5)} | y ${ymin.toFixed(1)}..${ymax.toFixed(1)} ${ok(ymax - ymin <= 16)} slope ${maxSlope.toFixed(3)} ${ok(maxSlope < 0.25)} | start ${straight.toFixed(3)} ${ok(straight > 0.97)} | flex ${lay.flexLengths.map((v) => v.toFixed(1))} close ${lay.closeError.toFixed(3)}`);
  console.log('   marks', Object.entries(lay.marks).map(([k, m]) => `${k}:${m.start.toFixed(0)}-${m.end.toFixed(0)}`).join(' '));
  const b = p.getBounds(); const pad = 40;
  const W = b.maxX - b.minX + pad * 2, H = b.maxZ - b.minZ + pad * 2;
  let segs = '';
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const c = Math.round(((p.py[i] - ymin) / Math.max(1, ymax - ymin)) * 220);
    segs += `<line x1="${(p.px[i] - b.minX + pad).toFixed(1)}" y1="${(p.pz[i] - b.minZ + pad).toFixed(1)}" x2="${(p.px[j] - b.minX + pad).toFixed(1)}" y2="${(p.pz[j] - b.minZ + pad).toFixed(1)}" stroke="rgb(${c},90,${220 - c})" stroke-width="${width}" stroke-linecap="round" opacity="0.45"/>`;
  }
  let lbl = '';
  for (let s = 0; s < p.length; s += 100) { const q = p.pointAt(s); lbl += `<text x="${q.x - b.minX + pad}" y="${q.z - b.minZ + pad}" font-size="12">${s}</text>`; }
  const s0 = p.pointAt(0);
  html += `<div><h3>${name} ${p.length.toFixed(0)}</h3><svg width="${W}" height="${H}">${segs}${lbl}<circle cx="${s0.x - b.minX + pad}" cy="${s0.z - b.minZ + pad}" r="6" fill="blue"/></svg></div>`;
}
fs.writeFileSync('dev/tracks-adventure-cup/layouts.html', `<html><body style="display:flex;flex-wrap:wrap;gap:20px;font-family:sans-serif">${html}</body></html>`);
