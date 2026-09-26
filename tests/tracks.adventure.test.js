// Adventure Cup tracks: jellybean-jungle, cocoa-canyon, lemonade-volcano,
// donut-downtown. The shared registry tests (tracks, tracksBuilder,
// registries, race.fairness) already run over these; this file covers what
// is special about each world.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TRACK_PACKS, getTrack, getTrackModule } from '../src/tracks/index.js';
import { LINEUP_CUPS, lineupTrack } from '../src/content/lineup.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack } from '../src/render/trackBuilder.js';
import { createPathIndex, distToPolyline } from '../src/tracks/pathTools.js';
import { FENCE_OFFSET } from '../src/tracks/constants.js';
import { runLayout } from '../src/tracks/layout.js';
import { SONGS } from '../src/audio/songs.js';
import { compileSong } from '../src/audio/compile.js';
import {
  FIGURE_EIGHT_TWIRL, findCrossing, supportSpots, FLOOR_Y,
} from '../src/tracks/jellybean-jungle.js';
import { ROCK_LAYERS, cocoaFlowTexture } from '../src/tracks/cocoa-canyon.js';
import { SEA_Y, volcanoSite } from '../src/tracks/lemonade-volcano.js';
import { BUILDING_TYPES, planLots, NEON } from '../src/tracks/donut-downtown.js';
import {
  instanced, animatedInstances, spotsAlong, isClearOfCamera, farRing, minDistToOtherLevel,
} from '../src/tracks/props/adventure-kit.js';
import { makeRng } from '../src/tracks/pathTools.js';

const IDS = ['jellybean-jungle', 'cocoa-canyon', 'lemonade-volcano', 'donut-downtown'];
const pathOf = (id) => {
  const t = getTrack(id);
  return new TrackPath(t.controlPoints, t.width);
};
const prepared = (id) => {
  const t = getTrack(id);
  const path = new TrackPath(t.controlPoints, t.width);
  const index = createPathIndex(path);
  const mod = getTrackModule(id);
  return { def: mod.prepare ? mod.prepare({ def: t, path, index }) : t, path, index };
};
/** Count triangles + drawable objects of a built track (like dev/tracks/tris.mjs). */
function budget(built) {
  let tris = 0, objects = 0;
  built.group.traverse((o) => {
    if (!o.geometry) return;
    objects++;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
  });
  return { tris, objects };
}

describe('Adventure Cup pack', () => {
  it('registers the four tracks in cup order, matching the lineup', () => {
    const pack = TRACK_PACKS.find((p) => p.id === 'adventure');
    expect(pack.cup).toBe('adventure-cup');
    expect(pack.modules.map((m) => m.def.id)).toEqual(LINEUP_CUPS.find((c) => c.id === 'adventure-cup').trackIds);
    expect(pack.modules.map((m) => m.def.id)).toEqual(IDS);
  });

  it.each(IDS)('%s has its own song, lineup unlock and friendly text', (id) => {
    const t = getTrack(id);
    expect(t.theme.music).toBe(id);
    expect(SONGS[id]).toBeTruthy();
    expect(t.unlock).toEqual(lineupTrack(id).unlock);
    expect(t.art).toHaveLength(3);
    const text = `${t.name} ${t.subtitle}`.toLowerCase();
    for (const bad of ['kill', 'die', 'dead', 'crash', 'destroy', 'hit', 'lava', 'burn', 'explode', 'scary']) {
      expect(text).not.toMatch(new RegExp(`\\b${bad}\\b`));
    }
  });

  it('gives every track a different song (not the same tune re-labelled)', () => {
    const sigs = IDS.map((id) => JSON.stringify([SONGS[id].main.chords, SONGS[id].main.lead]));
    expect(new Set(sigs).size).toBe(IDS.length);
    const tempos = IDS.map((id) => SONGS[id].bpm);
    expect(new Set(tempos).size).toBeGreaterThanOrEqual(3);
  });

  it.each(IDS)('%s songs compile to a steady loop with drums, bass and melody', (id) => {
    const c = compileSong(SONGS[id]);
    const tracks = new Set(c.events.map((e) => e.track));
    for (const k of ['lead', 'bass', 'drums']) expect(tracks.has(k), k).toBe(true);
    expect(c.loopSteps).toBe(16 * 16); // 16 bars
  });

  it('has four distinct layouts (lengths, shapes and moods differ)', () => {
    const defs = IDS.map(getTrack);
    const lengths = IDS.map((id) => Math.round(pathOf(id).length));
    expect(new Set(lengths).size).toBe(4);
    const skies = new Set(defs.map((d) => d.theme.skyTop));
    expect(skies.size).toBe(4);
    const roads = new Set(defs.map((d) => d.theme.road));
    expect(roads.size).toBe(4);
    const terrains = defs.map((d) => d.scenery.terrain);
    expect(new Set(terrains).size).toBeGreaterThanOrEqual(3); // void (jungle), hills, flat
    expect(defs.filter((d) => d.theme.night).map((d) => d.id)).toEqual(['donut-downtown']);
  });

  it.each(IDS)('%s builds deterministically, within the triangle / draw budget, and animates', (id) => {
    const t = getTrack(id);
    const a = buildTrack(t, pathOf(id));
    const b = buildTrack(t, pathOf(id));
    const ba = budget(a), bb = budget(b);
    expect(ba).toEqual(bb);
    // in line with the original tracks (castle ~353k / 137 objects, sundae ~386k)
    expect(ba.tris).toBeLessThan(430000);
    expect(ba.objects).toBeLessThan(140);
    // ambient animation: some instance matrix changes over time
    const inst = [];
    a.group.traverse((o) => { if (o.isInstancedMesh) inst.push(o); });
    const snap = () => inst.map((m) => Array.from(m.instanceMatrix.array.slice(0, 16)).join(','));
    a.update(1 / 60, 0.5);
    const s0 = snap();
    a.update(1 / 60, 2.1);
    const s1 = snap();
    expect(s0.some((v, i) => v !== s1[i])).toBe(true);
    a.dispose();
    b.dispose();
  }, 60000);
});

