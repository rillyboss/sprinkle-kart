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
import { buildParticipants, pickCpuCharacters, parseDebugParams, quickSetup, nextTrackId } from './game/setup.js';
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

  if (params.quick) {
    setup = quickSetup(params, input, CHARACTERS, TRACKS);
  }

  for (;;) {
    if (!setup) {
      game.state = 'menu';
      audio.playMusic('menu');
      bus.emit('menu-enter', { skipTitle, previous });
      setup = await menus.run({ skipTitle, previous });
    }
    previous = setup;
    let outcome = await playRace(setup);
    while (outcome === 'again' || outcome === 'next-track' || outcome === 'restart') {
      if (outcome === 'next-track') setup = { ...setup, trackId: nextTrackId(setup.trackId, TRACKS.filter((t) => isAvailable(t))) };
      previous = setup;
      outcome = await playRace(setup);
    }
    // 'menu' / 'quit' → back to the join screen with everyone still there.
    setup = null;
    skipTitle = true;
  }
}

/**
 * Build a race, run it to the results screen and resolve with what the
 * players picked next: 'again' | 'next-track' | 'menu' | 'restart' | 'quit'.
 */
function playRace(setup) {
  return new Promise((resolve) => {
    const session = startRace(setup, (outcome) => {
      session.dispose();
      if (activeSession === session) activeSession = null;
      game.race = null;
      resolve(outcome);
    });
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

function startRace(setup, done) {
  const trackDef = getTrack(setup.trackId);
  const theme = trackDef.theme || {};
  const humans = [...setup.players].sort((a, b) => a.playerIndex - b.playerIndex).slice(0, MAX_PLAYERS);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.skyBottom ?? 0xffd6ec);
  if (theme.fogColor !== undefined) {
    scene.fog = new THREE.Fog(theme.fogColor, theme.fogNear ?? 120, theme.fogFar ?? 700);
  }

  const path = new TrackPath(trackDef.controlPoints, trackDef.width);
  const built = buildTrack(trackDef, path);
  scene.add(built.group);

  const selectable = getSelectableCharacters((id) => progress.isUnlocked(id));
  const cpuCount = params.quick && params.cpus !== null
    ? Math.max(0, Math.min(RACERS_PER_RACE - humans.length, params.cpus))
    : RACERS_PER_RACE - humans.length;
  const cpuChars = pickCpuCharacters(humans.map((p) => p.characterId), selectable, cpuCount, Math.random);
  const participants = buildParticipants(humans, cpuChars);

  const laps = params.fastFinish ? 1 : (setup.laps || trackDef.laps || DEFAULT_LAPS);

  let completeAt = null;
  let resultsShown = false;
  let paused = false;
  let finished = false;
  let unsubDevice = null;

  const stats = createRaceStats();
  const helpers = createSessionHelpers({ humans, audio, input, hud, getCharacter });
  let session = null; // assigned below, before the first race.update()
  // Every Race event: count it, then forward it to the bus as 'race:<type>'.
  const onEvent = (e) => {
    stats.onEvent(e);
    if (e.type === 'race-complete') completeAt = race.clock;
    bus.emit(`race:${e.type}`, e, session);
  };
  const race = new Race({
    scene, trackDef, path, builtTrack: built, participants,
    speedClass: SPEED_CLASSES[setup.speedClass] ? setup.speedClass : 'zippy',
    buildKartModel, onEvent, laps,
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
    mode: setup.mode ?? 'free',
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
    // Subscribers (src/systems/progressUnlocks.js, ...) record progress and push into summary.unlocks.
    bus.emit('race-end', summary, session);
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
    menus.showResults({ standings, trackDef, humanWinner, newlyUnlocked, unlocks, summary }).then((choice) => {
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

function withoutEdges(inputs) {
  return inputs.map((i) => (i ? { ...i, useItem: false } : i));
}

boot();
