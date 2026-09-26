#!/usr/bin/env node
/**
 * Touch controls end-to-end (phones + tablets, Playwright device emulation).
 *
 *   node scripts/smoke-touch.mjs                 (starts its own Vite on TOUCH_PORT, default 5951)
 *   TOUCH_BASE=http://localhost:5951/ node scripts/smoke-touch.mjs      (use a running server)
 *   node scripts/smoke-touch.mjs pixel ipad      (filter devices by name)
 *   TOUCH_WEBKIT=1 node scripts/smoke-touch.mjs  (also run the Safari engine, needs `npx playwright install webkit`)
 *   TOUCH_LAP=0 …                                (skip the full 1-lap race, faster)
 *
 * Per device, in LANDSCAPE (system Chrome, hasTouch + isMobile):
 *   1. tap the title → the touch device joins as P1 (not a keyboard);
 *   2. long-press P1's join slot → Kid-Assist toggles (menu 'toggle' gesture);
 *   3. taps through mode select → character select (a swipe moves the cursor) → track select
 *      (tap 1 lap) → race;
 *   4. the touch controls show; auto-gas drives forward with no finger down; dragging the
 *      floating stick right steers right (DriveInput from 'touch1');
 *   5. ITEM uses the item; PAUSE opens the pause menu, a tap resumes;
 *   6. (one device) the race is finished with touch only → results.
 * Plus PORTRAIT checks (controls fit, no overlap with the road centre) and screenshots in
 * smoke-out/touch-*.png. Chromium touches go through CDP Input.dispatchTouchEvent (real
 * multi-touch); WebKit uses synthetic touch PointerEvents.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'smoke-out');
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.TOUCH_PORT || 5951);
const BASE = process.env.TOUCH_BASE || `http://localhost:${PORT}/`;
const SCALE = Number(process.env.SMOKE_TIMEOUT_SCALE || (process.env.CI ? 4 : 1));
const T = (ms) => ms * SCALE;
const filters = process.argv.slice(2).map((s) => s.toLowerCase());
const DO_LAP = process.env.TOUCH_LAP !== '0';

const DEVICES = [
  { name: 'Pixel 7', key: 'pixel', desc: devices['Pixel 7 landscape'], portrait: devices['Pixel 7'], lap: true },
  { name: 'iPhone 13', key: 'iphone', desc: devices['iPhone 13 landscape'], portrait: devices['iPhone 13'] },
  { name: 'iPad Pro 11', key: 'ipad', desc: devices['iPad Pro 11 landscape'], portrait: devices['iPad Pro 11'] },
];

const failures = [];
const log = (...a) => console.log('[touch]', ...a);
let server = null;

function startServer() {
  server = spawn(`npx vite --port ${PORT} --strictPort --host`, { cwd: ROOT, shell: true, stdio: 'ignore', windowsHide: true });
}
function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
    else server.kill('SIGTERM');
  } catch { /* gone */ }
}
async function waitForServer(ms = T(40000)) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('vite dev server did not start');
}

/* ---------------- touch drivers ---------------- */

/** Real multi-touch through CDP (Chromium). */
async function cdpTouch(page) {
  const cdp = await page.context().newCDPSession(page);
  const pts = new Map();
  const send = (type) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: [...pts.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id, radiusX: 8, radiusY: 8, force: 1 })),
  });
  return {
    async start(id, x, y) { pts.set(id, { x, y }); await send('touchStart'); },
    async move(id, x, y) { pts.set(id, { x, y }); await send('touchMove'); },
    async end(id) {
      const p = pts.get(id);
      pts.delete(id);
      // CDP: touchEnd lists the points that are STILL down
      if (p) await send('touchEnd');
    },
  };
}

/** Synthetic touch PointerEvents (WebKit has no CDP). */
function synthTouch(page) {
  const fire = (type, id, x, y) => page.evaluate(({ type, id, x, y }) => {
    const target = window.__skTouchTargets?.[id] ?? document.elementFromPoint(x, y) ?? document.body;
    window.__skTouchTargets = window.__skTouchTargets || {};
    if (type === 'pointerdown') window.__skTouchTargets[id] = target;
    target.dispatchEvent(new PointerEvent(type, { pointerId: 100 + id, pointerType: 'touch', isPrimary: id === 0, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true }));
    if (type === 'pointerup') delete window.__skTouchTargets[id];
  }, { type, id, x, y });
  const last = new Map();
  return {
    async start(id, x, y) { last.set(id, { x, y }); await fire('pointerdown', id, x, y); },
    async move(id, x, y) { last.set(id, { x, y }); await fire('pointermove', id, x, y); },
    async end(id) { const p = last.get(id) ?? { x: 0, y: 0 }; last.delete(id); await fire('pointerup', id, p.x, p.y); },
  };
}

