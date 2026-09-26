/**
 * Cozy Cup track tests (pumpkin-patch, teacup-garden, peppermint-village, pillow-fort).
 * The shared registry/layout/builder/fairness tests already run over these tracks;
 * this file checks what is special about each world, the props-vs-camera rule,
 * determinism, performance budgets, the drop-in songs and the Cozy prop kit.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TRACKS, TRACK_PACKS, getTrackModule } from '../src/tracks/index.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack, createPathIndex, FENCE_OFFSET } from '../src/render/trackBuilder.js';
import { LINEUP_CUPS, lineupTrack } from '../src/content/lineup.js';
import { SONGS } from '../src/audio/songs.js';
import { compileSong } from '../src/audio/compile.js';
import { bulbString, inRange, ringOfSpots, instanced, placeAlong, faceRoad } from '../src/tracks/props/cozy-kit.js';
import { pumpkinGeometry } from '../src/tracks/pumpkin-patch.js';
import { ginghamShade, teacupGeometry } from '../src/tracks/teacup-garden.js';
import { crescentShape } from '../src/tracks/pillow-fort.js';

const COZY = ['pumpkin-patch', 'teacup-garden', 'peppermint-village', 'pillow-fort'];
const def = (id) => TRACKS.find((t) => t.id === id);
const pathOf = (d) => new TrackPath(d.controlPoints, d.width);

/** Signed heading change per sample (radians), smoothed over ±3 units like the shared radius test. */
function curvatureSigns(path) {
  const n = path.count;
  const w = Math.max(1, Math.round(3 / path.step));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i - w + n) % n, b = (i + w) % n;
    let d = Math.atan2(path.tx[b], path.tz[b]) - Math.atan2(path.tx[a], path.tz[a]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push(d);
  }
  return out;
}

/** How many times the road switches between left and right bends (ignoring straights). */
function bendSwitches(path, from = 0, to = 1) {
  const c = curvatureSigns(path);
  let last = 0, switches = 0;
  for (let i = 0; i < path.count; i++) {
    if (!inRange(i * path.step, path.length, from, to)) continue;
    const s = Math.abs(c[i]) < 0.01 ? 0 : Math.sign(c[i]);
    if (s && last && s !== last) switches++;
    if (s) last = s;
  }
  return switches;
}

