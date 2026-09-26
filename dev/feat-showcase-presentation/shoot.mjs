// Throwaway visual check helper.
// node dev/feat-showcase-presentation/shoot.mjs <name> "<query>" "<waitExpr>" [shots] [gapFrames] [WxH] ["<actionExpr>"]
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });
const [name, query, waitExpr = 'true', shotsArg = '1', gapFrames = '20', vp = '1280x720', action = ''] = process.argv.slice(2);
const [W, H] = vp.split('x').map(Number);
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.stack || e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text()}`); });
await page.goto(`http://localhost:5411/${query}`);
await page.waitForFunction(new Function(`return (${waitExpr});`), null, { timeout: 600000, polling: 200 });
if (action) {
  await page.evaluate(new Function(action));
  const f0 = await page.evaluate(() => window.__game.frames);
  await page.waitForFunction((f) => window.__game.frames >= f, f0 + 4, { timeout: 600000 });
  await page.waitForTimeout(600); // let CSS transitions settle
}
const n = Number(shotsArg);
for (let i = 0; i < n; i++) {
  if (i > 0) {
    const f0 = await page.evaluate(() => window.__game.frames);
    await page.waitForFunction((f) => window.__game.frames >= f, f0 + Number(gapFrames), { timeout: 600000 });
  }
  await page.screenshot({ path: path.join(OUT, `${name}-${i}.png`) });
}
const info = await page.evaluate(() => ({
  state: window.__game?.state, screen: window.__game?.menus?.screenId, fps: window.__game?.fps,
  errors: window.__game?.errors?.slice(0, 3),
}));
console.log(JSON.stringify(info));
if (errs.length) console.log(errs.slice(0, 12).join('\n'));
await browser.close();
