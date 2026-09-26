/**
 * Host driver (NETWORKING.md §9.3, §9.4, §9.7, §9.9): runs the authoritative Race on the host clock and
 * talks to every guest house.
 *
 *   frame(nowMs, source)  hostClock.advance → for each due tick: gather inputs (host locals sampled for the
 *                         tick, each guest house from its input buffer), race.tick(inputs); after every 2nd tick
 *                         one SNAPSHOT per house (shared capture, per-house tail) + one EVENTS batch; paced
 *                         FRAG pieces for big in-race ctrl messages. Returns { alpha } for race.present(alpha).
 *   onMessage(peer, ch, bytes)   INPUT → the house's buffer (every tick in the packet), PING → PONG.
 *   pauseAll(on)          "Pause everyone": PAUSE + TIMEBASE (the clock re-anchors on resume).
 *   setHouseRobo(id, on)  a house fell asleep (or woke up): Robo Driver drives its karts / hand back.
 *
 * Robo Driver on the host uses `race.tick`'s own `robo` input flag when the Race supports it (WS1), and
 * otherwise drives the kart with the CPU brain through `aiDriveInput` (today's Race), marking
 * `kart.roboDriven` so the snapshot carries it. A `robo` event (on/off) goes through the event log.
 *
 * Injected: `wire` (WS2 codec), `capture(race, tick)` (WS1 captureSimState), `tickRace(race, inputs)`
 * (default: race.tick(inputs) or race.update(1/60, inputs)), `now` (host wall clock, ms).
 */
import { createInputBuffer } from './inputBuffer.js';
import { createEventLog } from './eventLog.js';
import { createSnapshotter, SNAPSHOT_EVERY } from './snapshotter.js';
import { aiDriveInput } from '../../race/Race.js';
import { TIMEBASE_REASON, PAUSE_REASON } from './hostClock.js';

export const EVENTS_PER_BATCH = 48;
export const NETSTAT_EVERY_TICKS = 60;

const defaultTickRace = (race, inputs) => {
  if (typeof race.tick === 'function') race.tick(inputs); else race.update(1 / 60, inputs);
};

/**
 * @param {object} o
 * @param {object} o.race
 * @param {object} o.transport                 NetTransport (host)
 * @param {Map<any, { peerId: string, karts: number[] }>|object} o.houses   guest houses (houseId → peer + kart ids in seat order)
 * @param {(tick: number) => object[]} [o.localInputs]   host locals' DriveInputs by playerIndex for a tick
 * @param {object} o.clock                     createHostClock()
 * @param {(e: object) => void} [o.onEvent]    host-side presentation (original race events)
 * @param {number} [o.snapshotEvery]
 * @param {object} o.wire
 * @param {(race: object, tick: number) => object} o.capture
 * @param {(race: object, inputs: object[]) => void} [o.tickRace]
 * @param {() => number} [o.now]
 * @param {boolean} [o.nativeRobo]             the Race handles `robo: true` inputs itself (WS1)
 * @param {(houseId, tick, result) => void} [o.onInputTaken]    diagnostics: every buffer take
 * @param {(houseId, tick, status) => void} [o.onInputPushed]   diagnostics: every buffer push ('stored'|'late'|…)
 */
