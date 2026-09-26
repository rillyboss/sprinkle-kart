// Showcase presentation: camera wobble, finish orbit, photo finish, intro card,
// 3D confetti, the presentation sound pack and the race-spectacle system.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  createShake, SHAKE_AMOUNTS, FINISH_ORBIT, finishOrbitAt, finishCameraPose, orbitSide, photoFinishPair,
  introCardModel, wrap, easeOutCubic, easeInOutSine,
} from '../src/presentation/cameraFx.js';
import { createConfettiSim, createConfetti, CONFETTI_COLORS } from '../src/presentation/confetti.js';
import presentationSfx from '../src/audio/sfx/presentation.js';
import raceSpectacle from '../src/systems/raceSpectacle.js';
import { AudioManager } from '../src/audio/AudioManager.js';
import { SFX } from '../src/audio/sfx.js';
import { CameraRig } from '../src/render/CameraRig.js';
import { createPrefsStore } from '../src/presentation/prefs.js';
import { getCharacter } from '../src/characters/index.js';
import { installSystems } from '../src/systems/index.js';
import { createStrictAudioContext } from './helpers/fakeAudio.js';
import { createFakeApp, fakeSession, runHeadlessSession } from './helpers/headlessSession.js';

const memStore = (init = {}) => {
  const data = new Map();
  const s = createPrefsStore({ storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) }, reducedMotion: false });
  s.set(init);
  return s;
};

describe('easing helpers', () => {
  it('clamp and hit their end points', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeInOutSine(0)).toBeCloseTo(0);
    expect(easeInOutSine(1)).toBeCloseTo(1);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5);
    expect(wrap(Math.PI * 2.5)).toBeCloseTo(Math.PI / 2);
    expect(wrap(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });
});

describe('createShake', () => {
  it('is still with no trauma, bounded when shaking, and decays back to zero', () => {
    const s = createShake();
    expect(s.step(1 / 60)).toEqual({ x: 0, y: 0, roll: 0 });
    s.add(SHAKE_AMOUNTS.bonked);
    let maxX = 0;
    let maxRoll = 0;
    for (let i = 0; i < 30; i++) {
      const o = s.step(1 / 60);
      maxX = Math.max(maxX, Math.abs(o.x), Math.abs(o.y));
      maxRoll = Math.max(maxRoll, Math.abs(o.roll));
    }
    expect(maxX).toBeGreaterThan(0.005);
    expect(maxX).toBeLessThanOrEqual(0.28); // kid-tuned: never more than a nudge
    expect(maxRoll).toBeLessThanOrEqual(0.03);
    for (let i = 0; i < 120; i++) s.step(1 / 60);
    expect(s.trauma).toBe(0);
    expect(s.step(1 / 60)).toEqual({ x: 0, y: 0, roll: 0 });
  });
  it('trauma adds up to 1 and ignores junk', () => {
    const s = createShake();
    s.add(0.7); s.add(0.7);
    expect(s.trauma).toBe(1);
    s.add(NaN); s.add(-3);
    expect(s.trauma).toBe(1);
    s.reset();
    expect(s.trauma).toBe(0);
  });
  it('small bumps stay much smaller than bonks (trauma²)', () => {
    const peak = (amt) => { const s = createShake(); s.add(amt); let m = 0; for (let i = 0; i < 20; i++) { const o = s.step(1 / 60); m = Math.max(m, Math.abs(o.x)); } return m; };
    expect(peak(0.1)).toBeLessThan(peak(0.55) / 8);
  });
  it('is deterministic and survives bad dt', () => {
    const a = createShake({ seed: 3 }); const b = createShake({ seed: 3 });
    a.add(0.5); b.add(0.5);
    for (let i = 0; i < 10; i++) expect(a.step(0.016)).toEqual(b.step(0.016));
    expect(Number.isFinite(a.step(NaN).x)).toBe(true);
    expect(Number.isFinite(a.step(99).x)).toBe(true);
  });
});

