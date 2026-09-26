// Local-kart prediction and reconciliation (NETWORKING.md §9.6): joint replay with emit off, decaying
// visual offsets, the snap rules, and the Robo Driver hand-over in ReplicaRace.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createReconciler, applyKartRecord, SNAP_DIST, RECONCILE_TAU_MS } from '../src/net/guest/reconcile.js';
import { ReplicaRace } from '../src/net/guest/replicaRace.js';
import { Race } from '../src/race/Race.js';
import { encodeSnapshot, decode, quantizeInput } from './helpers/netWire.js';
import { captureSimState, captureKart, predictTick, makeCountdown, raceTick } from './helpers/netSim.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';

const { def, path } = trackFixture('gumdrop-meadow');
const cd = makeCountdown(3);

/** A host race with one human (kart 0) plus `cpus` CPUs, driven for `ticks` with a wavy scripted input. */
function hostRace({ cpus = 0, ticks = 400, seed = 2 } = {}) {
  const ids = defaultRacerIds(cpus + 1);
  const participants = [...ids.slice(1).map((c) => ({ characterId: c, playerIndex: null })), { characterId: ids[0], playerIndex: 0 }];
  const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants, buildKartModel: stubKartModel(), laps: 3, seed });
  const me = race.karts.find((k) => k.playerIndex === 0);
  const inputs = [];
  const states = [];
  for (let t = 1; t <= ticks; t++) {
    const inp = quantizeInput({ steer: Math.sin(t / 40) * 0.6, accel: 1, brake: 0, drift: t % 180 > 150 });
    const drive = { ...inp, useItem: false };
    inputs[t] = drive;
    const arr = [];
    arr[0] = drive;
    raceTick(race, arr);
    states[t] = captureSimState(race, t);
  }
  return { race, me, inputs, states, participants };
}

/** A decoded-snapshot-shaped record with EXACT floats (no quantisation) for one kart. */
const exactRec = (ks) => ({
  ...ks, position: ks.position.slice(), velocity: ks.velocity.slice(),
  phys: { ...ks.phys },
});
const exactOwner = (ks) => ({ kart: ks.id, aiSpeedMult: ks.aiSpeedMult, phys: { ...ks.phys } });

const ctxFor = (tick) => ({ path, boostPads: [], gameplay: {}, tick, startTick: 1, goTick: cd.goTick, countdownAfter: cd.after, lapsTotal: 3 });

describe('replay from the host state', () => {
  const H = hostRace({ ticks: 600 });
  const boostPads = H.race.boostPads;
  const ctx = (tick) => ({ ...ctxFor(tick), boostPads, gameplay: H.race.gameplay });

  it('from EXACT host state the joint replay is bit-identical to the host in a contact-free window', () => {
    const replica = new ReplicaRace({ trackDef: def, path, setup: { participants: H.participants, laps: 3, goTick: cd.goTick }, localKartIds: [H.me.id], predictTick, countdownAfter: cd.after });
    const k = replica.karts[H.me.id];
    const S = 300;
    const ks = H.states[S].karts[H.me.id];
    applyKartRecord(k, exactRec(ks), exactOwner(ks), path);
    k.s = ks.s; k.lateral = ks.lateral; k.lap = ks.lap;
    for (let t = S + 1; t <= S + 14; t++) predictTick([k], [H.inputs[t]], ctx(t));
    const host = H.states[S + 14].karts[H.me.id];
    expect(Math.hypot(k.position.x - host.position[0], k.position.z - host.position[2])).toBeLessThan(1e-9);
    expect(k.heading).toBeCloseTo(host.heading, 12);
  });

  it('from the QUANTISED snapshot the replay stays within a few cm (the §5 measurement)', () => {
    const errs = [];
    for (let S = 200; S <= 560; S += 12) {
      const snap = decode(encodeSnapshot(H.states[S], { houseTail: { owner: [H.me.id] } }));
      const replica = new ReplicaRace({ trackDef: def, path, setup: { participants: H.participants, laps: 3, goTick: cd.goTick }, localKartIds: [H.me.id], predictTick, countdownAfter: cd.after });
      const k = replica.karts[H.me.id];
      applyKartRecord(k, snap.karts[H.me.id], snap.owner[0], path);
      for (let t = S + 1; t <= S + 12; t++) predictTick([k], [H.inputs[t]], ctx(t));
      const host = H.states[S + 12].karts[H.me.id];
      errs.push(Math.hypot(k.position.x - host.position[0], k.position.z - host.position[2]));
    }
    errs.sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length / 2)]).toBeLessThan(0.03);
    expect(errs[errs.length - 1]).toBeLessThan(0.1);
  });
});

