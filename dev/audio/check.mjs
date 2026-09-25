import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5185/dev/audio/index.html');
await page.waitForFunction(() => window.__analyze);
const res = await page.evaluate(() => window.__analyze());
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(28), JSON.stringify(v));
// Real-time sanity: click to unlock, play music & sfx live for a few seconds
await page.click('button');
await page.waitForTimeout(1500);
const live = await page.evaluate(() => ({ unlocked: window.__am.unlocked, music: window.__am.currentMusic, state: window.__am.ctx && window.__am.ctx.state }));
console.log('live', JSON.stringify(live));
await page.screenshot({ path: 'D:/dev/sprinkle-kart/dev/audio/booth.png', fullPage: true });
console.log('console:', errs);
await browser.close();