describe('finish orbit', () => {
  it('starts behind the kart and blends in smoothly', () => {
    const p0 = finishOrbitAt(0);
    expect(p0.yaw).toBe(0);
    expect(p0.blend).toBe(0);
    expect(p0.dist).toBeCloseTo(FINISH_ORBIT.dist0);
    expect(finishOrbitAt(FINISH_ORBIT.blendIn).blend).toBeCloseTo(1);
    expect(finishOrbitAt(-5)).toEqual(p0);
    expect(finishOrbitAt(NaN)).toEqual(p0);
  });
  it('swings round towards the front, slowing down (slow-mo feel), then keeps drifting', () => {
    const y = (t) => finishOrbitAt(t).yaw;
    expect(y(1)).toBeGreaterThan(0);
    expect(y(2) - y(1)).toBeLessThan(y(1) - y(0)); // slowing down
    expect(y(6)).toBeGreaterThan(Math.PI * 0.8); // ends up in front
    expect(y(30)).toBeGreaterThan(y(10)); // still gently circling
    expect(finishOrbitAt(10).height).toBeCloseTo(FINISH_ORBIT.height1, 1);
  });
  it('finishCameraPose puts the camera behind at t=0 and looks at the kart', () => {
    const pose = finishCameraPose({ x: 10, y: 2, z: 5 }, 0, 0);
    // heading 0 = forward +Z, so behind = -Z
    expect(pose.pos.z).toBeCloseTo(5 - FINISH_ORBIT.dist0);
    expect(pose.pos.x).toBeCloseTo(10);
    expect(pose.look).toEqual({ x: 10, y: 2 + FINISH_ORBIT.lookHeight, z: 5 });
  });
  it('dir picks the side; the road clamp keeps the camera over the road', () => {
    const right = finishCameraPose({ x: 0, y: 0, z: 0 }, 0, 1.5, { dir: 1 });
    const left = finishCameraPose({ x: 0, y: 0, z: 0 }, 0, 1.5, { dir: -1 });
    // right of heading 0 = (-1, 0, 0)
    expect(right.pos.x).toBeLessThan(0);
    expect(left.pos.x).toBeGreaterThan(0);
    // kart near the right edge of a 9 m half-width road, camera swinging right: pulled in and raised
    const free = finishCameraPose({ x: 0, y: 0, z: 0 }, 0, 1.5, { dir: 1 });
    const clamped = finishCameraPose({ x: 0, y: 0, z: 0 }, 0, 1.5, { dir: 1, lateral: 7, halfWidth: 9 });
    const latOf = (pose, lateral) => lateral + (pose.pos.x * -1);
    expect(latOf(free, 7)).toBeGreaterThan(8); // would leave the road
    expect(latOf(clamped, 7)).toBeLessThan(latOf(free, 7));
    expect(latOf(clamped, 7) - 7).toBeCloseTo(Math.max(1, 0.3 * (latOf(free, 7) - 7)), 5);
    expect(clamped.height).toBeGreaterThan(free.height);
    // plenty of room: untouched
    expect(finishCameraPose({ x: 0, y: 0, z: 0 }, 0, 1.5, { dir: -1, lateral: 0, halfWidth: 9 }).pos).toEqual(left.pos);
  });
  it('orbitSide swings towards the side with more room', () => {
    expect(orbitSide(-4, 9)).toBe(1);
    expect(orbitSide(4, 9)).toBe(-1);
    expect(orbitSide(0, 9)).toBe(1);
    expect(orbitSide(NaN, 9)).toBe(1);
  });
});

describe('photoFinishPair', () => {
  it('finds a human finishing within the window of a neighbour', () => {
    expect(photoFinishPair([{ time: 30, human: false }, { time: 30.2, human: true }])).toEqual([0, 1]);
    expect(photoFinishPair([{ time: 30, human: true }, { time: 30.4, human: false }])).toBe(null);
    expect(photoFinishPair([{ time: 30, human: false }, { time: 30.1, human: false }])).toBe(null);
    expect(photoFinishPair([{ time: 30, human: true }])).toBe(null);
    expect(photoFinishPair([{ time: NaN, human: true }, { time: 30, human: true }])).toBe(null);
    expect(photoFinishPair([{ time: 1, human: true }, { time: 1.5, human: true }], 0.6)).toEqual([0, 1]);
  });
});

