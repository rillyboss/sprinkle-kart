/**
 * Sprinkle Kart — boot + game state machine.
 *
 *   boot (portraits) → menus → race (countdown → racing → finished) → results
 *        ↑                ↑________________ again / next-track ______|
 *        |____________________________ menu __________________________|
 *
 * Debug URL params (see README):
 *   ?quick=<trackId>   skip menus, start a race right away
 *   ?players=1..4      how many humans in a quick race
 *   ?speed=cozy|zippy|zoomy
 *   ?autodrive=1       human karts drive themselves (CPU brain)
 *   ?fastfinish=1      1-lap races
 *   ?unlockreset=1     wipe saved progress on load
 *   ?cpus=0..7         CPU racer count in a quick race (default: fill to 8)
 *   ?simspeed=1..8     run N simulation steps per frame (fast automated tests)
 *   ?democontent=1     menus show locked placeholders for the whole v2 lineup
 *   ?mode=gp&cup=<id>  skip menus, start a Grand Prix of that cup (with ?players, ?speed, ...)
 *   ?mode=tt&quick=<trackId>  skip menus, start a Time Trial (P1 only, vs your saved ghost)
 *
 * Modes (setup.mode): 'free' (single races), 'grand-prix' (runGrandPrix: 4
 * races, 'gp-race-end' / 'gp-end', standings + trophy ceremony) and
 * 'time-trial' (runTimeTrial: solo, no CPUs, no item boxes, 3 sprinkle boosts,
 * ghost of your best run), 'battle' (runBattle: Bubble Pop Battle in an arena,
 * src/modes/battleSession.js) and 'team' (runTeamRaces: the family + CPU buddies
 * vs a CPU team, src/modes/teamSession.js). Battle and Team plug into a race
 * session through `opts.controller` (onEvent / update / decorateSummary /
 * showResults / dispose) — the generic mode hook for new modes.
 */
import * as THREE from 'three';
import { RACERS_PER_RACE, MAX_PLAYERS, SPEED_CLASSES, DEFAULT_LAPS } from './config.js';
import * as progress from './progress/progress.js';
import { isAvailable } from './progress/access.js';
import { CHARACTERS, getCharacter, getSelectableCharacters } from './data/characters.js';
import { TRACKS, getTrack, findTrack } from './data/tracks.js';
import { TrackPath } from './track/TrackPath.js';
import { buildTrack } from './render/trackBuilder.js';
import { buildKartModel } from './render/characterModels.js';
import { renderPortraits } from './render/portraits.js';
import { Race, aiDriveInput } from './race/Race.js';
import { InputManager } from './input/InputManager.js';
import { AudioManager } from './audio/AudioManager.js';
import { Menus } from './ui/Menus.js';
import { Hud } from './ui/Hud.js';
import { SplitScreen, pixelRatioFor } from './render/SplitScreen.js';
import { CameraRig, SpectatorCam } from './render/CameraRig.js';
import { hideOccluders, restoreKarts } from './render/occlusion.js';
import { buildParticipants, pickCpuCharacters, parseDebugParams, quickSetup, nextTrackId, wantsQuickStart, menuPrevious } from './game/setup.js';
import { CUPS, getCup, cupTracks } from './data/cups.js';
import { rulesForMode, modeId } from './modes/rules.js';
import { finalizeSetup } from './modes/flow.js';
import { createGrandPrix, gpRaceSetup, gpRecordRace, gpNextRace, gpIsLastRace } from './modes/grandPrix.js';
import { createGhostRecorder, encodeGhost, decodeGhost, ghostGap, ghostStore } from './modes/ghost.js';
import { createGhostKart } from './modes/ghostKart.js';
import { raceRecordEligible } from './modes/timing.js';
import { getArena, nextArenaId, arenaIdOr } from './modes/arenas/index.js';
import { createBattleSession } from './modes/battleSession.js';
import { createTeamSession, createTeamSeries } from './modes/teamSession.js';
import { dailyChallenge, dailyRules } from './modes/daily.js';
import { createDailySession } from './modes/dailySession.js';
import { todayString } from './progress/goals.js';
import { MY_CUP_ID, myCupDef } from './modes/myCup.js';
import { bus } from './game/events.js';
import { createSessionHelpers } from './game/session.js';
import { createRaceStats } from './game/raceStats.js';
import { raceStartInfo, buildRaceSummary } from './game/summary.js';
import { installSystems } from './systems/index.js';
import { demoContent } from './game/demoContent.js';

