/**
 * Headless ONLINE session (NETWORKING.md §15, WS7): a host house and N guest houses in one node process,
 * each with its own event bus, installed systems, fake audio / HUD and in-memory progress, talking over the
 * seeded in-memory NetTransport hub with network conditions. It uses the real glue the game uses:
 *
 *   WS6 sessions (HELLO → approval with the match check → WELCOME, seat / pick / ready intents,
 *   createHostNetContext().composeSetup → NetRaceSetup) → src/online/netRace.js (SETUP → Race on the host,
 *   ReplicaRace on each guest → LOADED → START, host driver / guest drivers) → race-complete →
 *   HostRaceSummary → RESULT → each machine localizes it and emits ITS OWN race-end (progress, goals, records).
 *
 *   const s = runHeadlessNetSession({ houses: [[1], [2], [1]], conditions: { latencyMs: 75, loss: 0.03 }, seed: 3 });
 *   s.host.results · s.guests[i].results   finish order / places / times (host truth vs what the guest saw)
 *   s.host.localSummary · s.guests[i].localSummary   each machine's own race-end summary
 *   s.machines[i].progress.state            what each machine recorded
 *
 * houses[0] is the HOST house ([n] = n local players on the host machine), the rest are guest houses.
 * Options: mode 'free' (M1) · track · laps 1 · seed · speedClass · conditions (every link) · pauses
 * [{ atMs, ms }] ("Pause everyone", times after the host START) · maxSeconds · guestRobo [{ guest, atMs, ms }]
 * (a guest's local pause: its seats send the robo bit) · systems (default: all).
 */
import * as THREE from 'three';
import { Race, aiDriveInput } from '../../src/race/Race.js';
import { ReplicaRace } from '../../src/net/guest/replicaRace.js';
import { createSessionHelpers } from '../../src/game/session.js';
import { createRaceStats } from '../../src/game/raceStats.js';
import { raceStartInfo } from '../../src/game/summary.js';
import { installSystems, listSystems } from '../../src/systems/index.js';
import { getCharacter } from '../../src/characters/index.js';
import { createHostSession, createHostNetContext } from '../../src/net/session/hostSession.js';
import { createGuestSession } from '../../src/net/session/guestSession.js';
import { matchEmoji } from '../../src/net/session/approval.js';
import { applyRaceSummary, applyGrandPrix, evaluateUnlocks, lineupEntries } from '../../src/progress/engine.js';
import { emptyProgress, mergeProgress, defaultSettings } from '../../src/progress/schema.js';
import { netStack } from '../../src/online/stack.js';
import {
  isSessionBytes, encodeSetup, encodeLoaded, encodeResult, decodeRaceCtrl, raceTiming, raceParticipants, houseKartIds,
  driverHouses, localHumans, allSetupHumans, buildHostRaceSummary, localRaceSummary, createInputLatch, createSeatSampler,
  createHostNetRace, createGuestNetRace, createPendingBytes,
} from '../../src/online/netRace.js';
import { createFakeBus } from './fakeBus.js';
import { createFakeAudio } from './fakeAudio.js';
import { createFakeInput } from './fakeInput.js';
import { createFakeHud } from './headlessSession.js';
import { createMemoryHub } from './netMemoryHub.js';
import { trackFixture, defaultRacerIds, stubKartModel } from './raceHarness.js';

const FRAME_MS = 1000 / 60;
export const NET_SECRET = Object.freeze({ label: 'SPRINKLE-4821', sweets: Object.freeze([3, 14, 15, 9, 26, 53]) });
const NODE_PLATFORM = Object.freeze({ userAgent: 'node', platform: 'Win32', maxTouchPoints: 0 });

/**
 * In-memory progress with the REAL rule engine (recordRace → applyRaceSummary + evaluateUnlocks, update(),
 * records): a whole machine's save that never touches localStorage.
 */
