// Real-race chase-cam check for pack A: unlock pack A, pick each racer through the
// menus (kb1), autodrive, and screenshot the chase view mid-race.
// usage: node dev/characters-a/race.mjs [ids...]   (server: npx vite --port 5251)
import { chromium } from 'playwright';

const PACK_A = ['bruno', 'shelly', 'peekaberry', 'twiggy', 'captain-crumbs', 'baby-bonbon'];
const ids = process.argv.slice(2).length ? process.argv.slice(2) : PACK_A;
const BASE = 'http://localhost:5251/';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failed = 0;
for (const id of ids) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript((unlocked) => {
    localStorage.setItem('sprinkle-kart-progress-v1', JSON.stringify({ unlocked }));
  }, PACK_A);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${BASE}?autodrive=1&simspeed=2`);
  await p.waitForFunction(() => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, { timeout: 60000 });
  await p.waitForTimeout(1200);
  const press = async (k, ms = 700) => { await p.keyboard.press(k); await p.waitForTimeout(ms); };
  await press('Enter', 1000); // join
  await press('Enter', 1000); // -> character select
  const index = await p.evaluate((cid) => window.__game.menus?.characters?.findIndex?.((c) => c.id === cid) ?? -1, id);
  if (index < 0) { console.log(id, 'not in the menu list'); failed++; await ctx.close(); continue; }
  for (let i = 0; i < index; i++) await press('KeyD', 150);
  await p.screenshot({ path: `dev/characters-a/race-${id}-select.png` });
  await press('Enter', 2200); // lock in -> tracks
  await press('Enter', 500); // race!
  await p.waitForFunction(() => window.__game?.state === 'race' && window.__game.race?.state === 'racing', null, { timeout: 60000 });
  await p.waitForTimeout(6000);
  const me = await p.evaluate(() => window.__game.race.karts.find((k) => k.playerIndex === 0)?.characterId);
  await p.screenshot({ path: `dev/characters-a/race-${id}.png` });
  const fps = await p.evaluate(() => window.__game.fps);
  console.log(id, 'raced as', me, 'fps', fps, errs.length ? 'ERRORS ' + errs.join(' | ') : 'no errors');
  if (me !== id || errs.length) failed++;
  await ctx.close();
}
await b.close();
process.exit(failed ? 1 : 0);
