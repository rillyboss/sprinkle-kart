import { chromium } from 'playwright';
const [,, track='gumdrop-meadow', players='1'] = process.argv;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:5192/?quick=${track}&players=${players}`);
await page.waitForFunction(() => window.__game?.state === 'race', null, {timeout: 90000});
for (let i=0;i<6;i++){ await page.waitForTimeout(600);
 const s = await page.evaluate(()=>{const r=window.__game.race; const k=r.getPlayerKart(0); return {st:r.state, cd:r.countdown, sh:k.shielded, items:r.karts.filter(x=>x.shielded).length}});
 console.log(i, JSON.stringify(s));
 await page.screenshot({ path: `smoke-out/review-look/cd-${track}-${i}.png` }); }
await browser.close();
