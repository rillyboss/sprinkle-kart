/**
 * Headless game session: a real Race on a registered track, wired to the event bus
 * exactly like src/main.js does it (race-start → race:<type> for every Race event →
 * race-frame every frame → race-end with a real RaceSummary → race-exit), with the
 * real systems from src/systems/ installed on fakes (audio, input, hud).
 *
 *   const s = runHeadlessSession('gumdrop-meadow', { humans: 2, laps: 1 });
 *   s.bus.countOf('race:lap'); s.audio.played('go'); s.summary.humans[0].place; s.errors  // [] = no handler threw
 *
 *   // or wire only what you need
 *   const app = createFakeApp();                         // { bus, audio, input, hud, progress, params, game }
 *   installSystems(app.bus, app, [mySystem]);
 *   const session = fakeSession(app, { humans: 1 });      // session helpers + a stub race
 *   app.bus.emit('race:finish', { type: 'finish', kart, place: 1 }, session);
 *
 * Options: humans (autodriven, default 1) · laps 1 · seed 1 · speedClass 'zippy' · dt 1/30 ·
 * systems (default: every auto-registered system) · mode 'free' · characters · easyDrive ·
 * progress (default: an in-memory fake, so the real save is never touched) · maxSeconds.
 */
import { Race, aiDriveInput } from '../../src/race/Race.js';
import { TUNING } from '../../src/race/tuning.js';
import { createSessionHelpers } from '../../src/game/session.js';
import { createRaceStats } from '../../src/game/raceStats.js';
import { raceStartInfo, buildRaceSummary } from '../../src/game/summary.js';
import { installSystems, listSystems } from '../../src/systems/index.js';
import { getCharacter } from '../../src/characters/index.js';
import * as THREE from 'three';
import { createFakeBus } from './fakeBus.js';
import { createFakeAudio } from './fakeAudio.js';
import { createFakeInput } from './fakeInput.js';
import { trackFixture, defaultRacerIds, stubKartModel, kartProblems } from './raceHarness.js';

// Online (WS7): a host + guest houses over the in-memory transport, each with its own bus / systems / progress.
export { runHeadlessNetSession, createMemoryProgress, NET_CODE } from './headlessNetSession.js';

/** A HUD stand-in recording flashes and hosting widgets (create() gets fake nodes). */
export function createFakeHud() {
  const widgets = [];
  const hud = {
    flashes: [],
    widgets,
    shown: false,
    flash(playerIndex, text) { hud.flashes.push({ playerIndex, text }); },
    addWidget(def) { widgets.push(def); return () => { const i = widgets.indexOf(def); if (i >= 0) widgets.splice(i, 1); }; },
    layout() {}, update() {}, show() { hud.shown = true; }, hide() { hud.shown = false; }, reset() { hud.flashes.length = 0; }, dispose() {},
  };
  return hud;
}

/** In-memory progress with the progress.js API surface systems use (never touches the real save). */
export function createFakeProgress() {
  const state = { unlocked: new Set(), wins: 0, trophies: {}, records: {} };
  return {
    state,
    isUnlocked: (id) => state.unlocked.has(id),
    unlock(id) { if (state.unlocked.has(id)) return false; state.unlocked.add(id); return true; },
    recordWin(trackId) { state.wins++; state.trophies[trackId] = (state.trophies[trackId] || 0) + 1; },
    getRecord: (trackId) => state.records[trackId] ?? { bestRace: null, bestLap: null },
    submitRecord(trackId, { raceTime, bestLap } = {}) {
      const prev = state.records[trackId] ?? { bestRace: null, bestLap: null };
      const better = (t, old) => Number.isFinite(t) && t > 0 && (old === null || t < old);
      const record = { bestRace: better(raceTime, prev.bestRace) ? raceTime : prev.bestRace, bestLap: better(bestLap, prev.bestLap) ? bestLap : prev.bestLap };
      state.records[trackId] = record;
      return { newBestRace: record.bestRace !== prev.bestRace, newBestLap: record.bestLap !== prev.bestLap, previous: prev, record };
    },
    loadProgress: () => state,
    resetProgress() { state.unlocked.clear(); state.wins = 0; state.trophies = {}; state.records = {}; },
  };
}