/** Total absolute turning (degrees) of a lap — a plain oval is ~360. */
function totalTurning(path) {
  let sum = 0;
  for (let i = 0; i < path.count; i++) {
    const j = (i + 1) % path.count;
    let d = Math.atan2(path.tx[j], path.tz[j]) - Math.atan2(path.tx[i], path.tz[i]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    sum += Math.abs(d);
  }
  return (sum * 180) / Math.PI;
}

const built = new Map();
function builtOf(id) {
  if (!built.has(id)) {
    const d = def(id);
    const path = pathOf(d);
    built.set(id, { d, path, b: buildTrack(d, path), index: createPathIndex(path) });
  }
  return built.get(id);
}

function named(group, name) {
  const out = [];
  group.traverse((o) => { if (o.name === name) out.push(o); });
  return out;
}

describe('Cozy Cup registration', () => {
  it('registers exactly the four Cozy tracks, in cup order, in pack-cozy', () => {
    const pack = TRACK_PACKS.find((p) => p.id === 'cozy');
    expect(pack.modules.map((m) => m.def.id)).toEqual(COZY);
    expect(LINEUP_CUPS.find((c) => c.id === 'cozy-cup').trackIds).toEqual(COZY);
    for (const id of COZY) {
      expect(def(id).cup).toBe('cozy-cup');
      expect(def(id).name).toBe(lineupTrack(id).name);
      expect(def(id).unlock).toEqual(lineupTrack(id).unlock);
      expect(def(id).locked).toBeUndefined(); // tracks lock by `unlock`, not a flag
    }
  });

  it.each(COZY)('%s plays its own drop-in song', (id) => {
    expect(def(id).theme.music).toBe(id);
    expect(SONGS[id]?.id).toBe(id);
  });

  it('every Cozy song is its own tune (tempo / instruments / key all differ)', () => {
    const songs = COZY.map((id) => SONGS[id]);
    expect(new Set(songs.map((s) => s.bpm)).size).toBe(4);
    expect(new Set(songs.map((s) => s.instruments.lead + s.instruments.arp)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(songs.map((s) => s.main.chords[0])).size).toBe(4);
    for (const s of songs) {
      const c = compileSong(s);
      expect(c.loopSteps).toBeGreaterThanOrEqual(16 * 16); // at least 16 bars before it loops
      const lead = c.events.filter((e) => e.track === 'lead');
      expect(new Set(lead.map((e) => e.midi % 12)).size).toBeLessThanOrEqual(8); // happy + in key
    }
  });

  it('uses friendly, kid-safe words and short arch banners that fit the sign', () => {
    const bad = /\b(kill|die|dead|crash|destroy|hit|spooky|scary|creepy|ghoul|monster|blood)\b/i;
    for (const id of COZY) {
      const d = def(id);
      const text = `${d.name} ${d.subtitle} ${d.scenery.arch.text}`;
      expect(text).not.toMatch(bad);
      expect(d.scenery.arch.text.length).toBeLessThanOrEqual(13);
      expect(d.art).toHaveLength(3);
    }
  });
});

describe('each Cozy track has its own layout personality', () => {
  it('none of them is a plain oval (lots of extra turning) and no two are alike', () => {
    const sig = COZY.map((id) => {
      const p = pathOf(def(id));
      return { id, turning: totalTurning(p), switches: bendSwitches(p), len: p.length };
    });
    for (const s of sig) {
      expect(s.turning, s.id).toBeGreaterThan(560);
      expect(s.switches, s.id).toBeGreaterThanOrEqual(2);
    }
    for (let i = 0; i < sig.length; i++) {
      for (let j = i + 1; j < sig.length; j++) {
        const same = Math.abs(sig[i].len - sig[j].len) < 20 && Math.abs(sig[i].turning - sig[j].turning) < 30;
        expect(same, `${sig[i].id} vs ${sig[j].id}`).toBe(false);
      }
    }
  });

  it('Pumpkin Pie Patch: covered bridge over Apple Juice Creek, hay-bale hops, a kid-sized hairpin', () => {
    const { d, path, index, b } = builtOf('pumpkin-patch');
    const [c0, c1] = d.scenery.coveredBridge;
    const [b0, b1] = d.scenery.bridges[0];
    expect(c0).toBeGreaterThan(b0);
    expect(c1).toBeLessThan(b1);
    // the creek (made by prepare) runs under the bridge, well below the deck
    const prepared = getTrackModule('pumpkin-patch').prepare({ def: d, path, index });
    const river = prepared.scenery.riverLine;
    expect(river.length).toBeGreaterThan(8);
    const mid = path.pointAt(d.scenery.river.at * path.length);
    const closest = Math.min(...river.map(([x, z]) => Math.hypot(x - mid.x, z - mid.z)));
    expect(closest).toBeLessThan(8);
    expect(b.terrainHeight(mid.x + 0.1, mid.z)).toBeLessThan(mid.y - 2.5);
    expect(prepared).not.toBe(d); // prepare returns a NEW def
    // hay-hop hump makes the road rise and fall
    const hop = d.scenery.hayHop * path.length;
    const ys = [-70, 0, 70].map((ds) => path.pointAt(hop + ds).y);
    expect(ys[1]).toBeGreaterThan((ys[0] + ys[2]) / 2 + 1.2);
    // the windmill hairpin: a real 180 but roomy (r >= 40) with the mill clear of the road
    const w = d.scenery.windmill;
    expect(w.lateral).toBeGreaterThanOrEqual(40);
    const mill = path.positionAt(w.at * path.length, w.lateral);
    expect(index.nearest(mill.x, mill.z, 200).dist).toBeGreaterThan(path.halfWidth + FENCE_OFFSET + 10);
  });

  it('Pumpkin Pie Patch: every hero pumpkin wears a smile (smiley, never spooky)', () => {
    const { b } = builtOf('pumpkin-patch');
    const [heroes] = named(b.group, 'smiley-pumpkins');
    const [smiles] = named(b.group, 'pumpkin-smiles');
    const [cheeks] = named(b.group, 'pumpkin-cheeks');
    expect(heroes.count).toBeGreaterThanOrEqual(8);
    expect(smiles.count).toBeGreaterThanOrEqual(heroes.count);
    expect(cheeks.count).toBe(heroes.count * 2);
    expect(named(b.group, 'pie-windmill').length).toBeGreaterThanOrEqual(1);
  });

  it('Teacup Garden: flat garden, a wiggly hedge-maze slalom and a humped tea bridge', () => {
    const { d, path, index } = builtOf('teacup-garden');
    expect(d.scenery.terrain).toBe('flat');
    const [m0, m1] = d.scenery.maze;
    expect(bendSwitches(path, m0, m1)).toBeGreaterThanOrEqual(3);
    const bridge = path.pointAt(d.scenery.bridge * path.length);
    expect(bridge.y).toBeGreaterThan(2);
    const pot = path.positionAt(d.scenery.teapot.at * path.length, d.scenery.teapot.lateral);
    expect(index.nearest(pot.x, pot.z, 300).dist).toBeGreaterThan(path.halfWidth + FENCE_OFFSET + 20 * 1.6 - 1);
  });

  it('Teacup Garden: the road is a gingham tablecloth', () => {
    expect([ginghamShade(0, 0), ginghamShade(1, 0), ginghamShade(0, 1), ginghamShade(1, 1)]).toEqual([0, 1, 1, 2]);
    const { b } = builtOf('teacup-garden');
    expect(named(b.group, 'gingham-road')).toHaveLength(1);
    expect(named(b.group, 'teacup-ride')).toHaveLength(1);
  });

  it('Peppermint Village: the road is a candy cane (a big hook with a crook, two long legs)', () => {
    const { d, path, index } = builtOf('peppermint-village');
    const dev = path.length;
    // the two legs of the cane run side by side in opposite directions
    const [ms0, ms1] = d.scenery.mainStreet;
    const sMain = (((ms0 > ms1 ? ms0 - 1 : ms0) + ms1) / 2) * dev;
    const main = path.pointAt(sMain);
    const tMain = path.tangentAt(sMain);
    let best = null;
    for (let s = 0; s < dev; s += 2) {
      if (Math.abs(path.delta(s, sMain)) < 200) continue;
      const p = path.pointAt(s);
      const dd = Math.hypot(p.x - main.x, p.z - main.z);
      if (!best || dd < best.dd) best = { dd, s };
    }
    const tOther = path.tangentAt(best.s);
    expect(tMain.x * tOther.x + tMain.z * tOther.z).toBeLessThan(-0.85); // antiparallel legs
    expect(best.dd).toBeGreaterThan(d.width * 1.5);
    expect(best.dd).toBeLessThan(110); // ...close together, like a cane's shaft
    // the village tree stands in the crook of the cane, clear of the road
    const tree = path.positionAt(d.scenery.villageTree.at * dev, d.scenery.villageTree.lateral);
    expect(index.nearest(tree.x, tree.z, 200).dist).toBeGreaterThan(path.halfWidth + FENCE_OFFSET + 13);
  });

  it('Pillow Fort Dreamland: a cloud-shaped road (puffs and dips) with a fort tunnel over the road', () => {
    const { d, path, b } = builtOf('pillow-fort');
    expect(d.theme.night).toBe(true);
    expect(d.scenery.terrain).toBe('hills');
    expect(bendSwitches(path)).toBeGreaterThanOrEqual(8);
    const [blanket] = named(b.group, 'fort-blanket');
    expect(blanket).toBeTruthy();
    const [t0, t1] = d.scenery.tunnel;
    expect((t1 - t0) * path.length).toBeGreaterThan(50);
  });
});

describe('Cozy props never block the chase camera', () => {
  // Anything within the fence line must be on the road surface by design, or well overhead.
  const ON_ROAD = new Set(['lace-edge', 'road-stitches', 'gingham-road', 'wheel-ruts']);
  const ANIMATED_FREE = new Set(['drifting']); // tiny falling leaves / flakes, see-through by nature
  const OVERHEAD = 7.5; // camera sits ~2.75 above the road; leave lots of room
  it.each(COZY)('%s', (id) => {
    const { path, b, index } = builtOf(id);
    const lim = path.halfWidth + FENCE_OFFSET - 0.6;
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const offenders = [];
    let checked = 0;
    const check = (name, x, y, z) => {
      checked++;
      const n = index.nearest(x, z, lim + 1);
      if (n.i < 0 || n.dist >= lim) return;
      const above = y - n.y;
      if (above >= OVERHEAD || above <= -1.5) return;
      offenders.push(`${name} @ (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) ${n.dist.toFixed(1)} from centre, ${above.toFixed(1)} above road`);
    };
    for (let k = 0; k < 3; k++) b.update(1 / 30, 2 + k * 3.7); // animated props in a few poses
    b.group.traverse((o) => {
      if (!o.name || o.name.startsWith('track:') || ON_ROAD.has(o.name) || ANIMATED_FREE.has(o.name) || o.name.endsWith(':outline')) return;
      if (o.name === 'road' || o.name === 'ground' || o.name === 'sky') return;
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          v.setFromMatrixPosition(m).applyMatrix4(o.parent.matrixWorld);
          check(o.name, v.x, v.y, v.z);
        }
      } else if (o.isMesh && o.geometry?.attributes?.position) {
        o.updateWorldMatrix(true, false);
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i += 5) {
          v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
          check(o.name, v.x, v.y, v.z);
        }
      } else if (o.isGroup || o.isObject3D) {
        o.updateWorldMatrix(true, false);
        v.setFromMatrixPosition(o.matrixWorld);
        if (o.children.length) check(o.name, v.x, v.y, v.z);
      }
    });
    expect(offenders.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(500); // the check really looked at the props
  });
});

