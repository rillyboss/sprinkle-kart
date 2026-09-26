/**
 * Smooth karts at any refresh rate (net review #3 / #4).
 *
 *  Host: the Race moves karts only when a 60 Hz tick runs. The host now puts its tick grid half a tick before
 *  the start frame (vsync frames land mid-tick) and draws every kart between its last two tick poses at the
 *  clock's alpha (createHostPresenter). Measured: per-frame displacement of the host's own kart ÷ speed×dt stays
 *  within ±50 % on vsync-locked frames with callback jitter at 60 and 144 Hz.
 *
 *  Guest: frames that predict no tick (120/144 Hz) used to draw the full current pose (alpha = 1) and the next
 *  frame blended back — a forward-back judder of the own kart and the camera. It now always blends prev → cur
 *  at P's fraction (heading too).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Race, aiDriveInput } from '../src/race/Race.js';
import { createHostNetRace, createInputLatch, createHostPresenter, HOST_TICK_PHASE_MS } from '../src/online/netRace.js';
import { netStack } from '../src/online/stack.js';
import { createHostClock } from '../src/net/host/hostClock.js';
import { trackFixture, defaultRacerIds, stubKartModel } from './helpers/raceHarness.js';
import { runNetRace, mulberry } from './helpers/netHarness.js';

/** Host alone (no guests) on vsync-locked frames with callback jitter; returns the own-kart jerky-frame share. */
function hostFrames({ hz, jitterMs = 1, present = true, seconds = 9, seed = 3 }) {
  const { def, path } = trackFixture('gumdrop-meadow');
  const ids = defaultRacerIds(8);
  const participants = ids.map((characterId, i) => ({ characterId, playerIndex: i === 7 ? 0 : null }));
  const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants, speedClass: 'zippy', buildKartModel: stubKartModel(), laps: 1, seed, onEvent: () => {} });
  const transport = { send: () => true, broadcast: () => {}, stats: () => ({}), peers: () => [] };
  const latch = createInputLatch();
  const rnd = mulberry(seed);
  let wall = 1000;
  const link = createHostNetRace({ stack: netStack, race, transport, setup: { raceId: 1 }, houses: new Map(), localInputs: () => latch.forTick(), now: () => wall });
  const me = race.getPlayerKart(0);
  const frameMs = 1000 / hz;
  let last = null;
  let frames = 0;
  let jerky = 0;
  let zeroTickFrames = 0;
  for (let f = 0; f < seconds * hz; f++) {
    const vsync = 1000 + f * frameMs;
    wall = vsync + (rnd() - 0.5) * 2 * jitterMs; // rAF callback time = vsync ± jitter
    const inputs = [];
    inputs[0] = aiDriveInput(race, me, 1 / 60);
    latch.setFrame(inputs);
    const fr = link.frame(wall, 'raf');
    if (present) link.present(fr.alpha);
    const p = present ? me.render.position : me.position;
    const pos = { x: p.x, z: p.z };
    if (last && race.state === 'racing' && me.speed > 12) {
      frames++;
      const d = Math.hypot(pos.x - last.x, pos.z - last.z);
      const e = me.speed * (frameMs / 1000);
      if (d < 0.5 * e || d > 1.5 * e) jerky++;
      if (fr.ticks === 0) zeroTickFrames++;
    }
    last = pos;
  }
  race.dispose();
  link.dispose();
  return { frames, jerky, share: frames ? jerky / frames : 1, zeroTickFrames };
}

describe('host render interpolation (review #3)', () => {
  it('the host clock can put its tick grid half a tick before the start frame', () => {
    const c = createHostClock({ now: () => 0, phaseMs: HOST_TICK_PHASE_MS });
    c.start(100);
    expect(c.state().anchorMs).toBeCloseTo(100 - 1000 / 120, 6);
    // the frame at the start runs exactly one tick; a frame one tick later runs exactly one more
    expect(c.advance(100).ticks).toBe(1);
    expect(c.advance(100 + 1000 / 60).ticks).toBe(1);
    expect(c.advance(100 + 2000 / 60 + 1).ticks).toBe(1); // +1 ms of callback jitter changes nothing
    expect(c.advance(100 + 3000 / 60 - 1).ticks).toBe(1);
    expect(createHostClock({ now: () => 0 }).start(100).anchorMs).toBe(100); // default: no phase
  });

  for (const hz of [60, 144]) {
    it(`${hz} Hz vsync frames with ±1 ms jitter: the host's own kart moves smoothly every frame`, () => {
      const r = hostFrames({ hz, jitterMs: 1 });
      expect(r.frames).toBeGreaterThan(hz * 4);
      expect(r.share).toBeLessThan(0.03);
    });
  }

  it('±2 ms jitter at 60 Hz: no 0-tick frames once the grid sits mid-frame', () => {
    const r = hostFrames({ hz: 60, jitterMs: 2 });
    expect(r.zeroTickFrames).toBe(0);
    expect(r.share).toBeLessThan(0.03);
  });

  it('control: drawing the raw tick pose at 144 Hz is the judder this fixes', () => {
    expect(hostFrames({ hz: 144, jitterMs: 1, present: false }).share).toBeGreaterThan(0.3);
  });

  it('the presenter never sweeps a respawned kart across the track and moves the model + camera pose', () => {
    const k = { id: 0, position: new THREE.Vector3(0, 0, 0), heading: 3.1, phys: { pitch: 0, roll: 0, spinAngle: 0 }, model: { group: new THREE.Group() } };
    const p = createHostPresenter({ karts: [k] });
    p.beforeTick();
    k.position.set(1, 0, 0);
    k.heading = -3.1; // across ±π: the short way round
    p.present(0.5);
    expect(k.render.position.x).toBeCloseTo(0.5);
    expect(k.model.group.position.x).toBeCloseTo(0.5);
    expect(Math.abs(Math.abs(k.render.heading) - Math.PI)).toBeLessThan(0.05);
    p.beforeTick();
    k.position.set(50, 0, 0); // a respawn
    p.present(0.5);
    expect(k.render.position.x).toBe(50);
  });
});

/** Own-kart per-frame displacement ÷ speed×dt on a guest at `hz`. */
function guestOwnKart(hz) {
  let last = null;
  let frames = 0;
  let jerky = 0;
  runNetRace({
    houses: [[1]], laps: 1, seed: 5, conditions: { latencyMs: 25 }, guestFrameMs: 1000 / hz, maxSeconds: 14,
    onGuestFrame: ({ g, fr, t }) => {
      if (fr.P === undefined) return;
      const id = g.replica.localKartIds[0];
      const k = g.replica.karts[id];
      const pos = { x: k.render.position.x, z: k.render.position.z, t };
      if (last && g.replica.isPredicted(id) && k.speed > 12 && g.replica.state === 'racing') {
        frames++;
        const d = Math.hypot(pos.x - last.x, pos.z - last.z);
        const e = k.speed * ((t - last.t) / 1000);
        if (d < 0.5 * e || d > 1.5 * e) jerky++;
      }
      last = pos;
    },
  });
  return { frames, share: frames ? jerky / frames : 1 };
}

describe('guest own-kart prediction drawing (review #4)', () => {
  for (const hz of [60, 144]) {
    it(`${hz} Hz guest: the own kart (and the camera on it) moves smoothly every frame`, () => {
      const r = guestOwnKart(hz);
      expect(r.frames).toBeGreaterThan(hz * 3);
      expect(r.share).toBeLessThan(0.05);
    });
  }
});