/** `app` object like main.js hands to systems (all fakes). */
export function createFakeApp(overrides = {}) {
  const bus = overrides.bus ?? createFakeBus();
  return {
    bus,
    audio: createFakeAudio({ unlocked: true }),
    input: createFakeInput(),
    hud: createFakeHud(),
    menus: null,
    progress: createFakeProgress(),
    params: {},
    game: { state: 'race', errors: [] },
    ...overrides,
  };
}

/** Session object (the 2nd argument of race events) for hand-fired events. */
export function fakeSession(app, { humans = 1, race = { lapsTotal: 3, karts: [], getPlayerKart: () => null } } = {}) {
  const players = Array.from({ length: humans }, (_, i) => ({ playerIndex: i, deviceId: `gp${i}`, characterId: defaultRacerIds(humans)[i], easyDrive: false }));
  return {
    ...createSessionHelpers({ humans: players, audio: app.audio, input: app.input, hud: app.hud, getCharacter }),
    race, humans: players, playerIndices: players.map((p) => p.playerIndex),
    audio: app.audio, input: app.input, hud: app.hud, params: app.params,
    mode: 'free', paused: false, resultsShown: false, outcome: null,
  };
}

/** Run a whole race through the bus + systems. See the file header. */
export function runHeadlessSession(trackId, opts = {}) {
  const {
    humans = 1, laps = 1, seed = 1, speedClass = 'zippy', dt = 1 / 30, mode = 'free', easyDrive = false,
    characters = defaultRacerIds(8), systems = listSystems(), maxSeconds = laps * 150 + 90,
  } = opts;
  const app = createFakeApp(opts.progress ? { progress: opts.progress } : {});
  const { bus } = app;
  const uninstall = installSystems(bus, app, systems);
  const { def: trackDef, path } = trackFixture(trackId);
  const players = characters.slice(0, humans).map((characterId, i) => ({ playerIndex: i, deviceId: `gp${i}`, characterId, easyDrive }));
  const setup = { players, trackId, speedClass, laps, mode };
  const participants = characters.map((characterId, i) => ({ characterId, playerIndex: i < humans ? i : null, easyDrive: i < humans && easyDrive }));
  const stats = createRaceStats();
  let session = null;
  let completeAt = null;
  const onEvent = (e) => {
    stats.onEvent(e);
    if (e.type === 'race-complete') completeAt = race.clock;
    bus.emit(`race:${e.type}`, e, session);
  };
  const race = new Race({ scene: new THREE.Scene(), trackDef, path, builtTrack: null, participants, speedClass, buildKartModel: stubKartModel(), onEvent, laps, seed });
  session = {
    ...createSessionHelpers({ humans: players, audio: app.audio, input: app.input, hud: app.hud, getCharacter }),
    race, humans: players, playerIndices: players.map((p) => p.playerIndex), setup, trackDef, laps, stats, path,
    mode, audio: app.audio, input: app.input, hud: app.hud, params: app.params, paused: false, resultsShown: false, outcome: null,
  };
  bus.emit('race-start', raceStartInfo({ setup, trackDef, humans: players, cpuIds: characters.slice(humans), laps }), session);
  const problems = [];
  let t = 0;
  let frames = 0;
  while (t < maxSeconds && !(completeAt !== null && race.clock - completeAt >= 1.2)) {
    const inputs = [];
    for (const p of players) {
      const k = race.getPlayerKart(p.playerIndex);
      inputs[p.playerIndex] = aiDriveInput(race, k, race.lastDt);
    }
    race.update(dt, inputs);
    bus.emit('race-frame', dt, session);
    bus.emit('frame', dt, app.game);
    t += Math.min(dt, TUNING.maxFrameDt);
    frames++;
    if (problems.length < 10) for (const k of race.karts) problems.push(...kartProblems(k, path));
  }
  const summary = race.state === 'finished'
    ? buildRaceSummary({ setup, trackDef, humans: players, standings: race.getStandings(), stats, laps, raceTime: race.time })
    : null;
  if (summary) {
    session.resultsShown = true;
    bus.emit('race-end', summary, session);
    bus.emit('results-choice', { choice: 'menu' }, session);
  }
  session.outcome = 'menu';
  bus.emit('race-exit', { outcome: 'menu' }, session);
  race.dispose();
  uninstall();
  return { app, bus, audio: app.audio, input: app.input, hud: app.hud, progress: app.progress, race, session, summary, frames, problems, errors: bus.errors };
}
