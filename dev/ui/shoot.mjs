// node dev/ui/shoot.mjs [screens...]  — screenshots at 1280x720 and 1920x1080 into dev/ui/out/
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = 'http://localhost:5186/dev/ui/index.html';
const all = ['title', 'join', 'chars1', 'chars2', 'chars4', 'tracks', 'pause', 'results', 'unlock', 'hud1', 'hud2', 'hud3', 'hud4', 'hud2?state=countdown', 'hud1?track=2', 'chars1?unlocked=1', 'join?noportraits=1'];
const args = process.argv.slice(2);
const sizes = args.includes('--small') ? [[1280, 720]] : [[1280, 720], [1920, 1080]];
const screens = args.filter((a) => !a.startsWith('--'));
mkdirSync('dev/ui/out', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const s of screens.length ? screens : all) {
  for (const [w, h] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const [name, q] = s.split('?');
    await page.goto(`${base}?screen=${name}${q ? `&${q}` : ''}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 }).catch(() => errors.push('timeout'));
    await page.waitForTimeout(900);
    const file = `dev/ui/out/${s.replace(/[?=&]/g, '_')}-${w}.png`;
    await page.screenshot({ path: file });
    console.log(file, errors.length ? `ERRORS: ${errors.join(' | ')}` : 'ok');
    await page.close();
  }
}
await browser.close();
