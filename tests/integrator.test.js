import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeViewports, pixelRatioFor, SplitScreen, VIEWPORT_GAP } from '../src/render/SplitScreen.js';
import { CameraRig, SpectatorCam, wrapAngle, fitVerticalFov, swoopAt, smoothing, easeInOutCubic } from '../src/render/CameraRig.js';
import {
  parseDebugParams, pickCpuCharacters, buildParticipants, nextTrackId, quickSetup, quickDeviceIds, driftBoostText, shuffle,
} from '../src/game/setup.js';
import { CHARACTERS, getSelectableCharacters } from '../src/data/characters.js';
import { TRACKS } from '../src/data/tracks.js';
import { TrackPath } from '../src/track/TrackPath.js';
import { RACERS_PER_RACE, UNLOCK_CHARACTER_ID } from '../src/config.js';
import { makeRng } from '../src/race/Race.js';

const area = (r) => r.w * r.h;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('computeViewports', () => {
  it('1 player fills the screen', () => {
    const { views, spectator } = computeViewports(1, 1280, 720);
    expect(views).toEqual([{ playerSlot: 0, x: 0, y: 0, w: 1280, h: 720 }]);
    expect(spectator).toBeNull();
  });

  it('2 players are stacked top / bottom', () => {
    const { views } = computeViewports(2, 1280, 720);
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({ x: 0, y: 0, w: 1280 });
    expect(views[1].x).toBe(0);
    expect(views[1].y).toBeGreaterThan(views[0].y + views[0].h - 1);
    expect(views[1].y + views[1].h).toBe(720);
  });

  it('3 players get quadrants plus a spectator quadrant', () => {
    const { views, spectator } = computeViewports(3, 1280, 720);
    expect(views).toHaveLength(3);
    expect(spectator).not.toBeNull();
    expect(spectator.x + spectator.w).toBe(1280);
    expect(spectator.y + spectator.h).toBe(720);
  });

  it('4 quadrants tile the screen without overlapping', () => {
    const W = 1921, H = 1081;
    const { views } = computeViewports(4, W, H);
    expect(views).toHaveLength(4);
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) expect(overlaps(views[i], views[j])).toBe(false);
    const total = views.reduce((a, v) => a + area(v), 0);
    expect(total).toBeLessThanOrEqual(W * H);
    expect(total).toBeGreaterThan(W * H - (W + H) * VIEWPORT_GAP * 1.5);
    for (const v of views) {
      expect(v.x + v.w).toBeLessThanOrEqual(W);
      expect(v.y + v.h).toBeLessThanOrEqual(H);
    }
  });

  it('clamps silly player counts', () => {
    expect(computeViewports(0, 800, 600).views).toHaveLength(1);
    expect(computeViewports(9, 800, 600).views).toHaveLength(4);
  });

  it('pixel ratio is capped by player count', () => {
    expect(pixelRatioFor(1, 3)).toBe(1.5);
    expect(pixelRatioFor(2, 3)).toBe(1.25);
    expect(pixelRatioFor(4, 3)).toBe(1);
    expect(pixelRatioFor(1, 1)).toBe(1);
  });
});

describe('SplitScreen', () => {
  function fakeRenderer() {
    const calls = [];
    return {
      calls,
      autoClear: true,
      setScissorTest: (v) => calls.push(['scissorTest', v]),
      setViewport: (...a) => calls.push(['viewport', ...a]),
      setScissor: (...a) => calls.push(['scissor', ...a]),
      render: (scene, cam) => calls.push(['render', cam.name]),
      clear: () => calls.push(['clear']),
      getClearColor: (c) => c.set(0xffffff),
      getClearAlpha: () => 1,
      setClearColor: () => {},
    };
  }

  it('renders each camera into its own flipped-Y viewport', () => {
    const r = fakeRenderer();
    const ss = new SplitScreen(r);
    ss.resize(1000, 600);
    ss.setPlayerCount(2);
    const cams = [{ name: 'a' }, { name: 'b' }];
    ss.render(new THREE.Scene(), cams);
    const vps = r.calls.filter((c) => c[0] === 'viewport');
    // P1 is the TOP half: in GL (bottom-left origin) that's the higher y.
    expect(vps[0][2]).toBeGreaterThan(vps[1][2]);
    expect(r.calls.filter((c) => c[0] === 'render').map((c) => c[1])).toEqual(['a', 'b']);
  });

  it('draws the spectator camera for 3 players and restores the fog', () => {
    const r = fakeRenderer();
    const ss = new SplitScreen(r);
    ss.resize(800, 600);
    ss.setPlayerCount(3);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xffffff, 50, 400);
    ss.render(scene, [{ name: 'a' }, { name: 'b' }, { name: 'c' }], { name: 'spec' });
    expect(r.calls.filter((c) => c[0] === 'render').map((c) => c[1])).toEqual(['a', 'b', 'c', 'spec']);
    expect(scene.fog.near).toBe(50);
    expect(scene.fog.far).toBe(400);
  });

  it('hudRects maps slots to player indices', () => {
    const ss = new SplitScreen(fakeRenderer());
    ss.resize(800, 600);
    ss.setPlayerCount(2);
    const rects = ss.hudRects([0, 2]);
    expect(rects.map((r) => r.playerIndex)).toEqual([0, 2]);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 800 });
  });
});

