#!/usr/bin/env node
/**
 * Phone & tablet e2e for Sprinkle Kart (mobile platform). OWNER: mobile platform.
 *
 *   node scripts/smoke-mobile.mjs [filters...]           build + `vite preview`, Chromium (system Chrome)
 *   MOBILE_ENGINES=chromium,webkit node scripts/smoke-mobile.mjs   also Safari's engine (npx playwright install webkit)
 *   MOBILE_PORT=5961 MOBILE_SKIP_BUILD=1 node scripts/smoke-mobile.mjs iphone13
 *
 * Emulated iPhone 13, iPad Pro 11 and Pixel 7 (Playwright device descriptors: touch, mobile viewport, UA,
 * device scale factor), each in landscape AND portrait:
 *   boot     the page loads into the menus with no errors · viewport meta has viewport-fit=cover and no zoom ·
 *            <html data-sk-device/touch> set · the page cannot scroll or zoom (a swipe keeps scroll 0 and
 *            visualViewport.scale 1) · the rotate overlay is up exactly for phones held upright ·
 *            'auto' picked a phone/tablet tier (never desktop 'high' on a software GPU) · a tap on the
 *            title reaches the game (no errors)
 *   race     a 1-player autodrive race runs: the kart moves, the preset was applied to the scene
 *   offline  the service worker takes control, the network goes away, a reload still boots the game
 * Screenshots: smoke-out/mobile-<scenario>.png (LOOK at them). Exit code 1 on any failure.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pw from 'playwright';
import { planMobileScenarios, descriptorName, expectRotateOverlay, acceptableAutoTier } from './smoke-mobile-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'smoke-out');
const PORT = Number(process.env.MOBILE_PORT || 5961);
const BASE = `http://localhost:${PORT}/`;
const SCALE = Number(process.env.MOBILE_TIMEOUT_SCALE || (process.env.CI ? 4 : 1));
const T = (ms) => ms * SCALE;
const engines = String(process.env.MOBILE_ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const only = process.argv.slice(2);
const log = (...a) => console.log('[mobile]', ...a);
mkdirSync(OUT, { recursive: true });

const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

/* ---------------- server ---------------- */
let server = null;
function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
    else server.kill('SIGTERM');
  } catch { /* gone */ }
}
process.on('SIGINT', () => { stopServer(); process.exit(130); });
async function startServer() {
  if (!process.env.MOBILE_SKIP_BUILD) {
    log('building…');
    execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' });
  }
  server = spawn(`npx vite preview --port ${PORT} --strictPort --host`, { cwd: ROOT, shell: true, stdio: 'ignore', windowsHide: true });
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('vite preview did not start');
}

/* ---------------- helpers ---------------- */
async function waitGame(page, fn, arg, timeout, what) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 150 });
  } catch (err) {
    const st = await page.evaluate(() => ({ state: window.__game?.state, screen: window.__game?.menus?.screenId, frames: window.__game?.frames, t: window.__game?.race?.time })).catch(() => ({}));
    throw new Error(`timed out waiting for ${what} (${JSON.stringify(st)})`);
  }
}