export function createMemoryProgress() {
  let p = emptyProgress();
  const api = {
    get state() { return p; },
    loadProgress: () => p,
    isUnlocked: (id) => p.unlockAll === true || p.unlocked.includes(id),
    update(fn) {
      const draft = mergeProgress(JSON.parse(JSON.stringify(p)));
      const r = fn(draft);
      p = mergeProgress(draft);
      return r;
    },
    evaluate(entries = lineupEntries()) {
      return api.update((d) => { const fresh = evaluateUnlocks(d, entries); for (const u of fresh) d.unlocked.push(u.id); return fresh; });
    },
    recordRace(summary, { entries = lineupEntries(), tallies = null } = {}) {
      api.update((d) => applyRaceSummary(d, summary, { tallies }));
      return api.evaluate(entries);
    },
    recordGrandPrix(gp, { entries = lineupEntries() } = {}) {
      api.update((d) => applyGrandPrix(d, gp));
      return api.evaluate(entries);
    },
    getSettings: () => ({ ...defaultSettings(), ...(p.settings || {}) }),
    getRecord(trackId) {
      const r = p.records?.[trackId];
      return { bestRace: r?.bestRace ?? null, bestLap: r?.bestLap ?? null };
    },
    submitRecord(trackId, { raceTime = null, bestLap = null } = {}) {
      const previous = api.getRecord(trackId);
      const ok = (t) => Number.isFinite(t) && t > 0;
      const newBestRace = ok(raceTime) && (previous.bestRace === null || raceTime < previous.bestRace);
      const newBestLap = ok(bestLap) && (previous.bestLap === null || bestLap < previous.bestLap);
      const record = { bestRace: newBestRace ? raceTime : previous.bestRace, bestLap: newBestLap ? bestLap : previous.bestLap };
      if (newBestRace || newBestLap) p = { ...p, records: { ...(p.records || {}), [trackId]: record } };
      return { newBestRace, newBestLap, previous, record };
    },
  };
  return api;
}

function makeMachine(name, systems) {
  const bus = createFakeBus();
  const app = {
    bus, audio: createFakeAudio({ unlocked: true }), input: createFakeInput(), hud: createFakeHud(), menus: null,
    progress: createMemoryProgress(), params: {}, game: { state: 'menu', errors: [] }, goalToasts: { show() {}, clear() {} },
  };
  const uninstall = installSystems(bus, app, systems);
  return { name, bus, app, uninstall, progress: app.progress, audio: app.audio, hud: app.hud, raceEnds: [] };
}

function raceSession(machine, { race, humans, allHumans, setup, trackDef, laps, path }) {
  const { app } = machine;
  return {
    ...createSessionHelpers({ humans, allHumans, audio: app.audio, input: app.input, hud: app.hud, getCharacter }),
    race, humans, setup, trackDef, laps, path, mode: setup.mode, audio: app.audio, input: app.input, hud: app.hud,
    params: app.params, paused: false, resultsShown: false, outcome: null, online: true,
  };
}

/** Results as a machine saw them: standings order + every kart's finish place / time (ms). */
function resultsFrom(order, finishOf) {
  return { order, karts: order.map((id) => ({ id, ...(finishOf(id) ?? { place: null, finishTimeMs: null, estimated: null }) })) };
}

/**
 * @param {object} [o] see the file header
 */
