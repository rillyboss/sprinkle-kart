// usage: node dev/characters-a/shot.mjs "<query>" out.png [w] [h]
import { chromium } from 'playwright';
const [,, query = '', out = 'shot.png', w = '1500', h = '900'] = process.argv;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`http://localhost:5251/dev/characters-a/index.html?w=${w}&h=${h}&` + query);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await p.screenshot({ path: 'dev/characters-a/' + out, fullPage: true });
if (errs.length) console.log('ERRORS', errs.join('\n'));
await b.close();