describe('reconciler', () => {
  const H = hostRace({ ticks: 360 });
  const mk = () => new ReplicaRace({ trackDef: def, path, setup: { participants: H.participants, laps: 3, goTick: cd.goTick }, localKartIds: [H.me.id], predictTick, countdownAfter: cd.after });
  const snapAt = (S, extra = {}) => ({ ...decode(encodeSnapshot(H.states[S], { houseTail: { owner: [H.me.id] } })), ...extra });

  it('turns a correction into a visual offset: the drawn pose does not move; it decays with τ = 100 ms', () => {
    const replica = mk();
    const k = replica.karts[H.me.id];
    const rec = createReconciler();
    const S = 300;
    const snap = snapAt(S);
    applyKartRecord(k, snap.karts[H.me.id], snap.owner[0], path);
    for (let t = S + 1; t <= S + 10; t++) predictTick([k], [H.inputs[t]], ctxFor(t));
    k.position.x += 1.2; // our prediction drifted 1.2 m
    const drawnBefore = rec.drawn(k);
    const res = rec.reconcile({ karts: [k], snap, inputsFor: (t) => [H.inputs[t]], toTick: S + 10, predictTick, ctxFor, path });
    expect(res.errors[0].snapped).toBe(false);
    expect(res.errors[0].err).toBeCloseTo(1.2, 1);
    const drawnAfter = rec.drawn(k);
    expect(drawnAfter.x).toBeCloseTo(drawnBefore.x, 9);
    expect(drawnAfter.z).toBeCloseTo(drawnBefore.z, 9);
    rec.decay(RECONCILE_TAU_MS);
    expect(rec.offset(k.id).x).toBeCloseTo(1.2 * Math.exp(-1), 1);
    rec.decay(1000);
    expect(Math.abs(rec.offset(k.id).x)).toBeLessThan(1e-4);
    expect(rec.stats.replayedTicks).toBe(10);
    expect(rec.percentile(0.5)).toBeCloseTo(1.2, 1);
    expect(rec.errors()).toHaveLength(1);
  });

  it(`snaps (no smoothing) beyond ${SNAP_DIST} m, beyond 0.6 rad of heading, on a teleport, or when forced`, () => {
    const cases = [
      ['far', (k) => { k.position.x += 5; }, {}, false],
      ['heading', (k) => { k.heading += 0.8; }, {}, false],
      ['teleport', (k) => { k.position.x += 0.5; }, { flags: { teleport: true } }, false],
      ['forced', (k) => { k.position.x += 0.5; }, {}, true],
    ];
    for (const [name, disturb, extra, force] of cases) {
      const replica = mk();
      const k = replica.karts[H.me.id];
      const rec = createReconciler();
      const S = 240;
      const snap = snapAt(S, extra);
      applyKartRecord(k, snap.karts[H.me.id], snap.owner[0], path);
      for (let t = S + 1; t <= S + 8; t++) predictTick([k], [H.inputs[t]], ctxFor(t));
      disturb(k);
      const res = rec.reconcile({ karts: [k], snap: { ...snap, flags: { ...snap.flags, ...(extra.flags || {}) } }, inputsFor: (t) => [H.inputs[t]], toTick: S + 8, predictTick, ctxFor, forceSnap: force, path });
      expect(res.errors[0].snapped, name).toBe(true);
      expect(rec.offset(k.id), name).toEqual({ x: 0, y: 0, z: 0, h: 0 });
    }
  });

  it('replayed ticks never emit events (a predicted hop fires once, when first predicted)', () => {
    const rec = createReconciler();
    const replica = mk();
    const k = replica.karts[H.me.id];
    const outer = vi.fn();
    const spy = vi.fn((karts, inputs, ctx) => ctx.emit({ type: 'hop', kart: karts[0] }));
    const snap = snapAt(200);
    rec.reconcile({ karts: [k], snap, inputsFor: (t) => [H.inputs[t]], toTick: 206, predictTick: spy, ctxFor: (t) => ({ ...ctxFor(t), emit: outer }) });
    expect(spy).toHaveBeenCalledTimes(6);
    expect(outer).not.toHaveBeenCalled();
    // missing inputs are skipped, nothing to reconcile is a no-op
    rec.reconcile({ karts: [k], snap, inputsFor: () => null, toTick: 206, predictTick: spy, ctxFor });
    expect(spy).toHaveBeenCalledTimes(6);
    expect(rec.reconcile({ karts: [], snap, inputsFor: () => null, toTick: 0, predictTick: spy, ctxFor })).toEqual({ errors: [] });
    rec.clear(k.id);
    expect(rec.offset(k.id)).toEqual({ x: 0, y: 0, z: 0, h: 0 });
  });

  it('applyKartRecord without owner phys keeps the discrete own-only fields and derives groundY', () => {
    const replica = mk();
    const k = replica.karts[H.me.id];
    k.phys.driftWindow = 0.2;
    const snap = snapAt(300);
    const r = snap.karts[H.me.id];
    applyKartRecord(k, r, null);
    expect(k.phys.driftWindow).toBe(0.2);
    expect(k.phys.groundY).toBeCloseTo(r.position[1] - r.phys.hopY, 9);
    expect(k.position.x).toBe(r.position[0]);
  });
});

