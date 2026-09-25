import { chromium } from 'playwright';
const [,, query, waitMs = '15000'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5187/' + query);
await page.waitForTimeout(+waitMs);
console.log(await page.evaluate(() => { const s = window.__game.session; return JSON.stringify(s.humans.map((p, i) => { const k = s.race.getPlayerKart(p.playerIndex); const c = s.rigs[i].camera; return { pi: p.playerIndex, ch: k.characterId, kp: k.position.toArray().map(v=>+v.toFixed(1)), cp: c.position.toArray().map(v=>+v.toFixed(1)), d: +c.position.distanceTo(k.position).toFixed(1), fov: +c.fov.toFixed(1), h: +k.heading.toFixed(2), yaw: +s.rigs[i].yaw.toFixed(2) }; })); }));
await browser.close();
