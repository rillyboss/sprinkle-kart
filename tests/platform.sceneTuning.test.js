// Mobile platform: presets applied to real three.js scenes (outlines, scenery thinning, fog, kart LOD, disposal)
// and the platform-quality system on a real built track.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  isOutlineMaterial, setOutlines, findAnimatedInstances, thinScenery, roadProximity, scaleFog, createKartLod, disposeTree, OUTLINE_COLORS,
} from '../src/platform/sceneTuning.js';
import platformSystem, { tuneRaceScene, scaleParticles, HIDDEN_PAUSE_LABEL, GL_NAP_TEXT, HINT_AFTER_TITLE_SECONDS } from '../src/systems/platformQuality.js';
import { PRESETS } from '../src/platform/quality.js';
import { buildTrack } from '../src/tracks/core.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { getTrack, getTrackModule } from '../src/tracks/index.js';
import { OUTLINE_MAT } from '../src/characters/parts.js';
import { createEventBus } from '../src/game/events.js';

const outlineMat = () => new THREE.MeshBasicMaterial({ color: OUTLINE_COLORS[0], side: THREE.BackSide });

function instanced(positions, { color = true } = {}) {
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), positions.length);
  const mat = new THREE.Matrix4();
  positions.forEach(([x, z], i) => { mat.makeTranslation(x, 0, z); m.setMatrixAt(i, mat); if (color) m.setColorAt(i, new THREE.Color(i / positions.length, 0, 0)); });
  return m;
}

describe('outlines', () => {
  it('recognises track and racer outline materials only', () => {
    expect(isOutlineMaterial(outlineMat())).toBe(true);
    expect(isOutlineMaterial(OUTLINE_MAT)).toBe(true);
    expect(isOutlineMaterial(new THREE.MeshBasicMaterial({ color: OUTLINE_COLORS[0] }))).toBe(false); // front side
    expect(isOutlineMaterial(new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.BackSide }))).toBe(false);
    expect(isOutlineMaterial([outlineMat()])).toBe(false);
    expect(isOutlineMaterial(null)).toBe(false);
  });
  it('setOutlines hides and shows them', () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), outlineMat()), new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    expect(setOutlines(g, false)).toBe(1);
    expect(g.children.map((c) => c.visible)).toEqual([false, true]);
    expect(setOutlines(g, false)).toBe(0);
    expect(setOutlines(g, true)).toBe(1);
    expect(setOutlines(null, true)).toBe(0);
  });
});

describe('thinScenery', () => {
  it('drops far instances, keeps matrices and colours in step, updates count', () => {
    const m = instanced([[0, 0], [500, 0], [1, 1], [0, 600], [2, 2]]);
    const g = new THREE.Group();
    g.add(m);
    const before = [0, 2, 4].map((i) => { const c = new THREE.Color(); m.getColorAt(i, c); return c.r; });
    const r = thinScenery(g, { keep: (x, z) => Math.hypot(x, z) < 100 });
    expect(r).toEqual({ meshes: 1, removed: 2, kept: 3 });
    expect(m.count).toBe(3);
    const mat = new THREE.Matrix4();
    const p = new THREE.Vector3();
    m.getMatrixAt(1, mat);
    expect(p.setFromMatrixPosition(mat).toArray()).toEqual([1, 0, 1]);
    const after = [0, 1, 2].map((i) => { const c = new THREE.Color(); m.getColorAt(i, c); return c.r; });
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i]));
  });
  it('uses world positions (parent transforms) and hides a mesh with nothing left', () => {
    const m = instanced([[0, 0], [1, 0], [2, 0], [3, 0]], { color: false });
    const g = new THREE.Group();
    g.position.set(1000, 0, 0);
    g.add(m);
    const root = new THREE.Group();
    root.add(g);
    thinScenery(root, { keep: (x) => x < 100 });
    expect(m.count).toBe(0);
    expect(m.visible).toBe(false);
  });
  it('skips animated meshes, tiny meshes and meshes with per-instance attributes', () => {
    const anim = instanced([[0, 0], [900, 0], [900, 1], [900, 2]]);
    const tiny = instanced([[900, 0], [900, 1]]);
    const custom = instanced([[900, 0], [900, 1], [900, 2], [900, 3]]);
    custom.geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(new Float32Array(4), 1));
    const g = new THREE.Group();
    g.add(anim, tiny, custom);
    const r = thinScenery(g, { keep: () => false, skip: new Set([anim]) });
    expect(r.meshes).toBe(0);
    expect([anim.count, tiny.count, custom.count]).toEqual([4, 2, 4]);
    expect(thinScenery(null, { keep: () => true }).meshes).toBe(0);
  });
  it('findAnimatedInstances notices matrices rewritten by the track update', () => {
    const still = instanced([[0, 0], [1, 1]]);
    const moving = instanced([[0, 0], [1, 1]]);
    const g = new THREE.Group();
    g.add(still, moving);
    const update = (dt, t) => { moving.setMatrixAt(0, new THREE.Matrix4().makeTranslation(t, 0, 0)); moving.instanceMatrix.needsUpdate = true; };
    const set = findAnimatedInstances(g, update);
    expect([...set]).toEqual([moving]);
    expect(findAnimatedInstances(g, () => { throw new Error('needs a race'); }).size).toBe(0);
  });
});

