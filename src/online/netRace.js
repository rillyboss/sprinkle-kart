/**
 * Online race glue (NETWORKING.md §9, §10.5, §10.6, §12): the small pieces main.js's `startRace({ net })`
 * and the headless net session (tests/helpers/headlessSession.js `runHeadlessNetSession`) both use to put
 * the WS5 netcode on top of a real Race (host) or ReplicaRace (guests). No logic of its own beyond wiring:
 *
 *   SETUP → every machine builds the race → LOADED → host START (+ TIMEBASE) → ticks / snapshots / events
 *   → race-complete → host HostRaceSummary → RESULT → every machine localizes it and emits its own race-end
 *
 * Bytes on one transport: session messages (WS6, JSON starting with '{') and netcode messages (WS2 wire,
 * first byte = a message type < 0x40) never collide, so one router sends each to its owner.
 *
 * OWNER: WS7 (online game integration).
 */
import { createHostClock } from '../net/host/hostClock.js';
import { createHostDriver } from '../net/host/hostDriver.js';
import { createGuestDriver } from '../net/guest/guestDriver.js';
import { createHostTimeline } from '../net/guest/hostTimeline.js';
import { localizeSummary } from '../net/session/localize.js';
import { buildRaceSummary } from '../game/summary.js';
import { COUNTDOWN_SECONDS } from './stack.js';

/** First byte of a WS6 session message (UTF-8 JSON object). */
export const SESSION_FIRST_BYTE = 0x7b;
/** Host waits this long for every house's LOADED before starting anyway (§10.6). */
export const LOAD_TIMEOUT_MS = 20_000;
/** Host shows results this long after race-complete (same as offline). */
export const RESULTS_DELAY_S = 2.6;

/** Is this a WS6 session message (JSON) rather than a netcode message? */
export const isSessionBytes = (bytes) => bytes instanceof Uint8Array && bytes.length > 0 && bytes[0] === SESSION_FIRST_BYTE;

/* ------------------------------------------------------------------ race-level ctrl (WS7-owned) */

/** SETUP (host → all; §10.5): the NetRaceSetup, sent only between races. */
export function encodeSetup(stack, setup) {
  return stack.wire.encodeCtrl(stack.wire.MSG.SETUP, setup);
}
/** LOADED (guest → host; §6.2 0x2A, binary `raceId u32`, 5 B). */
export function encodeLoaded(stack, raceId) {
  const out = new Uint8Array(5);
  out[0] = stack.wire.MSG.LOADED;
  new DataView(out.buffer).setUint32(1, raceId >>> 0, true);
  return out;
}
/** RESULT (host → all; §12): the HostRaceSummary. */
export function encodeResult(stack, raceId, summary) {
  return stack.wire.encodeCtrl(stack.wire.MSG.RESULT, { raceId: raceId >>> 0, summary });
}

/**
 * Decode a netcode message this glue handles itself (SETUP / LOADED / RESULT), else null.
 * @returns {{ kind: 'setup'|'loaded'|'result', raceId?: number, setup?: object, summary?: object } | null}
 */
export function decodeRaceCtrl(stack, bytes) {
  if (!(bytes instanceof Uint8Array) || isSessionBytes(bytes)) return null;
  const M = stack.wire.MSG;
  if (bytes[0] === M.LOADED) {
    return bytes.length === 5 ? { kind: 'loaded', raceId: new DataView(bytes.buffer, bytes.byteOffset, 5).getUint32(1, true) } : null;
  }
  if (bytes[0] !== M.SETUP && bytes[0] !== M.RESULT) return null;
  const m = stack.wire.decode(bytes);
  if (!m) return null;
  if (m.type === M.SETUP && Array.isArray(m.participants)) {
    const { type, ...setup } = m; // eslint-disable-line no-unused-vars
    return { kind: 'setup', setup };
  }
  if (m.type === M.RESULT && m.summary && typeof m.summary === 'object') return { kind: 'result', raceId: m.raceId | 0, summary: m.summary };
  return null;
}

/* ------------------------------------------------------------------ setup helpers */

