#!/usr/bin/env node
/**
 * Sprinkle Kart smoke test.
 *
 *   node scripts/smoke.mjs [filters...]      (or: npm run smoke)
 *   SMOKE_PORT=5310 node scripts/smoke.mjs cotton-candy-castle menu
 *
 * Starts its own Vite dev server (SMOKE_PORT, default 5190), drives system Chrome
 * (headless, SwiftShader WebGL) with Playwright and checks:
 *   1. every REGISTERED track (read from the live registry, so new tracks are covered
 *      automatically) in 1p; 4p for the Sprinkle Cup locally (CI: a couple of tracks,
 *      see scripts/smoke-plan.mjs), for any track named in the filters
 *      (`node scripts/smoke.mjs bubblegum-bay` → 1p + 4p) or for all tracks with
 *      SMOKE_FULL=1; plus a 3-player spectator run. Autodrive: no console/page errors,
 *      every kart moves forward, fps is reported;
 *   2. the full menu flow with keyboard presses (title → join → racer → track → race →
 *      pause → resume), the menus at full v2 size (?democontent=1), and the same flow
 *      with a (fake) standard gamepad;
 *   3. a 1-lap autodrive race that reaches the results screen and shows the
 *      Cotton Candy Girl unlock celebration (after resetting progress).
 *
 * Robust on slow machines (CI has no GPU: SwiftShader can run at 1–3 fps):
 *   - every wait is on a GAME condition (window.__game state / race.time / frame count /
 *     menu cooldown), never a fixed wall-clock sleep, so a slow frame rate only makes
 *     the run longer, not red;
 *   - timeouts scale with SMOKE_TIMEOUT_SCALE (4× in CI); a failed scenario is retried
 *     once (SMOKE_RETRIES) and reported as flaky if the retry passes;
 *   - in CI (env CI) the viewport is 800×450 at devicePixelRatio 1.
 * On failure: `<name>-FAIL.png` + `<name>-FAIL.log` (console dump + game state) in
 * smoke-out/, plus `smoke-out/summary.json` (and a GitHub job summary when available).
 * Stale *-FAIL.* files are cleared at the start. Exits non-zero on any failure.
 *
 * Adding a smoke case for a new screen: write an `async function myTest(t)` like
 * `menuFlowTest` (use the helpers: waitGame, waitMenusReady, pressKey, tapPad, driveFor,
 * t.check, t.shot — never fixed sleeps) and append one line to FLOW_TESTS.
 */
import { spawn, execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  ORIGINAL_TRACK_IDS, resolveProfile, timeoutFor, planScenarios, stalledKarts, isIgnorableError,
} from './smoke-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'smoke-out');
const PROFILE = resolveProfile(process.env);
const PORT = PROFILE.port;
const BASE = `http://localhost:${PORT}/`;
const only = process.argv.slice(2); // optional filters: e.g. "menu", "results", a track id
const T = (ms) => timeoutFor(PROFILE, ms);

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/-FAIL\.(png|log)$/.test(f)) rmSync(path.join(OUT, f), { force: true });

const failures = [];
const flaky = [];
const results = [];
const log = (...a) => console.log('[smoke]', ...a);
const fail = (name, msg) => { failures.push(`${name}: ${msg}`); console.log(`[smoke] FAIL ${name}: ${msg}`); };

/* ---------------- dev server ---------------- */

let server = null;
let serverOut = '';
function startServer() {
  server = spawn(`npx vite --port ${PORT} --strictPort`, {
    cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  server.stdout.on('data', (d) => { serverOut = (serverOut + d).slice(-20000); });
  server.stderr.on('data', (d) => { serverOut = (serverOut + d).slice(-20000); });
  server.on('exit', (code) => { if (code && code !== 0) log(`vite exited (${code})\n${serverOut}`); });
}
function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
    else server.kill('SIGTERM');
  } catch { /* already gone */ }
}
async function waitForServer(ms = T(40000)) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`vite dev server did not start\n${serverOut}`);
}
process.on('SIGINT', () => { stopServer(); process.exit(130); });

/* ---------------- page + game helpers ---------------- */

/** Track ids from the live registry (src/tracks/index.js via the dev server). */
async function registeredTrackIds(browser) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}?smoke-registry=1`, { timeout: T(60000) });
    const ids = await page.evaluate(async () => (await import('/src/tracks/index.js')).TRACKS.map((t) => t.id));
    if (!Array.isArray(ids) || !ids.length) throw new Error('no tracks registered');
    return ids;
  } catch (err) {
    fail('track-registry', err.message);
    return ORIGINAL_TRACK_IDS;
  } finally {
    await ctx.close().catch(() => {});
  }
}

/**
 * A fresh browser context + page for one scenario attempt.
 * `t.problems` collects failures of this attempt; `t.consoleLog` keeps everything the page said.
 */
async function newTestPage(browser, name) {
  const ctx = await browser.newContext({ viewport: PROFILE.viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.setDefaultTimeout(T(30000));
  const t = { ctx, page, name, errors: [], consoleLog: [], problems: [] };
  const note = (line) => { t.consoleLog.push(line); if (t.consoleLog.length > 400) t.consoleLog.shift(); };
  page.on('console', (m) => {
    note(`[${m.type()}] ${m.text()}`);
    if (m.type() === 'error' && !isIgnorableError(m.text())) t.errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => { note(`[pageerror] ${e.stack || e.message}`); t.errors.push(`pageerror: ${e.message}`); });
  page.on('requestfailed', (r) => {
    note(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`);
    // Fonts are a nice-to-have (offline families still get a rounded fallback).
    if (!isIgnorableError(r.url())) t.errors.push(`requestfailed: ${r.url()}`);
  });
  await ctx.addInitScript(() => {
    window.__smokeUiKey = () => {
      const g = window.__game;
      const u = document.querySelector('.sk-unlock:not(.sk-leaving)');
      const reveal = u ? `${u.classList.contains('sk-unlock-is-track') ? 'track' : 'character'}:${u.querySelector('.skp-ribbon')?.textContent ?? ''}:${u.textContent.length}` : '';
      return `${g?.state}|${g?.menus?.screenId}|${!!document.querySelector('.sk-cer-podium')}|${reveal}`;
    };
  });
  t.check = (ok, msg) => { if (!ok) t.problems.push(msg); return !!ok; };
  t.shot = (file) => page.screenshot({ path: path.join(OUT, file) });
  return t;
}