describe('CameraRig helpers', () => {
  it('wrapAngle keeps angles in (-PI, PI]', () => {
    for (const a of [0, 1, -1, 3.5, -3.5, 10, -10, 100]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 6);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 6);
    }
  });

  it('fitVerticalFov narrows very wide viewports only', () => {
    expect(fitVerticalFov(62, 16 / 9, 100)).toBe(62);
    const wide = fitVerticalFov(62, 3.6, 100);
    expect(wide).toBeLessThan(45);
    const h = (2 * Math.atan(Math.tan((wide * Math.PI) / 360) * 3.6) * 180) / Math.PI;
    expect(h).toBeCloseTo(100, 3);
  });

  it('swoop starts orbited and ends at the chase position', () => {
    expect(swoopAt(3).orbit).toBeGreaterThan(2);
    expect(swoopAt(0).orbit).toBeCloseTo(0, 6);
    expect(swoopAt(null)).toEqual({ orbit: 0, distMult: 1, lift: 0 });
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(smoothing(5, 0)).toBe(0);
    expect(smoothing(5, 10)).toBeCloseTo(1, 6);
  });
});

function fakeKart(heading = 0, pos = [0, 0, 0]) {
  return {
    heading, speed: 20, position: new THREE.Vector3(...pos), boosting: false, drifting: false, spinning: false,
    starPower: 0, stats: { maxSpeed: 33 },
  };
}

describe('CameraRig', () => {
  it('sits behind and above the kart, looking forward', () => {
    const rig = new CameraRig({ aspect: 16 / 9 });
    const kart = fakeKart(0, [10, 2, 20]);
    for (let i = 0; i < 60; i++) rig.update(1 / 60, kart);
    const cam = rig.camera;
    expect(cam.position.z).toBeLessThan(kart.position.z - 3); // behind (+Z is forward)
    expect(cam.position.y).toBeGreaterThan(kart.position.y + 1);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    expect(dir.z).toBeGreaterThan(0.8);
  });

  it('follows a turning kart smoothly', () => {
    const rig = new CameraRig();
    const kart = fakeKart(0);
    rig.update(1 / 60, kart);
    kart.heading = Math.PI / 2;
    rig.update(1 / 60, kart);
    expect(rig.yaw).toBeGreaterThan(0);
    expect(rig.yaw).toBeLessThan(Math.PI / 2);
    for (let i = 0; i < 240; i++) rig.update(1 / 60, kart);
    expect(rig.yaw).toBeCloseTo(Math.PI / 2, 2);
  });

  it('look-back puts the camera in front of the kart', () => {
    const rig = new CameraRig();
    const kart = fakeKart(0, [0, 0, 0]);
    rig.update(1 / 60, kart, { lookBack: true });
    expect(rig.camera.position.z).toBeGreaterThan(2);
    const dir = rig.camera.getWorldDirection(new THREE.Vector3());
    expect(dir.z).toBeLessThan(-0.8);
  });

  it('widens the FOV on boost and uses a narrower FOV for wide split views', () => {
    const rig = new CameraRig({ aspect: 16 / 9 });
    const kart = fakeKart();
    for (let i = 0; i < 60; i++) rig.update(1 / 60, kart);
    const base = rig.camera.fov;
    kart.boosting = true;
    for (let i = 0; i < 60; i++) rig.update(1 / 60, kart);
    expect(rig.camera.fov).toBeGreaterThan(base + 4);
    const wide = new CameraRig();
    wide.setAspect(3.6);
    expect(wide.camera.fov).toBeLessThan(base);
  });

  it('never dips below the road and survives bad dt', () => {
    const rig = new CameraRig();
    const kart = fakeKart(0, [0, 10, 0]);
    rig.update(NaN, kart);
    rig.update(-1, kart);
    rig.update(5, kart, { countdown: 3 });
    expect(Number.isFinite(rig.camera.position.x)).toBe(true);
    expect(rig.camera.position.y).toBeGreaterThanOrEqual(11 - 1e-6);
  });
});

describe('SpectatorCam', () => {
  it('circles the leader and stays finite', () => {
    const def = TRACKS[0];
    const path = new TrackPath(def.controlPoints, def.width);
    const spec = new SpectatorCam(path);
    const leader = { position: path.positionAt(100, 0) };
    for (let i = 0; i < 120; i++) spec.update(1 / 60, { getStandings: () => [leader] });
    const d = spec.camera.position.distanceTo(leader.position);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(80);
    spec.update(1 / 60, null);
    expect(Number.isFinite(spec.camera.position.y)).toBe(true);
  });
});

