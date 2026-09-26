// ReplicaRace (NETWORKING.md §9.1, §9.5–9.7): the Race read API on a guest — grid, countdown and GO on P,
// host places, host events mapped to kart objects, remote karts / items / boxes on R, models, resync.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ReplicaRace, MAX_PREDICT_TICKS, MAX_FILL_TICKS } from '../src/net/guest/replicaRace.js';
import { createReplicaItems } from '../src/net/guest/replicaItems.js';
import { createSnapshotBuffer } from '../src/net/guest/interpolation.js';
import { Race } from '../src/race/Race.js';
import { encodeSnapshot, decode, encodeEvents, quantizeInput } from './helpers/netWire.js';
import { captureSimState, predictTick, makeCountdown, raceTick } from './helpers/netSim.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';

const { def, path } = trackFixture('gumdrop-meadow');
const cd = makeCountdown(3);
const ids = defaultRacerIds(4);
const participants = [
  { characterId: ids[0], playerIndex: null }, { characterId: ids[1], playerIndex: null },
  { characterId: ids[2], playerIndex: 0 }, { characterId: ids[3], playerIndex: 1 },
];
const setup = { participants, laps: 2, startTick: 1, goTick: cd.goTick };
const make = (o = {}) => new ReplicaRace({
  scene: new THREE.Scene(), trackDef: def, path, setup, localKartIds: [3], predictTick, countdownAfter: cd.after,
  quantize: quantizeInput, buildKartModel: stubKartModel(), ...o,
});
const idle = () => [{ steer: 0, accel: 0, brake: 0, drift: false, itemCount: 0, hopCount: 0 }];

describe('ReplicaRace: grid and read API', () => {
  it('builds the same grid as the host Race (kart id = participant index)', () => {
    const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants, laps: 2, seed: 1, buildKartModel: stubKartModel() });
    const r = make();
    expect(r.karts).toHaveLength(4);
    for (const k of r.karts) {
      const h = race.karts[k.id];
      expect(k.position.x).toBeCloseTo(h.position.x, 9);
      expect(k.position.z).toBeCloseTo(h.position.z, 9);
      expect(k.heading).toBeCloseTo(h.heading, 9);
      expect(k.isCPU).toBe(h.isCPU);
    }
    expect(r.lapsTotal).toBe(2);
    expect(r.getPlayerKart(1).id).toBe(3);
    expect(r.getPlayerKart(7)).toBeNull();
    expect(r.rng).toBeNull();
    expect(r.lastDt).toBeCloseTo(1 / 60);
    expect(r.racingLine.length).toBeGreaterThan(10);
    expect(r.items.bursts.emit).toBeTypeOf('function');
    expect(r.isPredicted(3)).toBe(true);
    expect(r.isPredicted(2)).toBe(false);
    race.dispose();
  });

  it('respects gridSlot when the setup has one', () => {
    const r = make({ setup: { ...setup, participants: participants.map((p, i) => ({ ...p, gridSlot: 3 - i })) } });
    const base = make();
    expect(r.karts[0].position.distanceTo(base.karts[3].position)).toBeGreaterThan(0); // slot 3 is at the back
    expect(r.karts[0].gridSlot).toBe(3);
  });
});

describe('ReplicaRace: countdown and GO on the prediction timeline', () => {
  it('emits 3-2-1 and GO from P (predicted), with countdown / state / time following P', () => {
    const events = [];
    const r = make({ onEvent: (e) => events.push({ e, P: r.predictedTick }) });
    expect(r.state).toBe('countdown');
    r.frame(1 / 60, idle, { P: 1, R: -5 });
    expect(r.countdown).toBeCloseTo(cd.after(1), 12);
    for (let P = 2; P <= cd.goTick + 30; P++) r.frame(1 / 60, idle, { P, R: P - 12 });
    const cds = events.filter((x) => x.e.type === 'countdown');
    expect(cds.map((x) => x.e.n)).toEqual([3, 2, 1]);
    expect(cds.every((x) => x.e.predicted)).toBe(true);
    const go = events.filter((x) => x.e.type === 'go');
    expect(go).toHaveLength(1);
    expect(go[0].P).toBe(cd.goTick);
    expect(r.state).toBe('racing');
    expect(r.countdown).toBe(0);
    expect(r.time).toBeCloseTo(30 / 60, 9);
    expect(r.stats.predicted).toBeGreaterThan(200);
  });

  it('jumps (without predicting the gap) when P is far ahead, and rewind() moves P back', () => {
    const r = make();
    r.setStart({ startTick: 1, goTick: cd.goTick });
    const ticks = r.frame(1 / 60, idle, { P: 500, R: 480 });
    // the newest MAX_PREDICT_TICKS are predicted, the MAX_FILL_TICKS before them only get a recorded input
    // (so the host never repeats a stale one), everything older is jumped over
    expect(ticks).toHaveLength(MAX_PREDICT_TICKS + MAX_FILL_TICKS);
    expect(ticks[0]).toBe(500 - MAX_PREDICT_TICKS - MAX_FILL_TICKS + 1);
    expect(r.stats.predicted).toBe(MAX_PREDICT_TICKS);
    expect(r.stats.filled).toBe(MAX_FILL_TICKS);
    expect(r.history.get(ticks[0])).toBeTruthy();
    expect(r.predictedTick).toBe(500);
    r.rewind(450);
    expect(r.predictedTick).toBe(450);
    r.rewind(460); // forward: no-op
    expect(r.predictedTick).toBe(450);
    expect(r.stats.rewinds).toBe(1);
  });
});

