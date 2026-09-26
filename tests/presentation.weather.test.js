// Showcase presentation: ambient weather (per-track kinds, specs, the particle object and the system).
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  WEATHER_KINDS, TRACK_WEATHER, SHAPES, weatherFor, weatherSpec, buildWeather, seededRandom,
} from '../src/presentation/weather.js';
import ambientWeather from '../src/systems/ambientWeather.js';
import { createPrefsStore } from '../src/presentation/prefs.js';
import { TRACKS } from '../src/tracks/index.js';
import { LINEUP_TRACKS } from '../src/content/lineup.js';
import { installSystems } from '../src/systems/index.js';
import { createFakeApp, fakeSession, runHeadlessSession } from './helpers/headlessSession.js';
import { nonFiniteVertices } from './helpers/threeInspect.js';

const memStore = (init = {}) => {
  const data = new Map();
  const store = createPrefsStore({
    storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) },
    reducedMotion: false,
  });
  store.set(init);
  return store;
};

describe('weatherFor', () => {
  it('every registered track and every lineup track gets a real weather kind', () => {
    for (const def of TRACKS) expect(WEATHER_KINDS[weatherFor(def)], def.id).toBeTruthy();
    const ids = LINEUP_TRACKS.map((t) => t.id);
    expect(ids.length).toBe(20);
    for (const id of ids) expect(TRACK_WEATHER[id], `table entry for ${id}`).toBeTruthy();
    for (const kind of Object.values(TRACK_WEATHER)) expect(WEATHER_KINDS[kind], kind).toBeTruthy();
  });
  it('fits each theme (snow in snowy places, bubbles at the beach)', () => {
    expect(weatherFor({ id: 'peppermint-village' })).toBe('snow');
    expect(weatherFor({ id: 'bubblegum-bay' })).toBe('bubbles');
    expect(weatherFor({ id: 'pumpkin-patch' })).toBe('leaves');
    expect(weatherFor({ id: 'lemonade-volcano' })).toBe('fizz');
  });
  it('theme.weather overrides, "none" switches it off, unknown tracks fall back by night/day', () => {
    expect(weatherFor({ id: 'bubblegum-bay', theme: { weather: 'snow' } })).toBe('snow');
    expect(weatherFor({ id: 'bubblegum-bay', theme: { weather: 'none' } })).toBe(null);
    expect(weatherFor({ id: 'x', theme: { weather: 'lava' } })).toBe('stardust');
    expect(weatherFor({ id: 'x', theme: { night: true } })).toBe('fireflies');
    expect(weatherFor(null)).toBe(null);
  });
});

describe('weatherSpec', () => {
  it('every kind is a sane, friendly spec', () => {
    for (const kind of Object.keys(WEATHER_KINDS)) {
      const s = weatherSpec(kind);
      expect(s.kind).toBe(kind);
      expect(s.count).toBeGreaterThan(100);
      expect(s.count).toBeLessThanOrEqual(1000); // one Points for all players: keep it light
      expect(s.box).toBeGreaterThan(20);
      expect(s.size).toBeGreaterThan(0);
      expect(s.colors.length).toBeGreaterThan(0);
      expect(Object.values(SHAPES)).toContain(s.shape);
      expect(s.vel).toHaveLength(3);
      for (const v of [...s.vel, s.sway, s.spin, s.opacity, s.twinkle]) expect(Number.isFinite(v)).toBe(true);
    }
  });
  it('gentle motion halves the count and calms the drift', () => {
    const full = weatherSpec('snow');
    const gentle = weatherSpec('snow', { particleScale: 0.5 });
    expect(gentle.count).toBe(Math.round(full.count / 2));
    expect(Math.abs(gentle.vel[1])).toBeLessThan(Math.abs(full.vel[1]));
    expect(gentle.sway).toBeLessThan(full.sway);
  });
  it('unknown kinds give null; silly scales are clamped', () => {
    expect(weatherSpec('lava')).toBe(null);
    expect(weatherSpec(null)).toBe(null);
    expect(weatherSpec('snow', { particleScale: 7 }).count).toBe(WEATHER_KINDS.snow.count);
    expect(weatherSpec('snow', { particleScale: -1 }).count).toBe(0);
    expect(weatherSpec('snow', { particleScale: NaN }).count).toBe(WEATHER_KINDS.snow.count);
  });
});

describe('seededRandom', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = seededRandom('gumdrop-meadow');
    const b = seededRandom('gumdrop-meadow');
    const c = seededRandom('bubblegum-bay');
    const xs = Array.from({ length: 200 }, () => a());
    expect(Array.from({ length: 200 }, () => b())).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});

