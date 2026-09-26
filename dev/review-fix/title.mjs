// Title show screenshots: node dev/review-fix/title.mjs  (server: npx vite --port 5541)
import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto('http://localhost:5541/?unlockreset=1');
await p.waitForFunction(() => window.__game?.state === 'menu' && !!document.querySelector('.sk-title'), null, { timeout: 60000 });
for (let i = 0; i < 4; i++) {
  await p.waitForTimeout(2500);
  const a = await p.evaluate(() => window.__game.attract?.() ?? null);
  console.log(i, JSON.stringify(a)?.slice(0, 160));
  await p.screenshot({ path: `dev/review-fix/title-${i}.png` });
}
await b.close();