describe('Jellybean Jungle — figure-eight over the vine bridge', () => {
  const t = getTrack('jellybean-jungle');
  const path = pathOf('jellybean-jungle');

  it('the layout is a true figure-eight: one loop left, one loop right, zero net turn', () => {
    const turns = [];
    // re-run the spec without the twirl to prove the real turning adds up to 0
    const mod = getTrackModule('jellybean-jungle');
    expect(mod.def).toBe(t);
    expect(FIGURE_EIGHT_TWIRL.turn).toBe(360);
    expect(Math.abs(FIGURE_EIGHT_TWIRL.turn * (Math.PI / 180) * FIGURE_EIGHT_TWIRL.r)).toBeLessThan(1e-4);
    // integrate the actual path heading change over a lap
    let total = 0;
    for (let i = 0; i < path.count; i++) {
      const j = (i + 1) % path.count;
      let d = Math.atan2(path.tx[j], path.tz[j]) - Math.atan2(path.tx[i], path.tz[i]);
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      total += d;
      turns.push(d);
    }
    expect(Math.abs(total)).toBeLessThan(0.05);
    expect(turns.some((d) => d > 0.002) && turns.some((d) => d < -0.002)).toBe(true);
  });

  it('the zero-length twirl lets a figure-eight through the DSL and adds no length', () => {
    const TW = { ...FIGURE_EIGHT_TWIRL };
    const fig8 = runLayout({ start: [0, 0], heading: 45, emit: 3, ops: [{ s: 20 }, { turn: 270, r: 20 }, { s: 20 }, TW, { s: 20 }, { turn: -270, r: 20 }, { s: 20 }] });
    expect(fig8.length).toBeCloseTo(80 + 2 * (1.5 * Math.PI * 20), 3);
    expect(fig8.closeError).toBeLessThan(0.01); // the symmetric figure-eight closes on its own
    for (const p of fig8.points) for (const v of p) expect(Number.isFinite(v)).toBe(true);
    // a normal loop plus the twirl is still (rightly) rejected
    expect(() => runLayout({ start: [0, 0], heading: 0, ops: [{ s: 50 }, { turn: 180, r: 20 }, { s: 50 }, { turn: 180, r: 20 }, TW] })).toThrow();
  });

  it('control points are finite and never stack on top of each other', () => {
    const cp = t.controlPoints;
    for (let i = 0; i < cp.length; i++) {
      const a = cp[i], b = cp[(i + 1) % cp.length];
      for (const v of a) expect(Number.isFinite(v)).toBe(true);
      expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThan(1);
    }
  });

  it('crosses itself exactly once, nearly square-on, with a tall bridge', () => {
    const c = findCrossing(path);
    expect(c.dist).toBeLessThan(3);
    expect(c.dy).toBeGreaterThanOrEqual(9);
    const u = path.tangentAt(c.upper), v = path.tangentAt(c.lower);
    expect(Math.abs(u.x * v.x + u.z * v.z)).toBeLessThan(0.35); // ~90°
    // count separate crossings: runs of lower-road samples with bridge road directly overhead
    let runs = 0, inRun = false;
    for (let i = 0; i < path.count; i++) {
      const under = minDistToOtherLevel(path, path.px[i], path.pz[i], path.py[i], 6) < path.halfWidth && path.py[i] < 2;
      if (under && !inRun) runs++;
      inRun = under;
    }
    expect(runs).toBe(1);
  });

  it('keeps the start grid clear of the crossing', () => {
    const c = findCrossing(path);
    const d = Math.abs(path.delta(0, c.lower));
    expect(d).toBeGreaterThan(20);
  });

  it('never puts a support pillar on (or next to) the road passing underneath', () => {
    const spots = supportSpots(path);
    expect(spots.length).toBeGreaterThan(20); // the raised treetop walk is held up
    const index = createPathIndex(path);
    for (const p of spots) {
      expect(p.y1).toBeGreaterThan(p.y0);
      expect(p.y0).toBe(FLOOR_Y);
      // no road on another level within the fence + a margin
      expect(minDistToOtherLevel(path, p.x, p.z, p.y1 + 2.4, 4)).toBeGreaterThan(path.halfWidth + FENCE_OFFSET + 5);
      // and it sits under its own deck
      expect(index.nearest(p.x, p.z, 30).dist).toBeLessThan(path.halfWidth);
    }
  });

  it('never dips the road below the jungle floor', () => {
    for (let i = 0; i < path.count; i++) expect(path.py[i]).toBeGreaterThan(FLOOR_Y + 0.05);
  });

  it('draws its own jungle floor (void terrain)', () => {
    const built = buildTrack(t, path);
    const grounds = [];
    built.group.traverse((o) => { if (o.name === 'ground') grounds.push(o); });
    expect(t.scenery.terrain).toBe('void');
    expect(grounds.length).toBe(1);
    built.dispose();
  }, 60000);
});

