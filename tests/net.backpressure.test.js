// Snapshot backpressure (net review #11): a host on 15 Hz backpressure was read by the guest as ~50 % loss
// (interval = the smallest recent gap), which pinned interpolation at 150 ms and the input lead in lossy mode
// even on a clean link; and during an outage the host kept filling the SCTP buffer of a house it had put on
// Robo Driver, so the rate stayed at 15 Hz for seconds after the network came back.
import { describe, it, expect } from 'vitest';
import { createArrivalStats, modalGap } from '../src/net/guest/interpolation.js';
import * as THREE from 'three';
import { SILENT_HOUSE_TICKS, SILENT_SNAPSHOT_EVERY, createHostDriver } from '../src/net/host/hostDriver.js';
import { createHostClock } from '../src/net/host/hostClock.js';
import { Race } from '../src/race/Race.js';
import { wire, decode, MSG, encodeInput } from './helpers/netWire.js';
import { captureSimState } from './helpers/netSim.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';

describe('arrival stats read the host\'s real snapshot interval', () => {
  it('modalGap: the most common gap, ties to the smaller', () => {
    expect(modalGap([])).toBe(2);
    expect(modalGap([2, 2, 4, 2])).toBe(2);
    expect(modalGap([4, 4, 2, 4, 4])).toBe(4);
    expect(modalGap([2, 4])).toBe(2);
  });

  it('a clean 15 Hz host is not "50 % loss"; 5 % loss at 30 Hz still reads as loss', () => {
    const half = createArrivalStats();
    for (let i = 0; i < 80; i++) half.onSnapshot(1000 + i * 4, (1000 + i * 4) * (1000 / 60));
    half.onSnapshot(1000 + 79 * 4 + 2, 0); // an odd 2-tick gap at a rate change
    expect(half.lossPct).toBeLessThan(3);
    expect(half.intervalMs).toBeCloseTo(4 * (1000 / 60), 6);
    expect(half.lastBurst).toBe(0);

    const lossy = createArrivalStats();
    let tick = 2000;
    for (let i = 0; i < 90; i++) {
      tick += i % 20 === 7 ? 4 : 2; // one lost snapshot in 20
      lossy.onSnapshot(tick, tick * (1000 / 60));
    }
    expect(lossy.intervalMs).toBeCloseTo(2 * (1000 / 60), 6);
    expect(lossy.lossPct).toBeGreaterThan(2);
    expect(lossy.lossPct).toBeLessThan(10);
  });
});

describe('a silent house whose link backs up gets one snapshot a second, full rate again when it speaks', () => {
  it('silent + a filling state buffer → ~1 Hz; silent with an empty buffer (upload-only outage) → full rate', () => {
    expect(SILENT_HOUSE_TICKS).toBeGreaterThanOrEqual(60);
    expect(SILENT_SNAPSHOT_EVERY).toBe(30);
    const { def, path } = trackFixture('gumdrop-meadow');
    const ids = defaultRacerIds(2);
    const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants: [{ characterId: ids[0], playerIndex: null }, { characterId: ids[1], playerIndex: 0 }], laps: 2, seed: 3, buildKartModel: stubKartModel() });
    let now = 1000;
    let buffered = 0;
    const snaps = [];
    const transport = {
      send: (peer, ch, bytes) => { if (decode(bytes)?.type === MSG.SNAPSHOT) snaps.push(now); return true; },
      broadcast: () => {}, stats: () => ({ bufferedState: buffered }), peers: () => ['g'],
    };
    const driver = createHostDriver({
      race, transport, clock: createHostClock({ now: () => now }), wire, capture: captureSimState, now: () => now,
      houses: new Map([[0, { peerId: 'g', karts: [1] }]]), localInputs: () => [],
    });
    driver.start({ nowMs: now, goTick: 181 });
    const send = (tick) => driver.onMessage('g', 'state', encodeInput({ seq: tick, newestTick: tick, lastSnapTick: 0, ticks: [{ tick, players: [{ steer: 0, accel: 1, brake: 0, drift: false, itemCount: 0, hopCount: 0 }] }] }));
    const run = (ms, speak) => { const end = now + ms; while (now < end) { now += 1000 / 60; if (speak) send(driver.tick + 3); driver.frame(now); } };
    const count = (from) => snaps.filter((t) => t > from).length;
    run(2000, true);
    let t0 = now;
    run(3000, false); // upload-only outage: silent, but snapshots still leave (buffer empty) → full rate
    expect(count(t0)).toBeGreaterThanOrEqual(85);
    buffered = 4000; // now the downlink backs up too
    t0 = now;
    run(3000, false);
    expect(count(t0)).toBeLessThanOrEqual(4);
    expect(driver.stats().silentSkips).toBeGreaterThan(50);
    buffered = 0;
    t0 = now;
    run(1000, true); // it speaks again: full rate at once
    expect(count(t0)).toBeGreaterThanOrEqual(28);
    driver.dispose();
    race.dispose();
  });
});