async function newPage(browser, scenario) {
  const desc = pw.devices[descriptorName(scenario.device, scenario.orientation)];
  if (!desc) throw new Error(`no Playwright device "${descriptorName(scenario.device, scenario.orientation)}"`);
  // WebKit and Chromium both take the descriptor (UA, viewport, touch, isMobile where supported)
  const opts = { ...desc };
  if (scenario.engine === 'webkit') delete opts.defaultBrowserType;
  const ctx = await browser.newContext({ ...opts, serviceWorkers: scenario.kind === 'offline' ? 'allow' : 'block' });
  const page = await ctx.newPage();
  const t = { ctx, page, errors: [], problems: [], log: [] };
  page.on('console', (m) => {
    t.log.push(`[${m.type()}] ${m.text()}`);
    if (m.type() === 'error' && !/favicon|fonts\.(googleapis|gstatic)/.test(m.text())) t.errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => { t.log.push(`[pageerror] ${e.stack || e.message}`); t.errors.push(`pageerror: ${e.message}`); });
  t.check = (ok, msg) => { if (!ok) t.problems.push(msg); return !!ok; };
  t.shot = (name) => page.screenshot({ path: path.join(OUT, `mobile-${name}.png`) });
  return t;
}

const platformInfo = (page) => page.evaluate(() => window.__game?.platform?.info?.() ?? null);

/** A one-finger swipe (CDP touch events, Chromium) or a synthetic TouchEvent drag (WebKit). */
async function swipe(t, engine) {
  const { page } = t;
  const vp = page.viewportSize();
  const x = vp.width / 2, y0 = vp.height * 0.3, y1 = vp.height * 0.85;
  if (engine === 'chromium') {
    const cdp = await t.ctx.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 6 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // pinch: two fingers apart
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 20, y: vp.height / 2, id: 1 }, { x: x + 20, y: vp.height / 2, id: 2 }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 20 - i * 25, y: vp.height / 2, id: 1 }, { x: x + 20 + i * 25, y: vp.height / 2, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.evaluate(([cx, a, b]) => {
      const el = document.elementFromPoint(cx, a) || document.body;
      const mk = (type, yy) => {
        let touches = [];
        try { touches = [new Touch({ identifier: 1, target: el, clientX: cx, clientY: yy })]; } catch { /* no Touch ctor */ }
        const ev = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : touches });
        el.dispatchEvent(ev);
      };
      mk('touchstart', a);
      for (let i = 1; i <= 6; i++) mk('touchmove', a + ((b - a) * i) / 6);
      mk('touchend', b);
    }, [x, y0, y1]);
  }
}

/* ---------------- scenarios ---------------- */
async function bootScenario(t, s) {
  const { page } = t;
  await page.goto(BASE, { timeout: T(60000) });
  await waitGame(page, () => window.__game?.state === 'menu' && !!window.__game?.menus?.screen && !document.getElementById('loading'), null, T(90000), 'menus');
  const meta = await page.evaluate(() => document.querySelector('meta[name=viewport]')?.content ?? '');
  t.check(/viewport-fit=cover/.test(meta) && /user-scalable=no/.test(meta), `viewport meta: ${meta}`);
  const html = await page.evaluate(() => ({ ...document.documentElement.dataset, touchAction: getComputedStyle(document.body).touchAction }));
  t.check(html.skDevice === s.device.deviceClass, `data-sk-device=${html.skDevice}, expected ${s.device.deviceClass}`);
  t.check(html.skTouch === '1', `data-sk-touch=${html.skTouch}`);
  t.check(html.skOrientation === s.orientation, `data-sk-orientation=${html.skOrientation}, expected ${s.orientation}`);
  t.check(html.touchAction === 'none', `body touch-action=${html.touchAction}`);
  const info = await platformInfo(page);
  t.check(info && info.os === s.device.os, `os=${info?.os}, expected ${s.device.os}`);
  t.check(acceptableAutoTier(info), `auto quality ${info?.quality} (${info?.reasons}) on ${info?.deviceClass} gpu="${info?.gpu}"`);
  const rotate = await page.evaluate(() => { const n = document.querySelector('.sk-rotate'); return !!n && !n.hidden && getComputedStyle(n).display !== 'none'; });
  t.check(rotate === expectRotateOverlay(s.device, s.orientation), `rotate overlay visible=${rotate}, expected ${expectRotateOverlay(s.device, s.orientation)}`);
  await t.shot(s.name);
  await swipe(t, s.engine);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    scrollY: window.scrollY, scrollX: window.scrollX, scale: window.visualViewport?.scale ?? 1,
    docH: document.documentElement.scrollHeight, winH: window.innerHeight,
  }));
  t.check(after.scrollY === 0 && after.scrollX === 0, `page scrolled after a swipe: ${after.scrollX},${after.scrollY}`);
  t.check(Math.abs(after.scale - 1) < 0.01, `page zoomed after a pinch: scale ${after.scale}`);
  t.check(after.docH <= after.winH + 1, `document taller than the screen: ${after.docH} > ${after.winH}`);
  if (rotate) {
    await page.click('.sk-rotate-skip');
    const gone = await page.evaluate(() => document.querySelector('.sk-rotate')?.hidden === true);
    t.check(gone, '"Play anyway" did not close the rotate overlay');
  }
  // a tap reaches the game (the title screen's tap / click handlers) without errors
  const vp = page.viewportSize();
  await page.touchscreen.tap(vp.width / 2, vp.height * 0.6);
  await page.waitForTimeout(400);
  return { info, rotate };
}

