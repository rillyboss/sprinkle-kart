/**
 * Node multi-peer harness for the netcode (NETWORKING.md §15 "Node multi-peer sims", WS5):
 *
 *   const r = runNetRace({ track: 'gumdrop-meadow', houses: [[2], [1], [1]], laps: 1, seed: 3,
 *                          conditions: { latencyMs: 75, jitterMs: 20, loss: 0.05, burstLen: 3, reorder: 0.1, duplicate: 0.01 } });
 *   r.results            host results (standings, finish places/times, lap times in ms, RESULT summary)
 *   r.guests[i].results  the same, as guest i derived them from snapshots + events (+ its RESULT copy)
 *   r.metrics            wire kbps per flow, reconcile errors (in/out of contact), remote jumps, interp delay,
 *                        timeline error, press accounting, robo timings, buffer sizes
 *
 * It runs a real host Race (today's Race via `race.update(1/60)`, or WS1's `race.tick`) and one ReplicaRace per
 * guest house over the in-memory hub with a fake clock: every host/guest frame and every packet delivery happens
 * at an exact fake time, so runs are deterministic. "Human" seats are driven by a deterministic autopilot
 * (steer to the road ahead, full gas, scripted drift taps/holds and item presses via the press counters); tests can
 * override any seat with `script(ctx)`.
 *
 * Houses: `houses` lists the GUEST houses ([n] = n local players); the host's own players are `hostPlayers`
 * (default 1). Karts: CPUs first, then humans by global player index (host players first, then each house).
 */
import * as THREE from 'three';
import { Race } from '../../src/race/Race.js';
import { TUNING as T } from '../../src/race/tuning.js';
import { trackFixture, stubKartModel, defaultRacerIds } from './raceHarness.js';
import { createHostClock } from '../../src/net/host/hostClock.js';
import { createHostDriver } from '../../src/net/host/hostDriver.js';
import { ReplicaRace } from '../../src/net/guest/replicaRace.js';
import { createHostTimeline } from '../../src/net/guest/hostTimeline.js';
import { createGuestDriver } from '../../src/net/guest/guestDriver.js';
import { wire, decode, MSG } from './netWire.js';
import { createMemoryHub } from './netMemoryHub.js';
import { createClockSync } from './netClock.js';
import { captureSimState, predictTick, makeCountdown } from './netSim.js';

