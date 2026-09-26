// Superstar Cup tracks (cupcake-carnival, aurora-palace, moonbounce-base, ribbon-sky):
// the specific features each world promises, on top of the shared registry tests
// (tests/tracks.test.js, tracksBuilder, registries, race.fairness) that already run over them.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TRACK_PACKS, getTrack, getTrackModule } from '../src/tracks/index.js';
import { LINEUP_CUPS } from '../src/content/lineup.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack } from '../src/tracks/core.js';
import { createPathIndex, createTerrain, distToPolyline } from '../src/tracks/pathTools.js';
import { FENCE_OFFSET } from '../src/tracks/constants.js';
import { SONGS } from '../src/audio/songs.js';
import { compileSong } from '../src/audio/compile.js';
import { parseChord } from '../src/audio/theory.js';
import { normalizeGameplay, GAMEPLAY_LIMITS } from '../src/race/gameplay.js';
import { Race } from '../src/race/Race.js';
import { CHARACTERS } from '../src/data/characters.js';
import { stripedGeometry, mergeAll, instanced, findSpot, bunting, snowfall } from '../src/tracks/props/superstar-kit.js';

/** Building a whole world is heavy on a busy machine: give those tests room. */
const HEAVY = 60000;
const IDS = ['cupcake-carnival', 'aurora-palace', 'moonbounce-base', 'ribbon-sky'];
const defs = Object.fromEntries(IDS.map((id) => [id, getTrack(id)]));
const paths = Object.fromEntries(IDS.map((id) => [id, new TrackPath(defs[id].controlPoints, defs[id].width)]));
const built = {};
const builtFor = (id) => (built[id] ??= buildTrack(defs[id], paths[id]));

/** Signed curvature samples (rad per unit) along the path. */
function curvature(path, window = 3) {
  const n = path.count;
  const w = Math.max(1, Math.round(window / path.step));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - w + n) % n, b = (i + w) % n;
    let d = Math.atan2(path.tx[b], path.tz[b]) - Math.atan2(path.tx[a], path.tz[a]);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out[i] = d / (2 * w * path.step);
  }
  return out;
}

/** Local elevation maxima (bumps) between two lap fractions, at least `minRise` above their neighbourhood. */
function bumpsBetween(path, f0, f1, minRise = 0.8) {
  const i0 = Math.floor(f0 * path.count), i1 = Math.floor(f1 * path.count);
  const w = Math.round(20 / path.step);
  let bumps = 0;
  for (let i = i0 + w; i < i1 - w; i++) {
    const y = path.py[i];
    let isMax = true, lo = Infinity;
    for (let k = -w; k <= w; k++) {
      if (k === 0) continue;
      const yk = path.py[(i + k) % path.count];
      if (yk > y) { isMax = false; break; }
      lo = Math.min(lo, yk);
    }
    if (isMax && y - lo >= minRise) { bumps++; i += w; }
  }
  return bumps;
}

/** Zones where the road passes over/under itself: [{ s1, s2, dy, dist }]. */
function crossings(path, width) {
  const out = [];
  const n = path.count;
  for (let i = 0; i < n; i += 2) {
    for (let j = i + 2; j < n; j += 2) {
      let ds = Math.abs(i - j) * path.step;
      ds = Math.min(ds, path.length - ds);
      if (ds <= 60) continue;
      const d = Math.hypot(path.px[i] - path.px[j], path.pz[i] - path.pz[j]);
      if (d > width * 1.5) continue;
      const hit = { s1: i * path.step, s2: j * path.step, dy: Math.abs(path.py[i] - path.py[j]), dist: d };
      const zone = out.find((z) => Math.abs(path.delta(z.s1, hit.s1)) < 80 && Math.abs(path.delta(z.s2, hit.s2)) < 80);
      if (!zone) out.push({ ...hit, minDy: hit.dy });
      else zone.minDy = Math.min(zone.minDy, hit.dy);
    }
  }
  return out;
}