const gameInfo = (page) => page.evaluate(() => {
  const g = window.__game;
  if (!g) return null;
  const r = g.race;
  return {
    state: g.state,
    fps: g.fps,
    frames: g.frames,
    errors: g.errors,
    screen: g.menus?.screenId ?? null,
    menuCooldown: g.menus?._cooldown ?? null,
    raceState: r?.state ?? null,
    raceTime: r?.time ?? null,
    raceClock: r?.clock ?? null,
    karts: r ? r.karts.map((k) => ({ id: k.characterId, pi: k.playerIndex, progress: k.progress, s: k.s, lateral: k.lateral, speed: k.speed })) : [],
    lastResults: g.lastResults ? { ...g.lastResults, summary: undefined } : null,
  };
}).catch((err) => ({ unavailable: String(err?.message || err) }));

/** Wait for an in-page predicate (polled every 100 ms). */
async function waitGame(page, fn, arg, timeout, what) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
  } catch (err) {
    const info = await gameInfo(page);
    const brief = info && !info.unavailable
      ? ` (state=${info.state} screen=${info.screen} race=${info.raceState} t=${info.raceTime?.toFixed?.(1)} fps=${info.fps} frames=${info.frames})`
      : '';
    throw new Error(`timed out after ${Math.round(timeout / 1000)}s waiting for ${what}${brief}${/Timeout/.test(err.message) ? '' : `: ${err.message}`}`);
  }
}

/** Wait until the game loop has run `n` more frames (input is sampled once per frame). */
async function waitFrames(page, n = 1, timeout = T(20000)) {
  const f0 = await page.evaluate(() => window.__game?.frames ?? 0);
  await waitGame(page, ([f, k]) => (window.__game?.frames ?? 0) >= f + k, [f0, n], timeout, `${n} game frame(s)`);
}

/** Menus are showing a screen and are past their input cooldown (presses would be dropped before). */
async function waitMenusReady(page, timeout = T(20000)) {
  await waitGame(page, () => {
    const m = window.__game?.menus;
    return !!m?.screen && m._cooldown <= 0;
  }, null, timeout, 'menus to accept input');
}

/** Wait until the race is running and its clock has passed `seconds` (game time, not wall time). */
async function waitRaceTime(page, seconds, timeout = T(60000)) {
  await waitGame(page, (s) => window.__game?.race?.state === 'racing' && window.__game.race.time >= s,
    seconds, timeout, `race clock ${seconds.toFixed(1)}s`);
}

/** Current race time (0 during the countdown). */
const raceTime = (page) => page.evaluate(() => window.__game?.race?.time ?? 0);

/** Drive (game time) for `seconds` after GO. */
async function driveFor(page, seconds) {
  await waitGame(page, () => window.__game?.race?.state === 'racing', null, T(60000), 'GO');
  const t0 = await raceTime(page);
  await waitRaceTime(page, t0 + seconds);
}

/**
 * Press a keyboard key once the menus accept input (unless `inRace`), then let a frame
 * consume it. With `until`, retry (max `tries`) until the in-page predicate holds.
 */
async function pressKey(t, key, { until = null, arg = null, what = key, inRace = false, tries = 3, timeout = T(8000) } = {}) {
  for (let attempt = 1; ; attempt++) {
    if (!inRace) await waitMenusReady(t.page);
    await t.page.keyboard.press(key);
    await waitFrames(t.page, 1);
    if (!until) return;
    try {
      await waitGame(t.page, until, arg, timeout, what);
      return;
    } catch (err) {
      if (attempt >= tries) throw err;
      log(`${t.name}: ${key} did not reach "${what}" yet, pressing again (${attempt}/${tries - 1})`);
    }
  }
}

/** A fake standard-mapping controller injected before the page loads. */
const FAKE_PAD_SCRIPT = () => {
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: { playEffect: () => Promise.resolve('complete') },
  };
  window.__pad = {
    set(i, on) { pad.buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pad.timestamp++; },
    axis(i, v) { pad.axes[i] = v; pad.timestamp++; },
  };
  navigator.getGamepads = () => [pad, null, null, null];
};

/**
 * Press a pad button for EXACTLY one game frame, synchronised in the page with the game's own
 * 'frame' event (emitted after that frame's input poll): pressed for frame N, released before
 * frame N+1 polls, resolved after N+1. Releasing from node instead races the game loop: two
 * polls of a held d-pad more than 350 ms apart (slow CI frames) auto-repeat and skip an entry.
 */
async function padTapInPage(page, button, timeout = T(20000)) {
  await page.evaluate(([b, ms]) => new Promise((resolve, reject) => {
    const bus = window.__game?.bus;
    if (!bus) { reject(new Error('window.__game.bus missing')); return; }
    let n = 0;
    const timer = setTimeout(() => { off(); window.__pad.set(b, false); reject(new Error(`pad tap: no game frames for ${ms} ms`)); }, ms);
    const off = bus.on('frame', () => {
      n++;
      if (n === 1) window.__pad.set(b, false);
      else { off(); clearTimeout(timer); resolve(); }
    });
    window.__pad.set(b, true);
  }), [button, timeout]);
}

/**
 * Tap a pad button for exactly one sampled frame (never long enough to auto-repeat,
 * never so short that a slow frame misses it). Same retry rules as pressKey.
 */
async function tapPad(t, button, { until = null, arg = null, what = `button ${button}`, inRace = false, tries = 3, timeout = T(8000) } = {}) {
  for (let attempt = 1; ; attempt++) {
    if (!inRace) await waitMenusReady(t.page);
    await padTapInPage(t.page, button);
    if (!until) return;
    try {
      await waitGame(t.page, until, arg, timeout, what);
      return;
    } catch (err) {
      if (attempt >= tries) throw err;
      log(`${t.name}: button ${button} did not reach "${what}" yet, tapping again (${attempt}/${tries - 1})`);
    }
  }
}

/** Condition objects for pressKey / tapPad `{ ...cond }` and waitCond(page, cond). */
const onScreen = (id, what = `${id} screen`) => ({ until: (s) => window.__game?.menus?.screenId === s, arg: id, what });
const inState = (state, what = `game state "${state}"`) => ({ until: (s) => window.__game?.state === s, arg: state, what });
const waitCond = (page, c, timeout = T(30000)) => waitGame(page, c.until, c.arg, timeout, c.what);
/** In-page predicate (arg = n): at least n players joined on the join screen. */
const joinedAtLeast = (n) => (window.__game?.menus?.draft?.joinState?.players?.length ?? 0) >= n;

function checkErrors(t) {
  const errs = t.errors.filter((e) => !isIgnorableError(e));
  t.check(!errs.length, `errors:\n    ${errs.slice(0, 8).join('\n    ')}`);
}