describe('buildWeather', () => {
  it('builds one never-culled Points object with the right attributes', () => {
    const w = buildWeather(weatherSpec('bubbles'), { seed: 'bubblegum-bay' });
    expect(w.object).toBeInstanceOf(THREE.Points);
    expect(w.object.frustumCulled).toBe(false);
    expect(w.count).toBe(weatherSpec('bubbles').count);
    const g = w.geometry;
    expect(g.getAttribute('position').count).toBe(w.count);
    expect(g.getAttribute('aColor').itemSize).toBe(3);
    expect(g.getAttribute('aRand').itemSize).toBe(4);
    expect(nonFiniteVertices(w.object)).toEqual([]);
    const box = weatherSpec('bubbles').box;
    const p = g.getAttribute('position').array;
    for (const v of p) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(box); }
    w.dispose();
  });
  it('is deterministic for the same seed', () => {
    const a = buildWeather(weatherSpec('snow'), { seed: 's' });
    const b = buildWeather(weatherSpec('snow'), { seed: 's' });
    expect([...a.geometry.getAttribute('position').array.slice(0, 30)]).toEqual([...b.geometry.getAttribute('position').array.slice(0, 30)]);
    a.dispose(); b.dispose();
  });
  it('update() advances time (clamped) and ignores bad dt; onBeforeRender follows the camera', () => {
    const w = buildWeather(weatherSpec('petals'));
    w.update(0.05);
    w.update(5); // clamped to 0.1
    w.update(NaN);
    w.update(-1);
    expect(w.time).toBeCloseTo(0.15, 6);
    expect(w.material.uniforms.uTime.value).toBeCloseTo(0.15, 6);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(10, 2, -5);
    cam.updateMatrixWorld();
    const renderer = { getCurrentViewport: (v) => v.set(0, 0, 800, 400) };
    w.object.onBeforeRender(renderer, null, cam);
    expect(w.material.uniforms.uCam.value.toArray()).toEqual([10, 2, -5]);
    expect(w.material.uniforms.uScale.value).toBeCloseTo(400 / (2 * Math.tan(Math.PI / 6)), 3);
    // a renderer without viewport info falls back gracefully
    w.object.onBeforeRender({}, null, { fov: undefined, getWorldPosition: (v) => v.set(1, 1, 1) });
    expect(Number.isFinite(w.material.uniforms.uScale.value)).toBe(true);
    w.dispose();
  });
  it('dispose() frees GPU resources once and detaches', () => {
    const w = buildWeather(weatherSpec('fireflies'));
    const scene = new THREE.Scene();
    scene.add(w.object);
    const g = vi.spyOn(w.geometry, 'dispose');
    const m = vi.spyOn(w.material, 'dispose');
    w.dispose();
    w.dispose();
    expect(g).toHaveBeenCalledTimes(1);
    expect(m).toHaveBeenCalledTimes(1);
    expect(w.object.parent).toBe(null);
    w.update(0.1); // no-op after dispose
    expect(w.time).toBe(0);
  });
  it('needs a spec', () => {
    expect(() => buildWeather(null)).toThrow();
  });
  it('additive kinds glow, others blend normally', () => {
    expect(buildWeather(weatherSpec('fireflies')).material.blending).toBe(THREE.AdditiveBlending);
    expect(buildWeather(weatherSpec('snow')).material.blending).toBe(THREE.NormalBlending);
  });
});

describe('ambient-weather system', () => {
  const setup = (prefsInit = {}) => {
    const store = memStore(prefsInit);
    const app = createFakeApp({ prefs: store, game: { state: 'race', errors: [] } });
    const uninstall = installSystems(app.bus, app, [ambientWeather]);
    const scene = new THREE.Scene();
    const session = { ...fakeSession(app), scene, trackDef: { id: 'bubblegum-bay' } };
    return { store, app, uninstall, scene, session };
  };
  const weatherIn = (scene) => scene.children.filter((c) => c.userData.presentation === 'weather');

  it('adds the track weather on race-start, advances it, removes it on race-exit', () => {
    const { app, scene, session, uninstall } = setup();
    app.bus.emit('race-start', {}, session);
    expect(weatherIn(scene)).toHaveLength(1);
    expect(app.game.weather()).toMatchObject({ kind: 'bubbles' });
    app.bus.emit('race-frame', 0.05, session);
    expect(app.game.weather().time).toBeCloseTo(0.05);
    app.bus.emit('race-frame', 0.05, { ...session, paused: true });
    expect(app.game.weather().time).toBeCloseTo(0.05); // frozen while paused
    app.bus.emit('race-exit', { outcome: 'menu' }, session);
    expect(weatherIn(scene)).toHaveLength(0);
    expect(app.game.weather()).toBe(null);
    uninstall();
  });
  it('respects the pref, including flipping it mid-race, and gentle motion halves it', () => {
    const { app, scene, session, store } = setup({ weather: false });
    app.bus.emit('race-start', {}, session);
    expect(weatherIn(scene)).toHaveLength(0);
    store.set({ weather: true });
    expect(weatherIn(scene)).toHaveLength(1);
    const full = app.game.weather().count;
    store.set({ motion: 'gentle' });
    expect(weatherIn(scene)).toHaveLength(1); // rebuilt, never doubled
    expect(app.game.weather().count).toBe(Math.round(full / 2));
    store.set({ weather: false });
    expect(weatherIn(scene)).toHaveLength(0);
  });
  it('does nothing without a scene (headless sessions) and survives uninstall mid-race', () => {
    const { app, session, uninstall } = setup();
    app.bus.emit('race-start', {}, { ...session, scene: undefined });
    expect(app.game.weather()).toBe(null);
    app.bus.emit('race-start', {}, session);
    uninstall();
    expect(session.scene.children.filter((c) => c.userData.presentation === 'weather')).toHaveLength(0);
  });
  it('runs a whole headless race with no handler errors', () => {
    const s = runHeadlessSession('bubblegum-bay', { laps: 1, systems: [ambientWeather] });
    expect(s.errors).toEqual([]);
  });
});
