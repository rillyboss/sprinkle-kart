#!/usr/bin/env node
/**
 * Sprinkle Kart smoke test.
 *
 *   node scripts/smoke.mjs            (or: npm run smoke)
 *
 * Starts its own Vite dev server on :5190, drives system Chrome (headless,
 * SwiftShader WebGL) with Playwright and checks:
 *   1. every REGISTERED track (read from the live registry, so new tracks are
 *      covered automatically): 1 player always; 4 players for the original Sprinkle
 *      Cup, for any track named in the filters (e.g. `node scripts/smoke.mjs bubblegum-bay`)
 *      or for all tracks with SMOKE_FULL=1; plus a 3-player spectator run. Autodrive:
 *      no console/page errors, every kart moves forward, fps is reported;
 *   2. the full menu flow with keyboard presses (title → join → racer → track → race),
 *      and the menus at full v2 size (?democontent=1: 21 racers, 20 tracks);
 *   3. a 1-lap autodrive race that reaches the results screen and shows the
 *      Cotton Candy Girl unlock celebration (after resetting progress).
 * Screenshots land in smoke-out/ (stale *-FAIL.png files are cleared at the start).
 * Exits non-zero on any failure.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'smoke-out');
const PORT = Number(process.env.SMOKE_PORT || 5190);
const BASE = `http://localhost:${PORT}/`;
/** The original Sprinkle Cup: always smoke-tested in 1p and 4p. */
const ORIGINAL_TRACK_IDS = ['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes'];
const FULL = !!process.env.SMOKE_FULL;
const RACE_WAIT_MS = Number(process.env.SMOKE_WAIT_MS || 12000);
const only = process.argv.slice(2); // optional filters: e.g. "menu", "results", a track id

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('-FAIL.png')) rmSync(path.join(OUT, f), { force: true });

const failures = [];
const log = (...a) => console.log('[smoke]', ...a);
const fail = (name, msg) => { failures.push(`${name}: ${msg}`); console.log(`[smoke] FAIL ${name}: ${msg}`); };
const wanted = (name) => !only.length || only.some((f) => name.includes(f));

/* ---------------- dev server ---------------- */

let server = null;
function startServer() {
  server = spawn(`npx vite --port ${PORT} --strictPort`, {
    cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let out = '';
  server.stdout.on('data', (d) => { out += d; });
  server.stderr.on('data', (d) => { out += d; });
  server.on('exit', (code) => { if (code && code !== 0) log(`vite exited (${code})\n${out}`); });
}
function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
    else server.kill('SIGTERM');
  } catch { /* already gone */ }
}
async function waitForServer(ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('vite dev server did not start');
}
process.on('SIGINT', () => { stopServer(); process.exit(130); });

/* ---------------- helpers ---------------- */

/** Track ids from the live registry (src/tracks/index.js via the dev server). */
async function registeredTrackIds(browser) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(`${BASE}?smoke-registry=1`);
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

async function newPage(browser, name, viewport = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    // Fonts are a nice-to-have (offline families still get a rounded fallback).
    if (!/fonts\.(googleapis|gstatic)\.com/.test(r.url())) errors.push(`requestfailed: ${r.url()}`);
  });
  return { ctx, page, errors, name };
}

const gameInfo = (page) => page.evaluate(() => {
  const g = window.__game;
  if (!g) return null;
  return {
    state: g.state,
    fps: g.fps,
    frames: g.frames,
    errors: g.errors,
    raceState: g.race?.state ?? null,
    karts: g.race ? g.race.karts.map((k) => ({ id: k.characterId, pi: k.playerIndex, progress: k.progress })) : [],
    lastResults: g.lastResults,
  };
});

async function waitFor(page, fn, arg, timeout, what) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 250 });
    return true;
  } catch {
    throw new Error(`timed out waiting for ${what}`);
  }
}

function checkErrors(t) {
  const errs = t.errors.filter((e) => !/favicon/i.test(e));
  if (errs.length) fail(t.name, `errors:\n    ${errs.slice(0, 8).join('\n    ')}`);
}

/* ---------------- tests ---------------- */

