// Showcase presentation: Photo Mode (reducer, camera, file names, frame drawing, pause-menu wiring).
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  PHOTO_FRAMES, PHOTO_LIMITS, createPhotoState, photoReduce, photoCameraPose, photoFileName, captionDate, drawPhotoFrame,
} from '../src/presentation/photo.js';
import photoMode, { PHOTO_OPTION, withPhotoOption, pausingPlayer } from '../src/systems/photoMode.js';
import { PAUSE_OPTIONS } from '../src/ui/screens/pause.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { installSystems } from '../src/systems/index.js';
import { createFakeApp } from './helpers/headlessSession.js';

/** A recording fake CanvasRenderingContext2D. */
function fake2d() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    count: (name) => calls.filter((c) => c[0] === name).length,
    save: rec('save'), restore: rec('restore'), fillRect: rec('fillRect'), fillText: rec('fillText'), strokeText: rec('strokeText'),
    translate: rec('translate'), rotate: rec('rotate'),
    set fillStyle(v) { calls.push(['fillStyle', v]); }, set strokeStyle(v) { calls.push(['strokeStyle', v]); },
    set font(v) { calls.push(['font', v]); }, set textAlign(v) {}, set textBaseline(v) {}, set lineWidth(v) {},
  };
}

describe('photoReduce', () => {
  const s0 = createPhotoState();
  it('left/right orbit, up/down zoom (clamped), start tilts and loops', () => {
    expect(photoReduce(s0, { action: 'left' }).state.yaw).toBeCloseTo(s0.yaw - PHOTO_LIMITS.yawStep);
    expect(photoReduce(s0, { action: 'right' }).state.yaw).toBeCloseTo(s0.yaw + PHOTO_LIMITS.yawStep);
    let s = s0;
    for (let i = 0; i < 30; i++) s = photoReduce(s, { action: 'up' }).state;
    expect(s.dist).toBe(PHOTO_LIMITS.distMin);
    for (let i = 0; i < 30; i++) s = photoReduce(s, { action: 'down' }).state;
    expect(s.dist).toBe(PHOTO_LIMITS.distMax);
    s = s0;
    const pitches = [];
    for (let i = 0; i < 12; i++) { s = photoReduce(s, { action: 'start' }).state; pitches.push(s.pitch); }
    expect(Math.max(...pitches)).toBeLessThanOrEqual(PHOTO_LIMITS.pitchMax + 1e-9);
    expect(pitches).toContain(PHOTO_LIMITS.pitchMin); // looped back down
    expect(photoReduce(s0, { action: 'left' }).fx).toEqual(['move']);
  });
  it('Y cycles frames, A snaps (and counts), B leaves, junk does nothing', () => {
    let s = s0;
    const seen = [];
    for (let i = 0; i < PHOTO_FRAMES.length; i++) { s = photoReduce(s, { action: 'toggle' }).state; seen.push(s.frame); }
    expect(seen.at(-1)).toBe(0);
    expect(new Set(seen).size).toBe(PHOTO_FRAMES.length);
    const snap = photoReduce(s0, { action: 'confirm' });
    expect(snap.snap).toBe(true);
    expect(snap.state.snaps).toBe(1);
    expect(photoReduce(s0, { action: 'select' }).snap).toBe(true);
    expect(photoReduce(s0, { action: 'back' })).toMatchObject({ go: 'back', fx: ['back'] });
    expect(photoReduce(s0, { action: 'pick' })).toEqual({ state: s0, fx: [], snap: false, go: null });
    expect(photoReduce(s0)).toEqual({ state: s0, fx: [], snap: false, go: null });
  });
});

