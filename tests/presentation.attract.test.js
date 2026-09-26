// Showcase presentation: the title-screen show (director, shots, framing, track/racer choice,
// the show object and the title-attract system's life cycle).
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  SHOTS, SHOT_FRAMING, createDirector, shotPose, framingOffset, pickAttractTrack, starCaption, rng32,
} from '../src/presentation/attract.js';
import titleAttract, {
  buildAttractShow, pickAttractRacers, attractDisabledByUrl, ATTRACT_CLASS, ATTRACT_DELAY,
} from '../src/systems/titleAttract.js';
import { createPrefsStore } from '../src/presentation/prefs.js';
import { TRACKS, findTrack } from '../src/tracks/index.js';
import { CHARACTERS, getCharacter } from '../src/characters/index.js';
import { installSystems } from '../src/systems/index.js';
import { createFakeApp } from './helpers/headlessSession.js';
import { stubKartModel } from './helpers/raceHarness.js';

const memStore = (init = {}) => {
  const data = new Map();
  const s = createPrefsStore({ storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }, reducedMotion: false });
  s.set(init);
  return s;
};
const finite = (p) => [p.x, p.y, p.z].every(Number.isFinite);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('rng32', () => {
  it('is deterministic and in [0, 1)', () => {
    const a = rng32(5); const b = rng32(5);
    for (let i = 0; i < 50; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(rng32(0)()).toBe(rng32(1)()); // 0 falls back to 1
  });
});

describe('createDirector', () => {
  it('plays the shots in order, cutting after each length, and loops', () => {
    const d = createDirector({ seed: 2 });
    expect(d.shot.kind).toBe(SHOTS[0].kind);
    const seen = [];
    let cuts = 0;
    const total = SHOTS.reduce((s, x) => s + x.length, 0);
    for (let t = 0; t < total + 1; t += 0.05) {
      const s = d.update(0.05);
      if (s.cut) { cuts++; seen.push(s.kind); }
    }
    expect(cuts).toBe(SHOTS.length);
    expect(seen).toEqual([...SHOTS.slice(1).map((s) => s.kind), SHOTS[0].kind]);
  });
  it('picks a new star for every star shot, always a valid kart index', () => {
    const d = createDirector({ seed: 7, racers: 8 });
    const stars = [];
    for (let t = 0; t < 200; t += 0.1) {
      const s = d.update(0.1);
      expect(s.starIndex).toBeGreaterThanOrEqual(0);
      expect(s.starIndex).toBeLessThan(8);
      if (s.cut && s.kind === 'star-orbit') stars.push(s.starIndex);
    }
    for (let i = 1; i < stars.length; i++) expect(stars[i]).not.toBe(stars[i - 1]);
  });
  it('clamps dt, ignores junk and can jump to a shot', () => {
    const d = createDirector();
    d.update(99);
    expect(d.shot.t).toBeCloseTo(0.1);
    d.update(NaN);
    expect(d.shot.t).toBeCloseTo(0.1);
    expect(d.jump(-1)).toMatchObject({ kind: SHOTS.at(-1).kind, t: 0, cut: true });
    expect(createDirector({ racers: 1 }).shot.starIndex).toBe(0);
  });
});

describe('shotPose', () => {
  const leader = { position: { x: 10, y: 2, z: -5 }, heading: 0.7 };
  const star = { position: { x: 20, y: 1, z: 3 }, heading: -1.2 };
  it('every shot gives a finite pose looking at something sensible', () => {
    for (const { kind, length } of SHOTS) {
      for (let t = 0; t <= length; t += 0.5) {
        const p = shotPose({ kind, t }, { leader, star, center: { x: 0, y: 0, z: 0 }, extent: 200 });
        expect(finite(p.pos) && finite(p.look), kind).toBe(true);
        expect(p.fov).toBeGreaterThan(20);
        expect(p.fov).toBeLessThan(80);
        expect(dist(p.pos, p.look)).toBeGreaterThan(1);
        expect(p.pos.y).toBeGreaterThan(Math.min(leader.position.y, star.position.y)); // never under the road
      }
    }
  });
  it('the star orbit circles the star from the front, not the leader', () => {
    const p = shotPose({ kind: 'star-orbit', t: 0 }, { leader, star });
    expect(dist(p.look, { ...star.position, y: star.position.y + 1 })).toBeLessThan(1e-9);
    const toCam = { x: p.pos.x - star.position.x, z: p.pos.z - star.position.z };
    const fwd = { x: Math.sin(star.heading), z: Math.cos(star.heading) };
    expect(toCam.x * fwd.x + toCam.z * fwd.z).toBeGreaterThan(0); // camera in front: we see the face
  });
  it('front-pack sits ahead of the leader and looks back', () => {
    const p = shotPose({ kind: 'front-pack', t: 1 }, { leader });
    const fwd = { x: Math.sin(leader.heading), z: Math.cos(leader.heading) };
    expect((p.pos.x - leader.position.x) * fwd.x + (p.pos.z - leader.position.z) * fwd.z).toBeGreaterThan(5);
    expect((p.look.x - leader.position.x) * fwd.x + (p.look.z - leader.position.z) * fwd.z).toBeLessThan(0);
  });
  it('trackside uses the fixed spot it is given', () => {
    const p = shotPose({ kind: 'trackside', t: 2 }, { leader, trackside: { pos: { x: 1, y: 2, z: 3 } } });
    expect(p.pos).toEqual({ x: 1, y: 2, z: 3 });
    expect(p.look.x).toBe(leader.position.x);
  });
  it('without a leader it floats over the track centre', () => {
    const p = shotPose({ kind: 'heli', t: 0 }, { center: { x: 5, y: 0, z: 5 }, extent: 100 });
    expect(p.look).toEqual({ x: 5, y: 0, z: 5 });
    expect(finite(shotPose(null, null).pos)).toBe(true);
  });
});

describe('framingOffset', () => {
  it('centred framing is a plain camera', () => {
    const f = framingOffset(1000, 500, { u: 0.5, v: 0.5 }, 50);
    expect(f).toMatchObject({ fullWidth: 1000, fullHeight: 500, x: 0, y: 0, width: 1000, height: 500 });
    expect(f.fov).toBeCloseTo(50);
  });
  it('puts the virtual centre (the look target) at (u, v) of the view', () => {
    for (const fr of Object.values(SHOT_FRAMING)) {
      const f = framingOffset(1280, 720, fr, 50);
      expect(f.fullWidth / 2 - f.x).toBeCloseTo(fr.u * 1280);
      expect(f.fullHeight / 2 - f.y).toBeCloseTo(fr.v * 720);
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.x + f.width).toBeLessThanOrEqual(f.fullWidth + 1e-6);
      expect(f.y + f.height).toBeLessThanOrEqual(f.fullHeight + 1e-6);
      // same apparent size: tan(fov/2) scales with the virtual height
      const k = Math.tan((f.fov * Math.PI) / 360) / Math.tan((50 * Math.PI) / 360);
      expect(k).toBeCloseTo(f.fullHeight / 720, 6);
    }
  });
  it('clamps silly inputs', () => {
    const f = framingOffset(0, -5, { u: 2, v: -1 }, 50);
    expect([f.fullWidth, f.fullHeight, f.x, f.y, f.fov].every(Number.isFinite)).toBe(true);
    expect(framingOffset(100, 100).fov).toBeCloseTo(50);
  });
});