/** Screenshot + console dump + game state for a failed attempt. */
async function writeDiagnostics(t, attempt, problems) {
  const suffix = attempt > 1 ? `-try${attempt}` : '';
  await t.page.screenshot({ path: path.join(OUT, `${t.name}${suffix}-FAIL.png`) }).catch(() => {});
  const info = await gameInfo(t.page);
  const text = [
    `scenario: ${t.name} (attempt ${attempt}, profile ${PROFILE.name}, viewport ${PROFILE.viewport.width}x${PROFILE.viewport.height})`,
    '', 'problems:', ...problems.map((p) => `  - ${p}`),
    '', 'game state:', JSON.stringify(info, null, 2),
    '', `console (last ${t.consoleLog.length} lines):`, ...t.consoleLog,
  ].join('\n');
  writeFileSync(path.join(OUT, `${t.name}${suffix}-FAIL.log`), text);
}

/* ---------------- scenarios ---------------- */

async function raceTest(t, { trackId, players }) {
  await t.page.goto(`${BASE}?quick=${trackId}&players=${players}&autodrive=1&simspeed=2`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'race' && !!window.__game.race, null, T(60000), 'race to start');
  const before = await gameInfo(t.page);
  // Game clock, not wall clock: slow CI frames just take longer.
  await waitRaceTime(t.page, PROFILE.driveSeconds, T(90000));
  const after = await gameInfo(t.page);
  await t.shot(`${t.name}.png`);
  if (!t.check(after && !after.unavailable, 'window.__game missing')) return;
  t.check(after.karts.length === 8, `expected 8 karts, got ${after.karts.length}`);
  const humans = after.karts.filter((k) => k.pi !== null);
  t.check(humans.length === players, `expected ${players} human karts, got ${humans.length}`);
  for (const p of stalledKarts(before.karts, after.karts)) t.check(false, p);
  t.check(after.fps > 0, `fps not reported (${after.fps})`);
  t.check(!after.errors?.length, `game loop errors: ${after.errors?.[0]}`);
  checkErrors(t);
  t.detail = `fps=${after.fps} raceTime=${after.raceTime?.toFixed(1)}s`;
}

async function menuFlowTest(t) {
  const shot = (n) => t.shot(`menu-${n}.png`);
  await t.page.goto(`${BASE}?unlockreset=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, T(60000), 'title screen');
  await waitMenusReady(t.page);
  await shot('1-title');
  await pressKey(t, 'Enter', onScreen('join', 'join screen')); // kb1 joins as P1
  await shot('2-join');
  await pressKey(t, 'Enter', onScreen('mode-select', 'mode select'));
  await waitMenusReady(t.page);
  await shot('2b-modes');
  await pressKey(t, 'Enter', onScreen('character-select', 'character select (Free Race)'));
  await shot('3-characters');
  await pressKey(t, 'KeyD');                 // move the cursor one step right
  await pressKey(t, 'Enter');                // lock in → everyone ready → track select (after a 1.1 s game-time beat)
  await waitCond(t.page, onScreen('track-select'));
  await waitMenusReady(t.page);
  await shot('4-tracks');
  await pressKey(t, 'Enter', { ...inState('race', 'race to start from menus'), timeout: T(30000) }); // RACE!
  await waitGame(t.page, () => (window.__game?.race?.clock ?? 0) > 1, null, T(60000), 'countdown');
  await shot('5-race-countdown');
  // wait for GO, then drive a bit with the keyboard
  await waitGame(t.page, () => window.__game?.race?.state === 'racing', null, T(60000), 'GO');
  const start = (await gameInfo(t.page)).karts.find((k) => k.pi === 0)?.progress ?? 0;
  await t.page.keyboard.down('KeyW');
  await driveFor(t.page, 3);
  await t.page.keyboard.up('KeyW');
  await shot('6-race-driving');
  const info = await gameInfo(t.page);
  const me = info.karts.find((k) => k.pi === 0);
  if (t.check(me, 'no P1 kart in the race')) {
    t.check(me.progress > start + 3, `P1 did not drive forward with W (progress ${start.toFixed(1)} → ${me.progress.toFixed(1)})`);
  }
  // pause and resume
  await pressKey(t, 'Escape', { inRace: true, ...inState('paused', 'Esc to pause') });
  await waitMenusReady(t.page);
  await shot('7-pause');
  await pressKey(t, 'Escape', inState('race', 'Esc to resume'));
  checkErrors(t);
}

/**
 * The menus at full v2 size (?democontent=1 pads them with locked placeholders
 * for all 21 racers and 20 tracks): the grid scrolls, tracks page by cup, and
 * locked tracks / racers can't be picked.
 */
async function menuScaleTest(t) {
  const shot = (n) => t.shot(`scale-${n}.png`);
  await t.page.goto(`${BASE}?unlockreset=1&democontent=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, T(60000), 'title screen');
  await pressKey(t, 'Enter', onScreen('join', 'join screen')); // kb1 joins as P1
  await pressKey(t, 'Slash', { until: joinedAtLeast, arg: 2, what: 'P2 to join' }); // kb2 joins as P2
  await pressKey(t, 'Enter', onScreen('mode-select', 'mode select'));
  await pressKey(t, 'Enter', onScreen('character-select', 'character select (Free Race)'));
  await waitMenusReady(t.page);
  const tiles = await t.page.evaluate(() => document.querySelectorAll('.sk-tile').length);
  t.check(tiles === 21, `expected 21 racer tiles, got ${tiles}`);
  const locked = await t.page.evaluate(() => document.querySelectorAll('.sk-tile-locked').length);
  t.check(locked === 13, `expected 13 locked racer tiles, got ${locked}`);
  await shot('1-characters');
  await pressKey(t, 'KeyS');                 // P1 down two rows (grid scrolls)
  await pressKey(t, 'KeyS');
  await shot('2-characters-scrolled');
  await pressKey(t, 'Enter');                // a locked racer: nope-wiggle, not ready
  await waitFrames(t.page, 2);
  t.check(!(await t.page.evaluate(() => !!document.querySelector('.sk-panel-ready'))), 'a locked racer was picked');
  await pressKey(t, 'KeyW');
  await pressKey(t, 'KeyW');
  await pressKey(t, 'Enter');                // P1 picks Rocco
  await pressKey(t, 'Slash');                // P2 picks too → track select
  await waitCond(t.page, onScreen('track-select'));
  await waitMenusReady(t.page);
  const cards = await t.page.evaluate(() => document.querySelectorAll('.sk-card').length);
  t.check(cards === 20, `expected 20 track cards, got ${cards}`);
  const tabs = await t.page.evaluate(() => document.querySelectorAll('.sk-cup-tab').length);
  t.check(tabs === 5, `expected 5 cup tabs, got ${tabs}`);
  await shot('3-tracks');
  for (let i = 0; i < 4; i++) await pressKey(t, 'KeyD'); // → first Bubble Cup track (locked)
  await shot('4-tracks-bubble-cup');
  await pressKey(t, 'Enter');
  await waitFrames(t.page, 3);
  t.check((await gameInfo(t.page)).state === 'menu', 'a locked track started a race');
  await pressKey(t, 'KeyA');                 // back to Sundae Slopes
  await pressKey(t, 'Enter', { ...inState('race', 'race to start from the big menus'), timeout: T(30000) });
  const setup = await t.page.evaluate(() => window.__game.setup);
  t.check(setup.trackId === 'sundae-slopes', `expected sundae-slopes, got ${setup.trackId}`);
  checkErrors(t);
}

