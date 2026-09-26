// Brute-force the crescent: node dev/tracks-superstar/search-moon.mjs
globalThis.__SPRINKLE_TRACK_DEV__ = true;
const { runLayout } = await import('../../src/tracks/layout.js');
const { TrackPath } = await import('../../src/track/TrackPath.js');
const { analyze } = await import('../tracks/analyze.mjs');
const res = [];
function sane(ops) {
  // analytic end point with flex lengths at their given values, then solve like runLayout
  let x = 0, z = 0, h = 0; const hs = [];
  for (const op of ops) {
    hs.push(h);
    if (op.turn !== undefined) {
      const a = op.turn * Math.PI / 180, r = op.r * Math.sign(a);
      const cx = x + Math.cos(h) * r, cz = z - Math.sin(h) * r; // left-turn centre
      const h2 = h + a;
      x = cx - Math.cos(h2) * r; z = cz + Math.sin(h2) * r; h = h2;
    } else { x += Math.sin(h) * op.s; z += Math.cos(h) * op.s; }
  }
  const f = ops.map((o, i) => (o.flex ? i : -1)).filter((i) => i >= 0);
  const [ha, hb] = [hs[f[0]], hs[f[1]]];
  const ux = Math.sin(ha), uz = Math.cos(ha), vx = Math.sin(hb), vz = Math.cos(hb);
  const ex = -x, ez = -z, det = ux * vz - uz * vx;
  if (Math.abs(det) < 1e-3) return false;
  const la = ops[f[0]].s + (ex * vz - ez * vx) / det, lb = ops[f[1]].s + (ux * ez - uz * ex) / det;
  if (process.env.DBG) console.log(la.toFixed(0), lb.toFixed(0));
  return la > 10 && lb > 10 && la < 300 && lb < 300;
}
for (const E1 of [0, 20, 50]) for (const E2 of [10, 30, 60, 90]) for (const R1 of [120, 130, 140]) for (const R2 of [50, 55, 60, 70]) for (const beta of [165, 175]) for (const alpha of [180, 200, 220, 240, 260]) {
  const gamma = alpha + 2 * beta - 360;
  const ops = [
    { s: 90, flex: true, mark: 'launch-straight' },
    ...Array.from({ length: 8 }, (_, i) => ({ turn: alpha / 8, r: R1, mark: 'o' + i })),
    { s: 40, flex: true, mark: 'tube' },
    { turn: beta, r: 30, mark: 'tip-1' },
    { s: E1 || 0.01, mark: 'tip-1-exit' },
    { turn: -gamma / 2, r: R2, mark: 'crater-bridge' },
    { turn: -gamma / 2, r: R2, mark: 'inner' },
    { s: E2, mark: 'tip-2-entry' },
    { turn: beta, r: 30, mark: 'tip-2' },
  ];
  if (!sane(ops)) continue;
  try {
    const lay = runLayout({ start: [0, 0], heading: 0, ops, startAt: 54 });
    if (lay.flexLengths.some((v) => v < 10 || v > 300) || lay.length > 1500) continue;
    const def = { controlPoints: lay.points, width: 18 };
    const a = analyze(def);
    if (lay.flexLengths[0] < 75 || a.minSep < 30 || a.length < 950 || a.length > 1500) continue;
    res.push([E1, E2, R1, R2, beta, alpha, lay.flexLengths.map((v) => v.toFixed(0)).join('/'), a.length.toFixed(0), a.minSep.toFixed(1)]);
  } catch (e) { /* skip */ }
}
console.log(res.map((r) => r.join('  ')).join('\n'));
