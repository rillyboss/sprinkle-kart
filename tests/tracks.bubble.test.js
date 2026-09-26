// Bubble Cup tracks (bubblegum-bay, mermaid-lagoon, teddy-toyland, honeycomb-hive):
// cup data, each track's signature feature, the shared prop kit, songs and budgets.
// The generic track contract (length, radii, pads, fairness...) is covered by the
// shared registry tests that run over every registered track.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TRACKS, getTrackModule } from '../src/tracks/index.js';
import BUBBLE from '../src/tracks/pack-bubble.js';
import { LINEUP_CUPS, LINEUP_TRACKS } from '../src/content/lineup.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { buildTrack, createPathIndex } from '../src/render/trackBuilder.js';
import { FENCE_OFFSET, SHOULDER_OUT } from '../src/tracks/constants.js';
import { SONGS } from '../src/audio/songs.js';
import { compileSong } from '../src/audio/compile.js';
import { bayWaterSDF } from '../src/tracks/bubblegum-bay.js';
import { LAGOON } from '../src/tracks/mermaid-lagoon.js';
import { BOOK_HEIGHT, ROOM_MARGIN } from '../src/tracks/teddy-toyland.js';
import { HIVE } from '../src/tracks/honeycomb-hive.js';
import {
  instanced, animatedInstances, patternTexture, retextureRoad, waterGrid, frameAt, turnCentre, stripedSphere, hexagonPrism,
} from '../src/tracks/props/bubble-kit.js';
import { makeRng } from '../src/tracks/pathTools.js';

const IDS = ['bubblegum-bay', 'mermaid-lagoon', 'teddy-toyland', 'honeycomb-hive'];
const def = (id) => TRACKS.find((t) => t.id === id);
const pathOf = (id) => new TrackPath(def(id).controlPoints, def(id).width);
/** CAMERA: the chase camera sits ~2.75 above the road (src/render/CameraRig.js). */
const CAMERA_HEIGHT = 2.75;

/** Built tracks are cached: building is the slow part. */
const builds = new Map();
function built(id) {
  if (!builds.has(id)) builds.set(id, buildTrack(def(id), pathOf(id)));
  return builds.get(id);
}

function triangles(group) {
  let tris = 0, meshes = 0;
  group.traverse((o) => {
    if (!o.geometry || !o.isMesh) return;
    const g = o.geometry;
    const t = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += t * (o.isInstancedMesh ? o.count : 1);
    meshes++;
  });
  return { tris, meshes };
}

/** A tiny fake scenery ctx for the prop-kit unit tests. */
function fakeCtx() {
  const group = new THREE.Group();
  const owned = [];
  return {
    group, rng: makeRng(7), animators: [], outlineMat: new THREE.MeshBasicMaterial(),
    own: (m) => { owned.push(m); return m; }, ownTex: (t) => { owned.push(t); return t; }, owned,
  };
}

describe('Bubble Cup pack', () => {
  it('registers the four tracks in cup order, matching the lineup', () => {
    const cup = LINEUP_CUPS.find((c) => c.id === 'bubble-cup');
    expect(BUBBLE.map((m) => m.def.id)).toEqual(cup.trackIds);
    expect(BUBBLE.map((m) => m.def.id)).toEqual(IDS);
    for (const id of IDS) {
      const plan = LINEUP_TRACKS.find((t) => t.id === id);
      expect(def(id).name).toBe(plan.name);
      expect(def(id).cup).toBe('bubble-cup');
      expect(def(id).unlock).toEqual(plan.unlock);
      expect(def(id).art).toHaveLength(3);
      expect(getTrackModule(id).buildScenery).toBeTypeOf('function');
    }
  });

  it('gives every track its own song, sky, road colour and arch banner', () => {
    const pick = (k) => IDS.map((id) => def(id).theme[k]);
    expect(pick('music')).toEqual(IDS);
    for (const k of ['skyTop', 'road', 'fogColor', 'ground', 'curbA']) expect(new Set(pick(k)).size, k).toBe(4);
    expect(new Set(IDS.map((id) => def(id).scenery.arch.text)).size).toBe(4);
    expect(new Set(IDS.map((id) => def(id).previewColor)).size).toBe(4);
  });

  it('has four genuinely different layouts (not one oval re-skinned)', () => {
    const lengths = IDS.map((id) => Math.round(pathOf(id).length));
    expect(new Set(lengths).size).toBe(4);
    // distinct signatures: turn counts / elevation ranges differ between every pair
    const sig = IDS.map((id) => {
      const p = pathOf(id);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < p.count; i++) { lo = Math.min(lo, p.py[i]); hi = Math.max(hi, p.py[i]); }
      return `${Math.round(hi)}:${Math.round(lo)}`;
    });
    expect(new Set(sig).size).toBe(4);
  });

  it('uses friendly words only', () => {
    const text = IDS.map((id) => `${def(id).name} ${def(id).subtitle} ${def(id).scenery.arch.text}`).join(' ').toLowerCase();
    for (const bad of ['kill', 'die', 'dead', 'crash', 'destroy', 'hit', 'smash', 'explode', 'spooky', 'scary', 'fight']) {
      expect(text).not.toMatch(new RegExp(`\\b${bad}\\b`));
    }
  });
});