async function gamepadFlowTest(t) {
  const shot = (n) => t.shot(`pad-${n}.png`);
  await t.ctx.addInitScript(FAKE_PAD_SCRIPT);
  await t.page.goto(`${BASE}?unlockreset=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, T(60000), 'title screen');
  await tapPad(t, 0, onScreen('join', 'join screen')); // A on title → pad joins as P1
  await tapPad(t, 3);                        // Y toggles Kid-Assist
  await shot('1-join');
  await tapPad(t, 0, onScreen('mode-select', 'mode select'));
  await tapPad(t, 0, onScreen('character-select', 'character select (Free Race)'));
  await tapPad(t, 15);                       // d-pad right (Lenny)
  await tapPad(t, 0);                        // lock in → track select
  await waitCond(t.page, onScreen('track-select'));
  await tapPad(t, 15);                       // next track (Gumdrop Meadow)
  await shot('2-tracks');
  await tapPad(t, 0, { ...inState('race', 'race to start with the controller'), timeout: T(30000) });
  const setup = await t.page.evaluate(() => window.__game.setup);
  t.check(setup.players[0]?.deviceId === 'gp0', `P1 should be gp0, got ${setup.players[0]?.deviceId}`);
  t.check(!!setup.players[0]?.easyDrive, 'Y did not toggle Kid-Assist');
  t.check(setup.trackId === 'gumdrop-meadow', `expected gumdrop-meadow, got ${setup.trackId}`);
  t.check(setup.players[0]?.characterId === 'lenny', `expected lenny, got ${setup.players[0]?.characterId}`);
  await waitGame(t.page, () => window.__game?.race?.state === 'racing', null, T(60000), 'GO');
  const start = await t.page.evaluate(() => window.__game.race.getPlayerKart(0).progress);
  await t.page.evaluate(() => window.__pad.set(7, true)); // hold RT
  await driveFor(t.page, 2.5);
  const after = await t.page.evaluate(() => window.__game.race.getPlayerKart(0).progress);
  t.check(after > start + 3, `RT did not drive (progress ${start.toFixed(1)} → ${after.toFixed(1)})`);
  // steer right with the stick: lateral should go up (right = +lateral)
  const lat0 = await t.page.evaluate(() => window.__game.race.getPlayerKart(0).lateral);
  await t.page.evaluate(() => window.__pad.axis(0, 1));
  await driveFor(t.page, 0.6);
  const lat1 = await t.page.evaluate(() => window.__game.race.getPlayerKart(0).lateral);
  await t.page.evaluate(() => window.__pad.axis(0, 0));
  t.check(lat1 > lat0, `stick right did not steer right (lateral ${lat0.toFixed(2)} → ${lat1.toFixed(2)})`);
  await shot('3-race');
  await tapPad(t, 9, { inRace: true, ...inState('paused', 'Start to pause') });
  await waitMenusReady(t.page);
  await shot('4-pause');
  await tapPad(t, 9, inState('race', 'Start to resume'));
  checkErrors(t);
}

/** In-page: a key for the reveal on screen ('' when none), so a press can wait for it to change. */
const revealKey = () => {
  const u = document.querySelector('.sk-unlock:not(.sk-leaving)');
  return u ? `${u.classList.contains('sk-unlock-is-track') ? 'track' : 'character'}:${u.querySelector('.skp-ribbon')?.textContent ?? ''}:${u.textContent.length}` : '';
};

/** Dismiss every unlock reveal in a row (each one only once it may continue). Returns their keys. */
async function dismissUnlocks(t, max = 12) {
  const seen = [];
  for (let i = 0; i < max; i++) {
    await waitGame(t.page, () => !!document.querySelector('.sk-unlock.sk-can-continue:not(.sk-leaving)'), null, T(30000), `unlock reveal ${i + 1} ready to continue`);
    const key = await t.page.evaluate(revealKey);
    seen.push(key);
    await pressKey(t, 'Enter', { until: (prev) => {
      const u = document.querySelector('.sk-unlock:not(.sk-leaving)');
      const now = u ? `${u.classList.contains('sk-unlock-is-track') ? 'track' : 'character'}:${u.querySelector('.skp-ribbon')?.textContent ?? ''}:${u.textContent.length}` : '';
      return now !== prev;
    }, arg: key, what: `unlock reveal ${i + 1} to close` });
    // the next unlock (if any) follows after a 0.7 s game-time breath
    const t0 = await t.page.evaluate(() => window.__game?.menus?.time ?? 0);
    await waitGame(t.page, (m0) => !!document.querySelector('.sk-unlock:not(.sk-leaving)') || (window.__game?.menus?.time ?? 0) >= m0 + 1.6,
      t0, T(30000), 'next unlock reveal or none');
    if (!(await t.page.evaluate(() => !!document.querySelector('.sk-unlock:not(.sk-leaving)')))) break;
  }
  return seen;
}

async function resultsTest(t) {
  await t.page.goto(`${BASE}?quick=cotton-candy-castle&players=1&cpus=0&autodrive=1&fastfinish=1&unlockreset=1&simspeed=6&speed=zoomy`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'race', null, T(60000), 'race to start');
  await waitGame(t.page, () => window.__game?.state === 'results', null, T(240000), 'results screen');
  await waitMenusReady(t.page);
  await t.shot('results.png');
  await waitGame(t.page, () => !!document.querySelector('.sk-unlock'), null, T(30000), 'unlock celebration');
  await waitFrames(t.page, 3);
  await t.shot('results-unlock.png');
  const info = await gameInfo(t.page);
  t.check(info.lastResults?.newlyUnlocked === 'cotton-candy-girl', `unlock not recorded: ${JSON.stringify(info.lastResults)}`);
  const saved = await t.page.evaluate(() => JSON.parse(localStorage.getItem('sprinkle-kart-progress-v1') || '{}'));
  t.check(saved.unlocked?.includes('cotton-candy-girl'), 'unlock not saved to localStorage');
  // mashing A right away must NOT skip the reveal
  await t.page.keyboard.press('Enter');
  await waitFrames(t.page, 1);
  t.check(await t.page.evaluate(() => !!document.querySelector('.sk-unlock:not(.sk-leaving)')), 'unlock reveal was skipped by an early press');
  // once each reveal has had its moment, dismiss it (the rule engine may celebrate several
  // unlocks in a row), then pick "Race again" → a new race starts
  await dismissUnlocks(t);
  await waitMenusReady(t.page);
  await t.shot('results-after.png');
  await pressKey(t, 'Enter', { ...inState('race', 'next race after results'), timeout: T(15000) });
  checkErrors(t);
}

/**
 * Progression: the Sticker Book and Grown-ups corner from the title screen with the
 * keyboard, the parent gate unlocking everything, and a 3-unlock celebration sequence.
 */
async function progressionTest(t) {
  const shot = (n) => t.shot(`progress-${n}.png`);
  const has = (sel) => t.page.evaluate((q) => !!document.querySelector(q), sel);
  const saved = () => t.page.evaluate(() => JSON.parse(localStorage.getItem('sprinkle-kart-progress-v1') || '{}'));
  /** From the title screen: focus the menu entries, walk right to the one matching `re`, open it. */
  const openEntry = async (re, screenId) => {
    const idx = await t.page.evaluate((src) => [...document.querySelectorAll('.sk-title-entry')].findIndex((b) => new RegExp(src).test(b.textContent)), re);
    if (idx < 0) throw new Error(`no title entry matching ${re}`);
    await pressKey(t, 'KeyS');
    for (let i = 0; i < idx; i++) await pressKey(t, 'KeyD');
    await pressKey(t, 'Enter', onScreen(screenId));
    await waitMenusReady(t.page);
  };
  await t.page.goto(`${BASE}?unlockreset=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-title'), null, T(60000), 'title screen');
  await waitMenusReady(t.page);
  const chips = await t.page.evaluate(() => [...document.querySelectorAll('.sk-title-entry')].map((b) => b.textContent));
  t.check(chips.some((c) => /Sticker Book/.test(c)) && chips.some((c) => /Grown-ups/.test(c)), `title entries: ${JSON.stringify(chips)}`);
  await openEntry('Sticker Book', 'collection');
  t.check(await has('.skp-book'), 'Sticker Book did not open');
  const counts = await t.page.evaluate(() => [
    document.querySelectorAll('.skp-sticker').length, document.querySelectorAll('.skp-tsticker').length,
    window.__game.menus.characters.length, window.__game.menus.tracks.length,
  ]);
  // the book shows the whole v2 lineup (21 racers, 20 tracks), registered or not
  t.check(counts[0] === 21 && counts[1] === 20, `expected 21 racer + 20 track stickers, got ${counts.slice(0, 2)}`);
  await shot('1-book');
  await pressKey(t, 'Tab');
  await waitFrames(t.page, 2);
  await shot('2-book-tracks');
  await pressKey(t, 'Tab');
  await waitFrames(t.page, 2);
  await shot('3-book-totals');
  await pressKey(t, 'Escape', onScreen('title', 'B back to the title'));
  await openEntry('Grown-ups', 'settings');
  t.check(await has('.skp-settings'), 'Grown-ups corner did not open');
  for (let i = 0; i < 3; i++) await pressKey(t, 'KeyS');
  await pressKey(t, 'Enter', { until: () => !!document.querySelector('.skp-gate-q'), what: 'parent gate' }); // Unlock everything
  await pressKey(t, 'Enter', { until: () => /not quite/.test(document.querySelector('.skp-gate-oops')?.textContent ?? ''), what: 'wrong-answer hint' }); // 0 = wrong
  t.check(!(await saved()).unlockAll, 'a wrong gate answer unlocked everything');
  const answer = await t.page.evaluate(() => { const m = document.querySelector('.skp-gate-q').textContent.match(/(\d+)\D+(\d+)/); return Number(m[1]) + Number(m[2]); });
  for (let i = 0; i < answer; i++) await pressKey(t, 'KeyW');
  await shot('4-gate');
  await pressKey(t, 'Enter', { until: () => JSON.parse(localStorage.getItem('sprinkle-kart-progress-v1') || '{}').unlockAll === true, what: 'parent gate to unlock everything' });
  await waitMenusReady(t.page);
  await shot('5-unlocked');
  await pressKey(t, 'Enter', { until: () => !document.querySelector('.skp-modal:not([hidden])'), what: 'done card to close' });
  await pressKey(t, 'Escape', onScreen('title', 'back to the title'));
  await pressKey(t, 'Enter', onScreen('join', 'join screen'));
  await pressKey(t, 'Enter', { until: () => window.__game?.menus?.screenId !== 'join', what: 'leave join' });
  if (await t.page.evaluate(() => window.__game?.menus?.screenId === 'mode-select')) {
    await pressKey(t, 'Enter', onScreen('character-select', 'character select (Free Race)'));
  }
  await waitCond(t.page, onScreen('character-select'));
  await waitFrames(t.page, 2);
  const locked = await t.page.evaluate(() => document.querySelectorAll('.sk-tile-locked').length);
  t.check(locked === 0, `unlock everything left ${locked} locked racer tiles`);
  // A 3-unlock celebration, straight through the results screen.
  await t.page.evaluate(() => {
    const m = window.__game.menus;
    const c = m.characters;
    const standings = c.slice(0, 8).map((d, i) => ({ characterId: d.id, playerIndex: i ? null : 0, isCPU: !!i, finishPlace: i + 1, finished: true, finishTime: 70 + i }));
    window.__smokeResults = m.showResults({ standings, trackDef: m.tracks[0], humanWinner: standings[0], unlocks: [
      { kind: 'character', id: c[8].id, def: c[8] }, { kind: 'track', id: m.tracks[1].id, def: m.tracks[1] }, { kind: 'character', id: c[3].id, def: c[3] },
    ] });
  });
  await waitGame(t.page, () => !!document.querySelector('.sk-unlock.sk-can-continue:not(.sk-leaving)'), null, T(30000), 'first reveal');
  await shot('6-reveal');
  const seen = (await dismissUnlocks(t, 3)).map((k) => k.split(':').slice(0, 2).join(':'));
  const want = ['character:Surprise 1 of 3!', 'track:Surprise 2 of 3!', 'character:Surprise 3 of 3!'];
  t.check(JSON.stringify(seen) === JSON.stringify(want), `reveal sequence ${JSON.stringify(seen)}`);
  t.check(!(await has('.sk-unlock:not(.sk-leaving)')), 'a reveal stayed up after the sequence');
  checkErrors(t);
}

/**
 * Press A (Enter) through results / standings / unlock reveals until `done` holds in the page.
 * Each press waits for the screen to change (a reveal may not be dismissed before its minimum
 * show time, and intros are skipped by the first press).
 */
async function pressThrough(t, done, what, max = 24) {
  for (let i = 0; i < max; i++) {
    if (await t.page.evaluate(done)) return;
    await waitGame(t.page, () => {
      const u = document.querySelector('.sk-unlock:not(.sk-leaving)');
      return !u || u.classList.contains('sk-can-continue');
    }, null, T(30000), 'unlock reveal ready to continue');
    if (await t.page.evaluate(done)) return;
    const before = await t.page.evaluate(() => window.__smokeUiKey());
    try {
      await pressKey(t, 'Enter', { until: (prev) => window.__smokeUiKey() !== prev, arg: before, what: `${what} (step ${i + 1})`, tries: 1, timeout: T(4000) });
    } catch { /* e.g. an intro skip: nothing visible changed; press again */ }
  }
  await waitGame(t.page, done, null, T(5000), what);
}

/**
 * Modes (modes + timing workstream): mode select → Records → Grand Prix → cup select in
 * the menus, a whole 4-race Grand Prix (?mode=gp&cup=...) through the standings and the
 * trophy ceremony, and a Time Trial (?mode=tt&quick=...) twice so the second run races
 * the saved ghost.
 */
async function modesMenuTest(t) {
  const shot = (n) => t.shot(`modes-${n}.png`);
  await t.page.goto(`${BASE}?unlockreset=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, T(60000), 'title screen');
  await pressKey(t, 'Enter', onScreen('join', 'join screen'));          // P1 joins
  await pressKey(t, 'Enter', onScreen('mode-select', 'mode select'));
  await waitMenusReady(t.page);
  const cards = await t.page.evaluate(() => document.querySelectorAll('.sk-mode-card').length);
  t.check(cards === 5, `expected 5 mode cards, got ${cards}`);
  await shot('1-select');
  await pressKey(t, 'KeyS');                                            // down → Records
  await pressKey(t, 'Enter', onScreen('records', 'Records'));
  await waitMenusReady(t.page);
  await shot('2-records');
  await pressKey(t, 'Escape', onScreen('mode-select', 'back from Records'));
  await pressKey(t, 'KeyD');                                            // → Grand Prix
  await pressKey(t, 'Enter', onScreen('character-select', 'character select (Grand Prix)'));
  await pressKey(t, 'Enter');                                           // pick a racer → cup select
  await waitCond(t.page, onScreen('cup-select'));
  await waitMenusReady(t.page);
  await shot('3-cups');
  await pressKey(t, 'Enter', { ...inState('race', 'the cup to start'), timeout: T(30000) }); // Sprinkle Cup!
  const setup = await t.page.evaluate(() => window.__game.setup);
  t.check(setup.mode === 'grand-prix' && setup.cupId === 'sprinkle-cup' && setup.trackId === 'cotton-candy-castle', `bad GP setup ${JSON.stringify(setup)}`);
  const karts = await t.page.evaluate(() => window.__game.race.karts.length);
  t.check(karts === 8, `expected 8 karts in a GP race, got ${karts}`);
  checkErrors(t);
}

async function grandPrixTest(t) {
  const shot = (n) => t.shot(`gp-${n}.png`);
  await t.page.goto(`${BASE}?mode=gp&cup=sprinkle-cup&players=2&autodrive=1&fastfinish=1&simspeed=8&speed=zoomy&unlockreset=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'race', null, T(60000), 'GP race 1');
  await t.page.evaluate(() => {
    window.__gpEvents = [];
    window.__game.bus.on('gp-race-end', (gp) => window.__gpEvents.push(['race', gp.raceIndex, gp.finished]));
    window.__game.bus.on('gp-end', (gp) => window.__gpEvents.push(['end', gp.raceIndex, gp.standings.length]));
  });
  for (let r = 0; r < 4; r++) {
    await waitGame(t.page, () => window.__game?.state === 'results', null, T(240000), `GP race ${r + 1} results`);
    await waitMenusReady(t.page);
    if (r === 0) await t.shot('gp-1-results.png');
    // continue (dismissing any unlock celebrations first) → standings
    await pressThrough(t, () => window.__game?.menus?.screenId === 'gp-standings', `standings after race ${r + 1}`);
    // let the points tally count up, then continue
    await waitGame(t.page, () => !!document.querySelector('.sk-gp-opts.sk-show'), null, T(30000), `standings ${r + 1} options`);
    await shot(`2-standings-${r + 1}`);
    if (r < 3) await pressThrough(t, () => window.__game?.state === 'race', `GP race ${r + 2} to start`);
    else await pressThrough(t, () => !!document.querySelector('.sk-cer-podium'), 'trophy ceremony');
  }
  await waitGame(t.page, () => document.querySelectorAll('.sk-cer-podium .sk-trophy').length >= 3 || document.querySelectorAll('.sk-trophy').length >= 3, null, T(20000), 'trophies on the podium');
  // the podium has finished rising once the ceremony's options show
  await waitGame(t.page, () => !!document.querySelector('.sk-cer-podium') && !!document.querySelector('.sk-gp-opts.sk-show'), null, T(30000), 'ceremony options');
  await waitFrames(t.page, 3);
  await shot('3-ceremony');
  const info = await t.page.evaluate(() => ({ ev: window.__gpEvents, gp: window.__game.lastGp, cer: !!document.querySelector('.sk-cer-podium'), cups: document.querySelectorAll('.sk-trophy').length }));
  const want = JSON.stringify([['race', 0, false], ['race', 1, false], ['race', 2, false], ['race', 3, true], ['end', 3, 8]]);
  t.check(JSON.stringify(info.ev) === want, `GP events ${JSON.stringify(info.ev)} != ${want}`);
  t.check(info.gp?.finished && info.gp.races.length === 4, `GP not finished after 4 races: ${JSON.stringify(info.gp?.raceIndex)}`);
  t.check(info.cer && info.cups === 3, `no trophy ceremony (podium ${info.cer}, cups ${info.cups})`);
  const pts = info.gp?.standings?.reduce((a, row) => a + row.points, 0);
  t.check(pts === 4 * 58, `points should total ${4 * 58}, got ${pts}`);
  t.detail = `winner=${info.gp?.standings?.[0]?.characterId}`;
  checkErrors(t);
}

async function timeTrialTest(t) {
  const shot = (n) => t.shot(`tt-${n}.png`);
  await t.page.goto(`${BASE}?mode=tt&quick=gumdrop-meadow&players=3&autodrive=1&fastfinish=1&simspeed=6&speed=zoomy&unlockreset=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'race' && window.__game.race?.state === 'racing', null, T(60000), 'time trial to start');
  const race = await t.page.evaluate(() => ({ karts: window.__game.race.karts.length, item: window.__game.race.karts[0].item, charges: window.__game.race.karts[0].itemCharges, boxes: window.__game.race.itemBoxes.boxes.length }));
  t.check(race.karts === 1, `a Time Trial is solo, got ${race.karts} karts`);
  t.check(race.boxes === 0, `no item boxes in a Time Trial, got ${race.boxes}`);
  t.check(race.item === 'triple-sprinkle' && race.charges >= 2, `should start with 3 sprinkle boosts, got ${race.item} x${race.charges}`);
  await waitFrames(t.page, 2);
  const timer = await t.page.evaluate(() => document.querySelector('.sk-timer-t')?.textContent);
  t.check(/^\d+:\d\d\.\d\d$/.test(timer || ''), `race timer not showing (${timer})`);
  await waitGame(t.page, () => window.__game?.state === 'results', null, T(240000), 'time trial results');
  await waitMenusReady(t.page);
  await shot('1-results');
  t.check(await t.page.evaluate(() => window.__game.menus.screenId) === 'time-trial-results', 'time trial results screen not shown');
  const saved = await t.page.evaluate(() => JSON.parse(localStorage.getItem('sprinkle-kart-ghosts-v1') || '{}'));
  t.check(!!saved['gumdrop-meadow']?.['1']?.data, 'ghost not saved');
  const rec = await t.page.evaluate(() => JSON.parse(localStorage.getItem('sprinkle-kart-progress-v1') || '{}').records?.['gumdrop-meadow']);
  t.check(rec?.bestLap > 0, `best lap not saved via submitRecord (${JSON.stringify(rec)})`);
  await pressThrough(t, () => window.__game?.state === 'race', 'Try again → a run against the ghost');
  await waitGame(t.page, () => window.__game?.race?.state === 'racing', null, T(60000), 'second run GO');
  await driveFor(t.page, 1.5);
  await shot('2-vs-ghost');
  const tt = await t.page.evaluate(() => ({ tt: window.__game.timeTrial, gap: window.__game.race.modeInfo.ghostGap, ghost: !!window.__game.session.scene.getObjectByName('time-trial-ghost') }));
  t.check(tt.tt?.ghost && tt.ghost, 'second run has no ghost');
  t.check(Number.isFinite(tt.gap), `ghost gap not computed (${tt.gap})`);
  await waitGame(t.page, () => window.__game?.state === 'results', null, T(240000), 'second results');
  t.detail = `gap=${tt.gap?.toFixed?.(2)}`;
  checkErrors(t);
}

/**
 * Bubble Pop Battle (showcase features): the arena select in the menus, then a whole
 * 2-player battle (?mode=battle) — bubbles float over the karts, the battle HUD replaces the
 * lap / place / timer, items pop bubbles and the battle ends on the battle results screen.
 */
async function battleTest(t) {
  const shot = (n) => t.shot(`battle-${n}.png`);
  await t.page.goto(`${BASE}?unlockreset=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, T(60000), 'title screen');
  await pressKey(t, 'Enter', onScreen('join', 'join screen'));
  await pressKey(t, 'Enter', onScreen('mode-select', 'mode select'));
  await waitMenusReady(t.page);
  await pressKey(t, 'KeyA');                                            // wrap left → Bubble Battle (last card)
  await waitGame(t.page, () => document.querySelector('.sk-mode-card.sk-sel')?.classList.contains('sk-mode-battle'), null, T(8000), 'Bubble Battle card focused');
  await pressKey(t, 'Enter', onScreen('character-select', 'character select (battle)'));
  await pressKey(t, 'Enter', onScreen('arena-select', 'arena select'));
  await waitMenusReady(t.page);
  await shot('1-arenas');
  const arenas = await t.page.evaluate(() => document.querySelectorAll('.skb-arena').length);
  t.check(arenas >= 2, `expected 2+ arena cards, got ${arenas}`);
  await t.page.goto(`${BASE}?mode=battle&arena=bubble-bath-bowl&players=2&autodrive=1&simspeed=8&speed=zoomy&unlockreset=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'race' && window.__game.race?.state === 'racing', null, T(60000), 'battle to start');
  await driveFor(t.page, 4);
  await waitFrames(t.page, 2);
  await shot('2-arena');
  const live = await t.page.evaluate(() => {
    const g = window.__game;
    const vis = (sel) => { const n = document.querySelector(sel); return !!n && !n.hidden && getComputedStyle(n).display !== 'none'; };
    return {
      mode: g.setup.mode,
      track: g.race.trackDef.id,
      karts: g.race.karts.length,
      bubbles: g.race.karts.filter((k) => k.model?.group.getObjectByName(`battle-bubbles-${k.id}`)).length,
      battle: !!g.race.modeInfo.battle,
      hud: vis('.skb-hud'),
      lap: vis('.sk-lap'),
      timer: vis('.sk-timer'),
      clock: document.querySelector('.skb-hud-clock')?.textContent,
    };
  });
  t.check(live.mode === 'battle' && live.track === 'bubble-bath-bowl', `bad battle setup ${JSON.stringify(live)}`);
  t.check(live.karts === 8 && live.bubbles === 8, `every kart should float bubbles (${live.bubbles}/${live.karts})`);
  t.check(live.battle && live.hud && /^\d:\d\d$/.test(live.clock || ''), `battle HUD missing (${JSON.stringify(live)})`);
  t.check(!live.lap && !live.timer, 'lap pill / race timer should hide in a battle');
  await waitGame(t.page, () => window.__game?.state === 'results', null, T(400000), 'battle results');
  await waitMenusReady(t.page);
  await waitGame(t.page, () => !!document.querySelector('.sk-gp-opts.sk-show') || !!document.querySelector('.sk-unlock'), null, T(30000), 'battle results options');
  await shot('3-results');
  const res = await t.page.evaluate(() => ({ screen: window.__game.menus.screenId, battle: window.__game.lastResults?.summary?.battle, rows: document.querySelectorAll('.skb-row').length }));
  t.check(res.screen === 'battle-results', `battle results screen not shown (${res.screen})`);
  t.check(res.rows === 8 && res.battle?.ranking?.length === 8, `battle ranking missing (${res.rows} rows)`);
  t.check(res.battle?.ranking?.[0]?.place === 1, 'battle ranking has no winner');
  const popped = res.battle.ranking.reduce((a, r) => a + r.popped, 0);
  t.check(popped > 0, 'nobody popped a bubble in a whole battle');
  t.detail = `reason=${res.battle.reason} pops=${popped}`;
  checkErrors(t);
}

/**
 * Team Race (showcase features): a 2-player team race (?mode=team) shows the live team
 * score, puts a team badge on every kart and ends on the team results screen.
 */
async function teamTest(t) {
  const shot = (n) => t.shot(`team-${n}.png`);
  await t.page.goto(`${BASE}?quick=gumdrop-meadow&mode=team&players=2&autodrive=1&fastfinish=1&simspeed=6&speed=zoomy&unlockreset=1`, { timeout: T(60000) });
  await waitGame(t.page, () => window.__game?.state === 'race' && window.__game.race?.state === 'racing', null, T(60000), 'team race to start');
  await driveFor(t.page, 3);
  await waitFrames(t.page, 2);
  await shot('1-race');
  const live = await t.page.evaluate(() => {
    const g = window.__game;
    const teams = g.race.karts.map((k) => k.team);
    return {
      mode: g.setup.mode,
      home: teams.filter((x) => x === 'sprinkle').length,
      humansHome: g.race.karts.filter((k) => !k.isCPU).every((k) => k.team === 'sprinkle'),
      badges: g.race.karts.filter((k) => k.model?.group.getObjectByName(`team-badge-${k.id}`)).length,
      hud: document.querySelector('.skt-hud:not([hidden])')?.textContent ?? '',
    };
  });
  t.check(live.mode === 'team' && live.home === 4 && live.humansHome, `bad teams ${JSON.stringify(live)}`);
  t.check(live.badges === 8, `every kart should wear a team badge (${live.badges})`);
  t.check(/\d+\s*—\s*\d+/.test(live.hud), `team score HUD missing (${live.hud})`);
  await waitGame(t.page, () => window.__game?.state === 'results', null, T(300000), 'team results');
  await waitMenusReady(t.page);
  await waitGame(t.page, () => !!document.querySelector('.sk-gp-opts.sk-show') || !!document.querySelector('.sk-unlock'), null, T(30000), 'team results options');
  await shot('2-results');
  const res = await t.page.evaluate(() => ({ screen: window.__game.menus.screenId, team: window.__game.lastResults?.summary?.team, sides: document.querySelectorAll('.skt-side').length }));
  t.check(res.screen === 'team-results', `team results screen not shown (${res.screen})`);
  t.check(res.sides === 2, `expected 2 team boards, got ${res.sides}`);
  t.check(res.team && res.team.totals.sprinkle + res.team.totals.sparkle === 58, `team points should total 58 (${JSON.stringify(res.team?.totals)})`);
  t.detail = `score=${res.team?.totals?.sprinkle}-${res.team?.totals?.sparkle}`;
  checkErrors(t);
}

/**
 * Non-race scenarios in run order: name (also its CLI filter) → async (t) => {...}.
 * To add one, append your function above and one line here — nothing else to edit.
 */
const FLOW_TESTS = {
  'menu-flow': menuFlowTest,
  'menu-scale': menuScaleTest,
  'gamepad-flow': gamepadFlowTest,
  'results-unlock': resultsTest,
  progression: progressionTest,
  'modes-menu': modesMenuTest,
  'modes-grand-prix': grandPrixTest,
  'modes-time-trial': timeTrialTest,
  'modes-battle': battleTest,
  'modes-team': teamTest,
};

/* ---------------- runner ---------------- */

/** Run one scenario; retry a failed attempt (PROFILE.retries) with fresh diagnostics each time. */
async function runScenario(browser, sc) {
  const fn = sc.kind === 'race' ? raceTest : FLOW_TESTS[sc.name];
  if (!fn) { fail(sc.name, 'unknown scenario'); return; }
  const t0 = Date.now();
  let lastProblems = [];
  let detail = '';
  const attempts = PROFILE.retries + 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const t = await newTestPage(browser, sc.name);
    try {
      await fn(t, sc);
    } catch (err) {
      t.problems.push(err.message);
    }
    if (t.problems.length) await writeDiagnostics(t, attempt, t.problems);
    detail = t.detail || '';
    lastProblems = t.problems;
    await t.ctx.close().catch(() => {});
    if (!lastProblems.length) {
      if (attempt > 1) flaky.push(sc.name);
      log(`${sc.name}: ok${attempt > 1 ? ` (flaky: passed on try ${attempt})` : ''}  ${detail}  [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
      break;
    }
    if (attempt < attempts) log(`${sc.name}: attempt ${attempt} failed (${lastProblems[0].split('\n')[0]}), retrying once…`);
  }
  for (const p of lastProblems) fail(sc.name, p);
  results.push({ name: sc.name, ok: !lastProblems.length, flaky: flaky.includes(sc.name), seconds: Math.round((Date.now() - t0) / 1000), detail, problems: lastProblems });
}

function writeSummary(totalSeconds) {
  const summary = { profile: PROFILE, filters: only, totalSeconds, failures, flaky, results };
  writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => `| ${r.ok ? (r.flaky ? '🟡' : '✅') : '❌'} | ${r.name} | ${r.seconds}s | ${(r.ok ? r.detail : r.problems[0] || '').replace(/\|/g, '\\|').split('\n')[0]} |`);
    const md = [`### 🍭 Smoke (${PROFILE.name}, ${totalSeconds}s)`, '', '| | scenario | time | notes |', '|---|---|---|---|', ...rows, ''].join('\n');
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); } catch { /* optional */ }
  }
}