async function raceScenario(t, s) {
  const { page } = t;
  await page.goto(`${BASE}?quick=cotton-candy-castle&autodrive=1&players=1&laps=1`, { timeout: T(60000) });
  await waitGame(page, () => window.__game?.race?.state === 'racing' && window.__game.race.time > 1.5, null, T(150000), 'race to run');
  const first = await page.evaluate(() => window.__game.race.getPlayerKart(0)?.progress ?? 0);
  await waitGame(page, (p0) => (window.__game?.race?.getPlayerKart(0)?.progress ?? 0) > p0 + 0.01, first, T(90000), 'kart to move');
  const info = await platformInfo(page);
  const tuning = await page.evaluate(() => window.__game.platformTuning);
  t.check(!!tuning && tuning.quality === info.quality, `scene tuning ${JSON.stringify(tuning)}`);
  if (info.quality === 'low') t.check(tuning.outlinesHidden > 0 && (tuning.thinned?.removed ?? 0) >= 0, `low preset did not hide scenery outlines: ${JSON.stringify(tuning)}`);
  await t.shot(s.name);
  return { info, tuning, fps: await page.evaluate(() => window.__game.fps) };
}

async function offlineScenario(t) {
  const { page, ctx } = t;
  await page.goto(BASE, { timeout: T(60000) });
  await waitGame(page, () => window.__game?.state === 'menu', null, T(90000), 'menus');
  await waitGame(page, () => !!navigator.serviceWorker?.controller, null, T(60000), 'service worker to take control');
  const cached = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('sprinkle-kart-')));
  t.check(cached.length === 1, `precache: ${cached}`);
  await ctx.setOffline(true);
  await page.reload({ timeout: T(60000) });
  await waitGame(page, () => window.__game?.state === 'menu' && !!window.__game?.menus?.screen, null, T(90000), 'menus while offline');
  const fonts = await page.evaluate(() => document.fonts.check('600 20px Fredoka'));
  t.check(fonts, 'Fredoka (self-hosted) not available offline');
  await t.shot('offline');
  await ctx.setOffline(false);
  return { cached };
}

/* ---------------- run ---------------- */
const failures = [];
const results = [];
await startServer();
try {
  const scenarios = planMobileScenarios({ engines, only });
  const browsers = {};
  for (const engine of engines) {
    try {
      browsers[engine] = engine === 'chromium'
        ? await pw.chromium.launch({ channel: 'chrome', headless: true, args: CHROME_ARGS })
        : await pw.webkit.launch({ headless: true });
    } catch (err) {
      log(`${engine}: could not launch (${err.message.split('\n')[0]}) — skipped`);
    }
  }
  for (const s of scenarios) {
    const browser = browsers[s.engine];
    if (!browser) continue;
    const t = await newPage(browser, s);
    const t0 = Date.now();
    let extra = null;
    try {
      if (s.kind === 'boot') extra = await bootScenario(t, s);
      else if (s.kind === 'race') extra = await raceScenario(t, s);
      else extra = await offlineScenario(t, s);
    } catch (err) {
      t.problems.push(err.message);
    }
    const problems = [...t.problems, ...t.errors];
    const ok = problems.length === 0;
    results.push({ name: s.name, ok, seconds: Math.round((Date.now() - t0) / 100) / 10, problems, extra });
    log(`${ok ? 'ok  ' : 'FAIL'} ${s.name} (${results.at(-1).seconds}s)${extra?.info ? ` quality=${extra.info.quality} dpr=${extra.info.pixelRatio}` : ''}${extra?.fps ? ` fps=${extra.fps}` : ''}`);
    if (!ok) {
      failures.push(s.name);
      for (const p of problems) log(`     - ${p}`);
      await t.shot(`${s.name}-FAIL`).catch(() => {});
      writeFileSync(path.join(OUT, `mobile-${s.name}-FAIL.log`), [...problems, '', ...t.log].join('\n'));
    }
    await t.ctx.close().catch(() => {});
  }
  for (const b of Object.values(browsers)) await b.close().catch(() => {});
} finally {
  stopServer();
}
writeFileSync(path.join(OUT, 'mobile-summary.json'), JSON.stringify(results, null, 2));
log(`${results.length - failures.length}/${results.length} passed`);
process.exit(failures.length ? 1 : 0);