describe('introCardModel', () => {
  const def = { id: 'bubblegum-bay', name: 'Bubblegum Bay', subtitle: 'Pop! goes the beach', art: ['🫧', '🏖️', '🍬', '🦀'] };
  it('free races show the cup, Grand Prix shows the race number, Time Trial says so', () => {
    expect(introCardModel(def, { mode: 'free' }, { cupName: 'Bubble Cup', cupEmoji: '🫧' })).toEqual({
      kicker: '🫧 Bubble Cup', title: 'Bubblegum Bay', subtitle: 'Pop! goes the beach', art: ['🫧', '🏖️', '🍬'],
    });
    expect(introCardModel(def, { mode: 'grand-prix', gpRace: 1 }, { cupName: 'Bubble Cup', cupEmoji: '🫧', raceCount: 4 }).kicker)
      .toBe('🫧 Bubble Cup · Race 2 of 4');
    expect(introCardModel(def, { mode: 'grand-prix' }).kicker).toBe('Grand Prix');
    expect(introCardModel(def, { mode: 'time-trial' }).kicker).toBe('⏱️ Time Trial');
    expect(introCardModel(def, {}).kicker).toBe('🏁 Free Race');
  });
  it('has friendly defaults for a bare track', () => {
    expect(introCardModel(null)).toEqual({ kicker: '🏁 Free Race', title: 'Mystery Track', subtitle: '', art: ['🏁', '🍬', '✨'] });
  });
});

describe('confetti simulation', () => {
  it('bursts upwards, falls with gravity + drag and expires', () => {
    const sim = createConfettiSim({ max: 200, seed: 'x', life: 2 });
    expect(sim.burst({ x: 0, y: 1, z: 0 }, { count: 50 })).toBe(50);
    expect(sim.alive).toBe(50);
    const vy0 = sim.vel[1];
    expect(vy0).toBeGreaterThan(0);
    sim.step(0.1);
    expect(sim.vel[1]).toBeLessThan(vy0);
    for (let i = 0; i < 10; i++) sim.step(0.1);
    // after a while pieces flutter down no faster than terminal speed
    for (let i = 0; i < 50; i++) if (Number.isFinite(sim.age[i])) expect(sim.vel[i * 3 + 1]).toBeGreaterThanOrEqual(-2.2 - 1e-6);
    for (let i = 0; i < 40; i++) sim.step(0.1);
    expect(sim.alive).toBe(0);
    expect(sim.alpha(0)).toBe(0);
  });
  it('fades out over the end of life and stays finite', () => {
    const sim = createConfettiSim({ max: 20, seed: 'y', life: 2 });
    sim.burst({ x: 1, y: 2, z: 3 }, { count: 20 });
    expect(sim.alpha(0)).toBe(1);
    let lastAlpha = 1;
    for (let k = 0; k < 30; k++) {
      sim.step(0.05);
      for (const v of sim.pos) expect(Number.isFinite(v)).toBe(true);
      const a = sim.alpha(0);
      expect(a).toBeLessThanOrEqual(lastAlpha + 1e-9);
      lastAlpha = a;
    }
  });
  it('recycles the oldest pieces when full (the count never exceeds max)', () => {
    const sim = createConfettiSim({ max: 30, seed: 'z' });
    sim.burst({ x: 0, y: 0, z: 0 }, { count: 25 });
    sim.burst({ x: 0, y: 0, z: 0 }, { count: 25 });
    expect(sim.alive).toBe(30);
    expect(sim.burst({ x: 0, y: 0, z: 0 }, { count: 999 })).toBe(30);
    expect(sim.alive).toBe(30);
  });
  it('ignores bad origins and bad dt; clear() empties it', () => {
    const sim = createConfettiSim({ max: 10 });
    expect(sim.burst(null)).toBe(0);
    expect(sim.burst({ x: NaN, y: 0, z: 0 })).toBe(0);
    sim.burst({ x: 0, y: 0, z: 0 }, { count: 5, colors: [0xff0000] });
    expect(sim.color[0]).toBeCloseTo(1);
    expect(sim.step(NaN)).toBe(5);
    sim.clear();
    expect(sim.alive).toBe(0);
  });
  it('uses candy colours by default', () => {
    expect(CONFETTI_COLORS.length).toBeGreaterThan(4);
  });
});

