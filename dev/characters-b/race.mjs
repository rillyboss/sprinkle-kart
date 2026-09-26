// dev: pick a pack B racer through the menus (parent unlock-all) and screenshot the chase cam in a real race.
//   node dev/characters-b/race.mjs <characterId> [trackId-in-sprinkle-cup-order-index=0] [out prefix]
import { chromium } from 'playwright';
const [,, charId = 'luna', trackSteps = '0', prefix = 'race'] = process.argv;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('sprinkle-kart-progress-v1', JSON.stringify({ unlockAll: true, unlocked: ['luna', 'bleep', 'puff', 'prince-ribbit', 'marina', 'lulu'] })); } catch {}
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const press = async (k, ms = 500) => { await p.keyboard.press(k); await p.waitForTimeout(ms); };
await p.goto('http://localhost:5261/?autodrive=1');
await p.waitForFunction(() => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, { timeout: 90000 });
await p.waitForTimeout(1000);
await press('Enter', 1800);
await press('Enter', 1800);
const ids = await p.evaluate(() => [...document.querySelectorAll('.sk-tile-name')].map((e) => e.textContent));
const want = await p.evaluate((id) => window.__game?.characters?.find?.((c) => c.id === id)?.name, charId);
const names = { luna: 'Luna Lollicorn', bleep: 'Bleep Bloop', puff: 'Puff the Sprinkle Dragon', 'prince-ribbit': 'Prince Ribbit', marina: 'Marina Seashell', lulu: 'Lulu Lamb' };
const idx = ids.indexOf(want || names[charId] || charId);
console.log('grid ids', ids.join(','), 'target index', idx);
for (let i = 0; i < idx; i++) await press('KeyD', 150);
await p.screenshot({ path: `dev/characters-b/${prefix}-select.png` });
await press('Enter', 2200);
for (let i = 0; i < +trackSteps; i++) await press('KeyD', 250);
await press('Enter', 500);
await p.waitForFunction(() => window.__game?.state === 'race', null, { timeout: 60000 });
await p.waitForFunction(() => window.__game?.race?.state === 'racing', null, { timeout: 60000 });
const who = await p.evaluate(() => window.__game.race.karts.find((k) => k.playerIndex === 0)?.characterId);
console.log('P1 is', who);
await p.waitForTimeout(3500);
await p.screenshot({ path: `dev/characters-b/${prefix}-chase1.png` });
await p.waitForTimeout(4000);
await p.screenshot({ path: `dev/characters-b/${prefix}-chase2.png` });
const info = await p.evaluate(() => ({ fps: window.__game.fps, errors: window.__game.errors }));
console.log('fps', info.fps, 'errors', JSON.stringify(info.errors), errs.join('\n'));
await b.close();
