/**
 * Headless race harness: run a full CPU (or autodriven "human") race on ANY registered
 * track in a fraction of a second, with physics invariants checked every frame.
 *
 *   import { runCpuRace, trackFixture, kartProblems } from './helpers/raceHarness.js';
 *
 *   const r = runCpuRace('bubblegum-bay', { laps: 1, seed: 3 });
 *   expect(r.finished).toBe(true);
 *   expect(r.problems).toEqual([]);                 // no NaN, nobody through the soft walls
 *   r.standings[0].characterId; r.raceTime; r.eventCounts.lap; r.events
 *
 * Options (all optional):
 *   laps 1 · speedClass 'zippy' · seed 1 · dt 1/30 (the Race sub-steps physics at 1/120 anyway)
 *   characters: ids for the 8 racers (default: the first 8 registered racers)
 *   humans: 0..4 of them driven by the CPU brain through the human input path (like ?autodrive=1)
 *   easyDrive: Kid-Assist for those humans · builtTrack: 'none' (default, Race fallbacks) | 'real' (buildTrack)
 *   maxSeconds (race-clock cap, default laps * 150 + 90) · onFrame(race, frame) · checkEvery (frames, default 1)
 *   dtJitter: [min, max] random dt range per frame (dt spikes are clamped by Race like the game loop)
 *   inputs(race, frame): custom DriveInput[] by playerIndex (overrides the autodrive humans)
 *   keep: true to skip race.dispose() (inspect the scene/models afterwards; dispose yourself)
 *
 * The TrackPath of each track is cached (building it is the slow part), so looping over
 * every registered track stays fast.
 */
import * as THREE from 'three';
import { Race, aiDriveInput, makeRng } from '../../src/race/Race.js';
import { TUNING } from '../../src/race/tuning.js';
import { TRACKS, findTrack } from '../../src/tracks/index.js';
import { CHARACTERS } from '../../src/characters/index.js';
import { TrackPath } from '../../src/track/TrackPath.js';
import { buildTrack } from '../../src/render/trackBuilder.js';

const pathCache = new Map();

/** Stub kart model (no geometry): the Race only needs group/update/dispose. */
export function stubKartModel() {
  const models = [];
  const fn = (def) => {
    const m = { group: new THREE.Group(), characterId: def?.id, updates: 0, disposed: false, update() { m.updates++; }, dispose() { m.disposed = true; } };
    models.push(m);
    return m;
  };
  fn.models = models;
  return fn;
}

/** `{ def, path }` for a registered track id (or a TrackDef). The path is cached per id. */
export function trackFixture(trackOrId) {
  const def = typeof trackOrId === 'string' ? findTrack(trackOrId) : trackOrId;
  if (!def) throw new Error(`raceHarness: no registered track "${trackOrId}" (have: ${TRACKS.map((t) => t.id).join(', ')})`);
  let path = pathCache.get(def.id);
  if (!path || path.__def !== def) {
    path = new TrackPath(def.controlPoints, def.width);
    path.__def = def;
    pathCache.set(def.id, path);
  }
  return { def, path };
}

/** How far from the centre line a kart may ever be: the soft wall + its hard limit. */
export function wallLimit(path) {
  return path.halfWidth + TUNING.wallMargin - TUNING.kartHalfWidth + TUNING.wallHardExtra;
}

const finite3 = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * Physics invariants for one kart; returns human-readable problems ([] = healthy).
 * @param {object} kart KartState
 * @param {TrackPath} path
 * @param {{ slack?: number }} [opts] extra lateral tolerance (default 0.05)
 */
