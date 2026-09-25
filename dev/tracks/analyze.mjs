globalThis.__SPRINKLE_TRACK_DEV__ = true;
const { TRACKS } = await import('../../src/data/tracks.js');
import { TrackPath } from '../../src/track/TrackPath.js';
import fs from 'node:fs';

export function analyze(def) {
  const p = new TrackPath(def.controlPoints, def.width);
  const n = p.count, step = p.step;
  // curvature radius over window
  let minR = Infinity, minRAt = 0;
  const w = Math.max(1, Math.round(3 / step));
  for (let i = 0; i < n; i++) {
    const a = (i - w + n) % n, b = (i + w) % n;
    const ha = Math.atan2(p.tx[a], p.tz[a]), hb = Math.atan2(p.tx[b], p.tz[b]);
    let d = hb - ha; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const r = (2 * w * step) / Math.abs(d || 1e-9);
    if (r < minR) { minR = r; minRAt = i * step; }
  }
  let minSep = Infinity, sepAt = null;
  for (let i = 0; i < n; i += 2) for (let j = i + 2; j < n; j += 2) {
    let ds = Math.abs(i - j) * step; ds = Math.min(ds, p.length - ds);
    if (ds < 60) continue;
    if (Math.abs(p.py[i] - p.py[j]) >= 8) continue;
    const d = Math.hypot(p.px[i] - p.px[j], p.pz[i] - p.pz[j]);
    if (d < minSep) { minSep = d; sepAt = [i * step, j * step]; }
  }
  let ymin = Infinity, ymax = -Infinity, maxSlope = 0;
  for (let i = 0; i < n; i++) { ymin = Math.min(ymin, p.py[i]); ymax = Math.max(ymax, p.py[i]);
    maxSlope = Math.max(maxSlope, Math.abs(p.py[(i+1)%n]-p.py[i])/step); }
  return { p, length: p.length, minR, minRAt, minSep, sepAt, ymin, ymax, maxSlope };
}

if (process.argv[1].endsWith('analyze.mjs')) {
  let svgs = '';
  for (const t of TRACKS) {
    const a = analyze(t);
    console.log('flex', globalThis.__SPRINKLE_TRACK_DEV_INFO__[t.id].flex.map(v=>v.toFixed(1)));
    console.log(t.id, 'len', a.length.toFixed(0), 'minR', a.minR.toFixed(1), '@', a.minRAt.toFixed(0), 'minSep', a.minSep.toFixed(1), a.sepAt?.map(v=>v.toFixed(0)), 'y', a.ymin.toFixed(1), a.ymax.toFixed(1), 'slope', a.maxSlope.toFixed(3), 'cp', t.controlPoints.length);
    const b = a.p.getBounds(); const pad = 40;
    const W = b.maxX - b.minX + pad * 2, H = b.maxZ - b.minZ + pad * 2;
    const pts = a.p.getMinimapPoints(2).map(([x, z]) => `${(x - b.minX + pad).toFixed(1)},${(z - b.minZ + pad).toFixed(1)}`).join(' ');
    let marks = '';
    for (let s = 0; s < a.length; s += 100) { const q = a.p.pointAt(s); marks += `<text x="${q.x - b.minX + pad}" y="${q.z - b.minZ + pad}" font-size="10">${s}</text>`; }
    const s0 = a.p.pointAt(0);
    let extra = '';
    if (t.scenery.castle) { const c = t.scenery.castle; extra = `<circle cx="${-b.minX+pad}" cy="${-b.minZ+pad}" r="${c.moatOuter}" fill="none" stroke="pink" stroke-width="8"/>`; }
    svgs += `<div><h3>${t.id} ${a.length.toFixed(0)}</h3><svg width="${W*1.5}" height="${H*1.5}" viewBox="0 0 ${W} ${H}">${extra}<polyline points="${pts}" fill="none" stroke="#999" stroke-width="${t.width}" stroke-linejoin="round"/><polyline points="${pts}" fill="none" stroke="red" stroke-width="1"/><circle cx="${s0.x-b.minX+pad}" cy="${s0.z-b.minZ+pad}" r="5" fill="blue"/>${marks}</svg></div>`;
  }
  fs.writeFileSync('dev/tracks/layouts.html', `<html><body style="display:flex;flex-wrap:wrap">${svgs}</body></html>`);
}