describe('ReplicaRace Robo Driver hand-over', () => {
  it('a roboDriven own kart is drawn like a remote one; when it clears, prediction re-seeds from that snapshot, the history before it is cleared and the kart snaps', () => {
    const H = hostRace({ ticks: 420 });
    const events = [];
    const replica = new ReplicaRace({
      trackDef: def, path, setup: { participants: H.participants, laps: 3, goTick: cd.goTick, startTick: 1 }, localKartIds: [H.me.id],
      predictTick, countdownAfter: cd.after, quantize: quantizeInput, onEvent: (e) => events.push(e),
    });
    const sample = (tick) => [{ ...H.inputs[tick], itemCount: 0, hopCount: 0 }];
    const snapWith = (S, robo) => {
      const st = structuredClone(H.states[S]);
      st.karts[H.me.id].roboDriven = robo;
      return decode(encodeSnapshot(st, { houseTail: { owner: [H.me.id], lastInputTick: S, inputSlack: 2 } }));
    };
    replica.frame(1 / 60, sample, { P: 300, R: 280 });
    expect(replica.predictedTick).toBe(300);
    replica.onSnapshot(snapWith(290, false), 0);
    expect(replica.isPredicted(H.me.id)).toBe(true);
    replica.onSnapshot(snapWith(294, true), 10);
    expect(replica.isPredicted(H.me.id)).toBe(false);
    expect(replica.stats.roboOn).toBe(1);
    replica.frame(1 / 60, sample, { P: 310, R: 292 });
    replica.present(1, 1 / 60);
    const cleared = replica.history.get(295);
    expect(cleared).not.toBeNull();
    const corrections = [];
    replica.onCorrection = (s, errs) => corrections.push(...errs);
    replica.onSnapshot(snapWith(302, false), 20);
    expect(replica.isPredicted(H.me.id)).toBe(true);
    expect(replica.stats.reseeds).toBe(1);
    expect(replica.history.get(300)).toBeNull(); // entries before the snapshot tick are gone
    expect(replica.history.get(305)).not.toBeNull();
    expect(corrections).toHaveLength(1);
    expect(corrections[0].snapped).toBe(true);
    // stale snapshots are ignored for reconciliation (but kept for interpolation)
    expect(replica.onSnapshot(snapWith(298, false), 30)).toBe(true);
    expect(corrections).toHaveLength(1);
    expect(replica.onSnapshot(snapWith(298, false), 31)).toBe(false); // duplicate
  });
});