let browser = null;
let exitCode = 0;
const tStart = Date.now();
try {
  log(`profile ${PROFILE.name}: viewport ${PROFILE.viewport.width}x${PROFILE.viewport.height}, timeouts x${PROFILE.timeoutScale}, drive ${PROFILE.driveSeconds}s, retries ${PROFILE.retries}`);
  startServer();
  await waitForServer();
  log(`vite up on ${BASE}`);
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  if (process.platform === 'linux') args.push('--disable-dev-shm-usage');
  browser = await chromium.launch({ channel: 'chrome', headless: true, args });
  const trackIds = await registeredTrackIds(browser);
  log(`tracks: ${trackIds.join(', ')}`);
  const plan = planScenarios({ trackIds, filters: only, profile: PROFILE, flows: Object.keys(FLOW_TESTS) });
  log(`scenarios (${plan.length}): ${plan.map((s) => s.name).join(', ')}`);
  if (!plan.length) fail('smoke', `no scenario matches the filters ${JSON.stringify(only)}`);
  for (const sc of plan) await runScenario(browser, sc);
} catch (err) {
  fail('smoke', err.stack || err.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  stopServer();
}

const total = Math.round((Date.now() - tStart) / 1000);
writeSummary(total);
if (flaky.length) console.log(`\n[smoke] flaky (passed on retry): ${flaky.join(', ')}`);
if (failures.length) {
  console.log(`\n[smoke] ${failures.length} failure(s) in ${total}s:\n  - ${failures.join('\n  - ')}\n  (see smoke-out/*-FAIL.png / *-FAIL.log)`);
  exitCode = 1;
} else {
  console.log(`\n[smoke] all green in ${total}s. Screenshots in ${OUT}`);
}
process.exit(exitCode);
