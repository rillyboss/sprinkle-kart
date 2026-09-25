import * as THREE from 'three';
import { TrackPath } from '../src/track/TrackPath.js';

/** A friendly test loop (~950 units) with sweeping bends and a gentle hill. */
export function makeTestPath(width = 18) {
  const pts = [];
  const N = 20;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 1 + 0.18 * Math.sin(a * 2); // pinched ellipse => varied curvature
    pts.push([Math.cos(a) * 190 * r, 6 + Math.sin(a) * 6, Math.sin(a) * 110 * r]);
  }
  return new TrackPath(pts, width);
}

/** A tighter stadium loop (two straights + 45-radius hairpins, ~680 units). */
export function makeStadiumPath(width = 18) {
  const pts = [];
  const R = 45, half = 120;
  for (let i = 0; i <= 4; i++) pts.push([-half + (i / 4) * 2 * half, 0, -R]);
  for (let i = 1; i < 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    pts.push([half + Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  for (let i = 0; i <= 4; i++) pts.push([half - (i / 4) * 2 * half, 0, R]);
  for (let i = 1; i < 8; i++) {
    const a = Math.PI / 2 + (i / 8) * Math.PI;
    pts.push([-half + Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  return new TrackPath(pts, width);
}

export function makeBuiltTrack(path) {
  const L = path.length;
  const slots = [];
  for (const f of [0.15, 0.42, 0.7]) {
    for (const lateral of [-6, -2, 2, 6]) {
      const s = f * L;
      slots.push({ s, lateral, position: path.positionAt(s, lateral, new THREE.Vector3()) });
    }
  }
  const boostPads = [0.3, 0.8].map((f) => ({
    s: f * L, lateral: 0, length: 6, halfWidth: 2.5, position: path.positionAt(f * L, 0, new THREE.Vector3()),
  }));
  return { group: new THREE.Group(), itemBoxSlots: slots, boostPads, update() {}, dispose() {} };
}

export function stubModel() {
  const calls = [];
  const fn = () => ({
    group: new THREE.Group(),
    update(dt, state) { calls.push(state); },
    dispose() { this.disposed = true; },
  });
  fn.calls = calls;
  return fn;
}

export const CHARACTER_IDS = ['rocco', 'lenny', 'stella', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy'];

export function cpuParticipants(n = 8) {
  return CHARACTER_IDS.slice(0, n).map((characterId) => ({ characterId, playerIndex: null, easyDrive: false }));
}

/** Mock for src/data/characters.js (written in parallel by another engineer). */
export const characterMock = () => ({
  getCharacter: (id) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1) + ' Test',
    stats: { speed: 3, accel: 3, handling: 3, weight: id === 'gumbo' ? 5 : id === 'muffin' ? 1 : 3 },
    colors: {},
  }),
  CHARACTERS: [],
});

export function humanParticipants(n = 2, opts = {}) {
  return CHARACTER_IDS.slice(0, n).map((characterId, i) => ({ characterId, playerIndex: i, easyDrive: !!opts.easyDrive }));
}

/** Build a race with sensible test defaults; collects events in race.__events. */
export async function makeRace(opts = {}) {
  const { Race } = await import('../src/race/Race.js');
  const path = opts.path || makeTestPath();
  const events = [];
  const buildKartModel = opts.buildKartModel || stubModel();
  const scene = opts.scene || new THREE.Scene();
  const race = new Race({
    scene,
    trackDef: { laps: opts.laps ?? 3, ...(opts.trackDef || {}) },
    path,
    builtTrack: opts.builtTrack === undefined ? makeBuiltTrack(path) : opts.builtTrack,
    participants: opts.participants || cpuParticipants(8),
    speedClass: opts.speedClass || 'zippy',
    buildKartModel,
    onEvent: (e) => events.push(e),
    seed: opts.seed ?? 1,
    laps: opts.laps,
  });
  race.__events = events;
  race.__scene = scene;
  race.__buildKartModel = buildKartModel;
  return race;
}

/** Tick through the 3 s countdown with no input. */
export function skipCountdown(race, dt = 1 / 60) {
  while (race.state === 'countdown') race.update(dt, []);
}

/** Teleport a kart to (s, lateral) facing along the track (plus headingOffset). */
export function placeKart(race, kart, s, lateral = 0, speed = 0, headingOffset = 0) {
  const path = race.path;
  s = path.wrap(s);
  path.positionAt(s, lateral, kart.position);
  kart.s = s;
  kart.lateral = lateral;
  kart.heading = path.headingAt(s) + headingOffset;
  kart.velocity.set(Math.sin(kart.heading) * speed, 0, Math.cos(kart.heading) * speed);
  kart.speed = speed;
  kart.phys.groundY = kart.position.y;
  kart.distance = (kart.lap - 1) * path.length + s;
}

export const input = (o = {}) => ({ steer: 0, accel: 0, brake: 0, drift: false, useItem: false, lookBack: false, ...o });

/** Run the race until complete (or maxSeconds of race time). */
export function runRace(race, { dt = 1 / 60, maxSeconds = 400, inputs = () => [], onFrame } = {}) {
  let frames = 0;
  const maxFrames = Math.ceil((maxSeconds + 4) / dt);
  while (race.state !== 'finished' && frames < maxFrames) {
    race.update(dt, inputs(race, frames));
    onFrame?.(race, frames);
    frames++;
  }
  return frames;
}