const params = parseDebugParams(typeof location !== 'undefined' ? location.search : '');
if (params.unlockReset) progress.resetProgress();

/* ------------------------------------------------------------------ */
/* Core objects                                                        */
/* ------------------------------------------------------------------ */

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const loadingEl = document.getElementById('loading');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xffd6ec, 1);

const input = new InputManager(window);
const audio = new AudioManager();
input.onAnyUserGesture(() => { try { audio.unlock(); } catch { /* ignore */ } });

const split = new SplitScreen(renderer);

const game = {
  state: 'boot',
  race: null,
  setup: null,
  fps: 0,
  frames: 0,
  params,
  portraits: new Map(),
  lastResults: null,
  input,
  audio,
  menus: null,
  hud: null,
  errors: [],
  bus,
  gp: null,          // the running Grand Prix (src/modes/grandPrix.js state) or null
  lastGp: null,      // GrandPrixResult of the last finished cup race
  timeTrial: null,   // { ghost, ghostTime, ghostSaved, samples } for the running Time Trial
};
window.__game = game;

let menus = null;
let hud = null;

/* ------------------------------------------------------------------ */
/* Sizing                                                              */
/* ------------------------------------------------------------------ */

let activeSession = null; // the running race session (see startRace)

function resize() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const players = activeSession ? activeSession.humans.length : 1;
  renderer.setPixelRatio(pixelRatioFor(players, window.devicePixelRatio || 1));
  renderer.setSize(w, h, false);
  split.resize(w, h);
  if (activeSession) activeSession.layout();
}
window.addEventListener('resize', resize);
resize();

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

let lastT = performance.now();
let fpsAcc = 0;
let fpsFrames = 0;
let loggedLoopError = false;