describe('photoCameraPose', () => {
  it('orbits the kart at the chosen distance and height, looking at the driver', () => {
    const kart = { x: 10, y: 1, z: -4 };
    const st = { yaw: 0, pitch: 0, dist: 6 };
    const p = photoCameraPose(kart, 0, st);
    // yaw 0 = behind a heading-0 kart (-Z)
    expect(p.pos.z).toBeCloseTo(-10);
    expect(p.pos.x).toBeCloseTo(10);
    expect(p.look).toEqual({ x: 10, y: 2, z: -4 });
    const high = photoCameraPose(kart, 0, { ...st, pitch: 1 });
    expect(high.pos.y).toBeGreaterThan(p.pos.y);
    const d = (q) => Math.hypot(q.pos.x - q.look.x, q.pos.y - q.look.y, q.pos.z - q.look.z);
    expect(d(high)).toBeCloseTo(6);
    for (let yaw = 0; yaw < 7; yaw += 0.5) expect(d(photoCameraPose(kart, 1.3, { ...st, yaw }))).toBeCloseTo(6);
  });
  it('clamps and survives junk', () => {
    const p = photoCameraPose(null, NaN, { yaw: NaN, pitch: 99, dist: 999 });
    expect([p.pos.x, p.pos.y, p.pos.z].every(Number.isFinite)).toBe(true);
    const d = Math.hypot(p.pos.x - p.look.x, p.pos.y - p.look.y, p.pos.z - p.look.z);
    expect(d).toBeCloseTo(PHOTO_LIMITS.distMax);
  });
});

describe('file names and captions', () => {
  it('photoFileName is safe and dated', () => {
    const d = new Date(2026, 8, 5, 7, 3, 9);
    expect(photoFileName('gumdrop-meadow', d)).toBe('sprinkle-kart-gumdrop-meadow-2026-09-05-07-03-09.png');
    expect(photoFileName('../Évil Track!!', d)).toMatch(/^sprinkle-kart-[a-z0-9-]+-2026-09-05-07-03-09\.png$/);
    expect(photoFileName(null, d)).toBe('sprinkle-kart-race-2026-09-05-07-03-09.png');
    expect(photoFileName('x', new Date('nope'))).toMatch(/^sprinkle-kart-x-19(69|70)-/);
  });
  it('captionDate is friendly', () => {
    expect(captionDate(new Date(2026, 8, 25))).toBe('25 Sep 2026');
    expect(captionDate(new Date('bad'))).toMatch(/19(69|70)/);
  });
});

describe('drawPhotoFrame', () => {
  it('draws every frame with balanced save/restore and the title somewhere', () => {
    for (const f of PHOTO_FRAMES) {
      const g = fake2d();
      expect(drawPhotoFrame(g, 1280, 720, f.id, { title: 'Gumdrop Meadow', emoji: '🍝', date: '1 Jan 2026' })).toBe(f.id);
      expect(g.count('save')).toBe(g.count('restore'));
      const texts = g.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
      expect(texts.some((t) => t.includes('Gumdrop Meadow')), f.id).toBe(true);
    }
  });
  it('the snapshot frame has a caption band and the date; decorative frames draw a border', () => {
    const polaroid = fake2d();
    drawPhotoFrame(polaroid, 1000, 600, 0, { title: 'T', date: '2 Feb 2026' });
    expect(polaroid.count('fillRect')).toBe(4);
    expect(polaroid.calls.some((c) => c[0] === 'fillText' && c[1] === '2 Feb 2026')).toBe(true);
    const hearts = fake2d();
    drawPhotoFrame(hearts, 1000, 600, 'hearts');
    expect(hearts.calls.filter((c) => c[0] === 'fillText' && c[1] === '♥').length).toBeGreaterThan(40);
    const sprinkles = fake2d();
    drawPhotoFrame(sprinkles, 1000, 600, 'sprinkles');
    expect(sprinkles.count('rotate')).toBeGreaterThan(40);
  });
  it('unknown frames fall back to no frame', () => {
    expect(drawPhotoFrame(fake2d(), 100, 100, 99)).toBe('none');
    expect(drawPhotoFrame(fake2d(), 100, 100, 'glitter')).toBe('none');
  });
});