describe('Bubble Cup songs', () => {
  it.each(IDS)('%s has a valid, happy drop-in song', (id) => {
    const song = SONGS[id];
    expect(song, id).toBeTruthy();
    expect(song.id).toBe(id);
    const c = compileSong(song);
    expect(c.loopSteps).toBe(song.main.chords.length * 16);
    // major / major-7 friendly harmony: the song starts on a major chord
    expect(song.main.chords[0]).not.toMatch(/m(?!aj)/);
    for (const v of Object.values(song.mix)) expect(v).toBeLessThanOrEqual(0.7);
  });

  it('sounds different from each other (tempo + lead instrument)', () => {
    const sig = IDS.map((id) => `${SONGS[id].bpm}:${SONGS[id].instruments.lead}`);
    expect(new Set(sig).size).toBe(4);
    expect(new Set(IDS.map((id) => SONGS[id].instruments.lead)).size).toBe(4);
  });
});

describe('Bubblegum Bay: pier over the channel + sandcastle hairpin', () => {
  const t = def('bubblegum-bay');
  const p = pathOf(t.id);
  const sc = t.scenery;

  it('the boardwalk pier is a hump bridge over water', () => {
    const [a, b] = sc.pier;
    const mid = p.pointAt(((a + b) / 2) * p.length);
    expect(mid.y).toBeGreaterThan(2.5);
    expect(bayWaterSDF(sc, mid.x, mid.z)).toBeGreaterThan(0); // the channel runs under it
    // and it is back down to the beach at both ends
    expect(Math.abs(p.pointAt(a * p.length).y)).toBeLessThan(0.3);
    expect(Math.abs(p.pointAt(b * p.length).y)).toBeLessThan(0.3);
  });

  it('never lets the water cover the road (except under the raised pier)', () => {
    const water = built(t.id).group.getObjectByName('water');
    const pos = water.geometry.attributes.position;
    const idx = createPathIndex(p);
    const [a, b] = sc.pier;
    let checked = 0;
    for (let i = 0; i < pos.count; i++) {
      const n = idx.nearest(pos.getX(i), pos.getZ(i), p.halfWidth + SHOULDER_OUT + 1);
      if (n.i < 0) continue;
      const f = n.s / p.length;
      if (f > a && f < b) continue;
      checked++;
      expect(pos.getY(i)).toBeLessThan(-0.05); // sunk below the sand
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('has room for the sandcastle inside the hairpin', () => {
    const ctx = { path: p, L: p.length };
    const c = turnCentre(ctx, sc.hairpin.at, sc.hairpin.r, 1);
    const idx = createPathIndex(p);
    expect(idx.nearest(c.x, c.z, 200).dist).toBeGreaterThan(p.halfWidth + FENCE_OFFSET + 17);
  });

  it('draws water with foam and a lighthouse out at sea', () => {
    const b = built(t.id);
    const water = b.group.getObjectByName('water');
    expect(water).toBeTruthy();
    expect(water.geometry.attributes.color).toBeTruthy();
  });
});

describe('Mermaid Lagoon: glass bubble tunnel under the lagoon', () => {
  const t = def('mermaid-lagoon');
  const p = pathOf(t.id);
  const B = t.scenery.basin;
  const inside = (i) => Math.hypot(p.px[i] - B.center[0], p.pz[i] - B.center[1]);

  it('the basin is centred on the tunnel and sized to the dive', () => {
    expect(B.moatOuter).toBe(LAGOON.radius);
    let lowest = Infinity, at = null;
    for (let i = 0; i < p.count; i++) if (p.py[i] < lowest) { lowest = p.py[i]; at = i; }
    expect(lowest).toBeCloseTo(LAGOON.roadDepth, 1);
    expect(inside(at)).toBeLessThan(LAGOON.tunnel / 2 + 1);
    expect(B.depth).toBeLessThan(LAGOON.roadDepth - 2.4); // the lagoon floor is below the tunnel road
  });

  it('only the tunnel stretch enters the lagoon, and it is underwater in the middle', () => {
    const [a, b] = t.scenery.tunnel;
    for (let i = 0; i < p.count; i++) {
      const f = (i * p.step) / p.length;
      const r = inside(i);
      const inTunnel = f >= a - 0.005 && f <= b + 0.005;
      if (!inTunnel) expect(r, `s=${(i * p.step).toFixed(0)}`).toBeGreaterThan(B.moatOuter + 2);
      // the rest of the loop (away from the tunnel approaches) keeps well back from the lagoon
      const away = Math.min(Math.abs(f - a), Math.abs(f - b), Math.abs(f - a + 1), Math.abs(f - b - 1));
      if (!inTunnel && away > 0.1) expect(r).toBeGreaterThan(B.moatOuter + p.halfWidth + FENCE_OFFSET);
      // crossing the rim the road is still up at the beach
      if (Math.abs(r - B.moatOuter) < 1) expect(p.py[i]).toBeGreaterThan(-0.6);
      if (r < B.moatOuter - 30) expect(p.py[i]).toBeLessThan(LAGOON.water - 2);
    }
  });

  it('builds a see-through tunnel tall enough for the chase camera', () => {
    const b = built(t.id);
    const tunnel = b.group.getObjectByName('bubble-tunnel');
    expect(tunnel).toBeTruthy();
    expect(tunnel.material.transparent).toBe(true);
    tunnel.geometry.computeBoundingBox();
    const bb = tunnel.geometry.boundingBox;
    expect(bb.max.y - LAGOON.roadDepth).toBeGreaterThan(CAMERA_HEIGHT + 3);
    // the arch stands outside the fences
    const lagoonWater = b.group.getObjectByName('lagoon-water');
    expect(lagoonWater.material.side).toBe(THREE.DoubleSide);
    expect(lagoonWater.position.y).toBe(LAGOON.water);
  });
});

describe('Teddy Toyland: book plateau, crayon ramps and the playroom', () => {
  const t = def('teddy-toyland');
  const p = pathOf(t.id);

  it('the book plateau is flat at BOOK_HEIGHT and the ramps are gentle', () => {
    const [a, b] = t.scenery.books;
    for (let s = a * p.length + 3; s < b * p.length - 3; s += 2) expect(p.pointAt(s).y).toBeCloseTo(BOOK_HEIGHT, 1);
    for (const [ra, rb] of t.scenery.ramps) {
      const y0 = p.pointAt(ra * p.length).y, y1 = p.pointAt(rb * p.length).y;
      expect(Math.abs(y1 - y0)).toBeCloseTo(BOOK_HEIGHT, 1);
    }
  });

  it('snakes back and forth: three switchback U-turns plus the big sweeper', () => {
    // count sign flips of the path heading change over the lap (left vs right turning)
    const turnsAt = [];
    for (let i = 0; i < p.count; i += 4) {
      const a = Math.atan2(p.tx[i], p.tz[i]);
      const j = (i + 4) % p.count;
      let d = Math.atan2(p.tx[j], p.tz[j]) - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > 0.02) turnsAt.push(Math.sign(d));
    }
    let flips = 0;
    for (let i = 1; i < turnsAt.length; i++) if (turnsAt[i] !== turnsAt[i - 1]) flips++;
    expect(flips).toBeGreaterThanOrEqual(2);
  });

  it('the playroom walls surround the whole track', () => {
    const b = p.getBounds();
    const bt = built(t.id);
    let walls = 0;
    bt.group.traverse((o) => { if (o.isMesh && o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters.height >= 150) walls++; });
    expect(walls).toBe(4);
    expect(ROOM_MARGIN).toBeGreaterThan(150);
    expect(b.maxX - b.minX + ROOM_MARGIN * 2).toBeLessThan(1200); // inside the camera far plane
  });

  it('puts wood floorboards on the ground and the play-mat texture on the road', () => {
    const bt = built(t.id);
    expect(bt.group.getObjectByName('ground').material.map).toBeTruthy();
    expect(bt.group.getObjectByName('road').material.map.repeat.x).toBeCloseTo(9 / 20, 5);
  });
});

describe('Honeycomb Hive: the skep tunnel', () => {
  const t = def('honeycomb-hive');
  const p = pathOf(t.id);

  it('the hive sits on a straight', () => {
    const [a, b] = t.scenery.hive;
    const t0 = p.tangentAt(a * p.length);
    for (let s = a * p.length; s <= b * p.length; s += 4) {
      const tt = p.tangentAt(s);
      expect(t0.x * tt.x + t0.z * tt.z).toBeGreaterThan(0.995);
    }
  });

  it('its rings clear the fences and tower over the camera', () => {
    const inner = HIVE.rEnd - HIVE.tube;
    const atRoad = Math.sqrt(inner * inner - HIVE.drop * HIVE.drop);
    expect(atRoad).toBeGreaterThan(p.halfWidth + FENCE_OFFSET + 1);
    expect(inner - HIVE.drop).toBeGreaterThan(CAMERA_HEIGHT + 6);
    expect(HIVE.spacing).toBeLessThan(HIVE.tube * 2); // rings overlap: no gaps in the hive
  });

  it('paints a honeycomb road', () => {
    const bt = built(t.id);
    const map = bt.group.getObjectByName('road').material.map;
    expect(map.image.width).toBe(192);
  });
});

describe.each(IDS)('%s build quality', (id) => {
  it('stays within the draw-call and triangle budget of the original tracks', () => {
    const { tris, meshes } = triangles(built(id).group);
    expect(tris).toBeLessThan(420000);
    expect(meshes).toBeLessThan(150);
  });

  it('animates for a long time without NaNs in any instance', () => {
    const b = built(id);
    for (const time of [0, 0.5, 3.3, 17, 61.7, 240]) b.update(1 / 60, time);
    const m = new THREE.Matrix4();
    b.group.traverse((o) => {
      if (!o.isInstancedMesh) return;
      for (let i = 0; i < o.count; i += Math.max(1, Math.floor(o.count / 16))) {
        o.getMatrixAt(i, m);
        for (const e of m.elements) expect(Number.isFinite(e), o.name || o.geometry.type).toBe(true);
      }
    });
  });

  it('is deterministic: a second build makes the same world', () => {
    const a = triangles(built(id).group);
    const b2 = buildTrack(def(id), pathOf(id));
    const b = triangles(b2.group);
    b2.dispose();
    expect(b).toEqual(a);
  });
});

describe('Bubble Cup prop kit', () => {
  it('instanced() places every matrix and adds an outline hull', () => {
    const ctx = fakeCtx();
    const mats = [new THREE.Matrix4().makeTranslation(1, 2, 3), new THREE.Matrix4().makeTranslation(-4, 0, 9)];
    const r = instanced(ctx, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), mats, { colors: [0xff0000] });
    expect(r.mesh.count).toBe(2);
    expect(r.out.count).toBe(2);
    expect(ctx.group.children).toHaveLength(2);
    const m = new THREE.Matrix4();
    r.mesh.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).toArray()).toEqual([-4, 0, 9]);
    expect(instanced(ctx, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), [])).toBe(null);
  });

  it('animatedInstances() re-poses instances every frame', () => {
    const ctx = fakeCtx();
    const items = [{ k: 1 }, { k: 2 }];
    const r = animatedInstances(ctx, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), items, (it, t, o) => o.position.set(it.k * t, 0, 0));
    expect(ctx.animators).toHaveLength(1);
    ctx.animators[0](1 / 60, 5);
    const m = new THREE.Matrix4();
    r.mesh.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(10);
  });

  it('patternTexture() is a repeating texture of the requested size', () => {
    const ctx = fakeCtx();
    const tex = patternTexture(ctx, 8, (u, v) => [u * 300, v * 255, 0]);
    expect(tex.image.width).toBe(8);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.image.data[0 + 3]).toBe(255);
    expect(Math.max(...tex.image.data.filter((_, i) => i % 4 === 0))).toBeLessThanOrEqual(255);
    expect(ctx.owned).toContain(tex);
  });

  it('retextureRoad() swaps only the road map', () => {
    const ctx = fakeCtx();
    const road = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshToonMaterial());
    road.name = 'road';
    ctx.group.add(road);
    const tex = new THREE.Texture();
    expect(retextureRoad(ctx, tex)).toBe(true);
    expect(road.material.map).toBe(tex);
    expect(retextureRoad(fakeCtx(), tex)).toBe(false);
  });

  it('waterGrid() sinks under dry land, floats over water, foams at the shore and can skip holes', () => {
    const ctx = fakeCtx();
    const wet = (x) => x; // water for x > 0
    const mesh = waterGrid(ctx, { area: { minX: -50, maxX: 50, minZ: -10, maxZ: 10 }, cell: 5, y: 0.2, sink: -1, wet, color: 0x0000ff, foam: 0xffffff });
    const pos = mesh.geometry.attributes.position, col = mesh.geometry.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      if (x < -5) expect(pos.getY(i)).toBeCloseTo(-1, 5);
      if (x > 5) expect(pos.getY(i)).toBeCloseTo(0.2, 5);
      if (x > 40) expect(col.getX(i)).toBeLessThan(0.05); // deep blue, no foam
      if (x > -0.1 && x < 0.1) expect(col.getX(i)).toBeGreaterThan(0.9); // white foam at the shoreline
    }
    const full = mesh.geometry.index.count;
    const holed = waterGrid(fakeCtx(), { area: { minX: -50, maxX: 50, minZ: -10, maxZ: 10 }, cell: 5, wet, skip: (x) => Math.abs(x) < 12 });
    expect(holed.geometry.index.count).toBeLessThan(full);
    expect(holed.geometry.index.count).toBeGreaterThan(0);
  });

  it('frameAt() / turnCentre() find the centre of a circular turn', () => {
    // a circle of radius 60 run counter-clockwise (left turns)
    const pts = [];
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      pts.push([Math.cos(a) * 60, 0, -Math.sin(a) * 60]);
    }
    const path = new TrackPath(pts, 20);
    const ctx = { path, L: path.length };
    const f = frameAt(ctx, 10);
    expect(Math.hypot(f.x, f.z)).toBeCloseTo(60, 0);
    const c = turnCentre(ctx, 0.3, 60, 1);
    expect(Math.hypot(turnCentre(ctx, 0.3, 60, -1).x, turnCentre(ctx, 0.3, 60, -1).z)).toBeCloseTo(120, 0);
    expect(Math.hypot(c.x, c.z)).toBeLessThan(2);
  });

  it('stripedSphere() and hexagonPrism() make the expected shapes', () => {
    const g = stripedSphere(2, [0xff0000, 0x0000ff], 12);
    expect(g.attributes.color.count).toBe(g.attributes.position.count);
    g.computeBoundingSphere();
    expect(g.boundingSphere.radius).toBeCloseTo(2, 1);
    const reds = new Set();
    for (let i = 0; i < g.attributes.color.count; i++) reds.add(g.attributes.color.getX(i).toFixed(2));
    expect(reds.size).toBeGreaterThanOrEqual(2);
    expect(hexagonPrism(1, 2).parameters.radialSegments).toBe(6);
  });
});