/** Countdown / start ticks shared by the host (Race) and the guests (ReplicaRace). */
export function raceTiming(stack) {
  const cd = stack.makeCountdown(COUNTDOWN_SECONDS);
  const startTick = 1;
  return { startTick, goTick: startTick + cd.goTick - 1, countdownAfter: cd.after };
}

/** Race participants (kart order = kart id) from a NetRaceSetup. */
export function raceParticipants(setup) {
  return (setup?.participants ?? []).map((p) => ({
    characterId: p.characterId,
    playerIndex: p.playerIndex ?? null,
    easyDrive: !!p.easyDrive,
    paintId: p.paintId ?? 'original',
    gridSlot: Number.isInteger(p.gridSlot) ? p.gridSlot : undefined,
    houseId: p.houseId ?? null,
    seat: p.seat ?? null,
  }));
}

/** Kart ids of one house in seat order. */
export function houseKartIds(setup, houseId) {
  return (setup?.participants ?? [])
    .map((p, kartId) => ({ ...p, kartId }))
    .filter((p) => p.houseId === houseId && p.playerIndex !== null && p.playerIndex !== undefined)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => p.kartId);
}

/** Every house id with players in the setup. */
export function setupHouses(setup) {
  return [...new Set((setup?.participants ?? []).filter((p) => p.houseId !== null && p.houseId !== undefined).map((p) => p.houseId))].sort((a, b) => a - b);
}

/**
 * Host driver houses: every GUEST house in the setup → { peerId, karts }.
 * @param {object} setup NetRaceSetup
 * @param {number} hostHouseId
 * @param {(houseId: number) => string|null} peerOf  the house's current peer id (null = gone)
 */
export function driverHouses(setup, hostHouseId, peerOf) {
  const out = new Map();
  for (const houseId of setupHouses(setup)) {
    if (houseId === hostHouseId) continue;
    out.set(houseId, { peerId: peerOf(houseId) ?? `gone-${houseId}`, karts: houseKartIds(setup, houseId) });
  }
  return out;
}

/**
 * This machine's players for split screen: the setup's players of `houseId` (global player indices) in seat
 * order, each on the local device of the same seat (the n-th joined local player).
 * @param {object} setup
 * @param {number} houseId
 * @param {string[]} deviceIds local devices in seat order
 */
export function localHumans(setup, houseId, deviceIds = []) {
  return (setup?.participants ?? [])
    .map((p, kartId) => ({ ...p, kartId }))
    .filter((p) => p.houseId === houseId && p.playerIndex !== null && p.playerIndex !== undefined)
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      playerIndex: p.playerIndex, deviceId: deviceIds[p.seat] ?? deviceIds[0] ?? null, characterId: p.characterId,
      easyDrive: !!p.easyDrive, seat: p.seat, kartId: p.kartId, paintId: p.paintId ?? 'original',
    }));
}

/** Every human of the setup as RaceSummary players (remote ones have no device here). */
export function allSetupHumans(setup, local = []) {
  const dev = new Map(local.map((p) => [p.playerIndex, p.deviceId]));
  return (setup?.participants ?? [])
    .filter((p) => p.playerIndex !== null && p.playerIndex !== undefined)
    .sort((a, b) => a.playerIndex - b.playerIndex)
    .map((p) => ({ playerIndex: p.playerIndex, deviceId: dev.get(p.playerIndex) ?? null, characterId: p.characterId, easyDrive: !!p.easyDrive }));
}

/**
 * The host's HostRaceSummary (§12): the normal RaceSummary with EVERY human of the room (keyed by global
 * player index, stats from the host's own createRaceStats tally) + `online: true` + `raceId`.
 */
export function buildHostRaceSummary({ setup, trackDef, standings, stats, laps, raceTime, local = [] }) {
  const s = buildRaceSummary({
    setup: { mode: setup.mode, speedClass: setup.speedClass, cupId: setup.cupId },
    trackDef, humans: allSetupHumans(setup, local), standings, stats, laps, raceTime,
  });
  for (const h of s.humans) h.deviceId = null; // devices are each machine's own business
  return { ...s, online: true, raceId: setup.raceId >>> 0 };
}