export function runHeadlessNetSession({
  houses = [[1], [1]], mode = 'free', track = 'gumdrop-meadow', laps = 1, seed = 1, speedClass = 'zippy',
  conditions = {}, pauses = [], guestRobo = [], maxSeconds = null, systems = listSystems(), settleMs = 2500,
} = {}) {
  if (mode !== 'free') throw new Error(`runHeadlessNetSession: mode ${mode} is a later milestone`);
  if (houses.length < 1) throw new Error('runHeadlessNetSession: at least the host house');
  const stack = netStack;
  const { def: trackDef, path } = trackFixture(track);
  const hub = createMemoryHub({ seed });
  let t = 0;
  const now = () => t;
  const advance = (to) => { t = Math.max(t, to); hub.advance(t); };

  // ---------------------------------------------------------------- lobby (WS6 sessions)
  const hostEp = hub.endpoint('host0000host0000', 'host');
  const host = makeMachine('host', systems);
  const hostSession = createHostSession({ transport: hostEp, secret: NET_SECRET, hostPlayers: houses[0][0], now });
  hostSession.dispatch({ type: 'open' });
  hostSession.dispatch({ type: 'opened' });
  const hostNet = createHostNetContext(hostSession, { makeSeed: () => (seed * 2654435761) >>> 0, pickCpus: (n) => defaultRacerIds(8).slice(8 - n) });
  const approvals = [];
  const guests = houses.slice(1).map(([n], gi) => {
    const id = `guest${String(gi + 1).padStart(3, '0')}guest000`.slice(0, 16);
    const ep = hub.endpoint(id, 'guest');
    const machine = makeMachine(`guest${gi + 1}`, systems);
    const session = createGuestSession({ transport: ep, secret: NET_SECRET, localPlayers: n, now, platform: NODE_PLATFORM });
    return { gi, id, ep, machine, session, players: n, race: null, net: null, pending: createPendingBytes(), resultMsg: null, localSummary: null };
  });
  for (const g of guests) {
    hub.setPath('host0000host0000', g.id, conditions);
    g.session.dispatch({ type: 'connect' });
    hub.link('host0000host0000', g.id);
    advance(t + 400);
    const prompt = hostSession.prompt();
    const guestSees = matchEmoji(g.session.state.match);
    approvals.push({ guest: g.gi, promptAnimals: prompt?.animals ?? null, guestAnimals: guestSees, prompt });
    if (!prompt) throw new Error(`guest ${g.gi} never reached the approval prompt`);
    hostSession.dispatch({ type: 'approve', peerId: prompt.peerId, yes: true });
    advance(t + 400);
    if (g.session.state.phase !== 'joined') throw new Error(`guest ${g.gi} not joined (${g.session.state.phase})`);
  }

  // picks: distinct racers, everyone ready (host house via host-intent, guests via intents)
  const racers = defaultRacerIds(8);
  let r = 0;
  for (const p of hostSession.lobby().houses.find((h) => h.isHost).players) {
    hostSession.dispatch({ type: 'host-intent', intent: { kind: 'pick', seat: p.seat, characterId: racers[r++] } });
    hostSession.dispatch({ type: 'host-intent', intent: { kind: 'ready', seat: p.seat } });
  }
  for (const g of guests) {
    for (let seat = 0; seat < g.players; seat++) {
      g.session.dispatch({ type: 'intent', intent: { kind: 'pick', seat, characterId: racers[r++] } });
      g.session.dispatch({ type: 'intent', intent: { kind: 'ready', seat } });
    }
  }
  advance(t + 600);
  hostSession.dispatch({ type: 'tick' });
  advance(t + 400);

  const setup = hostNet.composeSetup({ mode, trackId: trackDef.id, speedClass, laps });
  const timing = raceTiming(stack);
  const hostHouseId = 0;
  const allHumans = allSetupHumans(setup);

  // ---------------------------------------------------------------- guests: SETUP → ReplicaRace → LOADED
  const peerOf = (houseId) => Object.entries(hostSession.state.peers).find(([, p]) => p.stage === 'joined' && p.houseId === houseId)?.[0] ?? null;
  for (const g of guests) {
    g.ep.onMessage((peer, ch, bytes) => {
      if (isSessionBytes(bytes)) return; // the WS6 session wrapper has it
      const rc = decodeRaceCtrl(stack, bytes);
      if (rc?.kind === 'setup') { buildGuestRace(g, rc.setup, peer); return; }
      if (rc?.kind === 'result') { guestResult(g, rc.summary); return; }
      if (g.net) g.net.onBytes(peer, ch, bytes); else g.pending.push(peer, ch, bytes);
    });
  }
  function buildGuestRace(g, s, hostPeer) {
    const houseId = g.session.state.houseId;
    const devices = Array.from({ length: g.players }, (_, i) => `gp${i}`);
    const humans = localHumans(s, houseId, devices);
    const machine = g.machine;
    let session = null;
    const replica = new ReplicaRace({
      scene: new THREE.Scene(), trackDef, path, setup: { ...s, participants: raceParticipants(s), startTick: timing.startTick, goTick: timing.goTick },
      localKartIds: houseKartIds(s, houseId), buildKartModel: stubKartModel(),
      onEvent: (e) => machine.bus.emit(`race:${e.type}`, e, session),
      predictTick: stack.predictTick, quantize: stack.wire.quantizeInput, countdownAfter: timing.countdownAfter,
    });
    session = raceSession(machine, { race: replica, humans, allHumans, setup: s, trackDef, laps: s.laps, path });
    const seats = humans.map((h) => createSeatSampler(h.kartId));
    g.race = replica;
    g.session_ = session;
    g.humans = humans;
    g.seats = seats;
    g.net = createGuestNetRace({ stack, replica, transport: g.ep, hostId: () => hostPeer, localSeats: seats, now });
    machine.app.game.state = 'race';
    machine.bus.emit('race-start', raceStartInfo({ setup: s, trackDef, humans, cpuIds: s.cpuIds, laps: s.laps }), session);
    g.pending.flush((p, c, b) => g.net.onBytes(p, c, b));
    g.ep.send(hostPeer, 'ctrl', encodeLoaded(stack, s.raceId));
  }
  function guestResult(g, summary) {
    g.resultMsg = summary;
    g.localSummary = localRaceSummary(summary, g.humans.map((h) => h.playerIndex), g.humans);
    g.session_.resultsShown = true;
    g.machine.bus.emit('race-end', g.localSummary, g.session_);
    g.machine.raceEnds.push(g.localSummary);
  }

  // ---------------------------------------------------------------- host: SETUP → Race → wait LOADED → START
  hostSession.dispatch({ type: 'phase', phase: 'loading' });
  const hostLocal = localHumans(setup, hostHouseId, Array.from({ length: houses[0][0] }, (_, i) => `gp${i}`));
  const stats = createRaceStats();
  let hostRaceSession = null;
  let completeAt = null;
  const hostEvents = [];
  const race = new Race({
    scene: new THREE.Scene(), trackDef, path, participants: raceParticipants(setup), speedClass: setup.speedClass,
    buildKartModel: stubKartModel(), laps: setup.laps, seed: setup.seed,
    onEvent: (e) => {
      stats.onEvent(e);
      hostEvents.push(e);
      if (e.type === 'race-complete') completeAt = race.clock;
      host.bus.emit(`race:${e.type}`, e, hostRaceSession);
    },
  });
  hostRaceSession = raceSession(host, { race, humans: hostLocal, allHumans, setup, trackDef, laps: setup.laps, path });
  const latch = createInputLatch();
  const hostNetRace = createHostNetRace({
    stack, race, transport: hostEp, setup, houses: driverHouses(setup, hostHouseId, peerOf), localInputs: () => latch.forTick(), now,
  });
  hostEp.onMessage((peer, ch, bytes) => {
    if (isSessionBytes(bytes)) return;
    const rc = decodeRaceCtrl(stack, bytes);
    if (rc?.kind === 'loaded') { hostNetRace.loaded(peer); return; }
    hostNetRace.onBytes(peer, ch, bytes);
  });
  host.app.game.state = 'race';
  host.bus.emit('race-start', raceStartInfo({ setup, trackDef, humans: hostLocal, cpuIds: setup.cpuIds, laps: setup.laps }), hostRaceSession);
  hostEp.broadcast('ctrl', encodeSetup(stack, setup));

  // ---------------------------------------------------------------- the race
  const endLimit = t + (maxSeconds ?? laps * 150 + 90) * 1000;
  let nextHost = t;
  const nextGuest = guests.map((g, i) => t + (i + 1) * 3.7);
  let startedAt = null;
  let hostSummary = null;
  let hostLocalSummary = null;
  const pauseState = pauses.map(() => ({ on: false, off: false }));
  const pauseLog = [];
  const frozen = []; // { t, host: race.clock, guests: predicted ticks } samples while paused
  const timelineErr = guests.map(() => []);
  let resultAt = null;
  while (t < endLimit) {
    const tNext = Math.min(nextHost, ...nextGuest, hub.nextAt);
    advance(tNext);
    if (t >= nextHost) {
      nextHost += FRAME_MS;
      // host locals: an autopilot, sampled once per frame (latched per tick like the real game)
      const inputs = [];
      for (const p of hostLocal) inputs[p.playerIndex] = aiDriveInput(race, race.getPlayerKart(p.playerIndex), 1 / 60);
      latch.setFrame(inputs);
      const fr = hostNetRace.frame(t, 'raf');
      if (fr.started && startedAt === null) startedAt = t;
      if (startedAt !== null) {
        pauses.forEach((p, i) => {
          const st = pauseState[i];
          if (!st.on && t - startedAt >= p.atMs) { st.on = true; hostNetRace.pauseAll(true, t); hostRaceSession.paused = true; pauseLog.push({ on: true, t, tick: hostNetRace.driver.tick }); }
          if (st.on && !st.off && t - startedAt >= p.atMs + p.ms) { st.off = true; hostNetRace.pauseAll(false, t); hostRaceSession.paused = false; pauseLog.push({ on: false, t, tick: hostNetRace.driver.tick }); }
        });
        if (hostNetRace.paused) frozen.push({ t, host: race.clock, hostTick: hostNetRace.driver.tick, guests: guests.map((g) => g.race?.predictedTick ?? null) });
      }
      host.bus.emit('race-frame', FRAME_MS / 1000, hostRaceSession);
      if (completeAt !== null && !hostSummary && race.clock - completeAt >= 1.2) {
        hostSummary = buildHostRaceSummary({ setup, trackDef, standings: race.getStandings(), stats, laps: setup.laps, raceTime: race.time, local: hostLocal });
        hostSession.dispatch({ type: 'phase', phase: 'results' });
        for (const g of guests) hostEp.send(peerOf(g.session.state.houseId), 'ctrl', encodeResult(stack, setup.raceId, hostSummary));
        hostLocalSummary = localRaceSummary(hostSummary, hostLocal.map((p) => p.playerIndex), hostLocal);
        hostRaceSession.resultsShown = true;
        host.bus.emit('race-end', hostLocalSummary, hostRaceSession);
        host.raceEnds.push(hostLocalSummary);
        resultAt = t;
      }
    }
    guests.forEach((g, i) => {
      if (t < nextGuest[i]) return;
      nextGuest[i] += FRAME_MS;
      if (!g.net) return;
      const robo = guestRobo.some((w) => w.guest === i && startedAt !== null && t - startedAt >= w.atMs && t - startedAt < w.atMs + w.ms);
      g.seats.forEach((seat, k) => {
        const kart = g.race.karts[seat.kartId];
        seat.setFrame(aiDriveInput(g.race, kart, 1 / 60), { robo });
        void k;
      });
      const fr = g.net.frame(FRAME_MS / 1000);
      if (fr.T !== undefined && startedAt !== null && !hostNetRace.paused) {
        const s = hostNetRace.clock.state();
        const truth = s.anchorTick + ((t - s.anchorMs) * 60) / 1000;
        timelineErr[i].push({ t, err: fr.T - truth });
      }
      g.machine.bus.emit('race-frame', FRAME_MS / 1000, g.session_);
    });
    if (resultAt !== null && guests.every((g) => g.localSummary) && t >= resultAt + settleMs) break;
  }

  // ---------------------------------------------------------------- results
  const msOf = (sec) => (Number.isFinite(sec) ? Math.max(0, Math.round(sec * 1000)) : null);
  const hostResults = resultsFrom(race.getStandings().map((k) => k.id), (id) => {
    const k = race.karts[id];
    return k.finished ? { place: k.finishPlace, finishTimeMs: msOf(k.finishTime), estimated: !!k.finishEstimated } : null;
  });
  const out = {
    setup,
    approvals,
    hostSummary,
    pauseLog,
    frozen,
    startedAt,
    t,
    host: {
      machine: host, race, net: hostNetRace, session: hostSession, raceSession: hostRaceSession, humans: hostLocal,
      results: hostResults, localSummary: hostLocalSummary, events: hostEvents,
    },
    guests: guests.map((g, i) => ({
      machine: g.machine, replica: g.race, net: g.net, session: g.session, raceSession: g.session_, humans: g.humans,
      resultMsg: g.resultMsg, localSummary: g.localSummary, timelineErr: timelineErr[i],
      results: g.race ? resultsFrom(g.race.getStandings().map((k) => k.id), (id) => g.race.finishes.get(id) ?? null) : null,
    })),
    machines: [host, ...guests.map((g) => g.machine)],
    errors: [host, ...guests.map((g) => g.machine)].flatMap((m) => m.bus.errors.map((e) => `${m.name}: ${e.name}: ${e.err?.stack || e.err}`)),
  };
  race.dispose();
  for (const g of guests) g.race?.dispose();
  for (const m of out.machines) m.uninstall();
  hostNetRace.dispose();
  return out;
}