describe('Cozy worlds are deterministic, animate cleanly and stay within budget', () => {
  it.each(COZY)('%s builds the same world twice', (id) => {
    const d = def(id);
    const p = pathOf(d);
    const count = (g) => {
      const rows = [];
      g.traverse((o) => {
        if (!o.isInstancedMesh) return;
        const m = new THREE.Matrix4();
        o.getMatrixAt(0, m);
        rows.push(`${o.name}:${o.count}:${m.elements.map((e) => e.toFixed(3)).join(',')}`);
      });
      return rows.join('|');
    };
    const a = buildTrack(d, p), b = buildTrack(d, p);
    expect(count(a.group)).toBe(count(b.group));
    a.dispose(); b.dispose();
  });

  it.each(COZY)('%s animates for a while without NaNs', (id) => {
    const { b } = builtOf(id);
    for (let k = 0; k < 90; k++) b.update(1 / 60, 10 + k / 60);
    b.update(0.5, 200); // a long hitch (tab in the background) is fine too
    const m = new THREE.Matrix4();
    b.group.traverse((o) => {
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i += Math.max(1, Math.floor(o.count / 25))) {
          o.getMatrixAt(i, m);
          for (const e of m.elements) expect(Number.isFinite(e), o.name).toBe(true);
        }
      }
      for (const k of ['x', 'y', 'z']) expect(Number.isFinite(o.position[k]), o.name).toBe(true);
    });
  });

  it.each(COZY)('%s keeps triangles and objects in line with the original tracks', (id) => {
    const { b } = builtOf(id);
    let tris = 0, objects = 0;
    b.group.traverse((o) => {
      if (!o.geometry) return;
      objects++;
      const g = o.geometry;
      const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tris += t * (o.isInstancedMesh ? o.count : 1);
    });
    expect(tris).toBeLessThan(420000); // originals: ~110k-390k
    expect(objects).toBeLessThan(140); // originals: 53-137
  });

  it.each(COZY)('%s disposes cleanly', (id) => {
    const d = def(id);
    const b = buildTrack(d, pathOf(d));
    const scene = new THREE.Scene();
    scene.add(b.group);
    b.dispose();
    expect(b.group.parent).toBe(null);
  });
});