const FRAME_MS = 1000 / 60;
const TAU = Math.PI * 2;
const wrap = (a) => { let x = (a + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deterministic "kid" autopilot for one seat. Returns sample(tick, kart, env) → PlayerTickInput and
 * keeps its press counters (itemCount / hopCount mod 8) plus a log of every press tick.
 */
export function makePilot(seed, { drift = true, items = true, pressFrom = 0, accelFrom = null } = {}) {
  const rnd = mulberry(seed);
  let itemCount = 0;
  let hopCount = 0;
  let driftUntil = -1;
  let nextHop = 240 + Math.floor(rnd() * 120);
  let itemSince = null;
  const presses = { item: [], hop: [] };
  const lane = (rnd() - 0.5) * 4;
  const sample = (tick, kart, env) => {
    const out = { steer: 0, accel: 1, brake: 0, drift: false, lookBack: false, robo: false, assisted: false, itemCount, hopCount };
    if (accelFrom !== null && tick < accelFrom) out.accel = 0;
    if (!kart) return out;
    const path = env.path;
    const ahead = path.positionAt(path.wrap(kart.s + 14 + Math.max(0, kart.speed) * 0.35), lane, new THREE.Vector3());
    const desired = Math.atan2(ahead.x - kart.position.x, ahead.z - kart.position.z);
    out.steer = clamp(-wrap(desired - kart.heading) * 2.4, -1, 1);
    const racing = env.racing(tick);
    if (!racing || tick < pressFrom) return out;
    if (drift) {
      if (tick >= nextHop && kart.speed > 14) {
        const hold = rnd() < 0.5;
        hopCount = (hopCount + 1) & 7;
        presses.hop.push(tick);
        driftUntil = tick + (hold ? 30 + Math.floor(rnd() * 50) : 1 + Math.floor(rnd() * 2));
        nextHop = tick + 150 + Math.floor(rnd() * 200);
      }
      out.drift = tick <= driftUntil;
      out.hopCount = hopCount;
    }
    if (items) {
      if (kart.item && kart.itemRoulette <= 0) {
        if (itemSince === null) itemSince = tick;
        if (tick - itemSince > 45 + Math.floor(rnd() * 30)) {
          itemCount = (itemCount + 1) & 7;
          presses.item.push(tick);
          itemSince = null;
        }
      } else itemSince = null;
      out.itemCount = itemCount;
    }
    return out;
  };
  return { sample, presses };
}

/** Deep-ish structural equality helper for results (returns the first difference or null). */
export function diffResults(a, b, path = '') {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = diffResults(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/**
 * @param {object} o
 * @returns {object} see the file header
 */
export function runNetRace({
  track = 'gumdrop-meadow', mode = 'free', houses = [[1]], hostPlayers = 1, cpus = null, laps = 1, seed = 1,
  conditions = {}, perGuest = null, speedClass = 'zippy', maxSeconds = null, startAtMs = 1500, settleMs = 2500,
  pauses = [], stalls = [], hidden = [], outages = [], script = null, pilot = {}, clockOffsets = null,
  guestFrameJitterMs = 0, recordFrames = false, onGuestFrame = null, onHostTick = null, stopWhen = null,
  hostOverride = null, drainMs = 3000, captureExtra = null,
} = {}) {
  if (mode !== 'free') throw new Error(`runNetRace: mode ${mode} is a later milestone (M2/M3)`);
  const rnd = mulberry(seed * 7919 + 1);
  const { def, path } = trackFixture(track);
  const humanCount = hostPlayers + houses.reduce((n, h) => n + h[0], 0);
  const cpuCount = cpus ?? Math.max(0, 8 - humanCount);
  const ids = defaultRacerIds(cpuCount + humanCount);
  const participants = [];
  for (let i = 0; i < cpuCount; i++) participants.push({ characterId: ids[i], playerIndex: null });
  let pi = 0;
  const hostKarts = [];
  for (let i = 0; i < hostPlayers; i++) { hostKarts.push(participants.length); participants.push({ characterId: ids[participants.length], playerIndex: pi++ }); }
  const houseKarts = houses.map(([n]) => {
    const karts = [];
    for (let i = 0; i < n; i++) { karts.push(participants.length); participants.push({ characterId: ids[participants.length], playerIndex: pi++ }); }
    return karts;
  });

  const countdown = makeCountdown(3);
  const startTick = 1;
  const goTick = startTick + countdown.goTick - 1;

  // ---- network
  const hub = createMemoryHub({ seed });
  const hostEp = hub.endpoint('host', 'host');
  const guestIds = houses.map((_, i) => `g${i + 1}`);
  const guestEps = guestIds.map((id) => hub.endpoint(id, 'guest'));
  for (const id of guestIds) hub.link('host', id);
  guestIds.forEach((id, i) => {
    const c = { ...conditions, ...(perGuest?.[i] || {}) };
    hub.setConditions(id, 'host', c);
    hub.setConditions('host', id, c);
  });

  // ---- host
  let t = 0;
  const hostOffset = 1000.5;
  const hostNow = () => t + hostOffset;
  const hostEvents = [];
  const models = stubKartModel();
  const race = new Race({
    scene: new THREE.Scene(), trackDef: def, path, participants, speedClass, buildKartModel: models, laps, seed,
    onEvent: null,
  });
  const clock = createHostClock({ now: hostNow });
  const hostPilots = hostKarts.map((_, i) => makePilot(seed * 101 + i, pilot));
  const env = { path, racing: (tick) => tick > goTick };
  const presses = new Map(); // `${house}:${seat}` → { guest: {item, hop}, host: {item: [], hop: []} }
  const lateAfter = [];
  const roboLog = [];
  const takeLog = new Map();
  const driver = createHostDriver({
    race, transport: hostEp, clock, wire, now: hostNow,
    capture: captureExtra ? (rc, tick) => captureExtra(captureSimState(rc, tick), tick) : captureSimState,
    houses: new Map(houseKarts.map((karts, i) => [i, { peerId: guestIds[i], karts }])),
    localInputs: (tick) => {
      const out = [];
      hostKarts.forEach((kid, i) => {
        const k = race.karts[kid];
        const x = hostOverride ? hostOverride({ tick, seat: i, kart: k, race }) : null;
        const s = x || hostPilots[i].sample(tick, k, env);
        out[k.playerIndex] = { steer: s.steer, accel: s.accel, brake: s.brake, drift: s.drift, useItem: false, lookBack: false };
      });
      return out;
    },
    onEvent: (e) => hostEvents.push({ tick: driver.tick, t, e }),
    onInputTaken: (house, tick, r) => {
      r.presses.forEach((p, seat) => {
        const key = `${house}:${seat}`;
        if (!presses.has(key)) presses.set(key, { host: { item: [], hop: [] } });
        const rec = presses.get(key).host;
        if (p.item) rec.item.push(tick);
        if (p.hop) rec.hop.push(tick);
      });
      if (r.roboChanged) roboLog.push({ house, tick, t, robo: r.status === 'robo' });
      let tl = takeLog.get(house);
      if (!tl) { tl = []; takeLog.set(house, tl); }
      tl.push(r.status);
    },
    onInputPushed: (house, tick, res) => {
      if (res === 'late') lateAfter.push({ house, tick, t });
    },
  });
  hostEp.onMessage((peer, ch, bytes) => driver.onMessage(peer, ch, bytes));

  // host truth per snapshot tick (for the final-state check) and host tick at a time
  const hostTruth = new Map();
  const hostTickAt = (ms) => {
    const s = clock.state();
    if (!s.started) return 0;
    if (s.paused) return s.lastTick;
    return s.anchorTick + ((ms + hostOffset - s.anchorMs) * 60) / 1000 - 1 + 1;
  };

  // ---- guests
  const guests = houses.map(([n], gi) => {
    const offset = clockOffsets ? clockOffsets[gi] : (gi + 1) * 12345.678 + rnd() * 1000;
    const gnow = () => t + offset;
    const ep = guestEps[gi];
    const events = [];
    const corrections = [];
    const replica = new ReplicaRace({
      scene: new THREE.Scene(), trackDef: def, path, setup: { participants, laps, speedClass, startTick, goTick },
      localKartIds: houseKarts[gi], buildKartModel: stubKartModel(), onEvent: (e) => events.push({ t, tick: replica.predictedTick, e }),
      predictTick, quantize: wire.quantizeInput, countdownAfter: countdown.after,
    });
    replica.onCorrection = (snap, errs) => { for (const x of errs) corrections.push({ tick: snap.tick, P: replica.predictedTick, ...x }); };
    const pilots = houseKarts[gi].map((_, seat) => makePilot(seed * 1000 + gi * 10 + seat, pilot));
    const guestPresses = houseKarts[gi].map(() => ({ item: [], hop: [] }));
    const lastCounts = houseKarts[gi].map(() => ({ item: 0, hop: 0 }));
    const localSeats = houseKarts[gi].map((kid, seat) => ({
      kartId: kid,
      sample: (tick) => {
        const k = replica.karts[kid];
        const base = pilots[seat].sample(tick, k, env);
        const x = script ? script({ guest: gi, seat, tick, kart: k, replica, input: base, t }) : null;
        const s = x ? { ...base, ...x } : base;
        const lc = lastCounts[seat];
        if (((s.itemCount - lc.item) & 7) > 0) for (let i = 0; i < ((s.itemCount - lc.item) & 7); i++) guestPresses[seat].item.push(tick);
        if (((s.hopCount - lc.hop) & 7) > 0) for (let i = 0; i < ((s.hopCount - lc.hop) & 7); i++) guestPresses[seat].hop.push(tick);
        lc.item = s.itemCount;
        lc.hop = s.hopCount;
        return s;
      },
    }));
    const clockSync = createClockSync({ now: gnow });
    const timeline = createHostTimeline({ clock: clockSync });
    const gdriver = createGuestDriver({ replica, transport: ep, clock: clockSync, timeline, localSeats, wire, hostId: () => 'host', now: gnow });
    ep.onMessage((peer, ch, bytes) => gdriver.onMessage(peer, ch, bytes));
    return {
      id: guestIds[gi], index: gi, replica, driver: gdriver, timeline, clock: clockSync, events, corrections, guestPresses,
      offset, gnow, nextFrame: startAtMs * 0.2 + rnd() * FRAME_MS, frames: [], jumps: [], lastRender: new Map(),
      timelineErr: [], leadLog: [], interpLog: [],
    };
  });

  // ---- schedule
  const inWindow = (list, ms) => list.find((w) => ms >= w.atMs && ms < w.atMs + w.ms);
  let nextHost = 0;
  let raceStarted = false;
  let finishedAt = null;
  let resultSent = false;
  const hostSummary = { value: null };
  const pauseState = pauses.map(() => ({ on: false, off: false }));
  const hiddenState = hidden.map(() => ({ on: false, off: false }));
  const endLimit = (maxSeconds ?? laps * 150 + 60) * 1000 + startAtMs;
  let wireStart = null;
  const outageState = outages.map(() => ({ on: false, off: false }));

  const hostFrame = (source) => {
    if (!raceStarted) {
      raceStarted = true;
      driver.start({ nowMs: hostNow(), goTick, startTick });
      wireStart = snapshotWire();
    }
    const before = driver.tick;
    driver.frame(hostNow(), source);
    for (let tk = before + 1; tk <= driver.tick; tk++) {
      if (tk % 2 === 0) hostTruth.set(tk, race.karts.map((k) => [k.position.x, k.position.y, k.position.z]));
      if (hostTruth.size > 400) hostTruth.delete(hostTruth.keys().next().value);
      onHostTick?.({ tick: tk, race, driver, t });
    }
    race.present?.(0, FRAME_MS / 1000);
  };

  function snapshotWire() {
    const out = { t, links: {} };
    for (const id of guestIds) {
      out.links[`${id}>host`] = hub.linkStats(id, 'host');
      out.links[`host>${id}`] = hub.linkStats('host', id);
    }
    return out;
  }

  while (t < endLimit) {
    const nextGuest = Math.min(...guests.map((g) => g.nextFrame));
    t = Math.min(nextHost, nextGuest, hub.nextAt);
    hub.advance(t);
    // scripted world events
    pauses.forEach((p, i) => {
      const st = pauseState[i];
      if (!st.on && t >= p.atMs) { st.on = true; driver.pauseAll(true, hostNow()); }
      if (st.on && !st.off && t >= p.atMs + p.ms) { st.off = true; driver.pauseAll(false, hostNow()); }
    });
    hidden.forEach((h, i) => {
      const st = hiddenState[i];
      if (!st.on && t >= h.atMs) { st.on = true; clock.usePump(true); }
      if (st.on && !st.off && t >= h.atMs + h.ms) { st.off = true; clock.usePump(false); }
    });
    outages.forEach((o, i) => {
      const st = outageState[i];
      const c = { ...conditions, ...(perGuest?.[o.guest] || {}) };
      if (!st.on && t >= o.atMs) { st.on = true; hub.setConditions(guestIds[o.guest], 'host', { ...c, loss: 0.999999, burstLen: 1 }); if (o.both) hub.setConditions('host', guestIds[o.guest], { ...c, loss: 0.999999, burstLen: 1 }); }
      if (st.on && !st.off && t >= o.atMs + o.ms) { st.off = true; hub.setConditions(guestIds[o.guest], 'host', { ...c, loss: c.loss || 0 }); hub.setConditions('host', guestIds[o.guest], { ...c, loss: c.loss || 0 }); }
    });
    const hostFrozen = resultSent && t >= finishedAt + settleMs; // the host stops; the network drains
    if (t >= nextHost) {
      if (t >= startAtMs && !hostFrozen) {
        const stall = inWindow(stalls, t);
        const hid = inWindow(hidden, t);
        if (!stall) {
          if (hid) {
            const from = hid.atMs + (hid.starveAt || 0);
            const starving = hid.starveMs && t >= from && t < from + hid.starveMs;
            if (!starving) hostFrame('pump');
          } else hostFrame('raf');
        }
      }
      nextHost += FRAME_MS;
      if (race.state === 'finished' && finishedAt === null) finishedAt = t;
      if (finishedAt !== null && !resultSent && t >= finishedAt + 200) {
        resultSent = true;
        hostSummary.value = hostResults();
        for (const id of guestIds) driver.sendCtrl(id, wire.encodeCtrl(MSG.RESULT, { raceId: 1, summary: hostSummary.value }));
      }
    }
    for (const g of guests) {
      if (t < g.nextFrame) continue;
      const dt = FRAME_MS / 1000;
      const fr = g.driver.frame(dt);
      g.nextFrame += FRAME_MS + (guestFrameJitterMs ? (rnd() - 0.5) * 2 * guestFrameJitterMs : 0);
      if (fr.T !== undefined && raceStarted) {
        const truth = hostTickAt(t);
        g.timelineErr.push({ t, err: fr.T - truth, paused: g.timeline.paused });
        g.leadLog.push({ t, lead: g.driver.lead.lead, target: g.driver.lead.targetSlack, slack: null });
        g.interpLog.push({ t, ms: g.replica.interpDelayMs });
        // remote pose continuity
        for (const k of g.replica.karts) {
          if (g.replica.isPredicted(k.id)) continue;
          const p = k.render.position;
          const last = g.lastRender.get(k.id);
          if (last && fr.R > goTick + 30) g.jumps.push({ t, kart: k.id, d: Math.hypot(p.x - last.x, p.z - last.z) });
          g.lastRender.set(k.id, { x: p.x, z: p.z });
        }
      }
      if (recordFrames) g.frames.push({ t, ...fr });
      onGuestFrame?.({ g, fr, t, race, driver });
    }
    if (stopWhen?.({ t, race, driver, guests })) break;
    if (resultSent && t >= finishedAt + settleMs + drainMs) break;
  }
  const wireEnd = snapshotWire();

  // ---- results
  function hostResults() {
    const log = driver.eventLog.entries();
    const laps = race.karts.map(() => []);
    const fin = new Map();
    for (const e of log) {
      if (e.type === 'lap') laps[e.kart].push(e.lapTimeMs);
      if (e.type === 'finish') fin.set(e.kart, { place: e.place, finishTimeMs: e.finishTimeMs, estimated: e.estimated });
    }
    return summarize(race.getStandings().map((k) => k.id), laps, fin);
  }
  function summarize(order, lapsMs, finishes) {
    return {
      order,
      karts: order.map((id) => {
        const f = finishes.get(id) || null;
        const lapTimesMs = lapsMs[id].slice();
        if (f && !f.estimated) lapTimesMs.push(f.finishTimeMs - lapTimesMs.reduce((a, b) => a + b, 0));
        return { id, place: f?.place ?? null, finishTimeMs: f?.finishTimeMs ?? null, estimated: f?.estimated ?? null, lapTimesMs };
      }),
    };
  }
  const results = hostSummary.value || hostResults();

  const durS = (wireEnd.t - (wireStart?.t ?? 0)) / 1000;
  const kbps = (key) => {
    const a = wireStart?.links[key] || { wireBytesOut: 0, sackBytesOut: 0 };
    const b = wireEnd.links[key];
    return ((b.wireBytesOut - a.wireBytesOut) * 8) / 1000 / Math.max(1e-9, durS);
  };
  const guestUp = guestIds.map((id) => kbps(`${id}>host`));
  const guestDown = guestIds.map((id) => kbps(`host>${id}`));

  // contact windows: host disturbances a guest cannot predict (bumps with karts of other machines, bonks,
  // shield pops, item pickups/drops). Bumps between two karts of the same guest house are predicted there.
  const houseOf = new Map();
  houseKarts.forEach((ks, h) => ks.forEach((k) => houseOf.set(k, h)));
  const disturb = [];
  for (const { tick, e } of hostEvents) {
    const a = e.kart?.id;
    if (e.type === 'bump' && !e.wall) {
      const b = e.other?.id;
      const sib = houseOf.has(a) && houseOf.get(a) === houseOf.get(b) ? houseOf.get(a) : null;
      disturb.push({ tick, karts: [a, b], sib });
    } else if (['bonked', 'shield-pop', 'item-dodged'].includes(e.type)) disturb.push({ tick, karts: [a, e.by?.id], sib: null });
    else if (e.type === 'item-use' && (e.item === 'gumdrop' || e.item === 'cupcake-rocket')) disturb.push({ tick, karts: [a], sib: null });
    else if (e.type === 'item-get' || e.type === 'item-box') disturb.push({ tick, karts: [a], sib: null });
  }
  const guestOut = guests.map((g, gi) => {
    const classify = (c) => (disturb.some((d) => d.sib !== gi && d.karts.includes(c.kart) && d.tick >= c.tick - 20 && d.tick <= c.P + 2) ? 'contact' : 'clean');
    const corr = g.corrections.filter((c) => c.tick > goTick + 6).map((c) => ({ ...c, kind: classify(c) }));
    const pct = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0; };
    const clean = corr.filter((c) => c.kind === 'clean').map((c) => c.err);
    const contact = corr.filter((c) => c.kind === 'contact').map((c) => c.err);
    const replica = g.replica;
    const order = replica.getStandings().map((k) => k.id);
    const gres = summarize(order, replica.lapTimesMs, replica.finishes);
    // final state vs host truth at the newest snapshot tick
    const newest = replica.buffer.newest;
    let finalErr = null;
    if (newest && hostTruth.has(newest.tick)) {
      const truth = hostTruth.get(newest.tick);
      finalErr = Math.max(...newest.karts.map((r, i) => Math.hypot(r.position[0] - truth[i][0], r.position[2] - truth[i][2], (r.position[1] - truth[i][1]))));
    }
    return {
      id: g.id, replica, driver: g.driver, events: g.events, results: gres, resultMsg: g.driver.lastResult?.summary ?? null,
      finalErr, acceptedSeqs: replica.acceptedSeqs.slice(),
      presses: g.guestPresses,
      metrics: {
        reconcile: { clean, contact, cleanP50: pct(clean, 0.5), cleanP99: pct(clean, 0.99), contactP99: pct(contact, 0.99), all: corr },
        maxJump: g.jumps.length ? Math.max(...g.jumps.map((j) => j.d)) : 0, jumps: g.jumps,
        interpDelayMs: replica.interpDelayMs, interpLog: g.interpLog, timelineErr: g.timelineErr, leadLog: g.leadLog,
        stats: g.driver.stats(), bufferSize: replica.buffer.size, historySize: replica.history.size, pendingEvents: replica.events.pending,
      },
    };
  });

  const out = {
    host: { race, driver, clock, events: hostEvents, results, hostKarts, houseKarts, participants, goTick, startTick },
    guests: guestOut,
    results,
    events: driver.eventLog.entries(),
    lastSeq: driver.stats().lastSentSeq,
    metrics: {
      durationS: durS,
      wire: { guestUpKbps: guestUp, guestDownKbps: guestDown, hostUpKbps: guestDown.reduce((a, b) => a + b, 0) },
      hostStats: driver.stats(),
      presses,
      lateAfter,
      roboLog,
      takeLog,
    },
    finishedAt,
    t,
  };
  race.dispose();
  for (const g of guestOut) g.replica.dispose();
  return out;
}

/** Press accounting for one run: per guest seat, guest press ticks vs host-applied ticks (in order). */
export function pressReport(r) {
  const out = [];
  const lastTick = r.host.driver.tick;
  r.guests.forEach((g, gi) => {
    g.presses.forEach((p, seat) => {
      const host = r.metrics.presses.get(`${gi}:${seat}`)?.host || { item: [], hop: [] };
      for (const kind of ['item', 'hop']) {
        const sent = p[kind].filter((tk) => tk <= lastTick - 30);
        const got = host[kind].slice(0, sent.length);
        const extra = host[kind].filter((tk) => tk <= lastTick - 30).length - sent.length;
        const late = sent.map((tk, i) => (got[i] === undefined ? Infinity : got[i] - tk));
        out.push({ guest: gi, seat, kind, sent: sent.length, applied: got.length, extra, late });
      }
    });
  });
  return out;
}

/**
 * Every convergence assertion of the matrix (NETWORKING.md §15 / §17 M1-6, M1-7, M1-8) → a list of problems.
 * @param {object} r runNetRace result
 * @param {{ rttMs: number, bursts?: boolean, maxLate?: number }} o
 */
export function convergenceProblems(r, { rttMs = 0, bursts = false, maxLate = 6, contact = true } = {}) {
  const probs = [];
  const seqs = Array.from({ length: r.lastSeq }, (_, i) => i + 1);
  r.guests.forEach((g, gi) => {
    const d1 = diffResults(r.results, g.results);
    if (d1) probs.push(`guest ${gi} results differ: ${d1}`);
    const d2 = diffResults(r.results, g.resultMsg);
    if (d2) probs.push(`guest ${gi} RESULT differs: ${d2}`);
    const acc = g.acceptedSeqs;
    if (acc.length !== seqs.length || acc.some((s, i) => s !== seqs[i])) probs.push(`guest ${gi} seqs not exactly once (${acc.length} of ${seqs.length})`);
    if (!(g.finalErr <= 0.04)) probs.push(`guest ${gi} final state ${g.finalErr} m off`);
    const rec = g.metrics.reconcile;
    if (rttMs <= 150) {
      const lim = bursts ? 0.75 : 0.5;
      if (rec.cleanP99 > lim) probs.push(`guest ${gi} reconcile p99 ${rec.cleanP99.toFixed(3)} m > ${lim} outside contact`);
      if (contact && rec.contactP99 > 2) probs.push(`guest ${gi} reconcile p99 ${rec.contactP99.toFixed(3)} m > 2 inside contact`);
    }
    if (g.metrics.maxJump > 1.5) probs.push(`guest ${gi} remote jump ${g.metrics.maxJump.toFixed(2)} m`);
    if (g.metrics.stats.bad) probs.push(`guest ${gi} got ${g.metrics.stats.bad} undecodable messages`);
  });
  for (const p of pressReport(r)) {
    if (p.applied !== p.sent || p.extra !== 0) probs.push(`guest ${p.guest} seat ${p.seat} ${p.kind}: sent ${p.sent}, applied ${p.applied}, extra ${p.extra}`);
    const worst = Math.max(0, ...p.late);
    if (worst > maxLate) probs.push(`guest ${p.guest} seat ${p.seat} ${p.kind} press ${worst} ticks late`);
  }
  if (r.metrics.hostStats.badMessages) probs.push(`host got ${r.metrics.hostStats.badMessages} undecodable messages`);
  return probs;
}

const pctOf = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : 0; };
export { pctOf as percentile };

/**
 * The §15 convergence matrix for one RTT: loss 0 / 1 / 5 % random and 5 % in (exactly) 3-packet bursts ×
 * jitter 0 / 20 ms × reorder 0 / 10 % (+ 1 % duplication with reorder).
 */
export function matrixCells(rttMs) {
  const cells = [];
  for (const loss of ['0', '1', '5', '5b']) {
    for (const jitterMs of [0, 20]) {
      for (const reorder of [0, 0.1]) {
        cells.push({
          name: `rtt ${rttMs} ms · loss ${loss === '5b' ? '5 % in 3-packet bursts' : `${loss} %`} · jitter ${jitterMs} ms · reorder ${reorder * 100} %`,
          bursts: loss === '5b',
          conditions: {
            latencyMs: rttMs / 2, jitterMs, loss: loss === '0' ? 0 : loss === '1' ? 0.01 : 0.05,
            burstLen: loss === '5b' ? 3 : 1, burstExact: loss === '5b', reorder, duplicate: reorder ? 0.01 : 0,
          },
        });
      }
    }
  }
  return cells;
}

/**
 * Run every matrix cell for one RTT; returns per-cell problems and the pooled reconcile samples
 * (the p99 inside contact is taken over the pooled samples: one race has too few contacts for a p99).
 */
export function runMatrixRow(rttMs, { houses = [[2], [1]], seed = 5, laps = 1 } = {}) {
  const cells = [];
  const contact = [];
  const clean = [];
  for (const cell of matrixCells(rttMs)) {
    const r = runNetRace({ houses, laps, seed, conditions: cell.conditions });
    const problems = convergenceProblems(r, { rttMs, bursts: cell.bursts, contact: false });
    for (const g of r.guests) { contact.push(...g.metrics.reconcile.contact); clean.push(...g.metrics.reconcile.clean); }
    cells.push({ name: cell.name, problems, maxJump: Math.max(...r.guests.map((g) => g.metrics.maxJump)), lastSeq: r.lastSeq });
  }
  return { cells, contactP99: pctOf(contact, 0.99), cleanP99: pctOf(clean, 0.99), contactN: contact.length, cleanN: clean.length };
}

export { decode, MSG, T };