describe('roadProximity', () => {
  const path = { px: Float32Array.from({ length: 100 }, (_, i) => i * 10), pz: new Float32Array(100), count: 100, halfWidth: 5 };
  it('answers within radius + half width of the centre line', () => {
    const near = roadProximity(path, 50);
    expect(near(500, 54)).toBe(true);
    expect(near(500, 56)).toBe(false);
    expect(near(-50, 0)).toBe(true);
    expect(near(-70, 0)).toBe(false);
    expect(near(5000, 0)).toBe(false);
  });
  it('infinite radius or no path → everything kept', () => {
    expect(roadProximity(path, Infinity)(1e6, 1e6)).toBe(true);
    expect(roadProximity({}, 10)(1e6, 1e6)).toBe(true);
  });
});

describe('fog, kart LOD and disposal', () => {
  it('scaleFog scales and restores', () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 100, 600);
    const restore = scaleFog(scene, 0.5);
    expect([scene.fog.near, scene.fog.far]).toEqual([50, 300]);
    restore();
    expect([scene.fog.near, scene.fog.far]).toEqual([100, 600]);
    expect(typeof scaleFog(new THREE.Scene(), 0.5)).toBe('function');
    expect(typeof scaleFog(scene, 1)).toBe('function');
  });
  it('createKartLod hides outlines of far karts only, restore shows them', () => {
    const kart = (x) => {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(new THREE.BoxGeometry(), OUTLINE_MAT), new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      return { position: new THREE.Vector3(x, 0, 0), model: { group } };
    };
    const karts = [kart(5), kart(100)];
    const lod = createKartLod(() => karts, 20);
    const cam = new THREE.PerspectiveCamera();
    expect(lod.update([cam])).toBe(1);
    expect(karts.map((k) => k.model.group.children[0].visible)).toEqual([true, false]);
    expect(karts[1].model.group.children[1].visible).toBe(true); // the body stays
    cam.position.set(100, 0, 0);
    lod.update([cam]);
    expect(karts.map((k) => k.model.group.children[0].visible)).toEqual([false, true]);
    lod.restore();
    expect(karts.map((k) => k.model.group.children[0].visible)).toEqual([true, true]);
    expect(createKartLod(() => karts, Infinity).update([cam])).toBe(0);
    expect(lod.update([])).toBe(0); // no cameras: everything near
  });
  it('disposeTree frees geometries + textures (materials only when asked)', () => {
    const tex = new THREE.Texture();
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    const geo = new THREE.BoxGeometry();
    const shader = new THREE.ShaderMaterial({ uniforms: { t: { value: new THREE.Texture() } } });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, [shader]), instanced([[0, 0]]));
    const spies = [vi.spyOn(geo, 'dispose'), vi.spyOn(tex, 'dispose'), vi.spyOn(mat, 'dispose')];
    const r = disposeTree(root);
    expect(r).toEqual({ geometries: 2, materials: 0, textures: 2 });
    expect(spies[0]).toHaveBeenCalledTimes(1);
    expect(spies[1]).toHaveBeenCalledTimes(1);
    expect(spies[2]).not.toHaveBeenCalled();
    expect(disposeTree(root, { materials: true }).materials).toBe(3);
    expect(disposeTree(null)).toEqual({ geometries: 0, materials: 0, textures: 0 });
  });
});