describe('createConfetti (THREE wrapper)', () => {
  it('is hidden until a burst, updates attributes, hides again when done, disposes once', () => {
    const c = createConfetti({ max: 100, seed: 'w' });
    expect(c.object).toBeInstanceOf(THREE.Points);
    expect(c.object.visible).toBe(false);
    c.burst({ x: 0, y: 0, z: 0 }, { count: 40 });
    expect(c.object.visible).toBe(true);
    expect(c.alive).toBe(40);
    const v = c.object.geometry.getAttribute('position').version;
    c.update(0.05);
    expect(c.object.geometry.getAttribute('position').version).toBeGreaterThan(v);
    for (let i = 0; i < 100; i++) c.update(0.1);
    expect(c.alive).toBe(0);
    expect(c.object.visible).toBe(false);
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    c.object.onBeforeRender({ getCurrentViewport: (vp) => vp.set(0, 0, 100, 500) }, null, cam);
    expect(c.object.material.uniforms.uScale.value).toBeCloseTo(500 / (2 * Math.tan((50 * Math.PI) / 360)), 3);
    const spy = vi.spyOn(c.object.geometry, 'dispose');
    c.dispose(); c.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(c.burst({ x: 0, y: 0, z: 0 })).toBe(0);
  });
});

describe('presentation sound pack', () => {
  it('every recipe is registered and renders cleanly on a strict Web Audio mock', () => {
    const names = Object.keys(presentationSfx.recipes);
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const n of names) {
      expect(n.startsWith('skx-')).toBe(true);
      expect(typeof SFX[n], n).toBe('function');
    }
    const { ctx, stats } = createStrictAudioContext();
    const am = new AudioManager({ createContext: () => ctx, startTimer: false, autoUnlock: false });
    am.unlock();
    for (const n of names) { am.sfx(n, { pan: -0.3 }); ctx.advance(0.1); am.sfx(n, { pan: 0.9, pitch: 1.3 }); ctx.advance(2); }
    am.dispose();
    expect(stats.errors).toEqual([]);
    expect(stats.started).toBeGreaterThan(names.length);
  });
});

/* ---------------- the system ---------------- */

function makeRace() {
  const me = { characterId: 'rocco', charDef: getCharacter('rocco'), playerIndex: 0, isCPU: false, place: 1, position: new THREE.Vector3(0, 0, 0), heading: 0, lateral: 0, finishTime: null };
  const cpu = { characterId: 'lenny', charDef: getCharacter('lenny'), playerIndex: null, isCPU: true, place: 2, position: new THREE.Vector3(3, 0, -4), heading: 0, lateral: 3, finishTime: null };
  const race = {
    state: 'countdown', countdown: 3, clock: 0, time: 0, lapsTotal: 3, karts: [me, cpu],
    path: { halfWidth: 9 },
    getPlayerKart: (pi) => (pi === 0 ? me : null),
    getStandings: () => [me, cpu],
  };
  return { me, cpu, race };
}

function rig(prefs = {}) {
  const store = memStore(prefs);
  const app = createFakeApp({ prefs: store, game: { state: 'race', errors: [] } });
  const uninstall = installSystems(app.bus, app, [raceSpectacle]);
  const { me, cpu, race } = makeRace();
  const scene = new THREE.Scene();
  const cam = new CameraRig();
  const session = { ...fakeSession(app, { humans: 1, race }), race, scene, rigs: [cam], trackDef: { id: 'gumdrop-meadow', name: 'Gumdrop Meadow' }, setup: { mode: 'free' }, path: race.path };
  app.bus.emit('race-start', { mode: 'free' }, session);
  const frame = (dt = 1 / 30, extra = {}) => {
    race.clock += dt;
    if (race.state === 'racing') race.time += dt;
    cam.update(dt, me, { countdown: race.state === 'countdown' ? race.countdown : null });
    app.bus.emit('race-frame', dt, { ...session, ...extra });
  };
  return { app, store, session, scene, cam, me, cpu, race, frame, uninstall, spec: () => app.game.spectacle() };
}

