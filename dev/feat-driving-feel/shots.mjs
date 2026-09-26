// Visual check for the driving-feel branch: drift sparks, skid marks,
// off-road puffs, speed lines, Kid-Assist label. PNGs land next to this file.
// The kart is driven by an in-page autopilot (plan = 'line' | 'drift' | 'grass')
// and waits use RACE time, because SwiftShader runs at a few fps.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = `http://localhost:${process.env.PORT || 5291}/`;
const which = process.argv.slice(2);
const want = (n) => !which.length || which.includes(n);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];

async function open(url, size = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport: size });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + url);
  await page.waitForFunction(() => window.__game && window.__game.race, null, { timeout: 30000 });
  await page.evaluate(() => {
    const g = window.__game;
    const orig = g.input.getDriveInput.bind(g.input);
    window.__plan = {};
    const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
    g.input.getDriveInput = (id) => {
      const base = orig(id);
      const r = g.race;
      const pi = id === 'kb1' ? 0 : id === 'kb2' ? 1 : id === 'v2' ? 2 : 3;
      const plan = window.__plan[pi];
      if (!plan || !r) return base;
      const k = r.getPlayerKart(pi);
      if (!k) return base;
      const out = { steer: 0, accel: 1, brake: 0, drift: false, useItem: false, lookBack: false };
      const path = r.path;
      const lat = plan.lat ?? 0;
      const tp = path.positionAt(k.s + 8 + Math.max(0, k.speed) * 0.45, lat);
      const diff = wrap(Math.atan2(tp.x - k.position.x, tp.z - k.position.z) - k.heading);
      out.steer = Math.max(-1, Math.min(1, -diff * 2.4));
      if (plan.mode === 'drift') {
        const bend = wrap(path.headingAt(k.s + 30) - path.headingAt(k.s));
        if ((k.drifting && (k.driftLevel < 3 || Math.abs(bend) > 0.2)) || (!k.drifting && Math.abs(bend) > 0.3)) {
          out.drift = true;
          const dir = k.drifting ? k.driftDir : -Math.sign(bend);
          out.steer = k.drifting ? out.steer : dir;
        }
      }
      return out;
    };
  });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(HERE, `${name}.png`) });
const plan = (page, pi, p) => page.evaluate(([i, q]) => { window.__plan[i] = q; }, [pi, p]);
async function raceTime(page, t, timeout = 120000) {
  await page.waitForFunction((tt) => window.__game.race?.state === 'racing' && window.__game.race.time >= tt, t, { timeout, polling: 50 });
}
const kinfo = (page, pi = 0) => page.evaluate((i) => {
  const k = window.__game.race.getPlayerKart(i);
  return { t: +window.__game.race.time.toFixed(2), level: k.driftLevel, drifting: k.drifting, speed: +k.speed.toFixed(1), offRoad: k.offRoad, boosting: k.boosting, fps: window.__game.fps };
}, pi);

if (want('drift')) {
  const page = await open('?quick=gumdrop-meadow&players=1&cpus=3');
  await plan(page, 0, { mode: 'drift' });
  // wait for a drift that reaches a level, take shots at level changes
  const got = {};
  const t0 = Date.now();
  while (Object.keys(got).length < 4 && Date.now() - t0 < 150000) {
    const i = await kinfo(page);
    const key = i.drifting && !i.boosting && !i.offRoad ? `drift-l${i.level}` : null;
    if (key && !got[key]) { got[key] = i; await shot(page, key); console.log(key, JSON.stringify(i)); }
    await new Promise((r) => setTimeout(r, 120));
  }
  await page.close();
}

if (want('offroad')) {
  const page = await open('?quick=gumdrop-meadow&players=1&cpus=0');
  await plan(page, 0, { mode: 'line' });
  await raceTime(page, 3);
  const hw = await page.evaluate(() => window.__game.race.path.halfWidth);
  await plan(page, 0, { mode: 'line', lat: -(hw + 4) });
  await page.waitForFunction(() => window.__game.race.getPlayerKart(0).offRoad, null, { timeout: 60000, polling: 50 });
  const t = await page.evaluate(() => window.__game.race.time);
  await raceTime(page, t + 0.8);
  console.log('offroad', JSON.stringify(await kinfo(page)));
  await shot(page, 'offroad');
  await page.close();
}

if (want('boost')) {
  const page = await open('?quick=starlight-galaxy&players=1&cpus=2');
  await plan(page, 0, { mode: 'line' });
  await raceTime(page, 3);
  await page.evaluate(() => { const k = window.__game.race.getPlayerKart(0); k.phys.boostTime = 3; k.boosting = true; });
  const t = await page.evaluate(() => window.__game.race.time);
  await raceTime(page, t + 0.7);
  console.log('boost', JSON.stringify(await kinfo(page)));
  await shot(page, 'boost-speedlines');
  await page.close();
}

if (want('p4')) {
  const page = await open('?quick=sundae-slopes&players=4&cpus=4');
  for (const pi of [0, 1, 2, 3]) await plan(page, pi, { mode: pi % 2 ? 'drift' : 'line', lat: pi === 2 ? -30 : 0 });
  await raceTime(page, 5);
  await page.evaluate(() => { const k = window.__game.race.getPlayerKart(0); k.phys.boostTime = 3; k.boosting = true; });
  const t = await page.evaluate(() => window.__game.race.time);
  await raceTime(page, t + 0.5);
  await shot(page, 'p4');
  console.log('p4', JSON.stringify([await kinfo(page, 0), await kinfo(page, 1), await kinfo(page, 2)]));
  await page.close();
}

if (want('assist')) {
  const page = await open('?quick=gumdrop-meadow&players=1&cpus=7');
  await page.evaluate(() => { window.__game.race.getPlayerKart(0).easyDrive = true; });
  await raceTime(page, 12);
  const info = await page.evaluate(() => { const k = window.__game.race.getPlayerKart(0); return { place: k.place, speed: k.speed, max: k.stats.maxSpeed, throttle: k.phys.throttle, offRoad: k.offRoad, t: window.__game.race.time }; });
  console.log('assist', JSON.stringify(info));
  await shot(page, 'assist');
  await page.close();
}

if (want('join')) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await new Promise((r) => setTimeout(r, 2500));
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));
  await page.keyboard.press('Tab');
  await new Promise((r) => setTimeout(r, 900));
  await shot(page, 'join');
  const txt = await page.evaluate(() => document.body.innerText);
  console.log('join has Kid-Assist:', txt.includes('Kid-Assist'), 'has Magic:', txt.includes('Magic'));
  await page.close();
}

console.log('errors', JSON.stringify(errors));
await browser.close();
