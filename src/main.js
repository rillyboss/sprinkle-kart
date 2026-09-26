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
import { tutorialTrackId, TUTORIAL_LAPS, TUTORIAL_SPEED } from './modes/tutorial.js';
import { createTutorialSession } from './modes/tutorialSession.js';
import { paintedBuilder } from './modes/paint.js';
import { bus } from './game/events.js';
import { createSessionHelpers } from './game/session.js';
import { createRaceStats } from './game/raceStats.js';
import { raceStartInfo, buildRaceSummary } from './game/summary.js';
import { installSystems } from './systems/index.js';
import { demoContent } from './game/demoContent.js';
// Online (WS7, NETWORKING.md §10): only tiny pure helpers are imported up front; the network code itself
// (matchmakers, WebRTC, netcode) loads with import('./online/index.js') once Online is opened.
import { startupInvite, createInviteMemory } from './net/session/inviteLink.js';
import { setLabelContext, clearLabelContext } from './net/session/playerLabel.js';
import { createJoinState } from './ui/menuState.js';
import { paintStore, paintFor } from './modes/paint.js';

const params = parseDebugParams(typeof location !== 'undefined' ? location.search : '');
if (params.unlockReset) progress.resetProgress();

// `#join=` invite links (NETWORKING.md §10.1): read ONCE at start-up and cleared from the address bar right
// away, so a reload or a screenshot never keeps it. Online on → the Online hub asks "Join 🏡 …?"; online
// off → the "ask a grown-up" screen (never a way around the parent gate). The secret stays in memory only.
const startInvite = readStartupInvite();
const inviteMemory = createInviteMemory();
if (startInvite?.screen === 'invite-gate') inviteMemory.remember(startInvite.secret);