async function raceTest(browser, trackId, players) {
  const name = `${trackId}-${players}p`;
  const n0 = failures.length;
  const t = await newPage(browser, name);
  try {
    await t.page.goto(`${BASE}?quick=${trackId}&players=${players}&autodrive=1&simspeed=2`);
    await waitFor(t.page, () => window.__game?.state === 'race' && !!window.__game.race, null, 60000, 'race to start');
    const before = await gameInfo(t.page);
    await t.page.waitForTimeout(RACE_WAIT_MS);
    const after = await gameInfo(t.page);
    await t.page.screenshot({ path: path.join(OUT, `${name}.png`) });
    if (!after) throw new Error('window.__game missing');
    if (after.karts.length !== 8) fail(name, `expected 8 karts, got ${after.karts.length}`);
    const humans = after.karts.filter((k) => k.pi !== null);
    if (humans.length !== players) fail(name, `expected ${players} human karts, got ${humans.length}`);
    after.karts.forEach((k, i) => {
      const b = before.karts[i]?.progress ?? 0;
      if (!(k.progress > b + 5)) fail(name, `${k.id} did not move (progress ${b.toFixed(1)} → ${k.progress.toFixed(1)})`);
    });
    if (!(after.fps > 0)) fail(name, `fps not reported (${after.fps})`);
    if (after.errors?.length) fail(name, `game loop errors: ${after.errors[0]}`);
    checkErrors(t);
    if (failures.length === n0) log(`${name}: ok  fps=${after.fps} state=${after.raceState}`);
  } catch (err) {
    fail(name, err.message);
    await t.page.screenshot({ path: path.join(OUT, `${name}-FAIL.png`) }).catch(() => {});
  } finally {
    await t.ctx.close();
  }
}

async function menuFlowTest(browser) {
  const name = 'menu-flow';
  const n0 = failures.length;
  const t = await newPage(browser, name);
  const shot = (n) => t.page.screenshot({ path: path.join(OUT, `menu-${n}.png`) });
  const press = async (key, pause = 700) => { await t.page.keyboard.press(key); await t.page.waitForTimeout(pause); };
  try {
    await t.page.goto(`${BASE}?unlockreset=1`);
    await waitFor(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, 60000, 'title screen');
    await t.page.waitForTimeout(1200);
    await shot('1-title');
    await press('Enter', 1000);                // kb1 joins as P1 → join screen
    await shot('2-join');
    await press('Enter', 1000);                // P1 continues → character select
    await shot('3-characters');
    await press('KeyD', 400);                  // move the cursor one step right
    await press('Enter', 2200);                // lock in → everyone ready → track select
    await shot('4-tracks');
    await press('Enter', 500);                 // RACE!
    await waitFor(t.page, () => window.__game?.state === 'race', null, 30000, 'race to start from menus');
    await t.page.waitForTimeout(2500);
    await shot('5-race-countdown');
    // wait for GO, then drive a bit with the keyboard
    await waitFor(t.page, () => window.__game?.race?.state === 'racing', null, 30000, 'GO');
    const start = (await gameInfo(t.page)).karts.find((k) => k.pi === 0)?.progress ?? 0;
    await t.page.keyboard.down('KeyW');
    await t.page.waitForTimeout(5000);
    await t.page.keyboard.up('KeyW');
    await shot('6-race-driving');
    const info = await gameInfo(t.page);
    const me = info.karts.find((k) => k.pi === 0);
    if (!me) fail(name, 'no P1 kart in the race');
    else if (!(me.progress > start + 3)) fail(name, `P1 did not drive forward with W (progress ${start.toFixed(1)} → ${me.progress.toFixed(1)})`);
    // pause and resume
    await press('Escape', 900);
    const paused = await gameInfo(t.page);
    await shot('7-pause');
    if (paused.state !== 'paused') fail(name, `Esc did not pause (state ${paused.state})`);
    await press('Escape', 900);
    const resumed = await gameInfo(t.page);
    if (resumed.state !== 'race') fail(name, `Esc did not resume (state ${resumed.state})`);
    checkErrors(t);
    if (failures.length === n0) log(`${name}: ok`);
  } catch (err) {
    fail(name, err.message);
    await shot('FAIL').catch(() => {});
  } finally {
    await t.ctx.close();
  }
}