describe('pause-menu wiring', () => {
  it('withPhotoOption adds Photo mode once, before "Back to menu"', () => {
    const opts = withPhotoOption(PAUSE_OPTIONS);
    expect(opts.map((o) => o[0])).toEqual(['resume', 'restart', 'photo', 'quit']);
    expect(withPhotoOption(opts).map((o) => o[0])).toEqual(['resume', 'restart', 'photo', 'quit']);
    expect(withPhotoOption([['a', 'A', '🅰️']]).map((o) => o[0])).toEqual(['a', 'photo']);
    expect(withPhotoOption(undefined).map((o) => o[0])).toContain('photo');
    expect(PAUSE_OPTIONS.map((o) => o[0])).toEqual(['resume', 'restart', 'quit']); // never mutated
  });
  it('pausingPlayer reads "P2" and falls back to the first human', () => {
    const humans = [{ playerIndex: 0 }, { playerIndex: 1 }];
    expect(pausingPlayer('P2', humans)).toBe(1);
    expect(pausingPlayer('P4', humans)).toBe(0);
    expect(pausingPlayer("P1's controller took a nap", humans)).toBe(0);
    expect(pausingPlayer('', [])).toBe(0);
  });
  it('the photo-mode screen is registered', () => {
    expect(SCREENS.has('photo-mode')).toBe(true);
    expect(SCREENS.get('photo-mode').menuEntry).toBeUndefined(); // only reachable from the pause menu
  });

  function rig({ renderer = true, scene = true } = {}) {
    const results = [];
    const menus = {
      opened: [],
      showPause: vi.fn(function (label, extra = {}) { return Promise.resolve(results.shift() ?? 'resume'); }),
      open: vi.fn(function (id, params) { this.opened.push({ id, params }); return Promise.resolve('back'); }),
    };
    const session = {
      scene: scene ? new THREE.Scene() : null,
      humans: [{ playerIndex: 0 }], trackDef: { id: 't', name: 'Track' },
      race: { clock: 1, karts: [], getPlayerKart: () => ({ position: new THREE.Vector3(), heading: 0, charDef: { emoji: '🍝' } }) },
    };
    const app = createFakeApp({ menus, renderer: renderer ? { render() {} } : null, game: { state: 'paused', errors: [], session } });
    const originalShowPause = menus.showPause;
    const uninstall = installSystems(app.bus, app, [photoMode]);
    return { app, menus, results, uninstall, originalShowPause };
  }

  it('adds the option to the pause menu and returns the caller’s own choice', async () => {
    const r = rig();
    r.results.push('restart');
    await expect(r.menus.showPause('P1')).resolves.toBe('restart');
    const passed = r.originalShowPause.mock.calls[0][1];
    expect(passed.options.map((o) => o[0])).toEqual(['resume', 'restart', 'photo', 'quit']);
  });
  it('choosing Photo mode opens the photo screen, then the pause menu again', async () => {
    const r = rig();
    r.results.push('photo', 'resume');
    await expect(r.menus.showPause('P1', { options: [['resume', 'Go', '▶️'], ['quit', 'Bye', '🏠']] })).resolves.toBe('resume');
    expect(r.menus.opened.map((o) => o.id)).toEqual(['photo-mode']);
    const ctl = r.menus.opened[0].params.ctl;
    expect(ctl.info).toMatchObject({ title: 'Track', emoji: '🍝' });
    expect(r.originalShowPause).toHaveBeenCalledTimes(2);
    expect(r.originalShowPause.mock.calls[1][1].options.map((o) => o[0])).toEqual(['resume', 'photo', 'quit']);
    expect(r.app.game.photoMode()).toBe(null); // closed again
  });
  it('without a renderer or a race scene the pause menu is left exactly as it was', async () => {
    for (const opts of [{ renderer: false }, { scene: false }]) {
      const r = rig(opts);
      await r.menus.showPause('P1', { x: 1 });
      expect(r.originalShowPause.mock.calls[0][1]).toEqual({ x: 1 });
    }
  });
  it('uninstall restores the original showPause', () => {
    const r = rig();
    expect(r.menus.showPause).not.toBe(r.originalShowPause);
    r.uninstall();
    expect(r.menus.showPause).toBe(r.originalShowPause);
  });
  it('does nothing when there are no menus (headless)', () => {
    const app = createFakeApp();
    expect(() => installSystems(app.bus, app, [photoMode])()).not.toThrow();
    expect(PHOTO_OPTION[0]).toBe('photo');
  });
});
