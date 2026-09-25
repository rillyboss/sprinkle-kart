import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e)));
const shots = JSON.parse(process.argv[2]);
for (const s of shots) {
  await page.goto(`http://localhost:5183/dev/race/index.html?manual=1&${s.q || ''}`);
  await page.waitForFunction(() => window.__advance);
  await page.evaluate((t) => window.__advance(t), s.t);
  if (s.setup) { await page.evaluate(s.setup); await page.evaluate((t) => window.__advance(t), s.t2 || 0.3); }
  await page.screenshot({ path: `dev/race/${s.name}.png` });
  console.log(s.name, await page.textContent('#hud'));
}
console.log('errors', errs);
await browser.close();