describe('track + racer choice', () => {
  it('pickAttractTrack walks the list from a start and wraps', () => {
    const t = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect([0, 1, 2, 3].map((v) => pickAttractTrack(t, v, 1).id)).toEqual(['b', 'c', 'a', 'b']);
    expect(pickAttractTrack([], 0)).toBe(null);
    expect(pickAttractTrack(null)).toBe(null);
    expect(pickAttractTrack(t, -1, 0).id).toBe('c');
  });
  it('pickAttractRacers only uses unlocked racers, no duplicates, deterministic', () => {
    const none = pickAttractRacers(CHARACTERS, () => false, 8, 3);
    for (const c of none) expect(c.unlock ?? null).toBe(null);
    expect(new Set(none.map((c) => c.id)).size).toBe(none.length);
    expect(none.length).toBe(8);
    expect(pickAttractRacers(CHARACTERS, () => false, 8, 3).map((c) => c.id)).toEqual(none.map((c) => c.id));
    expect(pickAttractRacers(CHARACTERS, () => true, 8, 4).length).toBe(8);
    expect(pickAttractRacers(CHARACTERS.slice(0, 3), () => true, 8, 1).length).toBe(3);
  });
  it('starCaption uses the name and tagline', () => {
    const rocco = getCharacter('rocco');
    expect(starCaption(rocco)).toEqual({ title: `⭐ Starring ${rocco.name}`, sub: rocco.tagline });
    expect(starCaption(null)).toBe(null);
  });
  it('attractDisabledByUrl reads ?attract=0', () => {
    expect(attractDisabledByUrl('?attract=0')).toBe(true);
    expect(attractDisabledByUrl('?attract=1')).toBe(false);
    expect(attractDisabledByUrl('')).toBe(false);
  });
});