describe('ReplicaRace: snapshots, events, remote karts and items', () => {
  function hostRun(ticks = 360) {
    const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants, laps: 2, seed: 4, buildKartModel: stubKartModel() });
    const states = [];
    const log = [];
    race.onEvent = (e) => log.push(e);
    for (let t = 1; t <= ticks; t++) {
      raceTick(race, [{ steer: 0, accel: 1, brake: 0 }, { steer: 0.1, accel: 1, brake: 0 }]);
      states[t] = captureSimState(race, t);
    }
    return { race, states, log };
  }
  const H = hostRun();
  const snap = (t, owner = [3]) => decode(encodeSnapshot(H.states[t], { houseTail: { owner, lastInputTick: t, inputSlack: 2 } }));

  it('places come from the newest snapshot; older snapshots only feed interpolation', () => {
    const r = make();
    r.onSnapshot(snap(300), 0);
    const places = H.states[300].karts.map((k) => k.place);
    expect(r.getStandings().map((k) => k.place)).toEqual([...places].sort((a, b) => a - b));
    r.onSnapshot(snap(296), 1);
    expect(r.getStandings().map((k) => k.id)).toEqual([...H.states[300].karts].sort((a, b) => a.place - b.place).map((k) => k.id));
    expect(r.buffer.size).toBe(2);
  });

  it('draws remote karts between snapshots at R and fills their discrete fields from the older one', () => {
    const r = make();
    for (const t of [290, 292, 294, 296]) r.onSnapshot(snap(t), t * 16.67);
    r.frame(1 / 60, idle, { P: 300, R: 293 });
    r.present(1, 1 / 60);
    const k = r.karts[0];
    const a = H.states[292].karts[0].position;
    const b = H.states[294].karts[0].position;
    expect(k.render.position.x).toBeGreaterThan(Math.min(a[0], b[0]) - 0.05);
    expect(k.render.position.x).toBeLessThan(Math.max(a[0], b[0]) + 0.05);
    expect(k.position.x).toBeCloseTo(k.render.position.x, 9);
    expect(k.model.group.position.x).toBeCloseTo(k.render.position.x, 9);
    expect(k.model.updates).toBeGreaterThan(0);
  });

  it('maps host events to kart objects, drops the host copies of my predicted ones and records laps/finishes', () => {
    const got = [];
    const r = make({ onEvent: (e) => { if (!e.predicted) got.push(e); } }); // (countdown numbers come from P)
    const events = [
      { seq: 1, tick: 100, type: 'bump', kart: 0, other: 255, strength: 0.5 },
      { seq: 2, tick: 100, type: 'bump', kart: 0, other: 1, strength: 0.5 },
      { seq: 3, tick: 101, type: 'hop', kart: 3 }, // mine: predicted locally → dropped
      { seq: 4, tick: 102, type: 'bonked', kart: 3, cause: 'gumdrop', by: 1 }, // mine, host-only → at once
      { seq: 5, tick: 103, type: 'rocket-launch', kart: 1, rocketId: 9, target: 3 },
      { seq: 6, tick: 104, type: 'lap', kart: 2, lap: 2, lapTimeMs: 31000 },
      { seq: 7, tick: 105, type: 'finish', kart: 2, place: 1, finishTimeMs: 62000, estimated: false },
      { seq: 8, tick: 106, type: 'robo', kart: 2, on: true },
      { seq: 9, tick: 107, type: 'race-complete', kart: 255 },
    ];
    r.onEvents(decode(encodeEvents(events)));
    r.frame(1 / 60, idle, { P: 110, R: 50 });
    expect(got.map((e) => e.type)).toEqual(['bonked']); // own events at once, world ones wait for R
    r.frame(1 / 60, idle, { P: 112, R: 110 });
    expect(got.map((e) => e.type)).toEqual(['bonked', 'bump', 'bump', 'rocket-launch', 'lap', 'finish', 'robo', 'race-complete']);
    expect(got[1].wall).toBe(true);
    expect(got[1].kart).toBe(r.karts[0]);
    expect(got[2].other).toBe(r.karts[1]);
    expect(got[0].by).toBe(r.karts[1]);
    expect(got[3].target).toBe(r.karts[3]);
    expect(got.some((e) => 'seq' in e || 'tick' in e)).toBe(false);
    expect(r.lapTimesMs[2]).toEqual([31000]);
    expect(r.finishes.get(2)).toEqual({ place: 1, finishTimeMs: 62000, estimated: false });
    expect(r.karts[2].finishPlace).toBe(1);
    expect(r.karts[2].roboDriven).toBe(true);
    expect(r.completeTick).toBe(107);
    expect(r.acceptedSeqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.appliedSeqs).toEqual([4, 1, 2, 5, 6, 7, 8, 9]);
    const gaps = vi.fn();
    r.onGap = gaps;
    r.onEvents({ events: [{ seq: 12, tick: 120, type: 'go', kart: 255 }] });
    expect(gaps).toHaveBeenCalledWith(10, 12);
  });

  it('a finished host snapshot switches the state to finished and an own finished kart keeps rolling on the autopilot', () => {
    const r = make();
    const st = structuredClone(H.states[300]);
    st.state = 'finished';
    for (const k of st.karts) { k.finished = true; k.finishPlace = k.place; }
    r.frame(1 / 60, idle, { P: 305, R: 290 });
    r.onSnapshot(decode(encodeSnapshot(st, { houseTail: { owner: [3] } })), 0);
    expect(r.state).toBe('finished');
    expect(r.hostFinished).toBe(true);
    expect(r.isAutopiloted(3)).toBe(true);
    expect(r.isPredicted(3)).toBe(true);
    const before = r.karts[3].position.clone();
    for (let P = 306; P <= 340; P++) r.frame(1 / 60, idle, { P, R: P - 10 });
    expect(r.karts[3].position.distanceTo(before)).toBeGreaterThan(1); // it keeps driving
    r.onResync({ lastEventSeq: 40, karts: [{ id: 2, lapTimes: [30.5, 31.25] }] });
    expect(r.events.lastSeq).toBe(40);
    expect(r.lapTimesMs[2]).toEqual([30500, 31250]);
  });

  it('dispose removes the kart models from the scene', () => {
    const scene = new THREE.Scene();
    const r = make({ scene });
    expect(scene.children.length).toBe(4);
    r.dispose();
    expect(scene.children.length).toBe(0);
  });
});

