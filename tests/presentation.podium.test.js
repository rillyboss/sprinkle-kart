// Showcase presentation: 3D victory podium (dances, DOM -> world mapping, the stage, the system).
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  DANCES, DANCE_BY_STYLE, danceFor, danceAt, screenToWorld, buildPodiumStage,
} from '../src/presentation/podium.js';
import victoryPodium, { podiumCharacters, podiumWanted, readPodiumRects, PODIUM_CLASS } from '../src/systems/victoryPodium.js';
import { CHARACTERS, getCharacter } from '../src/characters/index.js';
import { VOICE_STYLES } from '../src/audio/voice.js';
import { buildKartModel } from '../src/characters/model.js';
import { installSystems } from '../src/systems/index.js';
import { createFakeApp } from './helpers/headlessSession.js';
import { nonFiniteTransforms } from './helpers/threeInspect.js';

describe('dances', () => {
  it('every voice style has a dance and every racer gets one', () => {
    for (const style of VOICE_STYLES) expect(DANCES).toContain(DANCE_BY_STYLE[style]);
    for (const c of CHARACTERS) expect(DANCES, c.id).toContain(danceFor(c));
    expect(danceFor(null)).toBe('jump');
    expect(danceFor({ voice: { style: 'opera' } })).toBe('jump');
  });
  it('every dance is finite, bounded and actually moves', () => {
    for (const d of DANCES) {
      let moved = 0;
      for (let t = 0; t < 6; t += 0.05) {
        const p = danceAt(d, t, { place: 1 });
        for (const v of [p.y, p.yaw, p.roll, p.pitch, p.squash, p.steer]) expect(Number.isFinite(v), `${d} @${t}`).toBe(true);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1.2); // stays near the podium
        expect(Math.abs(p.roll)).toBeLessThan(0.35);
        expect(p.squash).toBeGreaterThan(0.7);
        expect(p.squash).toBeLessThan(1.2);
        expect(Math.abs(p.steer)).toBeLessThanOrEqual(1);
        moved += Math.abs(p.y) + Math.abs(p.yaw) + Math.abs(p.roll);
      }
      expect(moved, d).toBeGreaterThan(1);
    }
  });
  it('the twirl really twirls (a full turn) and the winner dances biggest', () => {
    let maxYaw = 0;
    for (let t = 0; t < 2.4; t += 0.02) maxYaw = Math.max(maxYaw, danceAt('twirl', t).yaw);
    expect(maxYaw).toBeCloseTo(Math.PI * 2, 1);
    const peak = (place) => Math.max(...Array.from({ length: 120 }, (_, i) => danceAt('jump', i * 0.02, { place }).y));
    expect(peak(1)).toBeGreaterThan(peak(2));
    expect(peak(2)).toBeGreaterThan(peak(3));
  });
  it('gentle motion is a calm sway for everyone', () => {
    for (const d of DANCES) {
      for (let t = 0; t < 4; t += 0.1) {
        const p = danceAt(d, t, { gentle: true });
        expect(p.y).toBe(0);
        expect(Math.abs(p.yaw)).toBeLessThanOrEqual(0.12);
        expect(p.squash).toBe(1);
      }
    }
  });
  it('bad times are treated as 0', () => {
    expect(danceAt('boing', NaN)).toEqual(danceAt('boing', 0));
    expect(danceAt('sway', -3)).toEqual(danceAt('sway', 0));
    expect(danceAt('unknown', 1)).toEqual(danceAt('sway', 1));
  });
});