function readStartupInvite() {
  if (typeof location === 'undefined') return null;
  let onlineEnabled = false;
  try { onlineEnabled = !!progress.getSettings().onlineEnabled; } catch { /* storage off: online off */ }
  const r = startupInvite({ hash: location.hash, pathname: location.pathname, search: location.search, onlineEnabled });
  for (const e of r.effects) {
    if (e.type === 'replaceState') { try { history.replaceState(history.state, '', e.url); } catch { /* ignore */ } }
  }
  return r.screen ? r : null;
}

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
    if (online) onlineTick(now);
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
  installOnlineActions(menus);
  hud = new Hud(uiRoot, { characters: CHARACTERS });
  game.menus = menus;
  game.hud = hud;
  // Event-bus subscribers (sounds, HUD callouts, rumble, progress, ...): src/systems/*.js
  installSystems(bus, { audio, input, hud, menus, progress, params, game, renderer });

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
  // a screen to open right after the menus start (an invite link, or back to the Online hub after a room)
  let startAt = startInvite ? { id: startInvite.screen, params: startInvite.params } : null;

  if (wantsQuickStart(params) && !startAt) {
    setup = quickSetup(params, input, CHARACTERS, TRACKS, { cups: CUPS });
  }

  for (;;) {
    if (!setup) {
      game.state = 'menu';
      audio.playMusic('menu');
      bus.emit('menu-enter', { skipTitle, previous });
      // Online hub → "Host a game" / "Join!" leaves the local menus for the room (runOnline).
      const request = deferred();
      onlineRequest = request;
      const run = menus.run({ skipTitle, previous });
      if (startAt) { menus.goto(startAt.id, startAt.params); startAt = null; }
      const raw = await Promise.race([run, request.promise.then((r) => ({ __online: r }))]);
      onlineRequest = null;
      if (raw?.__online) {
        const after = await runOnline(raw.__online);
        startAt = { id: 'online-hub', params: after?.message ? { message: after.message, ...(after.tips?.length ? { tips: after.tips } : {}) } : {} };
        previous = null;
        skipTitle = false;
        continue;
      }
      setup = finalizeSetup(raw, menus.draft);
    }
    const mode = modeId(setup.mode);
    if (mode === 'grand-prix') previous = await runGrandPrix(setup);
    else if (mode === 'time-trial') previous = await runTimeTrial(setup);
    else if (mode === 'battle') previous = await runBattle(setup);
    else if (mode === 'team') previous = await runTeamRaces(setup);
    else if (mode === 'daily') previous = await runDaily(setup);
    else if (mode === 'tutorial') previous = await runTutorial(setup);
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

/** Kart models in the racers' Paint Shop colours (src/modes/paint.js), read fresh for every race. */
function paintedKartBuilder() {
  return paintedBuilder(buildKartModel);
}

/**
 * How to Play (src/modes/tutorial.js): P1 alone on a friendly track, a coach
 * bubble teaches one trick at a time. Practice again / menu.
 */
async function runTutorial(setup) {
  const trackId = setup.trackId && findTrack(setup.trackId) ? setup.trackId : tutorialTrackId(availableTracks().map((t) => t.id));
  const p1 = setup.players[0];
  setup = { ...setup, mode: 'tutorial', players: [p1], trackId, laps: params.laps ?? setup.laps ?? TUTORIAL_LAPS, speedClass: setup.speedClass ?? TUTORIAL_SPEED };
  let device = p1?.deviceId ?? null;
  try { device = input.getDevice?.(p1.deviceId) ?? device; } catch { /* ignore */ }
  let outcome;
  do {
    outcome = await playRace(setup, {
      controller: (ctx) => createTutorialSession({ ...ctx, device }), // its own results screen
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
  if (opts.net) return startNetRace(setup, done, opts); // online (WS7): see the online section below
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
    buildKartModel: paintedKartBuilder(), onEvent, laps, rules,
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

/* ------------------------------------------------------------------ */
/* Online play (WS7, NETWORKING.md §9–§13)                             */
/* ------------------------------------------------------------------ */
//
//   Online hub → Host a game → runOnlineHost: open a room, lobby (approve / remove / lock), "Let's pick!"
//     → this machine's menus (join → mode → racers → track) with ctx.net → wait for friends' picks →
//     NetRaceSetup → startNetRace (Race + host driver) → results (host decides again / next / lobby)
//   Online hub → Join → runOnlineGuest: knock (match check) → lobby → PHASE-driven picking (join + racers)
//     → SETUP → startNetRace (ReplicaRace + guest driver) → RESULT (localized) → the host's CHOICE
//
// Offline play never enters this section: `online` stays null and startRace() is untouched. Online races
// ignore ?simspeed, ?autodrive and quick-start (the host's clock and inputs are the truth).

let online = null;        // the open room while this machine is online (see runOnline)
let onlineMod = null;     // the lazily loaded online chunk
let onlineRequest = null; // resolves the pending menus.run() when the family opens a room

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function onlineEnabledNow() {
  try { return !!progress.getSettings().onlineEnabled; } catch { return false; }
}

/**
 * Closing or reloading the tab while a room is open: say goodbye right away (host BYE {hostEnding} / guest BYE
 * {leaving} on ctrl) and close the connections, so friends know within a second or two instead of waiting for
 * the ICE timeout (§13.3).
 */
function sayByeOnPageHide() {
  const o = online;
  if (!o) return;
  try { o.room.session.dispatch(o.role === 'host' ? { type: 'close' } : { type: 'leave' }); } catch { /* going away anyway */ }
  try { o.room.transport?.close?.(); } catch { /* going away anyway */ }
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', sayByeOnPageHide);

/** menus.online (the Online hub / lobby / net-waiting screens call these). */
function installOnlineActions(m) {
  m.online = {
    host: () => { if (!online && onlineEnabledNow()) onlineRequest?.resolve({ role: 'host' }); },
    join: (secret) => { if (!online && onlineEnabledNow()) onlineRequest?.resolve({ role: 'guest', secret }); },
    pick: () => online?.onPick?.(),
    leave: () => { if (online) online.leave(); else m.goto('online-hub'); },
  };
  // After a grown-up turned online on, the Online hub offers a remembered invite once (§10.1).
  const baseGoto = m.goto.bind(m);
  m.goto = (id, p = {}) => {
    if (id === 'online-hub' && !p?.invite && onlineEnabledNow() && inviteMemory.peek()) return baseGoto(id, { ...p, invite: inviteMemory.take() });
    return baseGoto(id, p);
  };
}

async function loadOnline() {
  onlineMod ??= await import('./online/index.js');
  return onlineMod;
}

function signalConfig(mod) {
  let env = {};
  try { env = import.meta.env ?? {}; } catch { /* not a Vite build */ }
  return mod.signalConfigFor({ env, location, resolve: mod.resolveSignalConfig });
}

/** CPU racers for an online race: the HOST's unlocked racers the humans did not pick (§12). */
function onlineCpus(count, lobbyPicks = []) {
  const selectable = getSelectableCharacters((id) => progress.isUnlocked(id));
  return pickCpuCharacters(lobbyPicks, selectable, count, Math.random);
}

function localDeviceIds() {
  const players = [...(menus?.draft?.joinState?.players ?? [])].sort((a, b) => a.playerIndex - b.playerIndex);
  if (players.length) return players.map((p) => p.deviceId);
  const first = (() => { try { return input.getDevices()[0]?.id; } catch { return null; } })();
  return [first ?? 'kb1'];
}

/** Make sure the local draft has at least one player (a guest who joined straight into the racer screen). */
function ensureLocalPlayers() {
  const d = menus?.draft;
  if (!d) return;
  if (!d.joinState?.players?.length) d.joinState = createJoinState([{ deviceId: localDeviceIds()[0] }]);
}

async function runOnline(req) {
  let mod;
  try { mod = await loadOnline(); } catch (err) {
    console.error('[online] could not load', err);
    return { message: "Couldn't reach the matchmaker 🙈" };
  }
  return req.role === 'host' ? runOnlineHost(mod) : runOnlineGuest(mod, req.secret);
}

/** Shared per-room state + the per-frame housekeeping (onlineTick). */
function createOnlineState(mod, room) {
  const left = deferred();
  const state = {
    mod,
    room,
    role: room.role,
    racing: false,
    phase: null,
    left: left.promise,
    lobbyAction: null,
    backToLobby: null,
    raceHooks: null,     // { choice(c), ended(text), newSetup(setup) } while a guest race / results screen is open
    reconnecting: false, // a guest's link dropped and it is knocking again (§13.2)
    reconnectText: '',
    sessionTimer: null,
    overlay: null,
    lastOverlay: 0,
    leave() { left.resolve('leave'); state.lobbyAction?.resolve('leave'); state.raceHooks?.leave?.(); },
    onPick() { state.lobbyAction?.resolve('pick'); },
    houseId: () => (room.role === 'host' ? 0 : room.session.state.houseId),
    localPis() {
      const l = room.session.lobby();
      return l ? mod.housePis(l, state.houseId()) : [];
    },
  };
  state.draftSync = mod.createDraftSync({
    houseId: state.houseId,
    lobby: () => room.session.lobby(),
    send: (intent) => room.session.dispatch(room.role === 'host' ? { type: 'host-intent', intent } : { type: 'intent', intent }),
    paintOf: (() => { let map = {}; try { map = paintStore().load(); } catch { /* own colours */ } return (id) => paintFor(map, id); })(),
  });
  room.session.onEffect((e) => {
    if (e.type === 'emote') bus.emit('net-emote', { globalPi: e.globalPi, emote: e.emote, local: state.localPis().includes(e.globalPi) });
    if (e.type === 'net-state') { state.reconnecting = !!e.reconnecting; state.reconnectText = e.text || ''; }
  });
  // Session housekeeping (KEEP heartbeat, approvals, host silence, reconnects) on a plain timer, never rAF: a
  // hidden or busy tab keeps its room open (a throttled 1 Hz timer is still plenty).
  const onlineNow = () => { try { return typeof navigator === 'undefined' || navigator.onLine !== false; } catch { return true; } };
  state.sessionTimer = setInterval(() => {
    try { room.session.dispatch({ type: 'tick', online: onlineNow() }); } catch (err) { console.warn('[online] tick', err); }
  }, mod.SESSION_TICK_MS);
  const search = typeof location !== 'undefined' ? location.search : '';
  let showInfo = false;
  try { showInfo = !!progress.getSettings().showNetworkInfo; } catch { /* ignore */ }
  if (mod.shouldShowNetDebug({ search, showNetworkInfo: showInfo })) state.overlay = mod.createDebugOverlay({});
  return state;
}

/** Every frame while a room is open: session housekeeping, lobby ⇄ menus, labels, window.__game.net. */
function onlineTick(now) {
  const o = online;
  const { room, mod } = o;
  void now;
  const lobby = room.session.lobby();
  if (lobby) setLabelContext({ localPis: o.localPis(), lobby, characters: CHARACTERS });
  if (!o.racing && menus?.active) {
    // the menus can wander back to the title (B on the join screen): in a room that means "back to the lobby"
    if (menus.screenId === 'title') {
      if (o.backToLobby) o.backToLobby.resolve('lobby');
      else menus.goto('online-lobby');
    }
    if (menus.draft) o.draftSync.update(menus.draft);
    if (o.role === 'host') {
      const phase = mod.phaseForScreen(menus.screenId);
      if (phase && phase !== o.phase) { o.phase = phase; room.session.dispatch({ type: 'phase', phase }); }
    }
  }
  game.net = netInfo(o);
  if (o.overlay && now - o.lastOverlay > 500) { o.lastOverlay = now; o.overlay.update(game.net.debug); }
}

/** window.__game.net: the numbers smoke / e2e tests and the debug overlay read (never IP addresses). */
function netInfo(o) {
  const race = o.race;
  const st = race?.stats?.() ?? null;
  const lobby = o.room.session.lobby();
  const info = {
    role: o.role,
    label: lobby?.label ?? o.room.secret?.label ?? null,
    phase: o.room.role === 'host' ? o.room.session.state.phase : o.room.session.state.hostPhase ?? o.room.session.state.phase,
    houses: lobby?.houses?.length ?? 0,
    humans: lobby ? lobby.houses.reduce((n, h) => n + h.players.length, 0) : 0,
    locked: !!lobby?.locked,
    racing: o.racing,
    tick: o.role === 'host' ? st?.tick ?? 0 : race?.driver?.stats?.()?.lastEventSeq ?? 0,
    paused: !!race?.paused,
    stats: st,
  };
  info.debug = {
    role: o.role,
    transport: o.room.signaling?.kind === 'worker' ? 'worker' : 'public-torrent',
    self: { build: 'dev', proto: 1, content: 0 },
    peers: (o.room.transport?.peers?.() ?? []).map((peerId) => {
      const s = o.room.transport.stats?.(peerId) ?? {};
      return {
        relayed: s.relayed ?? null, candidate: s.candidateType ?? null, rttMs: s.rttMs ?? null, stateSkips: s.stateSkips ?? 0,
        interpDelayMs: st?.interpDelayMs, lead: st?.lead, slack: st?.lastSlack, epoch: st?.epoch, lastEventSeq: st?.lastEventSeq,
        reconcileP50Cm: st?.reconcileP50 != null ? st.reconcileP50 * 100 : null, reconcileP99Cm: st?.reconcileP99 != null ? st.reconcileP99 * 100 : null,
        bufferedCtrl: s.bufferedCtrl ?? 0, hostTick: o.role === 'host' ? st?.tick : null,
      };
    }),
  };
  return info;
}

function closeOnline(o) {
  clearInterval(o.sessionTimer);
  try { o.room.close(); } catch (err) { console.warn('[online] close', err); }
  try { o.overlay?.destroy(); } catch { /* ignore */ }
  if (menus) menus.net = null;
  online = null;
  clearLabelContext();
  game.net = null;
  bus.emit('net-room', { role: o.role, phase: null, label: null });
}

/** Host: open a room, run the lobby / picking / races until the host ends the room. */
async function runOnlineHost(mod) {
  menus.goto('net-waiting', { mode: 'connecting', text: mod.ONLINE_TEXT.opening });
  let room;
  try {
    room = await mod.openHostRoom({
      progress, hostPlayers: 1, rules: rulesForMode('free'), signal: signalConfig(mod),
      pickCpus: (n) => onlineCpus(n, (room?.session?.lobby() ? room.session.lobby().houses.flatMap((h) => h.players.map((p) => p.characterId)) : []).filter(Boolean)),
    });
  } catch (err) {
    console.warn('[online] could not open a room', err);
    return { message: mod.signalingErrorText(err?.code) };
  }
  const o = createOnlineState(mod, room);
  online = o;
  bus.emit('net-room', { role: 'host', phase: 'lobby', label: room.secret.label });
  // The host's menus compose the NetRaceSetup only after everyone picked (see below).
  menus.net = { ...room.netCtx, composeSetup: (local) => ({ __local: local }) };
  let previousLocal = null;
  try {
    for (;;) {
      o.phase = 'lobby';
      room.session.dispatch({ type: 'phase', phase: 'lobby' });
      try { room.transport.renewIceIfRelayed?.(); } catch { /* only between races */ }
      menus.goto('online-lobby');
      o.lobbyAction = deferred();
      const act = await Promise.race([o.lobbyAction.promise, o.left]);
      o.lobbyAction = null;
      if (act === 'leave') return {};
      // This machine's picking flow (join → mode → racers → track); guests pick their racers meanwhile.
      o.backToLobby = deferred();
      const run = menus.run({ skipTitle: true, previous: previousLocal });
      const got = await Promise.race([run, o.left, o.backToLobby.promise]);
      o.backToLobby = null;
      if (got === 'leave') return {};
      if (got === 'lobby' || !got?.__local) continue;
      const local = got.__local;
      previousLocal = { players: [...(menus.draft?.joinState?.players ?? [])], trackId: local.trackId, speedClass: local.speedClass, laps: local.laps, mode: 'free' };
      const deviceIds = localDeviceIds();
      menus.goto('net-waiting', { mode: 'waiting', text: mod.ONLINE_TEXT.friendsPicking });
      const ready = await waitForFriends(o, mod);
      if (ready === 'leave') return {};
      const trackDef = getTrack(local.trackId);
      const choice = { mode: 'free', trackId: trackDef.id, speedClass: local.speedClass ?? 'zippy', laps: params.fastFinish ? 1 : (local.laps || trackDef.laps || DEFAULT_LAPS) };
      const compose = () => mod.fillMissingPicks(room.netCtx.composeSetup(choice), getSelectableCharacters((id) => progress.isUnlocked(id)).map((c) => c.id));
      let setup = compose();
      let outcome;
      do {
        outcome = await playRace(setup, { net: { mod, room, role: 'host', deviceIds } });
        if (outcome === 'next-track') choice.trackId = nextTrackId(choice.trackId, availableTracks());
        if (outcome === 'again' || outcome === 'next-track' || outcome === 'restart') setup = compose();
      } while (outcome === 'again' || outcome === 'next-track' || outcome === 'restart');
      if (outcome === 'leave') return {};
    }
  } finally {
    closeOnline(o);
  }
}

/** Host: wait until every friend picked a racer and pressed ready (≤ READY_TIMEOUT_MS). */
function waitForFriends(o, mod) {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (!online || online !== o) return resolve('leave');
      const l = o.room.session.lobby();
      if (mod.everyoneReady(l) || performance.now() - started > mod.READY_TIMEOUT_MS) return resolve('go');
      setTimeout(check, 100);
    };
    o.left.then(() => resolve('leave'));
    check();
  });
}

/** Guest: knock, wait for approval, then follow the host (PHASE / SETUP / RESULT / CHOICE). */
async function runOnlineGuest(mod, secret) {
  menus.goto('net-waiting', { mode: 'connecting', text: mod.TEXT.knocking, label: secret?.label ?? '' });
  const room = await mod.joinGuestRoom({ secret, localPlayers: Math.max(1, menus?.draft?.joinState?.players?.length || 1), progress, signal: signalConfig(mod) });
  const o = createOnlineState(mod, room);
  online = o;
  menus.net = room.netCtx;
  const queue = mod.createEventQueue();
  let picking = false;
  room.session.onEffect((e) => {
    switch (e.type) {
      case 'screen':
        if (e.id === 'online-hub') break; // 'ended' carries the sentence
        if (o.racing) break;
        // back from a reconnect while the host races without us: wait for the next race instead of the lobby
        if (e.id === 'online-lobby' && mod.RACING_PHASES.includes(room.session.state.hostPhase)) menus.goto('net-waiting', { mode: 'waiting', text: mod.TEXT.hostWaiting });
        else menus.goto(e.id, e.params);
        break;
      case 'phase': queue.push({ type: 'phase', phase: e.phase }); break;
      case 'choice': if (o.raceHooks) o.raceHooks.choice(e.choice); break;
      case 'ended':
        if (o.raceHooks) o.raceHooks.ended(e.text);
        queue.push({ type: 'ended', text: e.text, tips: e.reason === 'no-connect' ? [...mod.TEXT.noConnectTips] : null });
        break;
      default: break;
    }
  });
  room.router?.on('setup', (rc) => {
    room.router.expectRace();
    o.raceHooks?.newSetup?.(rc.setup); // the host moved on (Start over / a new race): leave the old one
    queue.push({ type: 'setup', setup: rc.setup });
  });
  o.left.then(() => queue.push({ type: 'leave' }));
  // whatever the session already decided before we listened
  const st0 = room.session.state;
  if (st0.phase === 'ended') { closeOnline(o); return { message: st0.end?.text ?? '', tips: st0.end?.reason === 'no-connect' ? [...mod.TEXT.noConnectTips] : null }; }
  if (st0.phase === 'waiting-approval') menus.goto('net-waiting', { mode: 'approval', animals: matchText(st0.match), text: mod.TEXT.showHost(matchText(st0.match)), label: secret.label });
  bus.emit('net-room', { role: 'guest', phase: 'connecting', label: secret?.label ?? null });
  let guestPrev = null;
  try {
    for (;;) {
      const ev = await queue.next();
      if (ev.type === 'leave') return {};
      if (ev.type === 'ended') return { message: ev.text, tips: ev.tips ?? null };
      if (ev.type === 'phase') {
        if (o.racing) continue;
        if (ev.phase === 'lobby') { picking = false; menus.goto('online-lobby'); }
        else if (ev.phase === 'mode' || ev.phase === 'characters') {
          if (!picking) { picking = true; menus.run({ skipTitle: true, previous: guestPrev }); }
          if (ev.phase === 'characters' && menus.screenId !== 'character-select' && !menus.draft?.charState) {
            ensureLocalPlayers();
            menus.goto('character-select');
          }
        }
        continue;
      }
      if (ev.type === 'setup') {
        if (!mod.localHumans(ev.setup, room.session.state.houseId, []).length) {
          // a race composed while this house was away (reconnect window): watch the next one
          menus.goto('net-waiting', { mode: 'waiting', text: mod.TEXT.hostWaiting });
          continue;
        }
        guestPrev = { players: [...(menus.draft?.joinState?.players ?? [])], trackId: ev.setup.trackId, speedClass: ev.setup.speedClass, laps: ev.setup.laps, mode: 'free' };
        const deviceIds = localDeviceIds();
        menus.hide();
        const outcome = await playRace(ev.setup, { net: { mod, room, role: 'guest', deviceIds } });
        picking = false;
        if (outcome === 'leave') return {};
        if (outcome && typeof outcome === 'object' && outcome.ended) return { message: outcome.ended, tips: outcome.tips ?? null };
        // 'again' / 'next-track': the next SETUP comes; 'lobby': the host's PHASE lobby follows
        const queuedSetup = queue.take((x) => x.type === 'setup');
        if (queuedSetup) queue.push(queuedSetup);
        else if (outcome === 'lobby') menus.goto('online-lobby');
        else menus.goto('net-waiting', { mode: 'waiting', text: mod.ONLINE_TEXT.loading });
      }
    }
  } finally {
    closeOnline(o);
  }
}

function matchText(match) {
  // the session keeps indices; WS6's matchEmoji is in the online chunk, net-waiting takes the text
  try { return onlineMod?.matchEmoji?.(match) ?? ''; } catch { return ''; }
}

/**
 * One online race on this machine (NETWORKING.md §9, §10.4–§10.6, §12). The host runs the real Race on the
 * host clock (rAF when visible, the tick pump when hidden); a guest runs a ReplicaRace (own karts predicted,
 * everything else interpolated). Resolves (through `done`) with 'again' | 'next-track' | 'restart' | 'lobby'
 * | 'leave' | { ended: text }.
 */
function startNetRace(setup, done, { net }) {
  const { mod, room, role, deviceIds } = net;
  const stack = mod.netStack;
  const host = role === 'host';
  const trackDef = getTrack(setup.trackId);
  const theme = trackDef.theme || {};
  const houseId = host ? 0 : room.session.state.houseId;
  const humans = mod.localHumans(setup, houseId, deviceIds);
  const allHumans = mod.allSetupHumans(setup, humans);
  const playerIndices = humans.map((p) => p.playerIndex);
  const laps = setup.laps;
  const timing = mod.raceTiming(stack);
  menus.hide(); // the "waiting for friends" / net-waiting screen goes; the race takes the screen

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.skyBottom ?? 0xffd6ec);
  if (theme.fogColor !== undefined) scene.fog = new THREE.Fog(theme.fogColor, theme.fogNear ?? 120, theme.fogFar ?? 700);
  const path = new TrackPath(trackDef.controlPoints, trackDef.width);
  const built = buildTrack(trackDef, path);
  scene.add(built.group);

  let completeAt = null;
  let resultsShown = false;
  let finished = false;
  let pauseOpen = false;
  let pendingResult = null;
  let pendingChoice = null;
  let lastSnaps = 0;
  let lastSnapAt = 0;
  const unplugged = new Set();
  const offs = [];
  const stats = createRaceStats();
  const helpers = createSessionHelpers({ humans, allHumans, audio, input, hud, getCharacter });
  let session = null;
  const onEvent = (e) => {
    stats.onEvent(e);
    if (e.type === 'race-complete') completeAt = race.clock;
    bus.emit(`race:${e.type}`, e, session);
  };
  const participants = mod.raceParticipants(setup);
  const buildModel = mod.netKartBuilder(buildKartModel, participants);

  let race;
  let link;
  let latch = null;
  let seats = null;
  let pump = null;
  let boxView = null;
  let itemView = null;
  if (host) {
    race = new Race({
      scene, trackDef, path, builtTrack: built, participants, speedClass: SPEED_CLASSES[setup.speedClass] ? setup.speedClass : 'zippy',
      buildKartModel: buildModel, onEvent, laps, rules: rulesForMode('free'), seed: setup.seed,
    });
    latch = mod.createInputLatch();
    link = mod.createHostNetRace({
      stack, race, transport: room.transport, setup, houses: mod.driverHouses(setup, 0, (h) => room.peerOf(h)), localInputs: () => latch.forTick(),
    });
    offs.push(room.router.on('loaded', (rc, peerId) => link.loaded(peerId)));
    offs.push(room.transport.onPeer((ev) => {
      if (ev.type !== 'leave') return;
      link.loaded(ev.peerId); // a house that left never holds the start
      for (const hid of mod.driverHouses(setup, 0, () => null).keys()) if (room.peerOf(hid) === null) link.setHouseRobo(hid, true);
    }));
    // a house came back with its ticket (§13.2): its new connection gets the race and its karts back
    offs.push(room.session.onEffect((e) => { if (e.type === 'reattach') link.reattach(e.houseId, e.peerId); }));
    room.router.setRace(link);
    room.session.dispatch({ type: 'phase', phase: 'loading' });
    room.transport.broadcast('ctrl', mod.encodeSetup(stack, setup));
    room.session.dispatch({ type: 'phase', phase: 'race' });
    // Hidden tab / starved rAF: the Worker pump drives the same host clock (§9.9).
    pump = mod.createTickPump({ onTick: (t) => { if (!finished) link.frame(t, 'pump'); } });
    pump.start();
    const onVis = () => {
      const hidden = document.visibilityState === 'hidden';
      link.clock.usePump(hidden);
      if (session) session.net.hostHidden = hidden;
    };
    document.addEventListener('visibilitychange', onVis);
    offs.push(() => document.removeEventListener('visibilitychange', onVis));
  } else {
    itemView = mod.createItemView({ scene });
    boxView = mod.createBoxView({ scene, slots: built.itemBoxSlots ?? [] });
    race = new mod.ReplicaRace({
      scene, trackDef, path, builtTrack: built,
      setup: { ...setup, participants, startTick: timing.startTick, goTick: timing.goTick },
      localKartIds: humans.map((h) => h.kartId), buildKartModel: buildModel, onEvent,
      predictTick: stack.predictTick, quantize: stack.wire.quantizeInput, countdownAfter: timing.countdownAfter, itemView, boxView,
    });
    seats = humans.map((h) => mod.createSeatSampler(h.kartId));
    link = mod.createGuestNetRace({ stack, replica: race, transport: room.transport, hostId: room.hostId, localSeats: seats });
    offs.push(room.router.on('result', (rc) => { if (rc.raceId === (setup.raceId >>> 0)) pendingResult = rc.summary; }));
    room.router.setRace(link);
    room.transport.send(room.hostId(), 'ctrl', mod.encodeLoaded(stack, setup.raceId));
  }
  online.race = link;
  online.racing = true;

  const rigs = humans.map(() => new CameraRig());
  const spectator = new SpectatorCam(path);
  // guests draw their karts at the smoothed render pose (prediction corrections decay, remotes interpolate)
  const camKarts = new Map();
  const camKart = (k) => {
    if (host || !k?.render) return k;
    let v = camKarts.get(k);
    if (!v) {
      v = Object.create(k, { position: { get: () => k.render.position }, heading: { get: () => k.render.heading } });
      camKarts.set(k, v);
    }
    return v;
  };
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
    mode: 'free', audio, input, hud, params, outcome: null,
    net: { role, paused: false, wobbly: false, hostHidden: false, raceId: setup.raceId },
    get paused() { return pauseOpen; },
    get resultsShown() { return resultsShown; },
    layout() {
      hud.layout(split.hudRects(playerIndices));
      rigs.forEach((r, i) => r.setAspect(split.aspect(i)));
      if (split.spectator) spectator.setAspect(split.aspect('spectator'));
    },
    tick,
    dispose,
  };
  game.modeController = null;
  audio.setMusicTempo?.(1);
  audio.playMusic(theme.music || 'castle');
  game.state = 'race';
  bus.emit('race-start', raceStartInfo({ setup, trackDef, humans, cpuIds: setup.cpuIds ?? [], laps }), session);
  try {
    const k0 = race.getPlayerKart(playerIndices[0]) || race.karts[0];
    rigs[0]?.snap(camKart(k0));
    renderer.compile(scene, rigs[0]?.camera || spectator.camera);
  } catch { /* compile is only an optimisation */ }

  // Online a controller that naps hands its kart to Robo Driver on this machine — never a pause for everyone.
  offs.push(input.onDeviceChange?.((ev) => {
    const who = humans.find((p) => p.deviceId === ev.deviceId);
    if (!who) return;
    if (ev.type === 'disconnected') {
      unplugged.add(who.playerIndex);
      const k = race.getPlayerKart(who.playerIndex);
      if (k) helpers.flash(k, mod.ONLINE_TEXT.controllerNap);
    } else if (ev.type === 'connected') unplugged.delete(who.playerIndex);
  }) || (() => {}));

  if (!host) {
    online.raceHooks = {
      choice(c) {
        // on the results the host's pick closes them; mid-race ("Back to the lobby" / "Start over" from the host's
        // pause) it ends this race at once, so nobody is left in a frozen race
        const act = mod.guestChoiceAction(c, resultsShown);
        if (act.end) { bus.emit('results-choice', { choice: act.end }, session); end(act.end); } else pendingChoice = c;
      },
      ended(text) { end({ ended: text }); },
      leave() { end('leave'); },
      newSetup(s) { if (mod.setupEndsRace(setup, s)) end('again'); },
    };
  } else {
    online.raceHooks = { leave() { end('leave'); } };
  }

  function openNetPause(p) {
    if (pauseOpen || resultsShown) return;
    pauseOpen = true;
    helpers.sfx('confirm');
    if (host) {
      // "Pause everyone 🍪": every machine freezes until the host keeps racing
      link.pauseAll(true);
      bus.emit('race-pause', { label: 'everyone' }, session);
      menus.showPause(mod.ONLINE_TEXT.pausedEveryone, { options: mod.HOST_PAUSE_OPTIONS, noPhoto: true }).then((choice) => {
        pauseOpen = false;
        link.pauseAll(false);
        bus.emit('race-resume', { choice }, session);
        input.clearMenuEvents?.();
        // every guest follows the host's pick right away (they are frozen in the same race)
        if (choice === 'restart') { broadcastChoice('restart'); end('restart'); } else if (choice === 'lobby') { broadcastChoice('lobby'); end('lobby'); }
      });
    } else {
      // a guest's pause is local: Robo Driver drives meanwhile, the race goes on for everyone (§4, §10.4)
      const k = race.getPlayerKart(p.playerIndex);
      if (k) helpers.flash(k, mod.ONLINE_TEXT.robo);
      bus.emit('race-pause', { label: 'robo', local: true }, session);
      menus.showPause(mod.ONLINE_TEXT.guestPauseLine, { options: mod.GUEST_PAUSE_OPTIONS, title: mod.ONLINE_TEXT.guestPauseTitle, emoji: '🤖', noPhoto: true }).then((choice) => {
        pauseOpen = false;
        bus.emit('race-resume', { choice }, session);
        input.clearMenuEvents?.();
        if (choice === 'leave') { online?.leave(); end('leave'); return; }
        const k2 = race.getPlayerKart(p.playerIndex);
        if (k2 && !finished) helpers.flash(k2, mod.ONLINE_TEXT.roboBack);
      });
    }
  }

  function broadcastChoice(choice) {
    try { room.transport.broadcast('ctrl', mod.jsonEncode({ type: 'CHOICE', screen: 'results', choice })); } catch { /* ignore */ }
  }

  function driveInputs() {
    const out = [];
    for (const p of humans) {
      if (unplugged.has(p.playerIndex)) { out[p.playerIndex] = null; continue; }
      out[p.playerIndex] = input.getDriveInput(p.deviceId);
    }
    return out;
  }

  function resultStandings(hostSummary) {
    return hostSummary.standings.map((r, i) => ({ ...r, finishPlace: r.place, name: getCharacter(r.characterId)?.name, id: i }));
  }

  function showResults(hostSummary, options, onChoice) {
    resultsShown = true;
    game.state = 'results';
    session.net.paused = false;
    const summary = mod.localRaceSummary(hostSummary, playerIndices, humans);
    bus.emit('race-end', summary, session);
    const unlocks = summary.unlocks
      .map((u) => ({ ...u, def: u.kind === 'track' ? findTrack(u.id) : getCharacter(u.id) }))
      .filter((u) => u.def);
    const standings = resultStandings(hostSummary);
    const humanWinner = hostSummary.winner ?? null;
    game.lastResults = {
      trackId: trackDef.id, mode: 'free', online: true, humanWinner,
      unlocks: summary.unlocks.map((u) => ({ kind: u.kind, id: u.id })),
      standings: standings.map((k) => ({ characterId: k.characterId, playerIndex: k.playerIndex, place: k.place })),
      summary, hostSummary,
    };
    audio.setMusicTempo?.(1);
    audio.playMusic('victory');
    hud.hide();
    const open = (u) => menus.showResults({ standings, trackDef, humanWinner, unlocks: u, summary, options }).then(onChoice);
    open(unlocks);
    return open;
  }

  function showHostResults() {
    const hostSummary = mod.buildHostRaceSummary({ setup, trackDef, standings: race.getStandings(), stats, laps, raceTime: race.time, local: humans });
    room.session.dispatch({ type: 'phase', phase: 'results' });
    const bytes = mod.encodeResult(stack, setup.raceId, hostSummary);
    for (const [peerId, p] of Object.entries(room.session.state.peers)) if (p.stage === 'joined') room.transport.send(peerId, 'ctrl', bytes);
    showResults(hostSummary, mod.HOST_RESULT_OPTIONS, (choice) => {
      bus.emit('results-choice', { choice }, session);
      broadcastChoice(choice);
      end(choice);
    });
  }

  let reopen = null;
  function showGuestResults(hostSummary) {
    reopen = showResults(hostSummary, mod.GUEST_RESULT_OPTIONS, onGuestChoice);
  }
  function onGuestChoice(choice) {
    if (finished) return;
    if (typeof choice === 'string' && choice.startsWith('host:')) {
      const c = choice.slice(5);
      bus.emit('results-choice', { choice: c }, session);
      end(c === 'lobby' ? 'lobby' : c === 'next-track' ? 'next-track' : 'again');
      return;
    }
    if (choice === 'leave') { online?.leave(); end('leave'); return; }
    reopen?.([]); // "Waiting for the host…" was picked: stay on the results (no repeat celebrations)
  }

  function end(outcome) {
    if (finished) return;
    finished = true;
    session.outcome = typeof outcome === 'string' ? outcome : 'leave';
    done(outcome);
  }

  function tick(dt) {
    if (finished) return;
    if (!pauseOpen && !resultsShown) {
      for (const p of humans) {
        if (input.isPausePressed(p.deviceId)) { openNetPause(p); break; }
      }
    }
    const inputs = driveInputs();
    if (host) {
      for (const p of humans) {
        if (!inputs[p.playerIndex]) {
          const k = race.getPlayerKart(p.playerIndex);
          inputs[p.playerIndex] = k ? aiDriveInput(race, k, 1 / 60) : null; // controller asleep: Robo Driver
        }
      }
      latch.setFrame(inputs);
      link.frame(performance.now(), 'raf');
      session.net.paused = link.paused;
      const houses = link.started ? Object.values(link.stats().houses ?? {}) : [];
      session.net.wobbly = houses.some((h) => h.robo);
      if (completeAt !== null && !resultsShown && race.clock - completeAt >= mod.RESULTS_DELAY_S) showHostResults();
    } else {
      const away = !!online?.reconnecting;
      humans.forEach((p, i) => seats[i].setFrame(inputs[p.playerIndex], { robo: pauseOpen || unplugged.has(p.playerIndex) || away }));
      session.net.reconnecting = away;
      session.net.reconnectText = away ? online.reconnectText : '';
      link.frame(dt);
      itemView.update(dt);
      boxView.update(dt);
      session.net.paused = link.paused;
      const snaps = link.stats().snapshots;
      const t = performance.now();
      if (snaps !== lastSnaps) { lastSnaps = snaps; lastSnapAt = t; }
      session.net.wobbly = snaps > 0 && !link.paused && !resultsShown && !away && t - lastSnapAt > 3000;
      if (pendingResult && !resultsShown) showGuestResults(pendingResult);
      if (pendingChoice && resultsShown) { const c = pendingChoice; pendingChoice = null; menus.resolveCurrent(`host:${c}`); }
    }
    if (finished) return;
    built.update(dt, race.clock);
    const frozen = session.net.paused;
    const countdown = race.state === 'countdown' ? race.countdown : null;
    humans.forEach((p, i) => {
      const kart = race.getPlayerKart(p.playerIndex);
      rigs[i].update(frozen ? 0 : dt, camKart(kart), { lookBack: !!inputs[p.playerIndex]?.lookBack && !resultsShown, countdown });
    });
    if (split.spectator) spectator.update(frozen ? 0 : dt, race);
    if (!resultsShown) hud.update(race, path, { playerIndices, portraits: game.portraits });
    bus.emit('race-frame', dt, session);
    split.render(scene, rigs.map((r) => r.camera), spectator.camera, viewHooks);
  }

  function dispose() {
    session.net.wobbly = false;
    session.net.reconnecting = false;
    session.net.paused = false;
    bus.emit('race-exit', { outcome: session.outcome }, session);
    offs.splice(0).forEach((off) => { try { off?.(); } catch { /* ignore */ } });
    try { pump?.dispose(); } catch { /* ignore */ }
    try { room.router.setRace(null); } catch { /* ignore */ }
    if (online) { online.race = null; online.racing = false; online.raceHooks = null; online.phase = null; }
    try { link.dispose(); } catch (err) { console.warn(err); }
    try { itemView?.dispose(); boxView?.dispose(); } catch (err) { console.warn(err); }
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

boot();
