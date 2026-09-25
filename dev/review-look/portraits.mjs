import { chromium } from 'playwright';
import fs from 'fs';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:5192/`);
await page.waitForFunction(() => window.__game?.state === 'menu', null, {timeout: 90000});
const info = await page.evaluate(() => { const out={}; for (const [k,v] of window.__game.portraits) out[k]= typeof v==='string'? v : (v?.toDataURL? v.toDataURL() : (v?.src|| typeof v)); return out; });
for (const [k,v] of Object.entries(info)) { if (typeof v==='string' && v.startsWith('data:image/png')) fs.writeFileSync(`smoke-out/review-look/portrait-${k}.png`, Buffer.from(v.split(',')[1],'base64')); else console.log(k, String(v).slice(0,80)); }
console.log(Object.keys(info));
await browser.close();
