// node dev/tracks-adventure-cup/check.mjs [id...] — build headless, report tris/objects/time
const { TRACKS } = await import('../../src/data/tracks.js');
const { TrackPath } = await import('../../src/track/TrackPath.js');
const { buildTrack } = await import('../../src/render/trackBuilder.js');
const ids = process.argv.slice(2);
for (const t of TRACKS.filter((t) => !ids.length || ids.includes(t.id))) {
  const p = new TrackPath(t.controlPoints, t.width);
  const t0 = performance.now();
  const b = buildTrack(t, p);
  const ms = performance.now() - t0;
  let tris = 0, objs = 0; const rows = [];
  b.group.traverse((o) => { if (!o.geometry) return; objs++; const g = o.geometry; const tri = (g.index ? g.index.count : g.attributes.position.count) / 3; const n = o.isInstancedMesh ? o.count : 1; tris += tri * n; rows.push([Math.round(tri * n), o.geometry.type, o.material?.type, n, Math.round(tri)]); });
  for (let k = 0; k < 5; k++) b.update(1 / 60, k / 60 + 3);
  rows.sort((a, c) => c[0] - a[0]);
  console.log(t.id, 'tris', Math.round(tris), 'objects', objs, 'build ms', Math.round(ms), 'len', Math.round(p.length));
  if (ids.length) console.log(rows.slice(0, 16).map((r) => '   ' + r.join(' ')).join('\n'));
  b.dispose();
}
