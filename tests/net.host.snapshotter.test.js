// Host snapshotter (NETWORKING.md §6.1, §9.4): one capture per snapshot tick, shared body + per-house
// tail, 30 → 15 Hz under sustained backpressure and back. Also keeps the WS2 stand-in codec honest
// against the §6.1 sizes (acceptance M1-4) with a real Race.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSnapshotter, createRateControl, SNAPSHOT_EVERY } from '../src/net/host/snapshotter.js';
import { encodeSnapshot, decode, encodeInput, quantizeInput, MSG } from './helpers/netWire.js';
import { captureSimState, raceTick } from './helpers/netSim.js';
import { makeSimStateFixture } from '../src/race/simState.types.js';
import { Race, aiDriveInput } from '../src/race/Race.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';

describe('rate control', () => {
  it('halves to 15 Hz after > 10 skipped intervals in the last 30 and restores after 60 clean ones', () => {
    const r = createRateControl();
    for (let i = 0; i < 10; i++) { expect(r.shouldSend()).toBe(true); r.record(false); }
    expect(r.halved).toBe(false);
    r.shouldSend();
    r.record(false);
    expect(r.halved).toBe(true);
    expect(r.hz).toBe(15);
    let sent = 0;
    for (let i = 0; i < 400 && r.halved; i++) { if (r.shouldSend()) { sent++; r.record(true); } }
    expect(r.halved).toBe(false);
    expect(sent).toBe(60);
    expect(r.stats).toMatchObject({ halvings: 1, restores: 1 });
    expect(r.stats.idle).toBeGreaterThanOrEqual(59);
  });

  it('occasional skips (<= 10 of 30) keep 30 Hz', () => {
    const r = createRateControl();
    for (let i = 0; i < 300; i++) { r.shouldSend(); r.record(i % 3 !== 0 || i % 9 !== 0); }
    expect(r.halved).toBe(false);
  });
});

describe('snapshotter', () => {
  const fakeWire = () => {
    const calls = [];
    return { calls, encodeSnapshot: (s, o) => { calls.push([s, o]); return new Uint8Array(100 + o.houseTail.owner.length); } };
  };

  it('captures once per snapshot tick and encodes a tail per house', () => {
    const wire = fakeWire();
    let captures = 0;
    const snap = createSnapshotter({ wire, capture: () => { captures++; return { tick: 0 }; } });
    expect(snap.snapshotEvery).toBe(SNAPSHOT_EVERY);
    expect([1, 2, 3, 4].map((t) => snap.due(t))).toEqual([false, true, false, true]);
    const s = snap.capture({}, 42);
    expect(s.tick).toBe(42);
    const a = snap.encodeFor(s, 'A', { epoch: 3, lastInputTick: 40, inputSlack: 2, owner: [1] });
    const b = snap.encodeFor(s, 'B', { epoch: 3, lastInputTick: 39, inputSlack: -128, owner: [2, 3] });
    expect(a.length).toBe(101);
    expect(b.length).toBe(102);
    expect(captures).toBe(1);
    expect(wire.calls[0][0]).toBe(wire.calls[1][0]); // the same captured state for every house
    expect(wire.calls[1][1]).toEqual({ epoch: 3, flags: {}, houseTail: { lastInputTick: 39, inputSlack: -128, owner: [2, 3] } });
    expect(snap.stats).toMatchObject({ captures: 1, encodes: 2, maxBytes: 102 });
    expect(snap.lastState).toBe(s);
  });

  it('a house on 15 Hz gets null every 2nd interval; forget() resets it', () => {
    const snap = createSnapshotter({ wire: fakeWire(), capture: () => ({}) });
    const s = snap.capture({}, 2);
    for (let i = 0; i < 11; i++) { snap.encodeFor(s, 'A', { epoch: 0, owner: [] }); snap.sent('A', false); }
    expect(snap.rate('A').halved).toBe(true);
    const got = [];
    for (let i = 0; i < 4; i++) got.push(snap.encodeFor(s, 'A', { epoch: 0, owner: [] }) !== null);
    expect(got.filter(Boolean)).toHaveLength(2);
    expect(got[0]).not.toBe(got[1]);
    expect(got[1]).not.toBe(got[2]);
    snap.forget('A');
    expect(snap.rate('A').halved).toBe(false);
  });
});