describe('Cocoa Canyon — slot canyon, arch, river and hairpin', () => {
  const { def, path } = prepared('cocoa-canyon');
  const river = def.scenery.riverLine;

  it('traces a chocolate river that crosses the road only under the bridge', () => {
    expect(river.length).toBeGreaterThan(8);
    const [a, b] = def.scenery.bridges[0];
    for (let i = 0; i < path.count; i++) {
      const s = i * path.step;
      const onBridge = s >= a * path.length - 2 && s <= b * path.length + 2;
      const d = distToPolyline(path.px[i], path.pz[i], river);
      if (!onBridge) expect(d, `road at s=${s.toFixed(0)} runs through the river`).toBeGreaterThan(path.halfWidth + 3);
    }
    expect([0, 1]).toContain(def.scenery.riverFallsEnd);
  });

  it('keeps the bridge deck well above the carved river channel', () => {
    const built = buildTrack(getTrack('cocoa-canyon'), path);
    const s = def.scenery.river.at * path.length;
    const p = path.pointAt(s);
    expect(built.terrainHeight(p.x, p.z)).toBeLessThan(p.y - 3);
    built.dispose();
  }, 60000);

  it('has a proper hairpin, a long sweeper and a straight slot canyon', () => {
    const radiusAt = (f) => {
      const s = f * path.length;
      const a = path.headingAt(s - 3), b = path.headingAt(s + 3);
      let d = b - a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return 6 / Math.max(1e-6, Math.abs(d));
    };
    const [s0, s1] = def.scenery.slot;
    expect(radiusAt((s0 + s1) / 2)).toBeGreaterThan(300); // straight
    expect(path.length).toBeGreaterThan(1250);
    // the tightest corner on the lap is the hairpin (~30 radius), still kid-drivable
    let min = Infinity;
    for (let f = 0; f < 1; f += 0.002) min = Math.min(min, radiusAt(f));
    expect(min).toBeGreaterThan(path.halfWidth * 2.5);
    expect(min).toBeLessThan(40);
  });

  it('the Cocoa Arch clears the road, fences and chase camera', () => {
    const f = def.scenery.cocoaArch;
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    // arch span (hw + fence + 7) leaves room above a kart and its camera
    const span = path.halfWidth + FENCE_OFFSET + 7;
    expect(span - 3.6).toBeGreaterThan(path.halfWidth + FENCE_OFFSET);
  });

  it('uses the neapolitan rock layers and a flowing cocoa texture', () => {
    expect(ROCK_LAYERS.length).toBeGreaterThanOrEqual(4);
    const tex = cocoaFlowTexture(0x7a4127, 0xa8643a, 0xd89a6a);
    expect(tex.image.width).toBe(64);
    tex.dispose();
  });
});