describe('Superstar Cup registration', () => {
  it('registers exactly the four lineup tracks in cup order', () => {
    const pack = TRACK_PACKS.find((p) => p.cup === 'superstar-cup');
    expect(pack.modules.map((m) => m.def.id)).toEqual(LINEUP_CUPS.find((c) => c.id === 'superstar-cup').trackIds);
    expect(pack.modules.map((m) => m.def.id)).toEqual(IDS);
  });

  it.each(IDS)('%s has its own happy song, named after the track', (id) => {
    const def = defs[id];
    expect(def.theme.music).toBe(id);
    const song = SONGS[id];
    expect(song, `src/audio/songs/${id}.js`).toBeTruthy();
    expect(song.id).toBe(id);
    // major key: the first chord is major and the melody stays inside its major scale
    const key = parseChord(song.main.chords[0]);
    expect(key.intervals.slice(0, 3)).toEqual([0, 4, 7]);
    const scale = new Set([0, 2, 4, 5, 7, 9, 11].map((s) => (key.rootPc + s) % 12));
    const lead = compileSong(song).events.filter((e) => e.track === 'lead' || e.track === 'counter');
    expect(lead.length).toBeGreaterThan(40);
    for (const e of lead) expect(scale.has(e.midi % 12), `${id} note ${e.midi}`).toBe(true);
  });

  it('gives every track a different song tempo and feel', () => {
    const bpms = IDS.map((id) => SONGS[id].bpm);
    expect(new Set(bpms).size).toBe(IDS.length);
    const leads = IDS.map((id) => SONGS[id].instruments.lead);
    expect(new Set(leads).size).toBe(IDS.length);
  });

  it('uses friendly words on the banners and subtitles', () => {
    for (const id of IDS) {
      const text = `${defs[id].name} ${defs[id].subtitle} ${defs[id].scenery.arch.text}`.toLowerCase();
      for (const bad of ['kill', 'die', 'dead', 'crash', 'destroy', 'hit', 'fight', 'bomb']) expect(text).not.toMatch(new RegExp(`\\b${bad}\\b`));
    }
  });

  it('gives each world its own sky, road and mood', () => {
    const key = (id) => ['skyTop', 'road', 'fogColor', 'curbA'].map((k) => defs[id].theme[k]).join(',');
    expect(new Set(IDS.map(key)).size).toBe(IDS.length);
    expect(new Set(IDS.map((id) => defs[id].scenery.terrain))).toEqual(new Set(['flat', 'hills', 'void']));
    expect(defs['aurora-palace'].theme.night && defs['moonbounce-base'].theme.night).toBe(true);
    expect(defs['cupcake-carnival'].theme.night || defs['ribbon-sky'].theme.night).toBeFalsy();
  });
});