describe('screenToWorld', () => {
  const view = { width: 1000, height: 500, fov: 30, dist: 40 };
  const worldH = 2 * 40 * Math.tan(Math.PI / 12);
  it('the screen centre maps to the origin; edges map to the frustum edges', () => {
    const c = screenToWorld({ left: 450, top: 200, width: 100, height: 100 }, view);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(c.bottom).toBeCloseTo(-worldH * (50 / 500));
    const tl = screenToWorld({ left: 0, top: 0, width: 0, height: 0 }, view);
    expect(tl.x).toBeCloseTo(-worldH * 2 / 2);
    expect(tl.y).toBeCloseTo(worldH / 2);
  });
  it('scale fits the model height into the rect and honours the canvas offset', () => {
    const r = screenToWorld({ left: 100, top: 100, width: 50, height: 250 }, view, 2.5);
    expect(r.scale * 2.5).toBeCloseTo(worldH / 2);
    const off = screenToWorld({ left: 110, top: 120, width: 50, height: 250 }, { ...view, left: 10, top: 20 }, 2.5);
    expect(off).toEqual(r);
  });
});

describe('buildPodiumStage', () => {
  const defs = ['rocco', 'muffin', 'bizzy'].map(getCharacter);
  const layout = {
    width: 1280, height: 720,
    rects: [{ left: 270, top: 200, width: 120, height: 120 }, { left: 130, top: 260, width: 95, height: 95 }, { left: 430, top: 290, width: 95, height: 95 }],
    winnerRect: { left: 270, top: 200, width: 120, height: 120 },
  };
  it('builds three dancing racers placed on their rects, with no NaN anywhere', () => {
    const st = buildPodiumStage({ charDefs: defs, buildKartModel });
    expect(st.racers.map((r) => r.def.id)).toEqual(['rocco', 'muffin', 'bizzy']);
    expect(st.racers.map((r) => r.dance)).toEqual(defs.map(danceFor));
    for (let i = 0; i < 90; i++) st.update(1 / 30, layout);
    expect(nonFiniteTransforms(st.scene)).toEqual([]);
    for (const r of st.racers) expect(r.holder.visible).toBe(true);
    // the winner stands left-of-centre, higher than 2nd and 3rd (like the DOM podium)
    const [p1, p2, p3] = st.racers.map((r) => r.holder.position);
    expect(p2.x).toBeLessThan(p1.x);
    expect(p3.x).toBeGreaterThan(p1.x);
    expect(p1.y).toBeGreaterThan(p3.y);
    expect(st.camera.aspect).toBeCloseTo(1280 / 720);
    expect(st.time).toBeCloseTo(3, 5);
    expect(st.confetti.alive).toBeGreaterThan(0); // gentle confetti over the winner
    st.dispose();
    st.dispose();
  });
  it('hides a racer without a rect and survives junk layouts', () => {
    const st = buildPodiumStage({ charDefs: defs, buildKartModel });
    st.update(0.1, { ...layout, rects: [layout.rects[0], null, { left: 0, top: 0, width: 0, height: 0 }] });
    expect(st.racers.map((r) => r.holder.visible)).toEqual([true, false, false]);
    expect(() => st.update(NaN, null)).not.toThrow();
    expect(() => st.update(0.1, {})).not.toThrow();
    st.dispose();
    expect(() => st.update(0.1, layout)).not.toThrow(); // no-op after dispose
  });
  it('gentle motion: calm sway, no confetti rain', () => {
    const st = buildPodiumStage({ charDefs: defs, buildKartModel, gentle: true });
    for (let i = 0; i < 60; i++) st.update(1 / 30, layout);
    expect(st.confetti.alive).toBe(0);
    for (const r of st.racers) expect(r.dancer.position.y).toBe(0);
    st.dispose();
  });
  it('fewer than three racers, a model that fails to build, or no builder are all fine', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = buildPodiumStage({ charDefs: [defs[0], null], buildKartModel });
    expect(st.racers).toHaveLength(1);
    st.dispose();
    const bad = buildPodiumStage({ charDefs: defs, buildKartModel: () => { throw new Error('nope'); } });
    expect(bad.racers).toHaveLength(0);
    bad.dispose();
    expect(buildPodiumStage({ charDefs: defs }).racers).toHaveLength(0);
    warn.mockRestore();
  });
  it('disposes the racers it built', () => {
    const disposed = [];
    const fake = (def) => ({ group: new THREE.Group(), update() {}, dispose: () => disposed.push(def.id) });
    const st = buildPodiumStage({ charDefs: defs, buildKartModel: fake });
    st.dispose();
    expect(disposed).toEqual(['rocco', 'muffin', 'bizzy']);
  });
  it('render() hands the scene + camera to the renderer', () => {
    const st = buildPodiumStage({ charDefs: defs.slice(0, 1), buildKartModel });
    const renderer = { render: vi.fn() };
    st.render(renderer);
    expect(renderer.render).toHaveBeenCalledWith(st.scene, st.camera);
    st.render(null);
    st.dispose();
    st.render(renderer);
    expect(renderer.render).toHaveBeenCalledTimes(1);
  });
});