const stubTrack = () => {
  const built = { group: new THREE.Group(), updates: 0, disposed: 0, update() { built.updates++; }, dispose() { built.disposed++; } };
  return built;
};

describe('buildAttractShow', () => {
  it('runs a CPU race with the countdown skipped and the pack already moving', () => {
    const models = stubKartModel();
    let built = null;
    const show = buildAttractShow({
      trackDef: TRACKS[0], racers: CHARACTERS.slice(0, 8), seed: 3,
      deps: { buildTrackFn: () => (built = stubTrack()), buildKartModelFn: models },
    });
    expect(show.race.state).toBe('racing');
    expect(show.race.karts).toHaveLength(8);
    expect(show.race.karts.every((k) => k.isCPU)).toBe(true);
    expect(Math.max(...show.race.karts.map((k) => k.speed))).toBeGreaterThan(5);
    const t0 = show.race.time;
    for (let i = 0; i < 60; i++) show.update(1 / 30);
    expect(show.race.time).toBeCloseTo(t0 + 2, 5);
    expect(built.updates).toBe(60);
    expect(finite(show.camera.position)).toBe(true);
    expect(show.pose.fov).toBeGreaterThan(0);
    expect(show.focusKart()).toBeTruthy();
    const renderer = { render: vi.fn() };
    show.render(renderer, 1280, 720);
    expect(renderer.render).toHaveBeenCalledWith(show.scene, show.camera);
    expect(show.camera.view?.enabled).toBe(true); // framed beside the logo
    // karts hidden for the render are shown again
    expect(show.race.karts.every((k) => k.model.group.visible)).toBe(true);
    show.dispose();
    show.dispose();
    expect(built.disposed).toBe(1);
    expect(models.models.every((m) => m.disposed)).toBe(true);
    show.update(0.1);
    show.render(renderer, 10, 10);
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });
  it('builds on a real track too (sanity: one registered track, no NaN)', () => {
    const show = buildAttractShow({ trackDef: findTrack('gumdrop-meadow'), racers: CHARACTERS.slice(0, 4), seed: 1, preroll: 1, deps: { buildKartModelFn: stubKartModel() } });
    for (let i = 0; i < 30; i++) show.update(0.1);
    expect(finite(show.camera.position)).toBe(true);
    show.dispose();
  });
});

/* ---------------- the system ---------------- */

function rigSystem({ prefs = {}, state = 'menu', screenId = 'title' } = {}) {
  const store = memStore(prefs);
  const renderer = {
    domElement: { clientWidth: 1280, clientHeight: 720 },
    getSize: (v) => v.set(1280, 720),
    setScissorTest: vi.fn(), setViewport: vi.fn(), render: vi.fn(),
  };
  const menus = { screenId, el: null };
  const models = stubKartModel();
  const app = createFakeApp({
    prefs: store, renderer, menus, game: { state, errors: [] },
    attractTracks: TRACKS.slice(0, 2),
    attractDeps: { buildTrackFn: () => stubTrack(), buildKartModelFn: models },
  });
  const uninstall = installSystems(app.bus, app, [titleAttract]);
  const frame = (dt = 0.1) => app.bus.emit('frame', dt, app.game);
  /** enough title time for the (delayed) build: frames clamp dt to 0.1 s */
  const settle = () => { for (let i = 0; i < 6; i++) frame(0.1); };
  return { app, store, renderer, menus, frame, settle, uninstall, models };
}

