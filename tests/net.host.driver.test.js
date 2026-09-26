// Host driver and guest driver (NETWORKING.md §9.3–9.4, §9.7, §9.9, §4.1 FRAG pacing) with a fake transport.
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createHostDriver } from '../src/net/host/hostDriver.js';
import { createHostClock } from '../src/net/host/hostClock.js';
import { createGuestDriver } from '../src/net/guest/guestDriver.js';
import { createHostTimeline } from '../src/net/guest/hostTimeline.js';
import { ReplicaRace } from '../src/net/guest/replicaRace.js';
import { Race } from '../src/race/Race.js';
import { wire, decode, MSG, encodeInput, encodeCtrl, createFragmenter } from './helpers/netWire.js';
import { captureSimState, predictTick, makeCountdown } from './helpers/netSim.js';
import { createClockSync } from './helpers/netClock.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';

const TICK = 1000 / 60;
const { def, path } = trackFixture('gumdrop-meadow');
const cd = makeCountdown(3);

function fakeTransport() {
  const sent = [];
  let buffered = 0;
  return {
    sent, selfId: 'host', role: 'host',
    peers: () => ['g'],
    send: (peer, ch, bytes) => { sent.push({ peer, ch, bytes, m: decode(bytes) }); return true; },
    broadcast: (ch, bytes) => { sent.push({ peer: '*', ch, bytes, m: decode(bytes) }); },
    stats: () => ({ bufferedState: buffered }),
    setBuffered(n) { buffered = n; },
    of: (type) => sent.filter((x) => x.m?.type === type),
  };
}

function setup({ nativeRobo = false } = {}) {
  const ids = defaultRacerIds(3);
  const participants = [{ characterId: ids[0], playerIndex: null }, { characterId: ids[1], playerIndex: 0 }, { characterId: ids[2], playerIndex: 1 }];
  const race = new Race({ scene: new THREE.Scene(), trackDef: def, path, participants, laps: 2, seed: 3, buildKartModel: stubKartModel() });
  let now = 1000;
  const clock = createHostClock({ now: () => now });
  const transport = fakeTransport();
  const presentation = [];
  const taken = [];
  const driver = createHostDriver({
    race, transport, clock, wire, capture: captureSimState, now: () => now, nativeRobo,
    houses: new Map([[0, { peerId: 'g', karts: [2] }]]),
    localInputs: () => [{ steer: 0, accel: 1, brake: 0, drift: false, useItem: false }],
    onEvent: (e) => presentation.push(e),
    onInputTaken: (h, tick, r) => taken.push([tick, r.status]),
  });
  const step = (ms = TICK) => { now += ms; return driver.frame(now); };
  return { race, clock, transport, driver, step, presentation, taken, setNow: (v) => { now = v; }, get now() { return now; } };
}

const input = (ticks, o = {}) => encodeInput({
  seq: 1, newestTick: ticks[0], lastSnapTick: 0,
  ticks: ticks.map((t) => ({ tick: t, players: [{ steer: 0, accel: 1, brake: 0, drift: false, itemCount: 0, hopCount: 0, ...o }] })),
});

