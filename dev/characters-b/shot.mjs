// node dev/characters-b/shot.mjs "<query>" out.png   (dev server on :5261)
import { chromium } from 'playwright';
const [,, query = '', out = 'lineup.png'] = process.argv;
const q = new URLSearchParams(query);
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +(q.get('w') || 1600), height: +(q.get('h') || 700) } });
const errs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); }); p.on('pageerror', e => errs.push(String(e)));
await p.goto('http://localhost:5261/dev/characters-b/index.html?' + query);
await p.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await p.screenshot({ path: 'dev/characters-b/' + out, fullPage: true });
if (errs.length) console.log('ERRORS', errs.join('\n'));
await b.close();