describe('race-spectacle system', () => {
  it('adds a confetti object to the scene and removes it on race-exit', () => {
    const r = rig();
    expect(r.scene.children.some((c) => c.userData.presentation === 'confetti')).toBe(true);
    expect(r.spec()).toMatchObject({ orbiting: [], confetti: 0, photoFinish: false });
    r.app.bus.emit('race-exit', { outcome: 'menu' }, r.session);
    expect(r.scene.children.some((c) => c.userData.presentation === 'confetti')).toBe(false);
    expect(r.spec()).toBe(null);
    r.uninstall();
  });

  it('bonks, shield pops and bumps wobble the human camera (never CPUs), then it settles', () => {
    const r = rig();
    r.race.state = 'racing';
    r.app.bus.emit('race:bonked', { type: 'bonked', kart: r.cpu }, r.session);
    expect(r.spec().trauma).toEqual({});
    r.app.bus.emit('race:bonked', { type: 'bonked', kart: r.me, by: r.cpu }, r.session);
    expect(r.spec().trauma[0]).toBeCloseTo(SHAKE_AMOUNTS.bonked);
    r.app.bus.emit('race:shield-pop', { type: 'shield-pop', kart: r.me, expired: true }, r.session);
    expect(r.spec().trauma[0]).toBeCloseTo(SHAKE_AMOUNTS.bonked); // an expiring shield is not a bump
    r.app.bus.emit('race:bump', { type: 'bump', kart: r.cpu, other: r.me, strength: 1 }, r.session);
    expect(r.spec().trauma[0]).toBeGreaterThan(SHAKE_AMOUNTS.bonked);
    // the camera is actually displaced from the chase pose
    r.cam.update(1 / 30, r.me);
    const chase = r.cam.camera.position.clone();
    r.app.bus.emit('race-frame', 1 / 30, r.session);
    expect(r.cam.camera.position.distanceTo(chase)).toBeGreaterThan(1e-4);
    for (let i = 0; i < 120; i++) r.frame();
    expect(r.spec().trauma[0]).toBe(0);
  });

  it('screen wobble off (or gentle motion) keeps the camera still', () => {
    for (const prefs of [{ shake: false }, { motion: 'gentle' }]) {
      const r = rig(prefs);
      r.race.state = 'racing';
      r.app.bus.emit('race:bonked', { type: 'bonked', kart: r.me }, r.session);
      expect(r.spec().trauma).toEqual({});
    }
  });

  it('a human finish throws confetti and swings the camera round the kart', () => {
    const r = rig();
    r.race.state = 'racing';
    for (let i = 0; i < 5; i++) r.frame();
    const behind = r.cam.camera.position.clone();
    r.me.finishTime = 30;
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 1 }, r.session);
    expect(r.spec().orbiting).toEqual([0]);
    expect(r.app.audio.played('skx-confetti')).toBe(1);
    r.frame(1 / 30);
    expect(r.spec().confetti).toBeGreaterThan(10); // the fountain starts right away
    expect(r.app.audio.played('skx-whoosh')).toBe(1);
    for (let i = 0; i < 90; i++) r.frame(1 / 30);
    // 3 s later the camera is well round the side / front of the kart (heading 0: behind = -Z)
    expect(r.cam.camera.position.z).toBeGreaterThan(behind.z + 2);
    // a winner gets a second, delayed burst
    expect(r.spec().confetti).toBeGreaterThan(0);
    // the camera always looks roughly at the kart
    const toKart = r.me.position.clone().sub(r.cam.camera.position).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(r.cam.camera.quaternion);
    expect(fwd.dot(toKart)).toBeGreaterThan(0.8);
  });

  it('gentle motion: confetti (halved) but no orbit; CPUs finishing do nothing visual', () => {
    const count = (prefs) => {
      const r = rig(prefs);
      r.race.state = 'racing';
      r.app.bus.emit('race:finish', { type: 'finish', kart: r.cpu, place: 1 }, r.session);
      r.frame();
      expect(r.spec().confetti).toBe(0);
      r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 4 }, r.session);
      for (let i = 0; i < 20; i++) r.frame(); // 0.67 s of fountain
      return { confetti: r.spec().confetti, orbiting: r.spec().orbiting };
    };
    const full = count({});
    const gentle = count({ motion: 'gentle' });
    expect(full.orbiting).toEqual([0]);
    expect(gentle.orbiting).toEqual([]);
    expect(gentle.confetti).toBe(Math.round(full.confetti / 2));
  });

  it('the fountain follows a moving kart (confetti inherits its velocity) and stops after a while', () => {
    const r = rig();
    r.race.state = 'racing';
    r.me.velocity = new THREE.Vector3(0, 0, 20);
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 2 }, r.session);
    for (let i = 0; i < 12; i++) { r.me.position.z += 20 / 30; r.frame(); }
    const sim = r.scene.children.find((c) => c.userData.presentation === 'confetti');
    const pos = sim.geometry.getAttribute('position').array;
    let sumZ = 0; let n = 0;
    for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] > -1000) { sumZ += pos[i + 2]; n++; }
    expect(n).toBeGreaterThan(20);
    expect(sumZ / n).toBeGreaterThan(3); // travelled along with the kart
    for (let i = 0; i < 200; i++) r.frame();
    expect(r.spec().confetti).toBe(0);
  });

  it('the debug hook throws confetti anywhere', () => {
    const r = rig();
    expect(r.app.game.confettiBurst({ x: 0, y: 1, z: 0 }, { count: 12 })).toBe(12);
    r.app.bus.emit('race-exit', {}, r.session);
    expect(r.app.game.confettiBurst({ x: 0, y: 1, z: 0 })).toBe(0);
  });

  it('detects a photo finish once, flashes the human and plays the camera click', () => {
    const r = rig();
    r.race.state = 'racing';
    r.cpu.finishTime = 30;
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.cpu, place: 1 }, r.session);
    r.me.finishTime = 30.12;
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 2 }, r.session);
    expect(r.spec().photoFinish).toBe(true);
    expect(r.app.hud.flashes).toContainEqual({ playerIndex: 0, text: '📸 Photo finish!' });
    expect(r.app.audio.played('skx-photo')).toBe(1);
  });

  it('no photo finish when the gap is big', () => {
    const r = rig();
    r.cpu.finishTime = 30;
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.cpu, place: 1 }, r.session);
    r.me.finishTime = 31;
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 2 }, r.session);
    expect(r.spec().photoFinish).toBe(false);
  });

  it('pausing freezes the orbit and confetti but keeps the camera on its pose', () => {
    const r = rig();
    r.race.state = 'racing';
    r.me.finishTime = 30;
    r.app.bus.emit('race:finish', { type: 'finish', kart: r.me, place: 2 }, r.session);
    for (let i = 0; i < 20; i++) r.frame();
    const alive = r.spec().confetti;
    const pos = r.cam.camera.position.clone();
    for (let i = 0; i < 20; i++) { r.cam.update(0, r.me); r.app.bus.emit('race-frame', 1 / 30, { ...r.session, paused: true }); }
    expect(r.spec().confetti).toBe(alive);
    expect(r.cam.camera.position.distanceTo(pos)).toBeLessThan(1e-6);
  });

  it('headless: no scene, no rigs, no DOM — still no handler errors over a whole race', () => {
    const s = runHeadlessSession('bubblegum-bay', { humans: 2, laps: 1, systems: [raceSpectacle] });
    expect(s.errors).toEqual([]);
    expect(s.summary).toBeTruthy();
  });
});