describe('host driver', () => {
  it('start() broadcasts START and the first TIMEBASE', () => {
    const S = setup();
    const msg = S.driver.start({ nowMs: 1000, goTick: cd.goTick });
    expect(msg).toEqual({ raceId: 1, startTick: 1, goTick: cd.goTick, epoch: 0 });
    expect(S.transport.of(MSG.START)[0].m).toMatchObject({ raceId: 1, startTick: 1, goTick: cd.goTick, epoch: 0 });
    expect(S.transport.of(MSG.TIMEBASE)[0].m).toMatchObject({ epoch: 0, tick: 1, hostMs: 1000, reason: 1 });
  });

  it('runs due ticks, snapshots every 2nd tick with the house tail, and batches events', () => {
    const S = setup();
    S.driver.start({ nowMs: 1000, goTick: cd.goTick });
    S.driver.frame(1000);
    for (let i = 0; i < 300; i++) S.step();
    expect(S.driver.tick).toBe(301);
    const snaps = S.transport.of(MSG.SNAPSHOT);
    expect(snaps.length).toBe(150);
    expect(snaps.every((x) => x.peer === 'g' && x.ch === 'state' && x.m.tick % 2 === 0)).toBe(true);
    expect(snaps[0].m.owner.map((o) => o.kart)).toEqual([2]);
    expect(snaps.at(-1).m.karts).toHaveLength(3);
    const events = S.transport.of(MSG.EVENTS);
    expect(events.length).toBeGreaterThan(0);
    const seqs = events.flatMap((x) => x.m.events.map((e) => e.seq));
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(events[0].m.events[0].type).toBe('countdown');
    expect(S.presentation.some((e) => e.type === 'go')).toBe(true); // the host's own presentation gets race events
    const st = S.driver.stats();
    expect(st).toMatchObject({ ticks: 301, snapshots: 150, epoch: 0, paused: false });
    expect(st.lastSentSeq).toBe(seqs.at(-1));
    expect(st.houses[0]).toMatchObject({ peerId: 'g', rateHz: 30 });
  });

  it('uses the guest INPUT for its kart (on time) and answers PING with PONG', () => {
    const S = setup();
    S.driver.start({ nowMs: 1000, goTick: cd.goTick });
    S.driver.onMessage('g', 'state', input([6, 5, 4, 3, 2, 1], { steer: 0.5 }));
    for (let i = 0; i < 5; i++) S.step();
    expect(S.taken.slice(0, 5).map((x) => x[1])).toEqual(['on-time', 'on-time', 'on-time', 'on-time', 'on-time']);
    S.driver.onMessage('g', 'state', encodeCtrl(MSG.PING, { id: 7, t0: 123 }));
    const pong = S.transport.of(MSG.PONG)[0];
    expect(pong).toMatchObject({ peer: 'g', ch: 'state' });
    expect(pong.m).toMatchObject({ id: 7, t0: 123, t1: S.now, t2: S.now });
    S.driver.onMessage('g', 'state', new Uint8Array([0x7e, 1, 2]));
    S.driver.onMessage('nobody', 'state', input([9]));
    expect(S.driver.stats().badMessages).toBe(1);
  });

  it('pauseAll freezes ticks (PAUSE + TIMEBASE) and resume re-anchors on a new epoch', () => {
    const S = setup();
    S.driver.start({ nowMs: 1000, goTick: cd.goTick });
    for (let i = 0; i < 60; i++) S.step();
    const t0 = S.driver.tick;
    S.driver.pauseAll(true, S.now);
    S.driver.pauseAll(true, S.now); // idempotent
    for (let i = 0; i < 120; i++) S.step();
    expect(S.driver.tick).toBe(t0);
    S.driver.pauseAll(false, S.now);
    S.step();
    expect(S.driver.tick).toBeGreaterThan(t0);
    const pauses = S.transport.of(MSG.PAUSE).map((x) => x.m);
    expect(pauses.map((p) => [p.paused, p.reason, p.tick])).toEqual([[true, 0, t0], [false, 0, t0 + 1]]);
    const tbs = S.transport.of(MSG.TIMEBASE).map((x) => x.m.reason);
    expect(tbs).toContain(2);
    expect(tbs).toContain(3);
    const snapFlags = S.transport.of(MSG.SNAPSHOT).map((x) => x.m.epoch);
    expect(snapFlags.at(-1)).toBe(1);
  });

  it('Robo Driver for an asleep house: kart.roboDriven, robo events, the CPU brain drives; hand back rebaselines', () => {
    const S = setup();
    S.driver.start({ nowMs: 1000, goTick: cd.goTick });
    for (let i = 0; i < cd.goTick + 10; i++) S.step();
    S.driver.setHouseRobo(0, true);
    S.driver.setHouseRobo(9, true); // unknown house: ignored
    const before = S.race.karts[2].distance;
    for (let i = 0; i < 90; i++) S.step();
    expect(S.race.karts[2].roboDriven).toBe(true);
    expect(S.race.karts[2].distance - before).toBeGreaterThan(5); // the brain drives it
    const log = S.driver.eventLog.entries().filter((e) => e.type === 'robo');
    expect(log.map((e) => [e.kart, e.on])).toEqual([[2, true]]);
    S.driver.setHouseRobo(0, false);
    const t = S.driver.tick + 1;
    S.driver.onMessage('g', 'state', input([t + 3, t + 2, t + 1, t]));
    S.step();
    expect(S.race.karts[2].roboDriven).toBe(false);
    expect(S.driver.eventLog.entries().filter((e) => e.type === 'robo').map((e) => e.on)).toEqual([true, false]);
    S.driver.rebaseline(0);
    expect(S.driver.stats().houses[0].buffer.rebaselines).toBeGreaterThanOrEqual(2);
  });

  it('nativeRobo passes robo: true through to a Race that handles it itself', () => {
    const S = setup({ nativeRobo: true });
    const tickRace = vi.fn();
    const race = S.race;
    const d = createHostDriver({
      race, transport: fakeTransport(), clock: createHostClock({ now: () => 0 }), wire, capture: captureSimState, now: () => 0,
      nativeRobo: true, tickRace, houses: { 0: { peerId: 'g', karts: [2] } },
    });
    d.setHouseRobo('0', true);
    d.frame(0);
    expect(tickRace).toHaveBeenCalled();
    expect(tickRace.mock.calls[0][1][1]).toMatchObject({ robo: true });
    d.dispose();
  });

  it('big in-race ctrl messages go out as FRAG pieces, <= 1 per tick per peer, only while the state buffer is empty', () => {
    const S = setup();
    S.driver.start({ nowMs: 1000, goTick: cd.goTick });
    const big = encodeCtrl(MSG.RESYNC, { raceId: 1, pad: 'x'.repeat(2900) });
    expect(big.length).toBeGreaterThan(2048);
    S.driver.sendCtrl('g', big);
    S.transport.setBuffered(500);
    for (let i = 0; i < 5; i++) S.step();
    expect(S.transport.of(MSG.FRAG)).toHaveLength(0);
    S.transport.setBuffered(0);
    S.step();
    expect(S.transport.of(MSG.FRAG)).toHaveLength(1);
    for (let i = 0; i < 5; i++) S.step();
    const frags = S.transport.of(MSG.FRAG);
    expect(frags).toHaveLength(3);
    const re = wire.createReassembler();
    let whole = null;
    for (const f of frags) whole = re.push(f.m, 0) || whole;
    expect(Array.from(whole)).toEqual(Array.from(big));
    // small ones go straight out
    expect(S.driver.sendCtrl('g', encodeCtrl(MSG.RESULT, { raceId: 1 }))).toBe(true);
  });

  it('a catch-up skip drops inputs stored for ticks the host has not simulated (the guests re-send them)', () => {
    const S = setup();
    S.driver.start({ nowMs: 1000, goTick: cd.goTick });
    S.step();
    const t = S.driver.tick;
    S.driver.onMessage('g', 'state', input([t + 8, t + 7, t + 6, t + 5]));
    expect(S.driver.stats().houses[0].buffer.occupancy).toBe(4);
    S.step(2000); // > 30 ticks backlog → skip
    expect(S.driver.stats().houses[0].buffer.occupancy).toBe(0);
    expect(S.driver.stats().houses[0].buffer.dropFuture).toBe(1);
  });

  it('dispose restores race.onEvent and stops ticking', () => {
    const S = setup(); // the Race was built without an onEvent (null); the driver wrapped it
    S.driver.start({ nowMs: 1000, goTick: cd.goTick });
    expect(S.race.onEvent).toBeTypeOf('function');
    S.driver.dispose();
    expect(S.race.onEvent).toBeNull();
    expect(S.step()).toEqual({ alpha: 0, ticks: 0 });
  });

  it('starts itself on the first frame when start() was not called', () => {
    const S = setup();
    S.driver.frame(1000);
    expect(S.transport.of(MSG.START)).toHaveLength(1);
    expect(S.driver.tick).toBe(1);
  });
});