/**
 * A HostRaceSummary (§12) → this machine's race-end summary (local rows only, winner local or null,
 * humanCount = all humans so multiplayerRaces counts). Thin alias so every caller uses the same call.
 */
export function localRaceSummary(hostSummary, localPis, local = []) {
  const out = localizeSummary(hostSummary, localPis);
  const dev = new Map(local.map((p) => [p.playerIndex, p.deviceId]));
  for (const h of out.humans) h.deviceId = dev.get(h.playerIndex) ?? null;
  return out;
}

/* ------------------------------------------------------------------ inputs */

/**
 * Host local players: the rAF frame's DriveInputs (by global playerIndex) are used for every tick of that
 * frame; a `useItem` edge is latched until one tick consumes it (0 ticks in a frame never loses it, 2 ticks
 * never use it twice).
 */
export function createInputLatch() {
  let frame = [];
  const pending = new Set();
  return {
    setFrame(inputs = []) {
      frame = inputs;
      inputs.forEach((x, pi) => { if (x?.useItem) pending.add(pi); });
    },
    forTick() {
      const out = [];
      frame.forEach((x, pi) => { if (x) out[pi] = { ...x, useItem: pending.has(pi) }; });
      pending.clear();
      return out;
    },
    get pending() { return pending.size; },
  };
}

/**
 * One guest seat: DriveInput per frame → the wire PlayerTickInput per predicted tick (§9.2): analog + held
 * drift, plus the item / hop press counters (mod 8) that make redundancy safe. `robo` (paused locally,
 * controller asleep) asks the host's Robo Driver to take the wheel.
 */
export function createSeatSampler(kartId) {
  let input = null;
  let robo = false;
  let itemCount = 0;
  let hopCount = 0;
  let itemPending = false;
  let lastDrift = false;
  return {
    kartId,
    /** This frame's DriveInput (or null) and whether Robo Driver should drive. */
    setFrame(driveInput, { robo: r = false } = {}) {
      input = driveInput || null;
      robo = !!r;
      if (input?.useItem && !robo) itemPending = true;
    },
    sample() {
      const x = robo ? null : input;
      const drift = !!x?.drift;
      if (drift && !lastDrift) hopCount = (hopCount + 1) & 7;
      lastDrift = drift;
      if (itemPending) { itemCount = (itemCount + 1) & 7; itemPending = false; }
      return {
        steer: x?.steer || 0, accel: x?.accel || 0, brake: x?.brake || 0, drift, lookBack: !!x?.lookBack,
        robo, assisted: false, itemCount, hopCount,
      };
    },
    get counts() { return { item: itemCount, hop: hopCount }; },
  };
}

/* ------------------------------------------------------------------ host */

/**
 * The host side of one online race.
 * @param {object} o
 * @param {object} o.stack         netStack (./stack.js)
 * @param {object} o.race          the authoritative Race (its onEvent = the host's presentation handler)
 * @param {object} o.transport     NetTransport (host)
 * @param {object} o.setup         NetRaceSetup
 * @param {Map} o.houses           driverHouses(...)
 * @param {(tick: number) => object[]} o.localInputs  host locals' DriveInputs by playerIndex for a tick
 * @param {() => number} [o.now]
 * @param {number} [o.loadTimeoutMs]
 */