describe('tuneRaceScene on a real track', () => {
  const built = (id) => {
    const def = getTrack(id);
    const path = new TrackPath(def.controlPoints, def.width);
    const b = buildTrack(def, path, { module: getTrackModule(id) });
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 120, 700);
    scene.add(b.group);
    return { scene, built: b, path };
  };
  const count = (group) => { let n = 0; let o = 0; group.traverse((x) => { if (x.isInstancedMesh && x.visible) n += x.count; if (x.isMesh && x.visible && isOutlineMaterial(x.material)) o++; }); return { instances: n, outlines: o }; };

  it('high changes nothing', () => {
    const s = built('cotton-candy-castle');
    const before = count(s.built.group);
    const r = tuneRaceScene(s, PRESETS.high);
    expect(count(s.built.group)).toEqual(before);
    expect(r).toMatchObject({ outlinesHidden: 0, thinned: null, fog: false, particles: 0 });
    expect(s.scene.fog.far).toBe(700);
    s.built.dispose();
  });
  it('low hides scenery outlines, thins far scenery, pulls the fog in; medium does less', () => {
    const lowS = built('gumdrop-meadow');
    const medS = built('gumdrop-meadow');
    const before = count(lowS.built.group);
    const low = tuneRaceScene(lowS, PRESETS.low);
    const med = tuneRaceScene(medS, PRESETS.medium);
    const afterLow = count(lowS.built.group);
    const afterMed = count(medS.built.group);
    expect(low.outlinesHidden).toBeGreaterThan(0);
    expect(afterLow.outlines).toBe(0);
    expect(afterMed.outlines).toBe(before.outlines);
    expect(afterLow.instances).toBeLessThan(before.instances);
    expect(afterLow.instances).toBeLessThanOrEqual(afterMed.instances);
    expect(low.fog).toBe(true);
    expect(lowS.scene.fog.far).toBeCloseTo(700 * PRESETS.low.fogScale);
    low.restoreFog();
    expect(lowS.scene.fog.far).toBe(700);
    lowS.built.dispose();
    medS.built.dispose();
  });
  it('scaleParticles draws a fraction of the weather points, never the track group', () => {
    const scene = new THREE.Scene();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300), 3));
    const pts = new THREE.Points(geo);
    const track = new THREE.Group();
    const trackGeo = geo.clone();
    track.add(new THREE.Points(trackGeo));
    scene.add(pts, track);
    expect(scaleParticles(scene, 0.35, track)).toBe(1);
    expect(geo.drawRange.count).toBe(35);
    expect(trackGeo.drawRange.count).toBe(Infinity);
    expect(scaleParticles(scene, 1)).toBe(0);
    expect(tuneRaceScene({}, PRESETS.low).outlinesHidden).toBe(0);
  });
});