describe('snapshot codec stand-in vs §6.1 sizes (M1-4)', () => {
  it('fixture: typical 8 karts / 32 boxes / 1 own kart = 370 B; 8 gumdrops + 2 rockets <= 460 B; cap-case <= 1150 B', () => {
    const typical = encodeSnapshot(makeSimStateFixture(), { houseTail: { owner: [0] } });
    expect(typical.length).toBe(370);
    const items = encodeSnapshot(makeSimStateFixture({ gumdrops: 8, rockets: 2 }), { houseTail: { owner: [0] } });
    expect(items.length).toBeLessThanOrEqual(460);
    const cap = encodeSnapshot(makeSimStateFixture({ gumdrops: 24, rockets: 8, battle: true }), { houseTail: { owner: [0, 1, 2, 3] } });
    expect(cap.length).toBeLessThanOrEqual(1150);
    expect(cap.length).toBeGreaterThan(700);
  });

  it('decodes a fixture within the quantisation steps (owner tail included) and patches per-house header fields', () => {
    const s = makeSimStateFixture({ gumdrops: 3, rockets: 1 });
    const bytes = encodeSnapshot(s, { epoch: 7, flags: { teleport: true }, houseTail: { lastInputTick: 1198, inputSlack: 3, owner: [1] } });
    const m = decode(bytes);
    expect(m).toMatchObject({ type: MSG.SNAPSHOT, tick: 1200, epoch: 7, lastInputTick: 1198, inputSlack: 3 });
    expect(m.flags).toEqual({ racing: true, finished: false, battle: false, paused: false, teleport: true });
    for (const k of s.karts) {
      const d = m.karts[k.id];
      expect(Math.abs(d.position[0] - k.position[0])).toBeLessThanOrEqual(1 / 64 + 1e-9);
      expect(Math.abs(d.position[1] - k.position[1])).toBeLessThanOrEqual(1 / 128 + 1e-9);
      expect(Math.abs(d.velocity[2] - k.velocity[2])).toBeLessThanOrEqual(1 / 512 + 1e-9);
      expect(Math.abs(d.distance - k.distance)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(Math.atan2(Math.sin(d.heading - k.heading), Math.cos(d.heading - k.heading)))).toBeLessThan(1e-4);
      expect(d.phys.shieldTime).toBeCloseTo(k.phys.shieldTime, 3); // 17.5 s fits (u16 ms)
      expect([d.item, d.itemCharges, d.driftLevel, d.lap, d.place, d.drifting, d.driftDir])
        .toEqual([k.item, k.itemCharges, k.driftLevel, k.lap, k.place, k.drifting, k.driftDir]);
    }
    expect(m.gumdrops.map((g) => g.id)).toEqual(s.gumdrops.map((g) => g.id));
    expect(m.rockets[0].id).toBe(s.rockets[0].id);
    expect(m.owner).toHaveLength(1);
    const o = m.owner[0];
    expect(o.kart).toBe(1);
    expect(o.phys.driftHeld).toBe(s.karts[1].phys.driftHeld);
    expect(o.phys.groundY).toBeCloseTo(s.karts[1].phys.groundY, 1);
    expect(o.phys.lastLapStart).toBeCloseTo(s.karts[1].phys.lastLapStart, 2);
    // the second house reuses the cached body but gets its own tail
    const other = decode(encodeSnapshot(s, { epoch: 7, flags: { teleport: true }, houseTail: { lastInputTick: 5, inputSlack: -128, owner: [2, 3] } }));
    expect(other.owner.map((x) => x.kart)).toEqual([2, 3]);
    expect(other.inputSlack).toBe(-128);
  });

  it('INPUT: 13 + 4·n·p bytes (37 B for n = 6, p = 1; 141 B for n = 8, p = 4) and quantised values survive', () => {
    const tickOf = (t, p) => ({ tick: t, players: Array.from({ length: p }, () => ({ steer: 0.333, accel: 1, brake: 0.2, drift: true, itemCount: 9, hopCount: 3 })) });
    const one = encodeInput({ seq: 1, newestTick: 100, lastSnapTick: 96, ticks: [6, 5, 4, 3, 2, 1].map((k) => tickOf(100 - 6 + k, 1)).reverse() });
    expect(one.length).toBe(37);
    const four = encodeInput({ seq: 2, newestTick: 100, lastSnapTick: 96, ticks: Array.from({ length: 8 }, (_, i) => tickOf(100 - i, 4)) });
    expect(four.length).toBe(141);
    const m = decode(four);
    expect(m.ticks.map((t) => t.tick)).toEqual([100, 99, 98, 97, 96, 95, 94, 93]);
    expect(m.ticks[0].players[3]).toEqual(quantizeInput({ steer: 0.333, accel: 1, brake: 0.2, drift: true, itemCount: 9, hopCount: 3 }));
    expect(decode(new Uint8Array([MSG.INPUT, 1]))).toBeNull();
    expect(decode(new Uint8Array([0x7e]))).toBeNull();
  });

  it('a real 8-kart race snapshots at <= 460 B typical and every decode matches the host within quantisation', () => {
    const { def, path } = trackFixture('gumdrop-meadow');
    const participants = defaultRacerIds(8).map((characterId, i) => ({ characterId, playerIndex: i === 0 ? 0 : null }));
    const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants, buildKartModel: stubKartModel(), laps: 1, seed: 11 });
    let tick = 0;
    let maxBytes = 0;
    let sum = 0;
    let n = 0;
    while (race.state !== 'finished' && tick < 60 * 60) {
      tick++;
      const inputs = [];
      inputs[0] = aiDriveInput(race, race.karts[0], 1 / 60);
      raceTick(race, inputs);
      if (tick % 2) continue;
      const s = captureSimState(race, tick);
      const bytes = encodeSnapshot(s, { houseTail: { owner: [0] } });
      maxBytes = Math.max(maxBytes, bytes.length);
      sum += bytes.length;
      n++;
      if (tick % 60 === 0) {
        const m = decode(bytes);
        for (const k of race.karts) {
          const d = m.karts[k.id];
          expect(Math.hypot(d.position[0] - k.position.x, d.position[2] - k.position.z)).toBeLessThan(0.03);
          expect(d.place).toBe(Math.min(15, k.place));
        }
        expect(m.gumdrops.length).toBe(race.items.gumdrops.length);
      }
    }
    expect(sum / n).toBeLessThanOrEqual(460);
    expect(maxBytes).toBeLessThanOrEqual(1150);
    race.dispose();
  });
});