describe('victory-podium system helpers', () => {
  it('podiumCharacters picks the top three by place', () => {
    const standings = [
      { characterId: 'bizzy', place: 3 }, { characterId: 'rocco', place: 1 }, { characterId: 'dino', place: 4 }, { characterId: 'muffin', place: 2 },
    ];
    expect(podiumCharacters(standings).map((d) => d.id)).toEqual(['rocco', 'muffin', 'bizzy']);
    expect(podiumCharacters(null)).toEqual([]);
    expect(podiumCharacters([{ characterId: 'nobody', place: 1 }, null, { place: 2 }])).toEqual([]);
  });
  it('podiumWanted only on the results screen with standings and a renderer', () => {
    const game = { state: 'results', lastResults: { standings: [{ characterId: 'rocco', place: 1 }] } };
    const menus = { screenId: 'results' };
    expect(podiumWanted(game, menus, {})).toBe(true);
    expect(podiumWanted(game, menus, null)).toBe(false);
    expect(podiumWanted({ ...game, state: 'race' }, menus, {})).toBe(false);
    expect(podiumWanted(game, { screenId: 'time-trial-results' }, {})).toBe(false);
    expect(podiumWanted({ ...game, lastResults: { standings: [] } }, menus, {})).toBe(false);
  });
  it('readPodiumRects reads the portrait of each step by place', () => {
    const step = (place, r) => ({
      className: `sk-step sk-step-${place}`,
      querySelector: () => ({ getBoundingClientRect: () => r }),
    });
    const root = { querySelectorAll: () => [step(2, { left: 1, top: 2, width: 3, height: 4 }), step(1, { left: 5, top: 6, width: 7, height: 8 }), step(9, {}), { className: 'sk-step sk-step-3', querySelector: () => null }] };
    const out = readPodiumRects(root);
    expect(out.rects).toEqual([{ left: 5, top: 6, width: 7, height: 8 }, { left: 1, top: 2, width: 3, height: 4 }, null]);
    expect(out.winnerRect).toEqual(out.rects[0]);
    expect(readPodiumRects(null)).toEqual({ rects: [null, null, null], winnerRect: null });
  });
  it('the system does nothing without a renderer / DOM (tests, headless)', () => {
    const app = createFakeApp({ game: { state: 'results', errors: [], lastResults: { standings: [{ characterId: 'rocco', place: 1 }] } }, menus: { screenId: 'results' } });
    const uninstall = installSystems(app.bus, app, [victoryPodium]);
    app.bus.emit('frame', 1 / 60, app.game);
    expect(app.game.podium()).toBe(null);
    expect(app.bus.errors).toEqual([]);
    uninstall();
    expect(PODIUM_CLASS).toBe('skx-podium3d');
  });
});

describe('podium name labels stay readable over the 3D karts', () => {
  it('results and ceremony names get a white halo, sit above the canvas art and leave room under the kart', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/presentation/presentation.css', 'utf8');
    const m = /body\.skx-podium3d \.sk-results \.sk-step-name,\s*body\.skx-podium3d \.sk-cer \.sk-cer-name \{([^}]*)\}/.exec(css);
    expect(m).not.toBe(null);
    expect(m[1]).toMatch(/text-shadow:[^;]*#fff/);
    expect(m[1]).toMatch(/z-index:\s*3/);
    expect(parseFloat(/margin-top:\s*([\d.]+)em/.exec(m[1])[1])).toBeGreaterThanOrEqual(0.5);
  });
});