describe.each(IDS)('%s layout personality', (id) => {
  const path = paths[id];

  it('is not a plain oval: it has both left- and right-hand bends', () => {
    const k = curvature(path);
    const left = k.some((v) => v > 1 / 90), right = k.some((v) => v < -1 / 90);
    expect(left && right).toBe(true);
  });

  it('has at least one tight, exciting turn (radius under 45) that is still kid-drivable', () => {
    const k = curvature(path);
    const maxK = Math.max(...Array.from(k, Math.abs));
    expect(1 / maxK).toBeLessThan(45);
    expect(1 / maxK).toBeGreaterThan(defs[id].width * 1.15);
  });

  it('builds the same world every time (seeded)', () => {
    // compare a fresh build with the shared one; attributes that animation rewrites
    // (snow, streamers: version > 0) are skipped so test order does not matter
    const a = buildTrack(defs[id], path);
    const sig = (g) => {
      const out = [];
      g.traverse((o) => {
        if (!o.geometry) return;
        const p = o.geometry.attributes.position;
        out.push({ n: p.count, v: p.version, x: Math.round((p.getX(0) + p.getY(Math.floor(p.count / 2)) + p.getZ(p.count - 1)) * 100) });
      });
      return out;
    };
    const sa = sig(a.group), sb = sig(builtFor(id).group);
    expect(sa.map((e) => e.n)).toEqual(sb.map((e) => e.n));
    sa.forEach((e, i) => { if (e.v === 0 && sb[i].v === 0) expect(e.x).toBe(sb[i].x); });
    a.dispose();
  }, HEAVY);

  it('stays inside the scenery budget (triangles and draw calls like the original tracks)', () => {
    let tris = 0, objects = 0;
    builtFor(id).group.traverse((o) => {
      if (!o.geometry) return;
      objects++;
      const g = o.geometry;
      const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tris += t * (o.isInstancedMesh ? o.count : 1);
    });
    expect(tris).toBeLessThan(400000);
    expect(objects).toBeLessThan(140);
  }, HEAVY);

  it('animates for a long time (and through wild frame times) without NaNs', () => {
    const b = builtFor(id);
    const dts = [1 / 60, 0.5, 0, 1 / 144, 0.2];
    for (let k = 0; k < 240; k++) b.update(dts[k % dts.length], 3 + k / 30);
    const m = new THREE.Matrix4();
    b.group.traverse((o) => {
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i += Math.max(1, Math.floor(o.count / 16))) {
          o.getMatrixAt(i, m);
          expect(m.elements.every(Number.isFinite), `${o.name || o.type} #${i}`).toBe(true);
        }
      } else if (o.isMesh || o.isPoints) {
        expect([o.position.x, o.position.y, o.position.z, o.rotation.y].every(Number.isFinite)).toBe(true);
      }
    });
  }, HEAVY);

  it('never parks a prop on the road: named landmarks stay clear of the fences or high overhead', () => {
    const b = builtFor(id);
    const index = createPathIndex(path);
    const hw = path.halfWidth;
    const v = new THREE.Vector3();
    b.group.updateMatrixWorld(true);
    for (const name of ['ferris-wheel', 'carousel', 'rocket', 'radar', 'twirl-bow', 'superstar']) {
      b.group.traverse((o) => {
        if (o.name !== name) return;
        o.getWorldPosition(v);
        expect(index.nearest(v.x, v.z, 400).dist, `${id} ${name}`).toBeGreaterThan(hw + FENCE_OFFSET + 8);
      });
    }
  }, HEAVY);
});

describe('Cupcake Carnival specifics', () => {
  const def = defs['cupcake-carnival'];
  const path = paths['cupcake-carnival'];

  it('is shaped like a cupcake: a narrow wrapper bottom under a wide frosting top', () => {
    const b = path.getBounds();
    const zs = [b.minZ, b.maxZ];
    const start = path.pointAt(0);
    // the wrapper bottom (start straight) is on the z edge nearest the start line
    const bottomZ = Math.abs(start.z - zs[0]) < Math.abs(start.z - zs[1]) ? zs[0] : zs[1];
    const topZ = bottomZ === zs[0] ? zs[1] : zs[0];
    const spanNear = (z0) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < path.count; i++) {
        if (Math.abs(path.pz[i] - z0) > (b.maxZ - b.minZ) * 0.25) continue;
        lo = Math.min(lo, path.px[i]); hi = Math.max(hi, path.px[i]);
      }
      return hi - lo;
    };
    expect(spanNear(topZ)).toBeGreaterThan(spanNear(bottomZ) * 1.3);
  });

  it('has three roller-coaster humps on the wrapper side', () => {
    const [f0] = def.scenery.spots.coaster;
    const f1 = def.scenery.spots.coaster[2];
    expect(bumpsBetween(path, f0 - 0.04, f1 + 0.04, 0.7)).toBe(3);
  });

  it('builds the ferris wheel, carousel and a big-top tent high enough to drive under', () => {
    const b = builtFor('cupcake-carnival');
    const tent = b.group.getObjectByName('big-top');
    expect(tent).toBeTruthy();
    const roof = tent.children.find((c) => c.isMesh && c.material.vertexColors); // the striped cone
    const box = new THREE.Box3().setFromObject(roof);
    const roadY = path.pointAt(def.scenery.spots.tent * path.length).y;
    expect(box.min.y - roadY).toBeGreaterThan(8); // chase camera sits ~3 m up
    expect(b.group.getObjectByName('ferris-wheel')).toBeTruthy();
    expect(b.group.getObjectByName('carousel')).toBeTruthy();
  }, HEAVY);
});