/* ---------------- game helpers ---------------- */

const waitGame = async (page, fn, arg, timeout, what) => {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
  } catch {
    const info = await page.evaluate(() => ({ state: window.__game?.state, screen: window.__game?.menus?.screenId, race: window.__game?.race?.state, t: window.__game?.race?.time, fps: window.__game?.fps })).catch(() => ({}));
    throw new Error(`timed out waiting for ${what} ${JSON.stringify(info)}`);
  }
};
const waitMenus = (page, id) => waitGame(page, (s) => {
  const m = window.__game?.menus;
  return m?.screenId === s && m._cooldown <= 0;
}, id, T(30000), `screen ${id}`);
const waitFrames = async (page, n) => {
  const f0 = await page.evaluate(() => window.__game.frames);
  await waitGame(page, (f) => window.__game.frames >= f, f0 + n, T(30000), `${n} frames`);
};
const center = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`no box for ${sel}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const tapSel = async (page, sel) => {
  const c = await center(page, sel);
  await page.touchscreen.tap(Math.round(c.x), Math.round(c.y));
};
const controlRect = (page, id) => page.evaluate((cid) => {
  const n = document.querySelector(`.sk-touch-set-0 [data-control="${cid}"]`);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
}, id);
const kart = (page) => page.evaluate(() => {
  const k = window.__game?.race?.getPlayerKart?.(0);
  return k ? { progress: k.progress, lap: k.lap, item: k.item, steer: k.steer, speed: k.speed, finished: !!k.finished } : null;
});
const drive = (page) => page.evaluate(() => window.__game.input.getDriveInput('touch1'));

function check(cond, msg) {
  if (!cond) { failures.push(msg); log('FAIL', msg); }
  return !!cond;
}

/** Lay-out sanity: controls inside the viewport, big enough, off the road centre, no overlaps. */
async function layoutProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const W = innerWidth, H = innerHeight;
    const nodes = [...document.querySelectorAll('.sk-touch-set .sk-tc')];
    const rects = nodes.map((n) => ({ id: n.dataset.control, r: n.getBoundingClientRect() }));
    const portrait = H > W;
    const keep = { x0: W * (portrait ? 0.34 : 0.3), x1: W * (portrait ? 0.66 : 0.7), y0: H * 0.2, y1: H * (portrait ? 0.78 : 0.8) };
    for (const { id, r } of rects) {
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`${id} outside the screen`);
      if (Math.min(r.width, r.height) < 43) out.push(`${id} smaller than 44px (${r.width.toFixed(0)})`);
      if (id !== 'pause' && r.left < keep.x1 && r.right > keep.x0 && r.top < keep.y1 && r.bottom > keep.y0) out.push(`${id} covers the road centre`);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r, b = rects[j].r;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${rects[i].id} overlaps ${rects[j].id}`);
      }
    }
    return out;
  });
}

/* ---------------- the flow ---------------- */

