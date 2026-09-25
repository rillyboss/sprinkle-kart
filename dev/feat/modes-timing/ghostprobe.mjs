import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:5281/?mode=tt&quick=gumdrop-meadow&autodrive=1&simspeed=6&laps=1&speed=zippy');
await p.waitForFunction(() => window.__game?.state === 'results', null, { timeout: 180000 });
await p.goto('http://localhost:5281/?mode=tt&quick=gumdrop-meadow&laps=1&speed=zippy');
await p.waitForFunction(() => window.__game?.race?.state === 'racing', null, { timeout: 60000 });
await p.keyboard.down('KeyW');
for (const [i, ms] of [[1, 1500], [2, 2500], [3, 3000]]) {
  await p.waitForTimeout(ms);
  await p.screenshot({ path: `dev/feat/modes-timing/gh-${i}.png` });
}
console.log(await p.evaluate(() => ({ tt: window.__game.timeTrial, gap: window.__game.race.modeInfo })));
await browser.close();