describe('Aurora Ice Palace specifics', () => {
  const mod = getTrackModule('aurora-palace');
  const path = paths['aurora-palace'];
  const index = createPathIndex(path);
  const prepared = mod.prepare({ def: mod.def, path, index });

  it('zig-zags up the glacier on two switchbacks (U-turns within 120 m)', () => {
    const k = curvature(path);
    let hairpins = 0;
    const span = Math.round(120 / path.step);
    for (let i = 0; i < path.count; i++) {
      let turn = 0;
      for (let j = 0; j < span; j++) turn += k[(i + j) % path.count] * path.step;
      if (Math.abs(turn) > Math.PI * 0.92) { hairpins++; i += span; }
    }
    expect(hairpins).toBeGreaterThanOrEqual(2);
  });

  it('crosses a frozen river on a raised ice bridge', () => {
    const river = prepared.scenery.riverLine;
    expect(river.length).toBeGreaterThan(8);
    const terrain = createTerrain(prepared, path, index);
    const [a, bEnd] = prepared.scenery.bridges[0];
    const mid = path.pointAt(((a + bEnd) / 2) * path.length);
    expect(distToPolyline(mid.x, mid.z, river)).toBeLessThan(8);
    expect(mid.y - terrain.height(mid.x, mid.z)).toBeGreaterThan(2.4); // tall enough for pillars
    // the river never runs under any other part of the road
    for (let i = 0; i < path.count; i += 3) {
      const s = i * path.step;
      if (s > a * path.length - 40 && s < bEnd * path.length + 40) continue;
      expect(distToPolyline(path.px[i], path.pz[i], river)).toBeGreaterThan(path.halfWidth);
    }
  });

  it('climbs to the palace and slides back down (big but gentle elevation change)', () => {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < path.count; i++) { lo = Math.min(lo, path.py[i]); hi = Math.max(hi, path.py[i]); }
    expect(hi - lo).toBeGreaterThan(10);
  });

  it('dances with northern lights', () => {
    const b = builtFor('aurora-palace');
    const curtains = [];
    b.group.traverse((o) => { if (o.name === 'aurora') curtains.push(o); });
    expect(curtains.length).toBeGreaterThanOrEqual(3);
    const t0 = curtains[0].material.uniforms.time.value;
    b.update(1 / 60, t0 + 5);
    expect(curtains[0].material.uniforms.time.value).not.toBe(t0);
    expect(curtains[0].material.blending).toBe(THREE.AdditiveBlending);
  }, HEAVY);
});

describe('Moonbounce Base specifics', () => {
  const def = defs['moonbounce-base'];
  const path = paths['moonbounce-base'];

  it('asks for low gravity and bigger hops through def.gameplay', () => {
    expect(def.gameplay).toEqual({ gravity: 0.55, hopBoost: 1.4 });
    const g = normalizeGameplay(def.gameplay);
    expect(g.gravity).toBeLessThan(1);
    expect(g.gravity).toBeGreaterThanOrEqual(GAMEPLAY_LIMITS.gravity[0]);
    expect(g.hopBoost).toBeGreaterThan(1);
    expect(g.hopBoost).toBeLessThanOrEqual(GAMEPLAY_LIMITS.hopBoost[1]);
    // no other Superstar track changes physics
    for (const id of IDS.filter((x) => x !== 'moonbounce-base')) expect(defs[id].gameplay).toBeUndefined();
  });

  it('hands the low gravity to the race physics (env.gameplay)', () => {
    const b = builtFor('moonbounce-base');
    const race = new Race({
      scene: new THREE.Scene(), trackDef: def, path, builtTrack: b,
      participants: CHARACTERS.filter((c) => !c.locked).slice(0, 8).map((c, i) => ({ characterId: c.id, playerIndex: i === 0 ? 0 : null, easyDrive: false })),
      speedClass: 'zippy', buildKartModel: () => ({ group: new THREE.Group(), update() {}, dispose() {} }), laps: 1, seed: 4,
    });
    expect(race.gameplay.gravity).toBe(0.55);
    expect(race.gameplay.hopBoost).toBe(1.4);
    for (let k = 0; k < 400; k++) race.update(1 / 60, [{ steer: 0, accel: 1, drift: k % 90 < 30 }]);
    for (const kart of race.karts) expect(Number.isFinite(kart.position.y)).toBe(true);
    race.dispose();
  }, HEAVY);

  it('bounces over four moon moguls, each with a glowing bounce pad', () => {
    const f = def.scenery.spots.moguls;
    expect(f).toHaveLength(4);
    expect(bumpsBetween(path, f[0] - 0.04, f[3] + 0.04, 0.7)).toBe(4);
    const pads = builtFor('moonbounce-base').group.getObjectByName('bounce-pads');
    expect(pads.geometry.attributes.position.count).toBeGreaterThan(0);
  }, HEAVY);

  it('is shaped like a crescent moon: two hairpin tips and a concave inner rim', () => {
    const k = curvature(path);
    const tight = Array.from(k).filter((v) => Math.abs(v) > 1 / 35).length * path.step;
    expect(tight).toBeGreaterThan(2 * 60); // two ~175° hairpins of radius 30
    const rim = def.scenery.spots.crater * path.length;
    expect(k[Math.round(rim / path.step)]).toBeLessThan(0); // the rim bends the other way
  });

  it('puts the rocket in the middle of the crater, well clear of the rim road', () => {
    const b = builtFor('moonbounce-base');
    const rocket = b.group.getObjectByName('rocket');
    const v = rocket.getWorldPosition(new THREE.Vector3());
    const d = createPathIndex(path).nearest(v.x, v.z, 400).dist;
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(70);
  }, HEAVY);

  it('has a glass tube tunnel wide and tall enough for the chase camera', () => {
    const b = builtFor('moonbounce-base');
    const tube = b.group.getObjectByName('glass-tube');
    expect(tube).toBeTruthy();
    const [f0, f1] = def.scenery.spots.tube;
    const mid = path.pointAt(((f0 + f1) / 2) * path.length);
    tube.geometry.computeBoundingBox();
    expect(tube.geometry.boundingBox.max.y - mid.y).toBeGreaterThan(8);
  }, HEAVY);
});