describe('replica items and boxes', () => {
  const snapOf = (tick, gumdrops, rockets = [], boxes = [true, true]) => ({ tick, flags: {}, karts: [], gumdrops, rockets, boxes });

  it('spawns entities when they appear at R, moves them linearly, removes them when R passes, and uses event colours/reasons', () => {
    const calls = [];
    const view = new Proxy({}, { get: (_, name) => (name === 'then' ? undefined : (...a) => calls.push([name, ...a])) });
    const boxView = { setActive: vi.fn(), dispose: vi.fn() };
    const items = createReplicaItems({ itemView: view, boxView });
    const buf = createSnapshotBuffer();
    buf.insert(snapOf(10, [{ id: 5, x: 0, y: 0, z: 0 }], [{ id: 9, x: 0, y: 1, z: 0, heading: 0, target: 2 }], [true, false]));
    buf.insert(snapOf(12, [{ id: 5, x: 2, y: 0, z: 0 }], [], [false, false]));
    items.onEvent({ type: 'gumdrop-spawn', id: 5, color: 3 });
    items.onEvent({ type: 'rocket-despawn', id: 9, why: 'hit' });
    items.update(buf, 11);
    expect(calls.find((c) => c[0] === 'spawnGumdrop')[1]).toMatchObject({ id: 5, color: 3 });
    expect(calls.find((c) => c[0] === 'moveGumdrop')).toEqual(['moveGumdrop', 5, 1, 0, 0]);
    expect(calls.find((c) => c[0] === 'spawnRocket')[1]).toMatchObject({ id: 9, target: 2 });
    expect(boxView.setActive).toHaveBeenCalledWith(1, false);
    expect(items.gumdrops[0]).toMatchObject({ id: 5, color: 3 });
    items.update(buf, 12);
    expect(calls.find((c) => c[0] === 'removeRocket')).toEqual(['removeRocket', 9, 'hit']);
    expect(items.rockets).toEqual([]);
    expect(items.boxes).toEqual([false, false]);
    items.dispose();
    expect(calls.find((c) => c[0] === 'removeGumdrop')).toEqual(['removeGumdrop', 5, 'dispose']);
    expect(boxView.dispose).toHaveBeenCalled();
    expect(items.stats).toMatchObject({ gumdropsSpawned: 1, rocketsSpawned: 1 });
  });

  it('works headless without views and ignores R before any snapshot', () => {
    const items = createReplicaItems();
    const buf = createSnapshotBuffer();
    items.update(buf, 5);
    buf.insert(snapOf(10, [{ id: 1, x: 0, y: 0, z: 0 }]));
    items.update(buf, 11);
    expect(items.gumdrops).toHaveLength(1);
    for (let i = 0; i < 300; i++) items.onEvent({ type: 'gumdrop-despawn', id: i, why: 'popped' });
    items.dispose();
  });
});