describe('guest driver', () => {
  function guest() {
    const ids = defaultRacerIds(2);
    const participants = [{ characterId: ids[0], playerIndex: 0 }, { characterId: ids[1], playerIndex: 1 }];
    let now = 5000;
    const sent = [];
    const transport = { peers: () => ['host'], send: (p, ch, b) => { sent.push({ p, ch, m: decode(b) }); return true; } };
    const replica = new ReplicaRace({ trackDef: def, path, setup: { participants, laps: 1 }, localKartIds: [1], predictTick, countdownAfter: cd.after, quantize: wire.quantizeInput });
    const clock = createClockSync({ now: () => now });
    const timeline = createHostTimeline({ clock });
    const ctrl = [];
    const d = createGuestDriver({
      replica, transport, clock, timeline, wire, now: () => now, onCtrl: (m) => ctrl.push(m),
      localSeats: [{ kartId: 1, sample: () => ({ steer: 0, accel: 1, brake: 0, drift: false, itemCount: 0, hopCount: 0 }) }],
    });
    return { d, replica, sent, clock, timeline, ctrl, advance: (ms) => { now += ms; }, get now() { return now; } };
  }

  it('warms the clock up with 8 quick PINGs, then 2 Hz; predicts nothing before START + TIMEBASE', () => {
    const G = guest();
    for (let i = 0; i < 60; i++) { G.d.frame(1 / 60); G.advance(TICK); }
    const pings = G.sent.filter((x) => x.m.type === MSG.PING);
    expect(pings.length).toBeGreaterThanOrEqual(9);
    expect(pings.length).toBeLessThanOrEqual(11);
    expect(G.replica.predictedTick).toBe(0);
    expect(G.sent.some((x) => x.m.type === MSG.INPUT)).toBe(false);
  });

  it('after PONGs, START and TIMEBASE it predicts ahead of the host and sends INPUT every 2nd tick', () => {
    const G = guest();
    for (let i = 0; i < 8; i++) {
      G.d.frame(1 / 60);
      const ping = G.sent.filter((x) => x.m.type === MSG.PING).at(-1).m;
      G.advance(20);
      G.d.onMessage('host', 'state', encodeCtrl(MSG.PONG, { id: ping.id, t0: ping.t0, t1: ping.t0 + 10 + 1000, t2: ping.t0 + 10 + 1000 }));
    }
    expect(G.clock.ready).toBe(true);
    expect(G.d.lead.lead).toBeGreaterThanOrEqual(3);
    G.d.onMessage('host', 'ctrl', encodeCtrl(MSG.START, { raceId: 1, startTick: 1, goTick: cd.goTick, epoch: 0 }));
    G.d.onMessage('host', 'ctrl', encodeCtrl(MSG.TIMEBASE, { epoch: 0, tick: 1, hostMs: G.now + 1000, reason: 1 }));
    for (let i = 0; i < 30; i++) { G.d.frame(1 / 60); G.advance(TICK); }
    expect(G.replica.predictedTick).toBeGreaterThanOrEqual(30);
    const inputs = G.sent.filter((x) => x.m.type === MSG.INPUT);
    expect(inputs.length).toBeGreaterThanOrEqual(14);
    expect(inputs.at(-1).ch).toBe('state');
    const st = G.d.stats();
    expect(st.inputsSent).toBe(inputs.length);
    expect(st.epoch).toBe(0);
  });

  it('PAUSE freezes the timeline and the lead; FRAG pieces are reassembled; RESULT reaches onCtrl; junk is counted', () => {
    const G = guest();
    G.d.onMessage('host', 'ctrl', encodeCtrl(MSG.TIMEBASE, { epoch: 0, tick: 1, hostMs: G.now, reason: 1 }));
    G.d.onMessage('host', 'ctrl', encodeCtrl(MSG.PAUSE, { paused: true, reason: 0, tick: 50, epoch: 0 }));
    expect(G.timeline.paused).toBe(true);
    expect(G.d.lead.frozen).toBe(true);
    G.d.onMessage('host', 'ctrl', encodeCtrl(MSG.PAUSE, { paused: false, reason: 0, tick: 51, epoch: 1 }));
    expect(G.d.lead.frozen).toBe(false);
    const big = encodeCtrl(MSG.RESULT, { raceId: 1, summary: { pad: 'y'.repeat(2500) } });
    for (const piece of createFragmenter().split(big)) G.d.onMessage('host', 'ctrl', piece);
    expect(G.ctrl).toHaveLength(1);
    expect(G.d.lastResult.summary.pad).toHaveLength(2500);
    G.d.onMessage('host', 'ctrl', new Uint8Array([0x7e]));
    expect(G.d.stats().bad).toBe(1);
    expect(G.d.stats().frags).toBe(3);
    G.d.dispose();
  });
});