export function createHostDriver({
  race, transport, houses, localInputs = () => [], clock, onEvent = null, snapshotEvery = SNAPSHOT_EVERY, wire, capture,
  tickRace = defaultTickRace, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  nativeRobo = false, raceId = 1, onInputTaken = null, onInputPushed = null,
}) {
  const houseMap = houses instanceof Map ? houses : new Map(Object.entries(houses || {}));
  const H = new Map(); // houseId → state
  const byPeer = new Map();
  for (const [id, h] of houseMap) {
    const st = {
      id, peerId: h.peerId, karts: h.karts.slice(), buffer: createInputBuffer(), lastSnapTick: 0, robo: false,
      fragQueue: [], statusCounts: { 'on-time': 0, repeated: 0, robo: 0 }, inputsIn: 0, bytesIn: 0,
    };
    H.set(id, st);
    byPeer.set(h.peerId, st);
  }
  const log = createEventLog();
  const snapshotter = createSnapshotter({ wire, capture, snapshotEvery });
  const fragmenter = wire.createFragmenter ? wire.createFragmenter() : null;
  let currentTick = 0;
  let lastSentSeq = 0;
  let started = false;
  let paused = false;
  let disposed = false;
  const stats = { ticks: 0, snapshots: 0, eventBatches: 0, frags: 0, pings: 0, badMessages: 0, tickMsMax: 0 };

  const prevOnEvent = race.onEvent;
  race.onEvent = (e) => {
    log.push(currentTick, e);
    if (onEvent) onEvent(e);
  };

  const dropFutureInputs = () => { for (const st of H.values()) st.buffer.dropFuture(); };
  const unsubTb = clock.onTimebase((tb) => {
    if (!started) return;
    if (tb.reason === TIMEBASE_REASON.skip) dropFutureInputs();
    transport.broadcast('ctrl', wire.encodeCtrl(wire.MSG.TIMEBASE, tb));
  });
  const unsubPause = clock.onPause((p) => {
    if (!started) return;
    if (!p.paused && p.reason === PAUSE_REASON.starved) dropFutureInputs();
    transport.broadcast('ctrl', wire.encodeCtrl(wire.MSG.PAUSE, p));
  });

  function kartOf(id) { return race.karts[id]; }

  function setRoboFlag(st, on, tick) {
    if (st.robo === on) return;
    st.robo = on;
    for (const id of st.karts) {
      const k = kartOf(id);
      if (!k) continue;
      k.roboDriven = on;
      log.note(tick, 'robo', id, { on });
    }
  }

  function gatherInputs(tick) {
    const inputs = [];
    const local = localInputs(tick) || [];
    for (let i = 0; i < local.length; i++) if (local[i]) inputs[i] = local[i];
    for (const st of H.values()) {
      const r = st.buffer.take(tick);
      st.statusCounts[r.status]++;
      onInputTaken?.(st.id, tick, r);
      setRoboFlag(st, r.status === 'robo', tick);
      st.karts.forEach((id, seat) => {
        const k = kartOf(id);
        if (!k || k.playerIndex === null || k.playerIndex === undefined) return;
        if (r.status === 'robo') {
          inputs[k.playerIndex] = nativeRobo ? { steer: 0, accel: 0, brake: 0, drift: false, useItem: false, robo: true }
            : aiDriveInput(race, k, 1 / 60);
        } else {
          inputs[k.playerIndex] = r.inputs[seat] || r.inputs[r.inputs.length - 1];
        }
      });
    }
    return inputs;
  }

  function sendSnapshots(tick) {
    const epoch = clock.epoch;
    const state = snapshotter.capture(race, tick);
    for (const st of H.values()) {
      const bytes = snapshotter.encodeFor(state, st.id, {
        epoch, flags: { paused }, lastInputTick: st.buffer.lastConsumed, inputSlack: st.buffer.slack(tick), owner: st.karts,
      });
      if (!bytes) continue;
      const ok = transport.send(st.peerId, 'state', bytes);
      snapshotter.sent(st.id, ok);
      stats.snapshots++;
    }
  }

  function sendEvents() {
    const entries = log.drain();
    for (let i = 0; i < entries.length;) {
      const batch = [entries[i]];
      let j = i + 1;
      while (j < entries.length && batch.length < EVENTS_PER_BATCH && entries[j].tick - batch[0].tick <= 255) batch.push(entries[j++]);
      transport.broadcast('ctrl', wire.encodeEvents(batch));
      stats.eventBatches++;
      lastSentSeq = batch[batch.length - 1].seq;
      i = j;
    }
  }

  function pumpFrags() {
    for (const st of H.values()) {
      if (!st.fragQueue.length) continue;
      const s = transport.stats?.(st.peerId);
      if (s && s.bufferedState > 0) continue;
      transport.send(st.peerId, 'ctrl', st.fragQueue.shift());
      stats.frags++;
    }
  }

  function runTick(tick) {
    currentTick = tick;
    const inputs = gatherInputs(tick);
    tickRace(race, inputs);
    stats.ticks++;
    if (snapshotter.due(tick)) {
      sendSnapshots(tick);
      sendEvents();
    }
    pumpFrags();
  }

  const api = {
    /**
     * Announce the race start: START + the first TIMEBASE (clock started at `nowMs`).
     * @returns {{ raceId, startTick, goTick, epoch }}
     */
    start({ nowMs = now(), goTick, startTick = 1 } = {}) {
      started = true;
      clock.start(nowMs, startTick);
      const msg = { raceId, startTick, goTick, epoch: clock.epoch };
      transport.broadcast('ctrl', wire.encodeCtrl(wire.MSG.START, msg));
      transport.broadcast('ctrl', wire.encodeCtrl(wire.MSG.TIMEBASE, clock.timebase(1)));
      return msg;
    },
    /** Run every due tick. `source` 'raf' (visible) or 'pump' (hidden / stale rAF). */
    frame(nowMs = now(), source = 'raf') {
      if (disposed) return { alpha: 0, ticks: 0 };
      if (!started) api.start({ nowMs });
      const r = clock.advance(nowMs, { source });
      for (let i = 0; i < r.ticks; i++) runTick(r.firstTick + i);
      return { alpha: r.alpha, ticks: r.ticks };
    },
    onMessage(peerId, ch, bytes) {
      const st = byPeer.get(peerId);
      const m = wire.decode(bytes);
      if (!m) { stats.badMessages++; return; }
      if (m.type === wire.MSG.INPUT && st) {
        st.inputsIn++;
        st.bytesIn += bytes.length;
        st.lastSnapTick = Math.max(st.lastSnapTick, m.lastSnapTick);
        for (const t of m.ticks) {
          const res = st.buffer.push(t.tick, t.players);
          onInputPushed?.(st.id, t.tick, res);
        }
      } else if (m.type === wire.MSG.PING) {
        const t = now();
        stats.pings++;
        transport.send(peerId, 'state', wire.encodeCtrl(wire.MSG.PONG, { id: m.id, t0: m.t0, t1: t, t2: t }));
      }
    },
    /** Queue a ctrl message for one peer, split into paced FRAG pieces when > 1 KB during the race. */
    sendCtrl(peerId, bytes) {
      const st = byPeer.get(peerId);
      if (!st || !fragmenter || bytes.length <= (wire.CTRL_FRAGMENT_BYTES || 1024)) return transport.send(peerId, 'ctrl', bytes);
      st.fragQueue.push(...fragmenter.split(bytes));
      return true;
    },
    pauseAll(on, nowMs = now()) {
      if (on && !paused) { paused = true; clock.pause(nowMs); } else if (!on && paused) { paused = false; clock.resume(nowMs); }
    },
    setHouseRobo(houseId, on) {
      const st = H.get(houseId);
      if (!st) return;
      st.buffer.setRobo(on);
    },
    /** Tell the house's buffer a HELLO / RESYNC / reconnect happened (baseline without presses). */
    rebaseline(houseId) { H.get(houseId)?.buffer.rebaseline(); },
    stats() {
      const housesOut = {};
      for (const st of H.values()) {
        housesOut[st.id] = {
          peerId: st.peerId, robo: st.robo, lastConsumed: st.buffer.lastConsumed, statusCounts: { ...st.statusCounts },
          buffer: { ...st.buffer.stats, occupancy: st.buffer.occupancy }, rateHz: snapshotter.rate(st.id).hz,
          lastSnapTick: st.lastSnapTick, fragQueue: st.fragQueue.length, inputsIn: st.inputsIn,
        };
      }
      return {
        ...stats, tick: currentTick, epoch: clock.epoch, paused, lastSeq: log.lastSeq, lastSentSeq, eventLogSize: log.size,
        events: { ...log.stats }, snapshotter: { ...snapshotter.stats }, houses: housesOut,
      };
    },
    get tick() { return currentTick; },
    get eventLog() { return log; },
    dispose() {
      disposed = true;
      race.onEvent = prevOnEvent;
      unsubTb();
      unsubPause();
    },
  };
  return api;
}