export function kartProblems(kart, path, { slack = 0.05 } = {}) {
  const out = [];
  const who = kart.characterId ?? kart.id;
  if (!finite3(kart.position)) out.push(`${who}: position is not finite (${kart.position.x}, ${kart.position.y}, ${kart.position.z})`);
  if (!finite3(kart.velocity)) out.push(`${who}: velocity is not finite`);
  for (const key of ['heading', 'speed', 's', 'lateral', 'progress']) {
    if (key in kart && !Number.isFinite(kart[key])) out.push(`${who}: ${key} is not finite (${kart[key]})`);
  }
  if (Number.isFinite(kart.s) && (kart.s < 0 || kart.s >= path.length + 1e-6)) out.push(`${who}: s ${kart.s} outside [0, ${path.length})`);
  const lim = wallLimit(path) + slack;
  if (Math.abs(kart.lateral) > lim) out.push(`${who}: lateral ${kart.lateral.toFixed(2)} beyond the soft wall (±${lim.toFixed(2)})`);
  if (Number.isFinite(kart.heading) && Math.abs(kart.heading) > Math.PI + 1e-6) out.push(`${who}: heading ${kart.heading} not wrapped`);
  const maxSane = (kart.stats?.maxSpeed ?? 40) * 3;
  if (Math.abs(kart.speed) > maxSane) out.push(`${who}: speed ${kart.speed.toFixed(1)} is silly fast (> ${maxSane.toFixed(0)})`);
  return out;
}

/** Default racers: the first 8 registered (every racer can be a CPU in the harness). */
export function defaultRacerIds(n = 8) {
  const ids = CHARACTERS.map((c) => c.id);
  const out = [];
  for (let i = 0; i < n; i++) out.push(ids[i % ids.length]);
  return out;
}

/** Run a whole race headlessly. See the file header for options. */
export function runCpuRace(trackOrId, opts = {}) {
  const {
    laps = 1, speedClass = 'zippy', seed = 1, dt = 1 / 30, characters = defaultRacerIds(8),
    humans = 0, easyDrive = false, builtTrack = 'none', onFrame = null, checkEvery = 1,
    dtJitter = null, inputs = null, keep = false, scene = new THREE.Scene(), buildKartModel = stubKartModel(),
  } = opts;
  const { def, path } = trackFixture(trackOrId);
  const built = builtTrack === 'real' ? buildTrack(def, path) : null;
  const participants = characters.map((characterId, i) => ({
    characterId, playerIndex: i < humans ? i : null, easyDrive: i < humans && easyDrive,
  }));
  const events = [];
  const eventCounts = {};
  const race = new Race({
    scene, trackDef: def, path, builtTrack: built, participants, speedClass, buildKartModel,
    laps, seed, onEvent: (e) => { events.push(e); eventCounts[e.type] = (eventCounts[e.type] || 0) + 1; },
  });
  const rng = makeRng(seed * 7717 + 13);
  const maxSeconds = opts.maxSeconds ?? laps * 150 + 90;
  const problems = [];
  let worstLateral = 0;
  let frames = 0;
  let wall = 0;
  const humanKarts = race.karts.filter((k) => !k.isCPU);
  while (race.state !== 'finished' && wall < maxSeconds) {
    const step = dtJitter ? dtJitter[0] + rng() * (dtJitter[1] - dtJitter[0]) : dt;
    let frameInputs = [];
    if (inputs) frameInputs = inputs(race, frames) || [];
    else for (const k of humanKarts) frameInputs[k.playerIndex] = aiDriveInput(race, k, race.lastDt);
    race.update(step, frameInputs);
    wall += Math.min(step, TUNING.maxFrameDt);
    frames++;
    if (frames % checkEvery === 0) {
      for (const k of race.karts) {
        worstLateral = Math.max(worstLateral, Math.abs(k.lateral));
        if (problems.length < 20) problems.push(...kartProblems(k, path).map((p) => `t=${race.time.toFixed(2)} ${p}`));
      }
    }
    onFrame?.(race, frames);
  }
  const result = {
    race, def, path, built, frames, events, eventCounts, problems, worstLateral,
    finished: race.state === 'finished',
    raceTime: race.time,
    standings: race.getStandings().map((k) => ({
      characterId: k.characterId, playerIndex: k.playerIndex, isCPU: k.isCPU, place: k.finishPlace ?? k.place,
      finishTime: k.finishTime, estimated: !!k.finishEstimated, lapTimes: [...k.lapTimes],
    })),
    models: buildKartModel.models ?? null,
  };
  if (!keep) {
    race.dispose();
    built?.dispose?.();
  }
  return result;
}
