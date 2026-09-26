// Throwaway visual check: the production build (three.js in its own chunk) boots to the title and the Online hub
// shows the NAT tips. Usage: node dev/net-fix/preview-shot.mjs http://localhost:5741/
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5741/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.argv[3] || 1280), height: Number(process.argv[4] || 720) } });
await page.addInitScript(() => {
  const KEY = 'sprinkle-kart-progress-v1';
  const cur = JSON.parse(localStorage.getItem(KEY) || '{}');
  cur.settings = { ...(cur.settings || {}), onlineEnabled: true, music: 0, sfx: 0 };
  localStorage.setItem(KEY, JSON.stringify(cur));
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
await page.waitForFunction(() => window.__game?.menus?.screenId === 'title', null, { timeout: 60000 });
await page.screenshot({ path: 'dev/net-fix/preview-title.png' });
await page.evaluate(() => {
  window.__game.menus.goto('online-hub', {
    message: "We couldn't connect your houses 🙈",
    tips: ['Try again in a moment 🔁', 'A grown-up can turn on the Sprinkle Kart relay (see the grown-up setup guide) 🛟', 'Try another network — school computers and phone hotspots often need the relay 📶'],
  });
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'dev/net-fix/preview-hub-tips.png' });
const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /\.js$/.test(n)).map((n) => n.split('/').pop()));
console.log(JSON.stringify({ errors, scripts }));
await browser.close();