describe('Ribbon Sky Rally specifics (the grand finale)', () => {
  const def = defs['ribbon-sky'];
  const path = paths['ribbon-sky'];

  it('is the longest track of the cup', () => {
    for (const id of IDS.filter((x) => x !== 'ribbon-sky')) expect(path.length).toBeGreaterThan(paths[id].length);
  });

  it('twirls over and under itself exactly twice, with lots of headroom', () => {
    const zones = crossings(path, def.width);
    expect(zones).toHaveLength(2);
    for (const z of zones) {
      expect(z.minDy).toBeGreaterThanOrEqual(8);
      // the lower road's chase camera (~3 m up) stays well below the upper deck's underside (2.4 m thick)
      expect(z.minDy - 2.4 - 3).toBeGreaterThan(2);
    }
  });

  it('floats in the sky (void terrain) with the full rainbow on the road', () => {
    expect(def.scenery.terrain).toBe('void');
    const road = builtFor('ribbon-sky').group.getObjectByName('road');
    const col = road.geometry.attributes.color;
    expect(col).toBeTruthy();
    const seen = new Set();
    for (let i = 0; i < col.count; i += 97) seen.add(`${col.getX(i).toFixed(2)},${col.getY(i).toFixed(2)},${col.getZ(i).toFixed(2)}`);
    expect(seen.size).toBe(7);
    expect(road.material.vertexColors).toBe(true);
  }, HEAVY);

  it('keeps the start grid on the grand straight, before the first twirl', () => {
    const twirl = def.scenery.spots.twirls[0].at * path.length;
    expect(twirl).toBeGreaterThan(60);
    for (let s = -45; s <= 10; s += 5) expect(Math.abs(path.pointAt(s).y - path.pointAt(0).y)).toBeLessThan(0.5);
  });

  it('has a bow floating in each twirl and a superstar trophy in the middle', () => {
    const b = builtFor('ribbon-sky');
    const bows = [];
    b.group.traverse((o) => { if (o.name === 'twirl-bow') bows.push(o); });
    expect(bows).toHaveLength(2);
    expect(b.group.getObjectByName('superstar')).toBeTruthy();
    expect(b.group.getObjectByName('cloud-sea')).toBeTruthy();
  }, HEAVY);
});