/**
 * The menus at full v2 size (?democontent=1 pads them with locked placeholders
 * for all 21 racers and 20 tracks): the grid scrolls, tracks page by cup, and
 * locked tracks / racers can't be picked.
 */
async function menuScaleTest(browser) {
  const name = 'menu-scale';
  const n0 = failures.length;
  const t = await newPage(browser, name);
  const shot = (n) => t.page.screenshot({ path: path.join(OUT, `scale-${n}.png`) });
  const press = async (key, pause = 450) => { await t.page.keyboard.press(key); await t.page.waitForTimeout(pause); };
  try {
    await t.page.goto(`${BASE}?unlockreset=1&democontent=1`);
    await waitFor(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, 60000, 'title screen');
    await t.page.waitForTimeout(1200);
    await press('Enter', 1000);                // kb1 joins as P1
    await press('Slash', 800);                 // kb2 joins as P2
    await press('Enter', 1000);                // → character select
    const tiles = await t.page.evaluate(() => document.querySelectorAll('.sk-tile').length);
    if (tiles !== 21) fail(name, `expected 21 racer tiles, got ${tiles}`);
    const locked = await t.page.evaluate(() => document.querySelectorAll('.sk-tile-locked').length);
    if (locked !== 13) fail(name, `expected 13 locked racer tiles, got ${locked}`);
    await shot('1-characters');
    await press('KeyS');                       // P1 down two rows (grid scrolls)
    await press('KeyS');
    await shot('2-characters-scrolled');
    await press('Enter', 500);                 // a locked racer: nope-wiggle, not ready
    if (await t.page.evaluate(() => !!document.querySelector('.sk-panel-ready'))) fail(name, 'a locked racer was picked');
    await press('KeyW');
    await press('KeyW');
    await press('Enter', 500);                 // P1 picks Rocco
    await press('Slash', 2400);                // P2 picks too → track select
    const cards = await t.page.evaluate(() => document.querySelectorAll('.sk-card').length);
    if (cards !== 20) fail(name, `expected 20 track cards, got ${cards}`);
    const tabs = await t.page.evaluate(() => document.querySelectorAll('.sk-cup-tab').length);
    if (tabs !== 5) fail(name, `expected 5 cup tabs, got ${tabs}`);
    await shot('3-tracks');
    for (let i = 0; i < 4; i++) await press('KeyD', 300); // → first Bubble Cup track (locked)
    await shot('4-tracks-bubble-cup');
    await press('Enter', 900);
    if ((await gameInfo(t.page)).state !== 'menu') fail(name, 'a locked track started a race');
    await press('KeyA', 300);                  // back to Sundae Slopes
    await press('Enter', 500);
    await waitFor(t.page, () => window.__game?.state === 'race', null, 30000, 'race to start from the big menus');
    const setup = await t.page.evaluate(() => window.__game.setup);
    if (setup.trackId !== 'sundae-slopes') fail(name, `expected sundae-slopes, got ${setup.trackId}`);
    checkErrors(t);
    if (failures.length === n0) log(`${name}: ok`);
  } catch (err) {
    fail(name, err.message);
    await shot('FAIL').catch(() => {});
  } finally {
    await t.ctx.close();
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

async function gamepadFlowTest(browser) {
  const name = 'gamepad-flow';
  const n0 = failures.length;
  const t = await newPage(browser, name);
  const shot = (n) => t.page.screenshot({ path: path.join(OUT, `pad-${n}.png`) });
  const tap = async (button, pause = 900) => {
    await t.page.evaluate((b) => window.__pad.set(b, true), button);
    await t.page.waitForTimeout(200); // shorter than the 350 ms menu auto-repeat
    await t.page.evaluate((b) => window.__pad.set(b, false), button);
    await t.page.waitForTimeout(pause);
  };
  try {
    await t.ctx.addInitScript(FAKE_PAD_SCRIPT);
    await t.page.goto(`${BASE}?unlockreset=1`);
    await waitFor(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, 60000, 'title screen');
    await t.page.waitForTimeout(1200);
    await tap(0);                              // A on title → pad joins as P1
    await tap(3);                              // Y toggles Easy Drive
    await shot('1-join');
    await tap(0);                              // A → character select
    await tap(15, 500);                        // d-pad right (Lenny)
    await tap(0, 2400);                        // lock in → track select
    await tap(15, 500);                        // next track (Gumdrop Meadow)
    await shot('2-tracks');
    await tap(0, 500);                         // race!
    await waitFor(t.page, () => window.__game?.state === 'race', null, 30000, 'race to start with the controller');
    const setup = await t.page.evaluate(() => window.__game.setup);
    if (setup.players[0]?.deviceId !== 'gp0') fail(name, `P1 should be gp0, got ${setup.players[0]?.deviceId}`);
    if (!setup.players[0]?.easyDrive) fail(name, 'Y did not toggle Easy Drive');
    if (setup.trackId !== 'gumdrop-meadow') fail(name, `expected gumdrop-meadow, got ${setup.trackId}`);
    if (setup.players[0]?.characterId !== 'lenny') fail(name, `expected lenny, got ${setup.players[0]?.characterId}`);
    await waitFor(t.page, () => window.__game?.race?.state === 'racing', null, 30000, 'GO');
    const start = await t.page.evaluate(() => window.__game.race.getPlayerKart(0).progress);
    await t.page.evaluate(() => window.__pad.set(7, true)); // hold RT
    await t.page.waitForTimeout(4000);
    const after = await t.page.evaluate(() => window.__game.race.getPlayerKart(0).progress);
    if (!(after > start + 3)) fail(name, `RT did not drive (progress ${start.toFixed(1)} → ${after.toFixed(1)})`);
    // steer right with the stick: lateral should go up (right = +lateral)
    const lat0 = await t.page.evaluate(() => window.__game.race.getPlayerKart(0).lateral);
    await t.page.evaluate(() => window.__pad.axis(0, 1));
    await t.page.waitForTimeout(1500);
    const lat1 = await t.page.evaluate(() => window.__game.race.getPlayerKart(0).lateral);
    await t.page.evaluate(() => window.__pad.axis(0, 0));
    if (!(lat1 > lat0)) fail(name, `stick right did not steer right (lateral ${lat0.toFixed(2)} → ${lat1.toFixed(2)})`);
    await shot('3-race');
    await tap(9, 900);                         // Start → pause
    const paused = await t.page.evaluate(() => window.__game.state);
    if (paused !== 'paused') fail(name, `Start did not pause (state ${paused})`);
    await shot('4-pause');
    await tap(9, 900);                         // Start → resume
    const resumed = await t.page.evaluate(() => window.__game.state);
    if (resumed !== 'race') fail(name, `Start did not resume (state ${resumed})`);
    checkErrors(t);
    if (failures.length === n0) log(`${name}: ok`);
  } catch (err) {
    fail(name, err.message);
    await shot('FAIL').catch(() => {});
  } finally {
    await t.ctx.close();
  }
}

async function resultsTest(browser) {
  const name = 'results-unlock';
  const n0 = failures.length;
  const t = await newPage(browser, name);
  try {
    await t.page.goto(`${BASE}?quick=cotton-candy-castle&players=1&cpus=0&autodrive=1&fastfinish=1&unlockreset=1&simspeed=6&speed=zoomy`);
    await waitFor(t.page, () => window.__game?.state === 'race', null, 60000, 'race to start');
    await waitFor(t.page, () => window.__game?.state === 'results', null, 240000, 'results screen');
    await t.page.waitForTimeout(900);
    await t.page.screenshot({ path: path.join(OUT, 'results.png') });
    await waitFor(t.page, () => !!document.querySelector('.sk-unlock'), null, 10000, 'unlock celebration');
    await t.page.waitForTimeout(1200);
    await t.page.screenshot({ path: path.join(OUT, 'results-unlock.png') });
    const info = await gameInfo(t.page);
    if (info.lastResults?.newlyUnlocked !== 'cotton-candy-girl') fail(name, `unlock not recorded: ${JSON.stringify(info.lastResults)}`);
    const saved = await t.page.evaluate(() => JSON.parse(localStorage.getItem('sprinkle-kart-progress-v1') || '{}'));
    if (!saved.unlocked?.includes('cotton-candy-girl')) fail(name, 'unlock not saved to localStorage');
    // mashing A right away must NOT skip the reveal
    await t.page.keyboard.press('Enter');
    await t.page.waitForTimeout(150);
    if (!(await t.page.evaluate(() => !!document.querySelector('.sk-unlock:not(.sk-leaving)')))) fail(name, 'unlock reveal was skipped by an early press');
    // once each reveal has had its moment, dismiss it (the rule engine may celebrate
    // several unlocks in a row), then pick "Race again" → a new race starts
    for (let i = 0; i < 12; i++) {
      await waitFor(t.page, () => !!document.querySelector('.sk-unlock.sk-can-continue'), null, 30000, 'unlock reveal ready to continue');
      await t.page.keyboard.press('Enter');
      await t.page.waitForTimeout(1500);
      if (!(await t.page.evaluate(() => !!document.querySelector('.sk-unlock:not(.sk-leaving)')))) break;
    }
    await t.page.screenshot({ path: path.join(OUT, 'results-after.png') });
    await t.page.keyboard.press('Enter');
    await waitFor(t.page, () => window.__game?.state === 'race', null, 30000, 'next race after results');
    checkErrors(t);
    if (failures.length === n0) log(`${name}: ok`);
  } catch (err) {
    fail(name, err.message);
    await t.page.screenshot({ path: path.join(OUT, `${name}-FAIL.png`) }).catch(() => {});
  } finally {
    await t.ctx.close();
  }
}

/**
 * Progression: the Sticker Book and Grown-ups corner from the title screen with the
 * keyboard, the parent gate unlocking everything, and a 3-unlock celebration sequence.
 */
async function progressionTest(browser) {
  const name = 'progression';
  const n0 = failures.length;
  const t = await newPage(browser, name);
  const shot = (n) => t.page.screenshot({ path: path.join(OUT, `progress-${n}.png`) });
  const press = async (key, pause = 450) => { await t.page.keyboard.press(key); await t.page.waitForTimeout(pause); };
  const has = (sel) => t.page.evaluate((q) => !!document.querySelector(q), sel);
  try {
    await t.page.goto(`${BASE}?unlockreset=1`);
    await waitFor(t.page, () => window.__game?.state === 'menu' && !!document.querySelector('.sk-title'), null, 60000, 'title screen');
    await t.page.waitForTimeout(1200);
    const chips = await t.page.evaluate(() => [...document.querySelectorAll('.sk-title-entry')].map((b) => b.textContent));
    if (!chips.some((c) => /Sticker Book/.test(c)) || !chips.some((c) => /Grown-ups/.test(c))) fail(name, `title entries: ${JSON.stringify(chips)}`);
    await press('KeyS');                       // focus the menu entries
    await press('Enter', 900);                 // open the Sticker Book
    if (!(await has('.skp-book'))) throw new Error('Sticker Book did not open');
    const counts = await t.page.evaluate(() => [document.querySelectorAll('.skp-sticker').length, document.querySelectorAll('.skp-tsticker').length]);
    if (counts[0] !== 21 || counts[1] !== 20) fail(name, `expected 21 racer + 20 track stickers, got ${counts}`);
    await shot('1-book');
    await press('Tab', 600);
    await shot('2-book-tracks');
    await press('Tab', 600);
    await shot('3-book-totals');
    await press('Escape', 900);
    if (!(await has('.sk-title'))) fail(name, 'B did not go back to the title');
    await press('KeyS');
    await press('KeyD');
    await press('Enter', 900);                 // Grown-ups corner
    if (!(await has('.skp-settings'))) throw new Error('Grown-ups corner did not open');
    await press('KeyS', 250); await press('KeyS', 250); await press('KeyS', 250);
    await press('Enter', 700);                 // Unlock everything -> parent gate
    if (!(await has('.skp-gate'))) throw new Error('parent gate did not open');
    await press('Enter', 600);                 // wrong answer (0): still gated
    if (await t.page.evaluate(() => JSON.parse(localStorage.getItem('sprinkle-kart-progress-v1') || '{}').unlockAll)) fail(name, 'a wrong gate answer unlocked everything');
    const answer = await t.page.evaluate(() => { const m = document.querySelector('.skp-gate-q').textContent.match(/(\d+)\D+(\d+)/); return Number(m[1]) + Number(m[2]); });
    for (let i = 0; i < answer; i++) await press('KeyW', 110);
    await shot('4-gate');
    await press('Enter', 800);
    const all = await t.page.evaluate(() => JSON.parse(localStorage.getItem('sprinkle-kart-progress-v1') || '{}').unlockAll);
    if (all !== true) fail(name, 'the parent gate did not unlock everything');
    await shot('5-unlocked');
    await press('Enter', 600);
    await press('Escape', 900);
    await press('Enter', 1000);                // title -> join
    await press('Enter', 1000);                // join -> character select
    const locked = await t.page.evaluate(() => document.querySelectorAll('.sk-tile-locked').length);
    if (locked !== 0) fail(name, `unlock everything left ${locked} locked racer tiles`);
    // A 3-unlock celebration, straight through the results screen.
    await t.page.evaluate(() => {
      const m = window.__game.menus;
      const c = m.characters;
      const standings = c.slice(0, 8).map((d, i) => ({ characterId: d.id, playerIndex: i ? null : 0, isCPU: !!i, finishPlace: i + 1, finished: true, finishTime: 70 + i }));
      window.__smokeResults = m.showResults({ standings, trackDef: m.tracks[0], humanWinner: standings[0], unlocks: [
        { kind: 'character', id: c[8].id, def: c[8] }, { kind: 'track', id: m.tracks[1].id, def: m.tracks[1] }, { kind: 'character', id: c[3].id, def: c[3] },
      ] });
    });
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await waitFor(t.page, () => !!document.querySelector('.sk-unlock.sk-can-continue:not(.sk-leaving)'), null, 30000, `reveal ${i + 1}`);
      seen.push(await t.page.evaluate(() => {
        const u = document.querySelector('.sk-unlock:not(.sk-leaving)');
        return `${u.classList.contains('sk-unlock-is-track') ? 'track' : 'character'}:${u.querySelector('.skp-ribbon')?.textContent ?? ''}`;
      }));
      if (i === 1) await shot('6-reveal-track');
      await press('Enter', 1400);
    }
    const want = ['character:Surprise 1 of 3!', 'track:Surprise 2 of 3!', 'character:Surprise 3 of 3!'];
    if (JSON.stringify(seen) !== JSON.stringify(want)) fail(name, `reveal sequence ${JSON.stringify(seen)}`);
    if (await has('.sk-unlock:not(.sk-leaving)')) fail(name, 'a reveal stayed up after the sequence');
    checkErrors(t);
    if (failures.length === n0) log(`${name}: ok`);
  } catch (err) {
    fail(name, err.message);
    await shot('FAIL').catch(() => {});
  } finally {
    await t.ctx.close();
  }
}

/* ---------------- run ---------------- */

let browser = null;
let exitCode = 0;
try {
  startServer();
  await waitForServer();
  log(`vite up on ${BASE}`);
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const trackIds = await registeredTrackIds(browser);
  log(`tracks: ${trackIds.join(', ')}`);
  for (const id of trackIds) {
    if (wanted(`${id}-1p`)) await raceTest(browser, id, 1);
    const named = only.some((f) => f === id || f === `${id}-4p`);
    if ((ORIGINAL_TRACK_IDS.includes(id) || FULL || named) && wanted(`${id}-4p`)) await raceTest(browser, id, 4);
  }
  if (wanted('cotton-candy-castle-3p')) await raceTest(browser, 'cotton-candy-castle', 3);
  if (wanted('menu')) await menuFlowTest(browser);
  if (wanted('scale')) await menuScaleTest(browser);
  if (wanted('gamepad')) await gamepadFlowTest(browser);
  if (wanted('results')) await resultsTest(browser);
  if (wanted('progression')) await progressionTest(browser);
} catch (err) {
  fail('smoke', err.stack || err.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  stopServer();
}

if (failures.length) {
  console.log(`\n[smoke] ${failures.length} failure(s):\n  - ${failures.join('\n  - ')}`);
  exitCode = 1;
} else {
  console.log(`\n[smoke] all green. Screenshots in ${OUT}`);
}
process.exit(exitCode);