describe('title-attract system', () => {
  it('builds after a short delay on the title and draws every frame', () => {
    const r = rigSystem();
    r.frame(0.1);
    r.frame(0.1);
    expect(r.app.game.attract()).toBe(null); // 0.2 s < ATTRACT_DELAY
    expect(ATTRACT_DELAY).toBeGreaterThan(0.2);
    r.frame(0.1);
    r.frame(0.1);
    expect(r.app.game.attract()).toMatchObject({ racers: 8 });
    expect(TRACKS.slice(0, 2).map((t) => t.id)).toContain(r.app.game.attract().trackId);
    expect(r.renderer.render).toHaveBeenCalledTimes(1);
    r.frame();
    expect(r.renderer.render).toHaveBeenCalledTimes(2);
    expect(r.renderer.setScissorTest).toHaveBeenCalledWith(false);
    r.uninstall();
    expect(r.app.game.attract()).toBe(null);
  });
  it('pauses (keeps the show) on other menu screens, tears down when a race starts', () => {
    const r = rigSystem();
    r.settle();
    const calls = r.renderer.render.mock.calls.length;
    r.menus.screenId = 'join';
    r.frame();
    expect(r.renderer.render.mock.calls.length).toBe(calls);
    expect(r.app.game.attract()).not.toBe(null); // kept for a quick Back
    r.menus.screenId = 'title';
    r.frame();
    expect(r.renderer.render.mock.calls.length).toBe(calls + 1);
    r.app.bus.emit('race-start', {}, {});
    expect(r.app.game.attract()).toBe(null);
    expect(r.models.models.every((m) => m.disposed)).toBe(true);
  });
  it('the next show uses the next track', () => {
    const r = rigSystem();
    r.settle();
    const first = r.app.game.attract().trackId;
    r.app.game.state = 'race';
    r.frame();
    expect(r.app.game.attract()).toBe(null);
    r.app.game.state = 'menu';
    r.settle();
    expect(r.app.game.attract().trackId).not.toBe(first);
  });
  it('the "Title show" pref switches it off (live), and nothing is built without a renderer', () => {
    const r = rigSystem({ prefs: { attract: false } });
    r.settle();
    expect(r.app.game.attract()).toBe(null);
    r.store.set({ attract: true });
    r.settle();
    expect(r.app.game.attract()).not.toBe(null);
    r.store.set({ attract: false });
    expect(r.app.game.attract()).toBe(null);
    const r2 = rigSystem();
    r2.app.renderer = null;
    r2.settle();
    expect(r2.app.game.attract()).toBe(null);
  });
  it('a show that fails to build switches itself off instead of retrying every frame', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = rigSystem();
    let tries = 0;
    r.app.attractDeps = { buildTrackFn: () => { tries++; throw new Error('boom'); } };
    for (let i = 0; i < 10; i++) r.frame(1);
    expect(tries).toBe(1);
    expect(r.app.game.attract()).toBe(null);
    expect(r.app.bus.errors).toEqual([]);
    warn.mockRestore();
  });
  it('exports its body class', () => {
    expect(ATTRACT_CLASS).toBe('skx-attract-on');
  });
});

describe('avoidProps (play-test: the title camera parked in front of giant item boxes)', () => {
  it('rises over a nearby item box, smoothly, and leaves far-away shots alone', async () => {
    const { avoidProps } = await import('../src/presentation/attract.js');
    const pose = { pos: { x: 0, y: 1.6, z: 0 }, look: { x: 0, y: 1, z: -6 }, fov: 52 };
    expect(avoidProps(pose, [{ x: 20, y: 1.2, z: 0 }])).toBe(pose);
    expect(avoidProps(pose, [])).toBe(pose);
    const near = avoidProps(pose, [{ x: 0.5, y: 1.2, z: 0.5 }]);
    expect(near.pos.y).toBeGreaterThan(1.2 + 2.4); // over the box, not in it
    expect(near.look.y).toBeGreaterThan(pose.look.y);
    expect(near.pos.x).toBe(0);
    // continuous: a box sliding in from the edge lifts gradually (no jump cut)
    let prev = 1.6;
    for (let d = 4.5; d >= 0; d -= 0.1) {
      const y = avoidProps(pose, [{ x: d, y: 1.2, z: 0 }]).pos.y;
      expect(y - prev).toBeLessThan(0.4);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
    expect(avoidProps(pose, [{ x: NaN, y: 1, z: 0 }, null])).toBe(pose);
  });
});