async function deviceFlow(browserType, launchOpts, dev, engine) {
  const tag = `${engine}-${dev.key}`;
  const browser = await browserType.launch(launchOpts);
  const errors = [];
  try {
    const context = await browser.newContext({ ...dev.desc });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const touch = engine === 'chromium' ? await cdpTouch(page) : synthTouch(page);
    const shot = (n) => page.screenshot({ path: path.join(OUT, `touch-${tag}-${n}.png`) });

    await page.goto(`${BASE}?unlockreset=1`, { timeout: T(60000) });
    await waitMenus(page, 'title');
    const reg = await page.evaluate(() => window.__game.input.getDevices().filter((d) => d.type === 'touch').map((d) => d.id));
    check(reg.includes('touch1'), `${tag}: touch1 is not registered on a phone/tablet (${reg})`);
    check(await page.evaluate(() => !!document.querySelector('.sk-title-entry') && [...document.querySelectorAll('.sk-title-entry')].some((b) => /Touch/.test(b.textContent))), `${tag}: no Touch entry on the title screen`);
    await shot('1-title');

    // 1. tap the title → touch1 is P1
    await page.touchscreen.tap(Math.round(dev.desc.viewport.width / 2), Math.round(dev.desc.viewport.height * 0.4));
    await waitMenus(page, 'join');
    const p1 = await page.evaluate(() => window.__game.menus.draft.joinState.players.map((p) => p.deviceId));
    check(p1[0] === 'touch1' && p1.length === 1, `${tag}: title tap joined ${JSON.stringify(p1)} instead of touch1`);
    check(await page.evaluate(() => document.querySelector('.sk-slot-icon')?.textContent === '👆'), `${tag}: join slot does not show the touch icon`);

    // 2. long-press the P1 slot → Kid-Assist on
    const slot = await center(page, '.sk-slot.sk-slot-on .sk-slot-name');
    await touch.start(0, slot.x, slot.y);
    await waitFrames(page, 3);
    await page.waitForTimeout(750);
    await touch.end(0);
    await waitFrames(page, 3);
    const easy = await page.evaluate(() => window.__game.menus.draft.joinState.players[0]?.easyDrive);
    check(easy === true, `${tag}: long-press did not toggle Kid-Assist (easyDrive=${easy})`);
    await shot('2-join');

    // 3. menus by tap
    await tapSel(page, '.sk-go');
    await waitMenus(page, 'mode-select');
    await tapSel(page, '.sk-mode-card.sk-mode-free');
    await waitMenus(page, 'character-select');
    const cur0 = await page.evaluate(() => [...document.querySelectorAll('.sk-tile')].findIndex((t) => t.classList.contains('sk-tile-hot')));
    // swipe left = next (cursor right)
    const vw = dev.desc.viewport.width, vh = dev.desc.viewport.height;
    await touch.start(0, vw * 0.7, vh * 0.5);
    for (let i = 1; i <= 4; i++) await touch.move(0, vw * (0.7 - i * 0.08), vh * 0.5);
    await touch.end(0);
    await waitFrames(page, 3);
    const cur1 = await page.evaluate(() => [...document.querySelectorAll('.sk-tile')].findIndex((t) => t.classList.contains('sk-tile-hot')));
    check(cur0 !== null && cur1 === cur0 + 1, `${tag}: swipe did not move the racer cursor (${cur0} → ${cur1})`);
    await shot('3-characters');
    await tapSel(page, '.sk-tile >> nth=0');
    await waitMenus(page, 'track-select');
    await tapSel(page, '.sk-pill-num >> nth=0'); // 1 lap
    await shot('4-tracks');
    // the Race button can sit below the fold on a phone: tapping the picked track again also starts
    await tapSel(page, '.sk-card >> nth=0');
    await waitGame(page, () => window.__game?.state === 'race' && window.__game.race?.state === 'racing', null, T(90000), 'GO');

    // 4. controls on screen; auto-gas; stick steering
    check(await page.evaluate(() => !!document.querySelector('.sk-touch:not([hidden]) .sk-tc-item')), `${tag}: touch controls not shown in the race`);
    const probs = await layoutProblems(page);
    check(!probs.length, `${tag}: landscape layout problems: ${probs.join('; ')}`);
    const k0 = await kart(page);
    await waitGame(page, (p) => (window.__game.race.getPlayerKart(0)?.progress ?? 0) > p + 3, k0.progress, T(30000), 'auto-gas progress');
    const d0 = await drive(page);
    check(d0.accel === 1, `${tag}: auto-gas accel is ${d0.accel}`);
    const stick = await controlRect(page, 'stick');
    check(!!stick, `${tag}: no stick`);
    if (stick) {
      await touch.start(1, stick.x, stick.y);
      await touch.move(1, stick.x + stick.w * 0.25, stick.y);
      await touch.move(1, stick.x + stick.w * 0.6, stick.y);
      await waitFrames(page, 2);
      const d1 = await drive(page);
      check(d1.steer > 0.5, `${tag}: stick drag right steers ${d1.steer}`);
      await shot('5-steer');
      await touch.end(1);
      await waitFrames(page, 2);
      check((await drive(page)).steer === 0, `${tag}: steer did not return to 0 after lifting the thumb`);
    }
    // drift button is a hold
    const hop = await controlRect(page, 'drift');
    if (hop) {
      await touch.start(2, hop.x, hop.y);
      await waitFrames(page, 2);
      check((await drive(page)).drift === true, `${tag}: HOP hold does not drift`);
      await touch.end(2);
    }

    // 5. item + pause
    await page.evaluate(() => { const k = window.__game.race.getPlayerKart(0); k.item = 'sprinkle-boost'; k.itemCharges = 1; });
    await waitFrames(page, 3);
    check(await page.evaluate(() => document.querySelector('.sk-touch-set-0 .sk-tc-item')?.classList.contains('sk-tc-has')), `${tag}: ITEM button does not show the held item`);
    await shot('6-item');
    const itemBtn = await controlRect(page, 'item');
    await touch.start(3, itemBtn.x, itemBtn.y);
    await touch.end(3);
    await waitGame(page, () => !window.__game.race.getPlayerKart(0)?.item, null, T(10000), 'item used');
    const pauseBtn = await controlRect(page, 'pause');
    await touch.start(4, pauseBtn.x, pauseBtn.y);
    await touch.end(4);
    await waitGame(page, () => window.__game.state === 'paused', null, T(10000), 'pause');
    await waitMenus(page, 'pause');
    check(await page.evaluate(() => !document.querySelector('.sk-touch:not([hidden]):not(.sk-touch-suspended)')), `${tag}: touch controls still visible on the pause menu`);
    await shot('7-pause');
    await tapSel(page, '.sk-listbtn >> nth=0');
    await waitGame(page, () => window.__game.state === 'race', null, T(10000), 'resume');

    // 6. finish the 1-lap race with touch only (auto-gas + Kid-Assist + a bit of stick)
    if (dev.lap && DO_LAP) {
      await waitGame(page, () => window.__game.state === 'results' || !!window.__game.race?.getPlayerKart(0)?.finished, null, T(240000), '1 lap finished by touch');
      await waitMenus(page, 'results').catch(() => {});
      await shot('8-results');
      check(await page.evaluate(() => !document.querySelector('.sk-touch:not([hidden]):not(.sk-touch-suspended)')), `${tag}: touch controls visible on results`);
    }

    // portrait: controls still fit and keep off the road
    if (dev.portrait) {
      const pctx = await browser.newContext({ ...dev.portrait });
      const pp = await pctx.newPage();
      pp.on('pageerror', (e) => errors.push(String(e)));
      await pp.goto(`${BASE}?quick=gumdrop-meadow&players=1`, { timeout: T(60000) });
      await waitGame(pp, () => window.__game?.state === 'race', null, T(90000), 'portrait quick race');
      // quick races seat a keyboard: show the overlay for touch1 directly to check the layout
      await pp.evaluate(() => window.__game.touch.overlay.show([{ deviceId: 'touch1', playerIndex: 0 }]));
      await waitFrames(pp, 3);
      const pprobs = await layoutProblems(pp);
      check(!pprobs.length, `${tag}: portrait layout problems: ${pprobs.join('; ')}`);
      await pp.screenshot({ path: path.join(OUT, `touch-${tag}-9-portrait.png`) });
      await pctx.close();
    }
    const errs = errors.filter((e) => !/favicon|WebGL|GPU stall|AudioContext|net::ERR/i.test(e));
    check(!errs.length, `${tag}: page errors: ${errs.slice(0, 3).join(' | ')}`);
  } catch (err) {
    failures.push(`${tag}: ${err.message}`);
    log('FAIL', tag, err.message);
  } finally {
    await browser.close().catch(() => {});
  }
}

const chromeArgs = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
try {
  if (!process.env.TOUCH_BASE) { startServer(); await waitForServer(); }
  const list = DEVICES.filter((d) => !filters.length || filters.some((f) => d.key.includes(f) || d.name.toLowerCase().includes(f)));
  for (const dev of list) {
    log(`chromium ${dev.name}`);
    await deviceFlow(chromium, { channel: 'chrome', headless: true, args: chromeArgs }, { ...dev }, 'chromium');
  }
  if (process.env.TOUCH_WEBKIT === '1') {
    for (const dev of list.filter((d) => d.key !== 'pixel')) {
      log(`webkit ${dev.name}`);
      await deviceFlow(webkit, { headless: true }, { ...dev, lap: false }, 'webkit');
    }
  }
} finally {
  stopServer();
}
if (failures.length) {
  console.log(`\n[touch] ${failures.length} failure(s):\n - ${failures.join('\n - ')}`);
  process.exit(1);
}
console.log('\n[touch] all touch checks passed ✔');