describe('game setup helpers', () => {
  it('parses debug params', () => {
    const p = parseDebugParams('?quick=gumdrop-meadow&players=4&speed=zoomy&autodrive=1&fastfinish=1&unlockreset=1&cpus=0&simspeed=3');
    expect(p).toMatchObject({ quick: 'gumdrop-meadow', players: 4, speed: 'zoomy', autodrive: true, fastFinish: true, unlockReset: true, cpus: 0, simSpeed: 3 });
    const d = parseDebugParams('');
    expect(d).toMatchObject({ quick: null, players: 1, speed: 'zippy', autodrive: false, fastFinish: false, cpus: null, simSpeed: 1 });
    expect(parseDebugParams('?quick').quick).toBe('default');
    expect(parseDebugParams('?players=9&speed=warp&simspeed=99').players).toBe(4);
    expect(parseDebugParams('?speed=warp').speed).toBe('zippy');
    expect(parseDebugParams('?autodrive=0').autodrive).toBe(false);
  });

  it('CPU racers are distinct, unlocked and not picked by humans', () => {
    const selectable = getSelectableCharacters(() => false);
    for (let seed = 1; seed < 30; seed++) {
      const humans = ['rocco', 'rocco', 'stella'];
      const cpus = pickCpuCharacters(humans, selectable, RACERS_PER_RACE - humans.length, makeRng(seed));
      expect(cpus).toHaveLength(5);
      expect(new Set(cpus).size).toBe(5);
      for (const id of cpus) {
        expect(humans).not.toContain(id);
        expect(id).not.toBe(UNLOCK_CHARACTER_ID);
      }
    }
  });

  it('fills the grid even when there are not enough fresh characters', () => {
    const selectable = getSelectableCharacters(() => false).slice(0, 3);
    const cpus = pickCpuCharacters([selectable[0].id], selectable, 7, makeRng(2));
    expect(cpus).toHaveLength(7);
    expect(cpus.slice(0, 2).sort()).toEqual([selectable[1].id, selectable[2].id].sort());
    expect(pickCpuCharacters([], selectable, 0)).toEqual([]);
  });

  it('only uses Cotton Candy Girl as a CPU once she is unlocked, and last', () => {
    const selectable = getSelectableCharacters((id) => id === UNLOCK_CHARACTER_ID);
    expect(selectable.some((c) => c.id === UNLOCK_CHARACTER_ID)).toBe(true);
    const cpus = pickCpuCharacters(['rocco'], selectable, 7, makeRng(5));
    expect(cpus).not.toContain(UNLOCK_CHARACTER_ID);
    const all = pickCpuCharacters(['rocco'], selectable, 8, makeRng(5));
    expect(all[7]).toBe(UNLOCK_CHARACTER_ID);
  });

  it('humans start at the back of the grid, P1 last', () => {
    const humans = [
      { playerIndex: 0, deviceId: 'kb1', characterId: 'rocco', easyDrive: true },
      { playerIndex: 1, deviceId: 'gp0', characterId: 'lenny', easyDrive: false },
    ];
    const parts = buildParticipants(humans, ['a', 'b', 'c']);
    expect(parts.map((p) => p.playerIndex)).toEqual([null, null, null, 1, 0]);
    expect(parts[4]).toEqual({ characterId: 'rocco', playerIndex: 0, easyDrive: true });
  });

  it('next track wraps around', () => {
    expect(nextTrackId(TRACKS[0].id, TRACKS)).toBe(TRACKS[1].id);
    expect(nextTrackId(TRACKS[TRACKS.length - 1].id, TRACKS)).toBe(TRACKS[0].id);
    expect(nextTrackId('nope', TRACKS)).toBe(TRACKS[0].id);
  });

  it('quick setup builds a valid RaceSetup with virtual pads for players 3-4', () => {
    const added = [];
    const input = { addVirtualDevice: (id) => added.push(id) };
    const setup = quickSetup(parseDebugParams('?quick=sundae-slopes&players=4&speed=cozy'), input, CHARACTERS, TRACKS);
    expect(setup.trackId).toBe('sundae-slopes');
    expect(setup.speedClass).toBe('cozy');
    expect(setup.players.map((p) => p.deviceId)).toEqual(quickDeviceIds(4));
    expect(added).toEqual(['v2', 'v3']);
    expect(new Set(setup.players.map((p) => p.characterId)).size).toBe(4);
    expect(setup.players.every((p) => !CHARACTERS.find((c) => c.id === p.characterId).locked)).toBe(true);
    const fallback = quickSetup(parseDebugParams('?quick'), null, CHARACTERS, TRACKS);
    expect(fallback.trackId).toBe(TRACKS[0].id);
  });

  it('friendly helpers', () => {
    expect(driftBoostText(3)).toMatch(/Rainbow/);
    expect(driftBoostText(1)).toMatch(/Mini/);
    const s = shuffle([1, 2, 3, 4, 5], makeRng(1));
    expect([...s].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
