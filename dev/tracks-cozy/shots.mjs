// Visual check for a Cozy Cup track (needs `npx vite --port 5221 --strictPort` running).
//   node dev/tracks-cozy/shots.mjs <trackId> [which=top,race,at] [extra]
// top  : high overview via dev/tracks/index.html?view=top
// race : a real quick race with autodrive: chase cam at the start + 2 mid-lap shots
// at   : dev preview camera at lap fractions given as extra "0.1,0.4,0.7"
import { chromium } from 'playwright';
const [,, id = 'pumpkin-patch', which = 'top,race', extra = ''] = process.argv;
const BASE = 'http://localhost:5221/';
const OUT = 'dev/tracks-cozy/';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
async function page(w = 1280, h = 720) {
  const pg = await b.newPage({ viewport: { width: w, height: h } });
  pg.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('info')) console.log('[console]', m.type(), m.text()); if (m.type() === 'error') errors.push(m.text()); });
  pg.on('pageerror', (e) => { console.log('[pageerror]', e.message); errors.push(e.message); });
  return pg;
}
const want = which.split(',');
if (want.includes('top')) {
  const pg = await page(1400, 900);
  await pg.goto(`${BASE}dev/tracks/index.html?track=${id}&view=top`);
  await pg.waitForTimeout(6000);
  await pg.screenshot({ path: `${OUT}${id}-top.png` });
  await pg.close();
}
if (want.includes('at')) {
  const pg = await page(1280, 720);
  for (const f of (extra || '0.1,0.4,0.7').split(',')) {
    await pg.goto(`${BASE}dev/tracks/index.html?track=${id}&view=at&s=${f}&h=4`);
    await pg.waitForTimeout(4500);
    await pg.screenshot({ path: `${OUT}${id}-at-${f}.png` });
  }
  await pg.close();
}
if (want.includes('race')) {
  const pg = await page(1280, 720);
  await pg.goto(`${BASE}?quick=${id}&players=1&autodrive=1&simspeed=2`);
  await pg.waitForFunction(() => window.__game?.race, null, { timeout: 60000 });
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: `${OUT}${id}-race-start.png` });
  const times = (extra || '').split(',').filter(Boolean).map(Number);
  const plan = times.length ? times : [14000, 12000];
  let k = 1;
  for (const ms of plan) {
    await pg.waitForTimeout(ms);
    const info = await pg.evaluate(() => {
      const g = window.__game;
      const kart = g.race.getPlayerKart(0);
      return { fps: g.fps, s: Math.round(kart.s), lap: kart.lap, state: g.race.state, frac: +(kart.s / g.session.path.length).toFixed(2) };
    });
    console.log('mid', k, JSON.stringify(info));
    await pg.screenshot({ path: `${OUT}${id}-race-mid${k}.png` });
    k++;
  }
  const r = await pg.evaluate(() => ({ calls: window.__game.renderer?.info?.render?.calls, errors: window.__game.errors }));
  console.log('race', JSON.stringify(r));
  await pg.close();
}
await b.close();
console.log('errors', errors.length);
