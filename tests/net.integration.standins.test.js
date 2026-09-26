/**
 * WS7: the running game uses copies of the WS5 test stand-ins (src/online/standins/*) until WS1 / WS2 land.
 * These tests pin them to the originals the convergence matrix was proven with (same bytes, same sim
 * steps) and check the swap point (src/online/stack.js). Room ids: tests/net.roomcode.test.js.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import * as srcWire from '../src/online/standins/wire.js';
import * as testWire from './helpers/netWire.js';
import * as srcSim from '../src/online/standins/sim.js';
import * as testSim from './helpers/netSim.js';
import { createClockSync as srcClock } from '../src/online/standins/clockSync.js';
import { createClockSync as testClock } from './helpers/netClock.js';
import { deriveRoomIds } from '../src/net/session/roomCode.js';
import { netStack, COUNTDOWN_SECONDS } from '../src/online/stack.js';
import { makeSimStateFixture } from '../src/race/simState.types.js';
import { Race } from '../src/race/Race.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';

const bytes = (u8) => Array.from(u8);

describe('wire stand-in copy = the WS5 test stand-in', () => {
  it('SNAPSHOT bytes are identical for the canonical fixture (with an owner tail)', () => {
    const s = makeSimStateFixture({ gumdrops: 3, rockets: 1 });
    const o = { epoch: 3, flags: { paused: false }, houseTail: { lastInputTick: 1234, inputSlack: 2, owner: [5, 6] } };
    expect(bytes(srcWire.encodeSnapshot(s, o))).toEqual(bytes(testWire.encodeSnapshot(structuredClone(s), o)));
  });

  it('INPUT / EVENTS / ctrl bytes are identical and decode the same', () => {
    const ticks = [{ tick: 100, players: [{ steer: 0.5, accel: 1, brake: 0, drift: true, itemCount: 3, hopCount: 5 }] }];
    const inp = { seq: 7, newestTick: 100, lastSnapTick: 96, ticks };
    expect(bytes(srcWire.encodeInput(inp))).toEqual(bytes(testWire.encodeInput(inp)));
    const ev = [{ seq: 1, tick: 10, type: 'lap', kart: 2, lap: 2, lapTimeMs: 31000 }, { seq: 2, tick: 12, type: 'finish', kart: 2, place: 1, finishTimeMs: 62000, estimated: false }];
    expect(bytes(srcWire.encodeEvents(ev))).toEqual(bytes(testWire.encodeEvents(ev)));
    for (const [type, o] of [[srcWire.MSG.TIMEBASE, { epoch: 1, tick: 9, hostMs: 123.5, reason: 1 }], [srcWire.MSG.PAUSE, { paused: true, reason: 0, tick: 44, epoch: 2 }],
      [srcWire.MSG.START, { raceId: 3, startTick: 1, goTick: 180, epoch: 0 }], [srcWire.MSG.RESULT, { raceId: 3, summary: { a: 1 } }]]) {
      const b = srcWire.encodeCtrl(type, o);
      expect(bytes(b)).toEqual(bytes(testWire.encodeCtrl(type, o)));
      expect(srcWire.decode(b)).toEqual(testWire.decode(b));
    }
    expect(srcWire.quantizeInput({ steer: 0.33, accel: 0.51 })).toEqual(testWire.quantizeInput({ steer: 0.33, accel: 0.51 }));
    expect(srcWire.MSG).toEqual(testWire.MSG);
    expect(srcWire.EV).toEqual(testWire.EV);
  });

  it('fragmenter + reassembler round-trip like the original', () => {
    const big = new Uint8Array(3000).map((_, i) => i & 255);
    const parts = srcWire.createFragmenter().split(big);
    expect(parts.map(bytes)).toEqual(testWire.createFragmenter().split(big).map(bytes));
    const re = srcWire.createReassembler();
    let whole = null;
    for (const p of parts) whole = re.push(srcWire.decode(p), 0) ?? whole;
    expect(bytes(whole)).toEqual(bytes(big));
  });
});

describe('sim stand-in copy = the WS5 test stand-in', () => {
  it('makeCountdown gives the same goTick and float sequence', () => {
    const a = srcSim.makeCountdown(3);
    const b = testSim.makeCountdown(3);
    expect(a.goTick).toBe(b.goTick);
    for (let r = 0; r <= a.goTick + 2; r++) expect(a.after(r)).toBe(b.after(r));
  });

  it('predictTick moves local karts exactly like the original over 300 ticks', () => {
    const { def, path } = trackFixture('gumdrop-meadow');
    const mk = () => new Race({ scene: new THREE.Scene(), trackDef: def, path, participants: defaultRacerIds(2).map((c, i) => ({ characterId: c, playerIndex: i })), buildKartModel: stubKartModel(), laps: 1, seed: 4 });
    const ra = mk();
    const rb = mk();
    const cd = srcSim.makeCountdown(3);
    const ctx = (race, tick) => ({ path, boostPads: race.boostPads, gameplay: race.gameplay, tick, startTick: 1, goTick: cd.goTick, countdownAfter: cd.after, bumpTimes: new Map(), lapsTotal: 1, time: 0 });
    for (let tick = 1; tick <= 300; tick++) {
      const inputs = [{ steer: Math.sin(tick / 20), accel: 1 }, { steer: -0.2, accel: 1, drift: tick % 90 < 30 }];
      srcSim.predictTick(ra.karts, inputs, ctx(ra, tick));
      testSim.predictTick(rb.karts, inputs, ctx(rb, tick));
    }
    ra.karts.forEach((k, i) => {
      expect(k.position.toArray()).toEqual(rb.karts[i].position.toArray());
      expect(k.heading).toBe(rb.karts[i].heading);
    });
    expect(srcSim.captureKart(ra.karts[0])).toEqual(testSim.captureKart(rb.karts[0]));
    ra.dispose();
    rb.dispose();
  });
});

describe('clock sync copy = the WS5 test stand-in', () => {
  it('converges to the same offset from the same pongs', () => {
    let t = 0;
    const a = srcClock({ now: () => t });
    const b = testClock({ now: () => t });
    for (let i = 0; i < 20; i++) {
      const pa = a.makePing();
      const pb = b.makePing();
      t += 40 + (i % 3) * 5;
      const pong = (p) => ({ id: p.id, t0: p.t0, t1: p.t0 + 5000 + 20, t2: p.t0 + 5000 + 21 });
      a.onPong(pong(pa), t);
      b.onPong(pong(pb), t);
    }
    expect(a.ready).toBe(true);
    expect(a.offset).toBe(b.offset);
    expect(a.rttMs).toBe(b.rttMs);
    expect(Math.abs(a.hostNow(t) - t - 5000)).toBeLessThan(30);
  });
});

describe('netStack (the WS1 / WS2 swap point)', () => {
  it('exposes everything the WS5 netcode needs', () => {
    expect(typeof netStack.wire.encodeSnapshot).toBe('function');
    expect(typeof netStack.wire.decode).toBe('function');
    expect(typeof netStack.capture).toBe('function');
    expect(typeof netStack.predictTick).toBe('function');
    expect(typeof netStack.tickRace).toBe('function');
    expect(typeof netStack.createClockSync).toBe('function');
    expect(netStack.deriveRoomIds).toBe(deriveRoomIds);
    expect(netStack.makeCountdown(COUNTDOWN_SECONDS).goTick).toBe(testSim.makeCountdown(3).goTick);
    expect(Object.isFrozen(netStack)).toBe(true);
  });
});