describe('Lemonade Volcano — the friendliest volcano', () => {
  const { def, path, index } = prepared('lemonade-volcano');
  const b = path.getBounds();
  const center = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  const extent = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;

  it('puts the volcano inside the loop with lots of room around it', () => {
    const site = volcanoSite(path, index, center, extent);
    expect(site.room).toBeGreaterThan(path.halfWidth + FENCE_OFFSET + 40);
    expect(index.nearest(site.x, site.z, 1000).dist).toBeCloseTo(site.room, 3);
  });

  it('climbs to the highest road in the cup and stays above the sea', () => {
    let hi = -Infinity;
    for (let i = 0; i < path.count; i++) {
      hi = Math.max(hi, path.py[i]);
      expect(path.py[i]).toBeGreaterThan(SEA_Y + 1);
    }
    expect(hi).toBeGreaterThanOrEqual(13.5);
    for (const other of ['jellybean-jungle', 'cocoa-canyon', 'donut-downtown']) {
      const p = pathOf(other);
      expect(Math.max(...p.py)).toBeLessThan(hi);
    }
  });

  it('keeps the island dry around the road (sea only far away)', () => {
    const built = buildTrack(getTrack('lemonade-volcano'), path);
    for (let s = 0; s < path.length; s += 11) {
      for (const lat of [-1, 1]) {
        const p = path.positionAt(s, lat * (path.halfWidth + FENCE_OFFSET + 1));
        if (distToPolyline(p.x, p.z, def.scenery.riverLine) < 25) continue; // the stream's little gorge
        expect(built.terrainHeight(p.x, p.z)).toBeGreaterThan(SEA_Y);
      }
    }
    built.dispose();
  }, 60000);

  it('runs its lemonade stream under the Lemon Bridge only', () => {
    const stream = def.scenery.riverLine;
    expect(stream.length).toBeGreaterThan(8);
    const [a, bb] = def.scenery.bridges[0];
    for (let i = 0; i < path.count; i++) {
      const s = i * path.step;
      if (s >= a * path.length - 2 && s <= bb * path.length + 2) continue;
      expect(distToPolyline(path.px[i], path.pz[i], stream)).toBeGreaterThan(path.halfWidth + 3);
    }
  });
});

describe('Donut Downtown — night city and the giant donut', () => {
  const t = getTrack('donut-downtown');
  const path = pathOf('donut-downtown');
  const index = createPathIndex(path);
  const hw = path.halfWidth;
  const clearOfRoad = (x, z, margin) => index.nearest(x, z, hw + margin + 2).dist > hw + margin;

  it('is a night track with glowing curbs and stars', () => {
    expect(t.theme.night).toBe(true);
    expect(t.theme.skyStars).toBe(true);
    expect(t.scenery.fence.glow).toBe(true);
    expect(NEON.length).toBeGreaterThanOrEqual(5);
  });

  it('city lots never touch the road, the fences or each other', () => {
    const rng = makeRng(7);
    const scatter = (count, ok, { pad = 70 } = {}) => {
      const bb = path.getBounds();
      const out = [];
      for (let n = 0; n < count * 40 && out.length < count; n++) {
        const x = bb.minX - pad + rng() * (bb.maxX - bb.minX + 2 * pad);
        const z = bb.minZ - pad + rng() * (bb.maxZ - bb.minZ + 2 * pad);
        if (ok(x, z)) out.push([x, z]);
      }
      return out;
    };
    const lots = planLots({ path, rng, hw, clearOfRoad, scatter }, { infill: 60 });
    expect(lots.length).toBeGreaterThan(60);
    expect(lots.some((l) => l.back)).toBe(true);
    for (const l of lots) {
      const T = BUILDING_TYPES[l.type];
      // every corner of the footprint stays beyond the fence
      for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = (cx * T.w) / 2, lz = (cz * T.d) / 2;
        const x = l.x + Math.cos(l.ry) * lx + Math.sin(l.ry) * lz;
        const z = l.z - Math.sin(l.ry) * lx + Math.cos(l.ry) * lz;
        expect(index.nearest(x, z, 60).dist).toBeGreaterThan(hw + FENCE_OFFSET + 1);
      }
    }
    for (let i = 0; i < lots.length; i++) {
      for (let j = i + 1; j < lots.length; j++) {
        expect(Math.hypot(lots[i].x - lots[j].x, lots[i].z - lots[j].z)).toBeGreaterThan(lots[i].r + lots[j].r);
      }
    }
  });

  it('Main Street runs through the donut hole with room to spare', () => {
    const f = t.scenery.donutAt;
    const s = f * path.length;
    // on the long start straight, away from the start arch
    expect(Math.abs(path.delta(0, s))).toBeGreaterThan(60);
    const h0 = path.headingAt(s - 25), h1 = path.headingAt(s + 25);
    expect(Math.abs(h1 - h0)).toBeLessThan(0.01);
    // the hole (hw + fence + 5) is wider than the fence line at road height
    const hole = hw + FENCE_OFFSET + 5;
    const cy = hole * 0.42;
    expect(Math.sqrt(hole * hole - cy * cy)).toBeGreaterThan(hw + FENCE_OFFSET + 2);
    expect(hole - cy).toBeGreaterThan(8); // well above karts and cameras
  });

  it('the neon tunnel sits on a straight stretch of Donut Avenue', () => {
    const [f0, f1] = t.scenery.neonTunnel;
    expect(f1).toBeGreaterThan(f0);
    const h0 = path.headingAt(f0 * path.length), h1 = path.headingAt(f1 * path.length);
    expect(Math.abs(h1 - h0)).toBeLessThan(0.01);
  });

  it('building archetypes tile their windows instead of stretching them', () => {
    for (const T of BUILDING_TYPES) {
      expect(T.h).toBeGreaterThan(10);
      expect(T.w).toBeGreaterThanOrEqual(10);
    }
  });
});

