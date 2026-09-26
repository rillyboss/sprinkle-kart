// Screenshots for a track: node dev/tracks-superstar/shots.mjs <id> [port=5241] [what=all|top|race|at] [extra]
// top  = high overview (dev/tracks preview page)
// race = real quick race (?quick=<id>&autodrive=1): start (countdown) + 2 mid-lap chase-cam shots
// at   = preview page camera at lap fraction(s) extra="0.2,0.5" (chase-like, no karts)
import { chromium } from 'playwright';
const [,, id, port = '5241', what = 'all', extra = ''] = process.argv;
const base = `http://localhost:${port}/`;
const out = (n) => `dev/tracks-superstar/${id}-${n}.png`;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function page(w = 1280, h = 720) {
  const pg = await b.newPage({ viewport: { width: w, height: h } });
  pg.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('info')) console.log('[console]', m.text()); if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', (e) => { console.log('[pageerror]', e.message); errs.push(e.message); });
  return pg;
}
if (what === 'all' || what === 'top') {
  const pg = await page();
  await pg.goto(`${base}dev/tracks/index.html?track=${id}&view=top`);
  await pg.waitForTimeout(6000);
  await pg.screenshot({ path: out('top') });
  await pg.close();
}
if (what === 'at') {
  const pg = await page();
  for (const f of extra.split(',')) {
    await pg.goto(`${base}dev/tracks/index.html?track=${id}&view=at&s=${f}&h=${process.env.H || 4}`);
    await pg.waitForTimeout(5000);
    await pg.screenshot({ path: out(`at-${f}`) });
  }
  await pg.close();
}
if (what === 'all' || what === 'race') {
  const players = process.env.PLAYERS || '1';
  const pg = await page();
  await pg.goto(`${base}?quick=${id}&players=${players}&autodrive=1&simspeed=2`);
  await pg.waitForFunction(() => window.__game?.state === 'race' && !!window.__game.race, null, { timeout: 90000 });
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: out(`race-start-${players}p`) });
  for (const [k, ms] of [[1, +(process.env.T1 || 9000)], [2, +(process.env.T2 || 9000)]]) {
    await pg.waitForTimeout(ms);
    const info = await pg.evaluate(() => ({ fps: window.__game.fps, s: window.__game.race.karts.find((k) => k.playerIndex === 0)?.s, lap: window.__game.race.karts.find((k) => k.playerIndex === 0)?.lap, errors: window.__game.errors }));
    console.log('shot', k, JSON.stringify(info));
    await pg.screenshot({ path: out(`race-mid${k}-${players}p`) });
  }
  await pg.close();
}
await b.close();
console.log('errors', errs.length);