describe('Superstar prop kit', () => {
  it('stripedGeometry colours bands around +Y and keeps every triangle', () => {
    const src = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    const g = stripedGeometry(src, [0xff0000, 0x0000ff], 8);
    expect(g.attributes.position.count).toBe(src.toNonIndexed().attributes.position.count);
    const c = g.attributes.color;
    const colours = new Set();
    for (let i = 0; i < c.count; i++) colours.add(c.getX(i) > 0.5 ? 'red' : 'blue');
    expect(colours).toEqual(new Set(['red', 'blue']));
    // each triangle is one flat colour
    for (let i = 0; i < c.count; i += 3) {
      expect(c.getX(i)).toBe(c.getX(i + 1));
      expect(c.getX(i)).toBe(c.getX(i + 2));
    }
  });

  it('mergeAll merges mixed geometries (and colours on request)', () => {
    const a = new THREE.BoxGeometry(1, 1, 1);
    const b = new THREE.SphereGeometry(1, 4, 3);
    const m = mergeAll([a, b]);
    expect(m.attributes.position.count).toBe(a.toNonIndexed().attributes.position.count + b.toNonIndexed().attributes.position.count);
    expect(m.attributes.normal).toBeTruthy();
    const ca = a.toNonIndexed(); ca.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(ca.attributes.position.count * 3).fill(1), 3));
    expect(mergeAll([ca], { color: true }).attributes.color.count).toBe(ca.attributes.position.count);
  });

  it('instanced() skips empty lists and adds an outline copy', () => {
    const group = new THREE.Group();
    const ctx = { group, outlineMat: new THREE.MeshBasicMaterial() };
    expect(instanced(ctx, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), [])).toBe(null);
    const m = instanced(ctx, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), [{ m: new THREE.Matrix4(), c: 0xff0000 }, { m: new THREE.Matrix4() }]);
    expect(m.count).toBe(2);
    expect(group.children).toHaveLength(2);
    expect(m.userData.outline.count).toBe(2);
  });

  it('findSpot keeps big props clear of the road, and bunting spans both fences', () => {
    const path = paths['cupcake-carnival'];
    const index = createPathIndex(path);
    let seed = 1;
    const ctx = {
      path, hw: path.halfWidth, center: new THREE.Vector3(0, 0, 0),
      clearOfRoad: (x, z, margin) => index.nearest(x, z, path.halfWidth + margin + 2).dist > path.halfWidth + margin,
      scatter: (n, ok) => {
        const out = [];
        for (let k = 0; k < 4000 && out.length < n; k++) {
          seed = (seed * 16807) % 2147483647;
          const x = (seed / 2147483647 - 0.5) * 600;
          seed = (seed * 16807) % 2147483647;
          const z = (seed / 2147483647 - 0.5) * 600;
          if (ok(x, z)) out.push([x, z]);
        }
        return out;
      },
    };
    const p0 = path.pointAt(0);
    const [x, z] = findSpot(ctx, [p0.x, p0.z], 20); // start on the road: must move off it
    expect(index.nearest(x, z, 500).dist).toBeGreaterThan(path.halfWidth + FENCE_OFFSET + 20);
    const col = bunting(ctx, 10, { flags: 12 });
    expect(col.flags).toHaveLength(12);
    expect(col.poles).toHaveLength(2);
    const e = new THREE.Vector3();
    for (const pole of col.poles) {
      e.setFromMatrixPosition(pole.m);
      expect(index.nearest(e.x, e.z, 100).dist).toBeGreaterThan(path.halfWidth + FENCE_OFFSET);
    }
  });

  it('snowfall keeps falling forever and wraps back to the top', () => {
    const anims = [];
    let r = 0.3;
    const ctx = {
      rng: () => (r = (r * 9301 + 0.49297) % 1), center: new THREE.Vector3(), extent: 50, group: new THREE.Group(),
      own: (m) => m, ownTex: (t) => t, animate: (fn) => anims.push(fn),
    };
    const pts = snowfall(ctx, 50, { top: 20, bottom: -2 });
    for (let k = 0; k < 600; k++) anims.forEach((fn) => fn(1 / 30, k / 30));
    const a = pts.geometry.attributes.position.array;
    for (let i = 0; i < 50; i++) {
      expect(a[i * 3 + 1]).toBeGreaterThanOrEqual(-2.5);
      expect(a[i * 3 + 1]).toBeLessThanOrEqual(20);
    }
  });
});