describe('platform-quality system', () => {
  const fakePlatform = (over = {}) => {
    const subs = new Map();
    return {
      quality: PRESETS.low,
      caps: { mobile: true },
      renderer: { renderLists: { dispose: vi.fn() } },
      pwa: { hideHint: vi.fn(), showHint: vi.fn() },
      resetResolution: vi.fn(),
      on(ev, fn) { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev).delete(fn); },
      emit(ev, ...a) { for (const fn of subs.get(ev) ?? []) fn(...a); },
      subs,
      ...over,
    };
  };
  const session = (over = {}) => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(), outlineMat()));
    scene.add(group);
    return { scene, built: { group, update() {} }, path: null, race: { karts: [] }, rigs: [{ camera: new THREE.PerspectiveCamera() }], paused: false, resultsShown: false, requestPause: vi.fn(), ...over };
  };

  it('does nothing without a platform (node / headless sessions)', () => {
    expect(platformSystem.install(createEventBus(), { game: {} })).toBe(undefined);
  });
  it('race-start tunes the scene, race-exit restores + frees GPU memory on mobile', () => {
    const bus = createEventBus();
    const platform = fakePlatform();
    const game = { platform };
    const menus = { screenId: 'title' };
    const off = platformSystem.install(bus, { game, menus });
    const s = session();
    bus.emit('race-start', {}, s);
    expect(platform.resetResolution).toHaveBeenCalled();
    expect(platform.pwa.hideHint).toHaveBeenCalled();
    expect(game.platformTuning).toMatchObject({ quality: 'low', outlinesHidden: 1 });
    bus.emit('race-frame', 1 / 60, s);
    bus.emit('race-exit', { outcome: 'menu' }, s);
    expect(game.platformFreed.geometries).toBe(1);
    expect(platform.renderer.renderLists.dispose).toHaveBeenCalled();
    off();
    expect([...platform.subs.values()].every((set) => set.size === 0)).toBe(true);
  });
  it('desktop sessions keep their GPU memory (no forced disposal)', () => {
    const bus = createEventBus();
    const game = { platform: fakePlatform({ caps: { mobile: false }, quality: PRESETS.high }) };
    platformSystem.install(bus, { game });
    const s = session();
    bus.emit('race-start', {}, s);
    bus.emit('race-exit', {}, s);
    expect(game.platformFreed).toBe(undefined);
  });
  it('a hidden tab pauses an offline race, never an online one', () => {
    const bus = createEventBus();
    const platform = fakePlatform();
    platformSystem.install(bus, { game: { platform } });
    const offline = session();
    bus.emit('race-start', {}, offline);
    platform.emit('hidden', 'hidden');
    expect(offline.requestPause).toHaveBeenCalledWith(HIDDEN_PAUSE_LABEL);
    bus.emit('race-exit', {}, offline);
    const online = session({ net: { role: 'guest' } });
    bus.emit('race-start', {}, online);
    platform.emit('hidden', 'pagehide');
    expect(online.requestPause).not.toHaveBeenCalled();
    const paused = session({ paused: true });
    bus.emit('race-start', {}, paused);
    platform.emit('hidden', 'hidden');
    expect(paused.requestPause).not.toHaveBeenCalled();
  });
  it('context loss pauses and shows the nap overlay until restored', () => {
    const bus = createEventBus();
    const platform = fakePlatform();
    const body = { children: [], appendChild(n) { this.children.push(n); } };
    vi.stubGlobal('document', { documentElement: { dataset: {} }, body, createElement: () => ({ className: '', textContent: '', hidden: false, remove: vi.fn() }) });
    try {
      platformSystem.install(bus, { game: { platform } });
      const s = session();
      bus.emit('race-start', {}, s);
      expect(document.documentElement.dataset.skRacing).toBe('1');
      platform.emit('contextlost');
      expect(s.requestPause).toHaveBeenCalledWith(GL_NAP_TEXT);
      expect(body.children[0]).toMatchObject({ className: 'sk-glnap', textContent: GL_NAP_TEXT, hidden: false });
      platform.emit('contextrestored');
      expect(body.children[0].hidden).toBe(true);
      bus.emit('race-exit', {}, s);
      expect(document.documentElement.dataset.skRacing).toBe('0');
    } finally { vi.unstubAllGlobals(); }
  });
  it('the install hint waits for the title screen, once', () => {
    const bus = createEventBus();
    const platform = fakePlatform();
    const menus = { screenId: 'title' };
    platformSystem.install(bus, { game: { platform }, menus });
    for (let i = 0; i < (HINT_AFTER_TITLE_SECONDS - 1) * 10; i++) bus.emit('frame', 0.1);
    menus.screenId = 'join';
    bus.emit('frame', 0.1);
    menus.screenId = 'title';
    for (let i = 0; i < (HINT_AFTER_TITLE_SECONDS - 1) * 10; i++) bus.emit('frame', 0.1);
    expect(platform.pwa.showHint).not.toHaveBeenCalled();
    for (let i = 0; i < 25; i++) bus.emit('frame', 0.1);
    expect(platform.pwa.showHint).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 200; i++) bus.emit('frame', 0.1);
    expect(platform.pwa.showHint).toHaveBeenCalledTimes(1);
  });
});