function frame(now) {
  const rawDt = Math.max(0, (now - lastT) / 1000);
  lastT = now;
  const dt = Math.min(rawDt, 0.1);
  fpsAcc += rawDt;
  fpsFrames++;
  if (fpsAcc >= 0.5) {
    game.fps = Math.round((fpsFrames / fpsAcc) * 10) / 10;
    fpsAcc = 0;
    fpsFrames = 0;
  }
  game.frames++;
  try {
    input.update();
    if (menus) menus.update(dt);
    if (activeSession) activeSession.tick(dt);
    else {
      renderer.setScissorTest(false);
      renderer.clear();
    }
    bus.emit('frame', dt, game);
  } catch (err) {
    game.errors.push(String(err?.stack || err));
    if (!loggedLoopError) {
      loggedLoopError = true;
      console.error('Sprinkle Kart frame error:', err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  const fill = document.getElementById('loading-fill');
  const msg = document.getElementById('loading-msg');
  const lines = [
    'Sprinkling the sprinkles...',
    'Fluffing the cotton candy...',
    'Polishing the karts...',
    'Waking up the racers...',
    'Baking the peach pie crown...',
    'Inflating the gumdrops...',
  ];
  let pct = 6;
  let li = 0;
  const ticker = setInterval(() => {
    pct = Math.min(92, pct + (96 - pct) * 0.12);
    if (fill) fill.style.width = `${pct}%`;
    li = (li + 1) % lines.length;
    if (msg && Math.random() < 0.45) msg.textContent = lines[li];
  }, 180);

  renderer.setAnimationLoop(frame);

  let portraits = new Map();
  try {
    portraits = await renderPortraits(CHARACTERS, 256);
  } catch (err) {
    console.warn('Portraits could not be drawn, using emoji faces instead.', err);
  }
  game.portraits = portraits;

  // ?democontent=1 pads the menus with locked placeholders for the whole v2 lineup (UI checks).
  const menuContent = params.demoContent ? demoContent(CHARACTERS, TRACKS) : { characters: CHARACTERS, tracks: TRACKS };
  menus = new Menus(uiRoot, { input, audio, portraits, characters: menuContent.characters, tracks: menuContent.tracks, progress });
  hud = new Hud(uiRoot, { characters: CHARACTERS });
  game.menus = menus;
  game.hud = hud;
  // Event-bus subscribers (sounds, HUD callouts, rumble, progress, ...): src/systems/*.js
  installSystems(bus, { audio, input, hud, menus, progress, params, game });

  clearInterval(ticker);
  if (fill) fill.style.width = '100%';
  if (msg) msg.textContent = "Let's race!";
  await wait(250);
  loadingEl?.classList.add('done');
  setTimeout(() => loadingEl?.remove(), 700);

  flow().catch((err) => {
    console.error('Sprinkle Kart stopped:', err);
    loadingEl?.classList.add('failed');
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/* State machine                                                       */
/* ------------------------------------------------------------------ */

async function flow() {
  let previous = null;
  let skipTitle = false;
  let setup = null;

  if (wantsQuickStart(params)) {
    setup = quickSetup(params, input, CHARACTERS, TRACKS, { cups: CUPS });
  }

  for (;;) {
    if (!setup) {
      game.state = 'menu';
      audio.playMusic('menu');
      bus.emit('menu-enter', { skipTitle, previous });
      setup = finalizeSetup(await menus.run({ skipTitle, previous }), menus.draft);
    }
    const mode = modeId(setup.mode);
    if (mode === 'grand-prix') previous = await runGrandPrix(setup);
    else if (mode === 'time-trial') previous = await runTimeTrial(setup);
    else if (mode === 'battle') previous = await runBattle(setup);
    else if (mode === 'team') previous = await runTeamRaces(setup);
    else if (mode === 'daily') previous = await runDaily(setup);
    else previous = await runFreeRaces(setup);
    // 'menu' / 'quit' → back to the join screen with everyone still there.
    previous = menuPrevious(previous);
    setup = null;
    skipTitle = true;
  }
}

const availableTracks = () => TRACKS.filter((t) => isAvailable(t));

/** Free Race: race, then again / next track until the players pick the menu. */
async function runFreeRaces(setup) {
  let outcome = await playRace(setup);
  while (outcome === 'again' || outcome === 'next-track' || outcome === 'restart') {
    if (outcome === 'next-track') setup = { ...setup, trackId: nextTrackId(setup.trackId, availableTracks()) };
    outcome = await playRace(setup);
  }
  return setup;
}

/**
 * Bubble Pop Battle: an arena (not a race track), everyone floats bubbles,
 * items pop them, the last one bobbing wins. Again / another arena / menu.
 */
async function runBattle(setup) {
  let arenaId = arenaIdOr(setup.arenaId ?? params.arena);
  let outcome;
  do {
    const arena = getArena(arenaId);
    outcome = await playRace({ ...setup, mode: 'battle', arenaId }, {
      trackDef: arena.def,
      trackModule: arena,
      controller: (ctx) => createBattleSession(ctx),
    });
    if (outcome === 'next-track') arenaId = nextArenaId(arenaId);
  } while (outcome === 'again' || outcome === 'next-track' || outcome === 'restart');
  return { ...setup, mode: 'battle', arenaId };
}

/** Team Race: the family (+ CPU buddies) vs a CPU team; points by place, the series score carries over. */
async function runTeamRaces(setup) {
  setup = { ...setup, mode: 'team' };
  let series = createTeamSeries();
  let outcome;
  do {
    outcome = await playRace(setup, {
      controller: (ctx) => createTeamSession({ ...ctx, series, onScored: (next) => { series = next; } }),
    });
    if (outcome === 'next-track') setup = { ...setup, trackId: nextTrackId(setup.trackId, availableTracks()) };
  } while (outcome === 'again' || outcome === 'next-track' || outcome === 'restart');
  return setup;
}

/**
 * Daily Sprinkle: today's challenge (track, speed, goal, twist — src/modes/daily.js).
 * The menus hand over the challenge in setup.daily; a quick start (?mode=daily) rolls today's.
 */
async function runDaily(setup) {
  const challenge = setup.daily ?? dailyChallenge(todayString(), availableTracks().map((t) => t.id));
  const track = findTrack(challenge.trackId) ?? availableTracks()[0] ?? TRACKS[0];
  setup = { ...setup, mode: 'daily', daily: challenge, trackId: track.id, speedClass: setup.speedClass ?? challenge.speedClass, laps: params.laps ?? track.laps };
  let outcome;
  do {
    outcome = await playRace(setup, {
      rules: dailyRules(challenge),
      controller: (ctx) => createDailySession({ ...ctx, challenge }),
      resultOptions: [['again', 'Try again', '🔁'], ['menu', 'Menu', '🏠']],
    });
  } while (outcome === 'again' || outcome === 'restart' || outcome === 'next-track');
  return setup;
}

/** Time Trial: P1 alone against the ghost of their best run on this track. */
async function runTimeTrial(setup) {
  setup = { ...setup, mode: 'time-trial', players: setup.players.slice(0, 1) };
  let outcome = await playRace(setup);
  while (outcome === 'again' || outcome === 'next-track' || outcome === 'restart') {
    if (outcome === 'next-track') setup = { ...setup, trackId: nextTrackId(setup.trackId, availableTracks()) };
    outcome = await playRace(setup);
  }
  game.timeTrial = null;
  return setup;
}

/**
 * Grand Prix: the 4 races of a cup with the same CPU racers, points after
 * every race ('gp-race-end'), the standings screen in between, and after the
 * last race 'gp-end' + the trophy ceremony.
 */
async function runGrandPrix(setup) {
  // "My Cup" (src/modes/myCup.js): any 4 unlocked tracks the family picked, raced like a cup.
  const custom = setup.cupId === MY_CUP_ID && Array.isArray(setup.customTrackIds) && setup.customTrackIds.length;
  const cup = custom ? myCupDef(setup.customTrackIds.filter((id) => findTrack(id)), setup.customCup) : (getCup(setup.cupId) ?? CUPS[0]);
  const trackIds = custom ? cup.trackIds : cupTracks(cup.id).map((t) => t.id);
  if (!trackIds.length) return runFreeRaces({ ...setup, mode: 'free' });
  const base = { ...setup, mode: 'grand-prix', cupId: cup.id };
  const newCup = () => createGrandPrix({ cupId: cup.id, trackIds, cpuIds: pickCpus(base.players) });
  let gp = newCup();
  game.gp = gp;
  for (;;) {
    const raceSetup = gpRaceSetup(gp, base, { laps: params.laps ?? null });
    const outcome = await playRace(raceSetup, {
      resultOptions: [['gp-continue', gpIsLastRace(gp) ? 'Trophy time!' : 'Cup standings', '🏆']],
      onRaceEnd(summary, session) {
        gp = gpRecordRace(gp, summary);
        game.gp = gp;
        game.lastGp = gp.result;
        bus.emit('gp-race-end', gp.result, session);
        if (gp.result.finished) bus.emit('gp-end', gp.result, session);
      },
    });
    if (outcome === 'restart') continue; // pause → start over: the same race again
    if (outcome !== 'gp-continue') break; // left the cup from the pause menu
    game.state = 'standings';
    const final = gp.phase === 'done';
    audio.playMusic(final ? 'victory' : 'menu');
    const nextId = final ? null : gp.trackIds[gp.raceIndex + 1];
    const unlocks = (gp.result.unlocks || [])
      .map((u) => ({ ...u, def: u.kind === 'track' ? findTrack(u.id) : getCharacter(u.id) }))
      .filter((u) => u.def);
    const choice = await menus.open('gp-standings', {
      gp: gp.result, cup, final, nextTrack: nextId ? getTrack(nextId) : null, unlocks,
    });
    if (choice === 'next' && !final) { gp = gpNextRace(gp); game.gp = gp; continue; }
    if (choice === 'again' && final) { gp = newCup(); game.gp = gp; continue; }
    break;
  }
  game.gp = null;
  return base;
}

/** CPU racers for a race: fill the grid with unlocked racers the humans did not pick. */
function pickCpus(humans) {
  const selectable = getSelectableCharacters((id) => progress.isUnlocked(id));
  const quickCpus = wantsQuickStart(params) && params.cpus !== null;
  const count = quickCpus
    ? Math.max(0, Math.min(RACERS_PER_RACE - humans.length, params.cpus))
    : RACERS_PER_RACE - humans.length;
  return pickCpuCharacters(humans.map((p) => p.characterId), selectable, count, Math.random);
}

/**
 * Build a race, run it to the results screen and resolve with what the
 * players picked next: 'again' | 'next-track' | 'menu' | 'restart' | 'quit'.
 */
function playRace(setup, opts = {}) {
  return new Promise((resolve) => {
    const session = startRace(setup, (outcome) => {
      session.dispose();
      if (activeSession === session) activeSession = null;
      game.race = null;
      resolve(outcome);
    }, opts);
    activeSession = session;
    game.race = session.race;
    game.session = session;
    game.setup = setup;
    resize();
  });
}

/* ------------------------------------------------------------------ */
/* One race session                                                    */
/* ------------------------------------------------------------------ */

/**
 * @param {object} setup RaceSetup (+ mode, cupId, cpuIds for a Grand Prix)
 * @param {(outcome:string)=>void} done
 * @param {{ resultOptions?: Array, onRaceEnd?: (summary, session)=>void, trackDef?: object, trackModule?: object, rules?: object,
 *   controller?: (ctx) => { onEvent?, update?, decorateSummary?, showResults?, dispose? } }} [opts]
 *   trackDef / trackModule race somewhere that is not a registered track (a battle arena);
 *   controller(ctx) builds a mode controller once the Race exists (ctx: race, scene, session, setup,
 *   trackDef, humans, hud, menus, audio, bus).
 */
function startRace(setup, done, opts = {}) {
  const trackDef = opts.trackDef ?? getTrack(setup.trackId);
  const mode = modeId(setup.mode);
  const rules = opts.rules ?? rulesForMode(mode);
  const theme = trackDef.theme || {};
  const humans = [...setup.players].sort((a, b) => a.playerIndex - b.playerIndex).slice(0, MAX_PLAYERS);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.skyBottom ?? 0xffd6ec);
  if (theme.fogColor !== undefined) {
    scene.fog = new THREE.Fog(theme.fogColor, theme.fogNear ?? 120, theme.fogFar ?? 700);
  }

  const path = new TrackPath(trackDef.controlPoints, trackDef.width);
  const built = buildTrack(trackDef, path, opts.trackModule ? { module: opts.trackModule } : undefined);
  scene.add(built.group);

  // Grand Prix races keep the cup's CPU racers (setup.cpuIds); a Time Trial has none.
  const cpuChars = !rules.cpus ? [] : Array.isArray(setup.cpuIds) ? [...setup.cpuIds] : pickCpus(humans);
  const participants = buildParticipants(humans, cpuChars);

  const laps = params.fastFinish ? 1 : (setup.laps || trackDef.laps || DEFAULT_LAPS);
  const trial = mode === 'time-trial' ? createTrialSession(scene, setup, trackDef, humans[0], laps) : null;

  let completeAt = null;
  let resultsShown = false;
  let paused = false;
  let finished = false;
  let unsubDevice = null;

  const stats = createRaceStats();
  const helpers = createSessionHelpers({ humans, audio, input, hud, getCharacter });
  let session = null; // assigned below, before the first race.update()
  let ctrl = null; // mode controller (opts.controller), built right after the Race
  // Every Race event: count it, then forward it to the bus as 'race:<type>'.
  const onEvent = (e) => {
    stats.onEvent(e);
    try { ctrl?.onEvent?.(e); } catch (err) { console.error('[modes] controller event failed', err); }
    if (e.type === 'race-complete') completeAt = race.clock;
    bus.emit(`race:${e.type}`, e, session);
  };
  const race = new Race({
    scene, trackDef, path, builtTrack: built, participants,
    speedClass: SPEED_CLASSES[setup.speedClass] ? setup.speedClass : 'zippy',
    buildKartModel, onEvent, laps, rules,
  });

  const rigs = humans.map(() => new CameraRig());
  const spectator = new SpectatorCam(path);
  const playerIndices = humans.map((p) => p.playerIndex);
  // Karts right in front of a chase camera would fill the whole view with a
  // giant head, so they are hidden for that player's render only.
  const hiddenForView = [];
  const viewHooks = {
    beforeView(slot, cam) {
      if (slot === 'spectator') return;
      const own = race.getPlayerKart(playerIndices[slot]);
      hiddenForView.push(...hideOccluders(race.karts, own, cam));
    },
    afterView() { restoreKarts(hiddenForView); },
  };

  split.setPlayerCount(humans.length);
  hud.reset?.();
  hud.show();

  session = {
    ...helpers,
    race, humans, scene, built, path, rigs, spectator, setup, trackDef, laps, stats,
    mode,
    audio, input, hud, params,
    outcome: null,
    get paused() { return paused; },
    get resultsShown() { return resultsShown; },
    layout() {
      hud.layout(split.hudRects(playerIndices));
      rigs.forEach((r, i) => r.setAspect(split.aspect(i)));
      if (split.spectator) spectator.setAspect(split.aspect('spectator'));
    },
    tick,
    dispose,
  };

  if (opts.controller) {
    try {
      ctrl = opts.controller({ race, scene, session, setup, trackDef, humans, hud, menus, audio, bus });
    } catch (err) { console.error('[modes] controller failed to start', err); ctrl = null; }
  }
  game.modeController = ctrl;

  audio.setMusicTempo?.(1);
  audio.playMusic(theme.music || 'castle');
  game.state = 'race';
  bus.emit('race-start', raceStartInfo({ setup, trackDef, humans, cpuIds: cpuChars, laps }), session);

  // Precompile shaders so the countdown does not stutter.
  try {
    const k0 = race.getPlayerKart(playerIndices[0]) || race.karts[0];
    rigs[0]?.snap(k0);
    renderer.compile(scene, rigs[0]?.camera || spectator.camera);
  } catch { /* compile is only an optimisation */ }

  // A controller unplugged mid-race pauses the game so nobody is left behind.
  unsubDevice = input.onDeviceChange?.((ev) => {
    if (ev.type !== 'disconnected' || paused || resultsShown || finished) return;
    const who = humans.find((p) => p.deviceId === ev.deviceId);
    if (who) openPause(`P${who.playerIndex + 1}'s controller took a nap 💤 Plug it back in!`);
  }) || null;

  function openPause(label) {
    if (paused || resultsShown) return;
    paused = true;
    game.state = 'paused';
    helpers.sfx('confirm');
    bus.emit('race-pause', { label }, session);
    menus.showPause(label).then((choice) => {
      paused = false;
      bus.emit('race-resume', { choice }, session);
      game.state = resultsShown ? 'results' : 'race';
      input.clearMenuEvents?.();
      if (choice === 'restart') end('restart');
      else if (choice === 'quit') end('menu');
    });
  }

  function driveInputs() {
    const out = [];
    for (const p of humans) {
      const kart = race.getPlayerKart(p.playerIndex);
      if (params.autodrive && kart) {
        out[p.playerIndex] = aiDriveInput(race, kart, race.lastDt);
      } else {
        out[p.playerIndex] = input.getDriveInput(p.deviceId);
      }
    }
    return out;
  }

  function showResults() {
    resultsShown = true;
    game.state = 'results';
    const standings = race.getStandings();
    const humanWinner = standings.find((k) => helpers.isHuman(k) && k.finishPlace === 1 && !k.finishEstimated) || null;
    const summary = buildRaceSummary({ setup, trackDef, humans, standings, stats, laps, raceTime: race.time });
    try { ctrl?.decorateSummary?.(summary); } catch (err) { console.error('[modes] summary hook failed', err); }
    // Subscribers (src/systems/progressUnlocks.js, ...) record progress and push into summary.unlocks.
    bus.emit('race-end', summary, session);
    trial?.finish(race, summary);
    try { opts.onRaceEnd?.(summary, session); } catch (err) { console.error('[modes] race end hook failed', err); }
    const unlocks = summary.unlocks
      .map((u) => ({ ...u, def: u.kind === 'track' ? findTrack(u.id) : getCharacter(u.id) }))
      .filter((u) => u.def);
    const newlyUnlocked = unlocks.find((u) => u.kind === 'character')?.def ?? null;
    game.lastResults = {
      trackId: trackDef.id,
      mode: summary.mode,
      humanWinner: humanWinner ? { characterId: humanWinner.characterId, playerIndex: humanWinner.playerIndex } : null,
      newlyUnlocked: newlyUnlocked ? newlyUnlocked.id : null,
      unlocks: summary.unlocks.map((u) => ({ kind: u.kind, id: u.id })),
      standings: standings.map((k) => ({ characterId: k.characterId, playerIndex: k.playerIndex, place: k.finishPlace ?? k.place })),
      summary,
    };
    audio.setMusicTempo?.(1);
    audio.playMusic('victory');
    hud.hide();
    const custom = ctrl?.showResults ? ctrl.showResults({ menus, summary, standings, trackDef, unlocks, humanWinner }) : null;
    const shown = custom || (trial
      ? menus.open('time-trial-results', { summary, trackDef, unlocks, ghostSaved: trial.saved, hadGhost: trial.hadGhost, bestBefore: trial.bestBefore(summary) })
      : menus.showResults({ standings, trackDef, humanWinner, newlyUnlocked, unlocks, summary, ...(opts.resultOptions ? { options: opts.resultOptions } : {}) }));
    shown.then((choice) => {
      bus.emit('results-choice', { choice }, session);
      end(choice);
    });
  }

  function end(outcome) {
    if (finished) return;
    finished = true;
    session.outcome = outcome;
    done(outcome);
  }

  function tick(dt) {
    if (finished) return;
    // Pause (Start / Esc / P) — any joined player's device.
    if (!paused && !resultsShown) {
      for (const p of humans) {
        if (input.isPausePressed(p.deviceId)) { openPause(`P${p.playerIndex + 1}`); break; }
      }
    }

    const inputs = driveInputs();
    if (!paused) {
      const steps = params.simSpeed;
      for (let i = 0; i < steps; i++) {
        race.update(dt, i === 0 ? inputs : withoutEdges(inputs));
        if (params.autodrive && i < steps - 1) {
          // refresh AI inputs between sub-steps so the robots keep steering
          for (const p of humans) {
            const kart = race.getPlayerKart(p.playerIndex);
            if (kart) inputs[p.playerIndex] = aiDriveInput(race, kart, race.lastDt);
          }
        }
      }
      built.update(dt * steps, race.clock);
      trial?.update(race, dt * steps);
      try { ctrl?.update?.(dt * steps); } catch (err) { game.errors.push(String(err?.stack || err)); }
    }

    if (completeAt !== null && !resultsShown && race.clock - completeAt >= (params.simSpeed > 1 ? 1.2 : 2.6)) {
      showResults();
    }

    const countdown = race.state === 'countdown' ? race.countdown : null;
    humans.forEach((p, i) => {
      const kart = race.getPlayerKart(p.playerIndex);
      rigs[i].update(paused ? 0 : dt, kart, { lookBack: !!inputs[p.playerIndex]?.lookBack && !resultsShown, countdown });
    });
    if (split.spectator) spectator.update(paused ? 0 : dt, race);

    if (!resultsShown) hud.update(race, path, { playerIndices, portraits: game.portraits });
    // Per-frame systems (engine sounds, custom overlays, timers ...) read the session here.
    bus.emit('race-frame', dt, session);
    split.render(scene, rigs.map((r) => r.camera), spectator.camera, viewHooks);
  }

  function dispose() {
    bus.emit('race-exit', { outcome: session.outcome }, session);
    try { unsubDevice?.(); } catch { /* ignore */ }
    try { trial?.dispose(); } catch (err) { console.warn(err); }
    try { ctrl?.dispose?.(); } catch (err) { console.warn(err); }
    if (game.modeController === ctrl) game.modeController = null;
    try { race.dispose(); } catch (err) { console.warn(err); }
    try { built.dispose(); } catch (err) { console.warn(err); }
    scene.clear();
    hud.hide();
    hud.reset?.();
    menus.hide();
    split.setPlayerCount(1);
  }

  return session;
}

/**
 * Time Trial extras for one race: records P1 at ~20 Hz, replays the saved
 * ghost of the best run (same track + laps) and keeps race.modeInfo.ghostGap
 * up to date for the timer widget. On finish, a faster run replaces the ghost.
 */
function createTrialSession(scene, setup, trackDef, player, laps) {
  const recorder = createGhostRecorder();
  const packed = ghostStore.load(trackDef.id, laps);
  const decoded = packed ? decodeGhost(packed) : null;
  let ghostKart = null;
  if (decoded) {
    try {
      const charDef = getCharacter(decoded.meta.characterId) ?? getCharacter(player?.characterId);
      ghostKart = createGhostKart({ scene, decoded, charDef, buildKartModel });
    } catch (err) { console.warn('[time-trial] ghost could not be built', err); }
  }
  let appeared = false;
  const info = { ghost: !!decoded, ghostTime: decoded?.meta?.time ?? null, ghostSaved: false, samples: 0 };
  game.timeTrial = info;
  const session = {
    hadGhost: !!decoded,
    saved: false,
    update(race, dt) {
      const kart = race.getPlayerKart(player.playerIndex);
      if (!kart || race.state === 'countdown') return;
      if (!kart.finished) recorder.record(race.time, kart);
      info.samples = recorder.samples.length;
      if (!decoded) return;
      if (!appeared && race.time > 0.2) { appeared = true; try { audio.sfx('timing-ghost'); } catch { /* ignore */ } }
      ghostKart?.update(race.time, dt, kart.position, race.clock);
      race.modeInfo.ghostGap = kart.finished ? null : ghostGap(decoded, race.time, kart.distance);
    },
    finish(race, summary) {
      const kart = race.getPlayerKart(player.playerIndex);
      const h = summary.humans[0];
      if (!kart || !h?.finished || h.estimated || !Number.isFinite(h.finishTime)) return;
      recorder.finish(h.finishTime, kart);
      const ghost = encodeGhost(recorder.samples, {
        trackId: trackDef.id, laps, characterId: kart.characterId, speedClass: setup.speedClass, time: h.finishTime,
      });
      session.saved = ghostStore.offer(ghost);
      info.ghostSaved = session.saved;
    },
    /** The time this run had to beat: the ghost (same laps) or the saved record for a normal-length race. */
    bestBefore(summary) {
      const rec = summary.records;
      const eligibleRecord = rec && raceRecordEligible(laps, trackDef) ? rec.previous?.bestRace : null;
      const times = [decoded?.meta?.time, eligibleRecord].filter((t) => Number.isFinite(t) && t > 0);
      return times.length ? Math.min(...times) : null;
    },
    dispose() { ghostKart?.dispose(); },
  };
  return session;
}

function withoutEdges(inputs) {
  return inputs.map((i) => (i ? { ...i, useItem: false } : i));
}

boot();