describe('Cozy prop kit + shape helpers', () => {
  it('bulbString hangs from both ends and sags most in the middle', () => {
    const pts = bulbString([0, 10, 0], [10, 10, 0], 2, 10);
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual([0, 10, 0]);
    expect(pts[10]).toEqual([10, 10, 0]);
    const low = Math.min(...pts.map((p) => p[1]));
    expect(low).toBeCloseTo(8, 6);
    expect(pts[5][1]).toBeCloseTo(8, 6);
    expect(bulbString([0, 5, 0], [0, 5, 4], 0, 4).every((p) => p[1] === 5)).toBe(true);
  });

  it('inRange handles laps that wrap past the start line', () => {
    expect(inRange(50, 100, 0.4, 0.6)).toBe(true);
    expect(inRange(70, 100, 0.4, 0.6)).toBe(false);
    expect(inRange(95, 100, 0.9, 0.1)).toBe(true);
    expect(inRange(5, 100, 0.9, 0.1)).toBe(true);
    expect(inRange(50, 100, 0.9, 0.1)).toBe(false);
    expect(inRange(-5, 100, 0.9, 0.1)).toBe(true);
    expect(inRange(250, 100, 0.4, 0.6)).toBe(true);
  });

  it('ringOfSpots, instanced, placeAlong and faceRoad work on a tiny context', () => {
    let seed = 3;
    const d = def('teacup-garden');
    const path = pathOf(d);
    const ctx = { rng: () => ((seed = (seed * 16807) % 2147483647) / 2147483647), group: new THREE.Group(), outlineMat: new THREE.MeshBasicMaterial(), path, index: createPathIndex(path) };
    const ring = ringOfSpots(ctx, 0, 0, 10, 8, 0);
    expect(ring).toHaveLength(8);
    for (const [x, z] of ring) expect(Math.hypot(x, z)).toBeCloseTo(10, 6);
    const { mesh, outline } = instanced(ctx, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), [new THREE.Matrix4(), { m: new THREE.Matrix4(), color: 0xff0000 }], { name: 'boxes' });
    expect(mesh.count).toBe(2);
    expect(outline.name).toBe('boxes:outline');
    expect(ctx.group.children).toHaveLength(2);
    expect(instanced(ctx, new THREE.BoxGeometry(), null, []).mesh).toBe(null);
    const spot = placeAlong(ctx, 100, 20);
    const onRoad = path.positionAt(100, 0);
    expect(Math.hypot(spot.x - onRoad.x, spot.z - onRoad.z)).toBeCloseTo(20, 3);
    // a prop placed to the right of the road, facing the road, looks back toward the centre line
    const h = faceRoad(ctx, spot.x, spot.z);
    const look = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const toRoad = new THREE.Vector3(onRoad.x - spot.x, 0, onRoad.z - spot.z).normalize();
    expect(look.dot(toRoad)).toBeGreaterThan(0.9);
  });

  it('pumpkins are plump, ribbed and sit on the ground', () => {
    const g = pumpkinGeometry();
    g.computeBoundingBox();
    const bb = g.boundingBox;
    expect(bb.min.y).toBeCloseTo(0, 1);
    expect(bb.max.y).toBeGreaterThan(1.3);
    expect(bb.max.x).toBeGreaterThan(1);
    expect(bb.max.x).toBeLessThan(1.2);
    for (const v of g.attributes.position.array) expect(Number.isFinite(v)).toBe(true);
  });

  it('the teacup and crescent moon shapes are well formed', () => {
    const cup = teacupGeometry();
    cup.computeBoundingBox();
    expect(cup.boundingBox.max.y).toBeCloseTo(1, 1);
    expect(cup.boundingBox.max.x).toBeLessThanOrEqual(1.05);
    const pts = crescentShape().getPoints();
    expect(pts.length).toBeGreaterThan(20);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1.0001);
    // the crescent is hollow on the right: the centre of the unit circle is outside it
    const inside = (x, y) => {
      let c = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if ((pts[i].y > y) !== (pts[j].y > y) && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c;
      }
      return c;
    };
    expect(inside(0.3, 0)).toBe(false);
    expect(inside(-0.8, 0)).toBe(true);
  });
});
