import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:5281/?mode=tt&quick=cotton-candy-castle&autodrive=1&simspeed=8&fastfinish=1&speed=zoomy');
await p.waitForFunction(() => window.__game?.state === 'results', null, { timeout: 120000 });
await p.waitForTimeout(2500);
console.log(await p.evaluate(() => {
  const o = document.querySelector('.sk-gp-opts');
  const r = o?.getBoundingClientRect();
  return { cls: o?.className, r: r && [r.x, r.y, r.width, r.height], html: o?.innerHTML.slice(0, 200), screen: window.__game.menus.screenId };
}));
await browser.close();