export function createHostNetRace({ stack, race, transport, setup, houses, localInputs, now = () => performance.now(), loadTimeoutMs = LOAD_TIMEOUT_MS }) {
  const timing = raceTiming(stack);
  const clock = createHostClock({ now });
  const driver = createHostDriver({
    race, transport, houses, localInputs, clock, wire: stack.wire, capture: stack.capture, tickRace: stack.tickRace, now,
    raceId: setup.raceId >>> 0, onEvent: race.onEvent,
  });
  const waiting = new Set([...houses.values()].map((h) => h.peerId).filter((p) => !String(p).startsWith('gone-')));
  const createdAt = now();
  let started = false;
  let paused = false;
  let lastAlpha = 0;
  const api = {
    driver,
    clock,
    timing,
    get started() { return started; },
    get paused() { return paused; },
    get waitingFor() { return [...waiting]; },
    /** A guest house finished building the race (or left: it no longer holds the start). */
    loaded(peerId) { waiting.delete(peerId); },
    /** Netcode bytes from a guest (INPUT, PING). */
    onBytes(peerId, ch, bytes) { if (!isSessionBytes(bytes)) driver.onMessage(peerId, ch, bytes); },
    /** Run every due tick ('raf' when visible, 'pump' when hidden). Starts once every house has loaded. */
    frame(nowMs = now(), source = 'raf') {
      if (!started) {
        if (waiting.size && nowMs - createdAt < loadTimeoutMs) return { alpha: 0, ticks: 0, started: false };
        started = true;
        driver.start({ nowMs, goTick: timing.goTick, startTick: timing.startTick });
      }
      const r = driver.frame(nowMs, source);
      lastAlpha = r.alpha;
      return { ...r, started: true };
    },
    /** "Pause everyone 🍪" (§10.4): PAUSE + TIMEBASE; resume re-anchors on a new epoch. */
    pauseAll(on, nowMs = now()) {
      if (!started) return false;
      paused = !!on;
      driver.pauseAll(paused, nowMs);
      return true;
    },
    setHouseRobo(houseId, on) { driver.setHouseRobo(houseId, on); },
    /**
     * A house came back on a new connection (§13.2): snapshots, events and inputs follow the new peer, it
     * gets START + the current TIMEBASE again, Robo Driver hands the karts back and the input baseline resets.
     */
    reattach(houseId, peerId) {
      waiting.delete(driver.housePeer(houseId));
      if (!driver.setHousePeer(houseId, peerId)) return false;
      driver.rebaseline(houseId);
      driver.setHouseRobo(houseId, false);
      if (started) driver.sendStartTo(peerId);
      return true;
    },
    /** A queued ctrl message for one peer (FRAG-paced while racing). */
    sendCtrl(peerId, bytes) { return driver.sendCtrl(peerId, bytes); },
    get alpha() { return lastAlpha; },
    stats() { return driver.stats(); },
    dispose() { driver.dispose(); },
  };
  return api;
}

/* ------------------------------------------------------------------ guest */

/**
 * The guest side of one online race.
 * @param {object} o
 * @param {object} o.stack
 * @param {object} o.replica       ReplicaRace
 * @param {object} o.transport     NetTransport (guest)
 * @param {() => string} o.hostId
 * @param {Array<{ kartId: number, sample: (tick: number) => object }>} o.localSeats
 * @param {() => number} [o.now]
 * @param {(m: object) => void} [o.onCtrl]
 */
export function createGuestNetRace({ stack, replica, transport, hostId, localSeats, now = () => performance.now(), onCtrl = null }) {
  const clockSync = stack.createClockSync({ now });
  const timeline = createHostTimeline({ clock: clockSync });
  const driver = createGuestDriver({ replica, transport, clock: clockSync, timeline, localSeats, wire: stack.wire, hostId, now, onCtrl });
  return {
    driver,
    timeline,
    clock: clockSync,
    onBytes(peerId, ch, bytes) { if (!isSessionBytes(bytes)) driver.onMessage(peerId, ch, bytes); },
    frame(dt) { return driver.frame(dt); },
    get paused() { return !!timeline.paused; },
    stats() { return driver.stats(); },
    dispose() { /* the replica is disposed by its owner */ },
  };
}

/**
 * Buffers netcode bytes for a guest between SETUP and the moment its race exists (a straggler whose START
 * arrives before it finished loading must not lose it), then replays them in order.
 */
export function createPendingBytes(limit = 512) {
  const q = [];
  return {
    push(peerId, ch, bytes) { if (q.length < limit) q.push([peerId, ch, bytes]); },
    flush(fn) { const all = q.splice(0); for (const [p, c, b] of all) fn(p, c, b); return all.length; },
    clear() { q.length = 0; },
    get size() { return q.length; },
  };
}