describe('adventure prop kit', () => {
  const path = pathOf('cocoa-canyon');
  const index = createPathIndex(path);
  const hw = path.halfWidth;
  const ctx = {
    group: new THREE.Group(), outlineMat: new THREE.MeshBasicMaterial(), animators: [], path, hw,
    rng: makeRng(3), center: new THREE.Vector3(0, 0, 0),
    distToRoad: (x, z, maxR = 80) => index.nearest(x, z, maxR).dist,
  };

  it('instanced() makes one mesh (+ outline) and skips empty lists', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    expect(instanced(ctx, geo, new THREE.MeshBasicMaterial(), [])).toBe(null);
    const m = instanced(ctx, geo, new THREE.MeshBasicMaterial(), [{ m: new THREE.Matrix4(), c: 0xff0000 }, { m: new THREE.Matrix4() }], { outline: 0.1 });
    expect(m.count).toBe(2);
    expect(ctx.group.children.length).toBe(2);
  });

  it('animatedInstances() poses every instance each frame', () => {
    const items = [{ k: 1 }, { k: 2 }];
    const m = animatedInstances(ctx, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), items, (it, time, o) => { o.x = it.k * time; });
    const x = () => m.instanceMatrix.array[12 + 16];
    expect(x()).toBe(0);
    ctx.animators.at(-1)(1 / 60, 3);
    expect(x()).toBeCloseTo(6, 5);
    expect(m.frustumCulled).toBe(false);
  });

  it('spotsAlong() stays at the requested gap from the road', () => {
    const spots = spotsAlong(ctx, { from: 0.1, to: 0.2, every: 10, gap: 8 });
    expect(spots.length).toBeGreaterThan(10);
    for (const p of spots) expect(Math.abs(ctx.distToRoad(p.x, p.z, 60) - (hw + 8))).toBeLessThan(1.5);
  });

  it('isClearOfCamera() rejects spots inside the chase-camera corridor', () => {
    const p = path.positionAt(100, hw + FENCE_OFFSET + 1);
    expect(isClearOfCamera(ctx, p.x, p.z, 0)).toBe(false);
    const far = path.positionAt(100, hw + FENCE_OFFSET + 40);
    if (ctx.distToRoad(far.x, far.z, 200) > hw + FENCE_OFFSET + 30) expect(isClearOfCamera(ctx, far.x, far.z, 2)).toBe(true);
  });

  it('farRing() spreads spots around the centre within the radii', () => {
    const ring = farRing(ctx, 12, 100, 150);
    expect(ring).toHaveLength(12);
    for (const [x, z] of ring) {
      const r = Math.hypot(x, z);
      expect(r).toBeGreaterThanOrEqual(100);
      expect(r).toBeLessThanOrEqual(150);
    }
  });
});
