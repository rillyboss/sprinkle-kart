const { TRACKS } = await import('../../src/data/tracks.js');
const { TrackPath } = await import('../../src/track/TrackPath.js');
const { buildTrack } = await import('../../src/render/trackBuilder.js');
for (const t of TRACKS) {
  const p = new TrackPath(t.controlPoints, t.width);
  const b = buildTrack(t, p);
  const rows = [];
  b.group.traverse((o) => {
    if (!o.geometry) return;
    const g = o.geometry;
    const tri = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    rows.push([tri * n, o.type, n, tri, o.name]);
  });
  rows.sort((a, b) => b[0] - a[0]);
  console.log(t.id, 'total', rows.reduce((a, r) => a + r[0], 0), 'objects', rows.length);
  console.log(rows.slice(0, 8).map((r) => r.join(' ')).join('\n'));
}
