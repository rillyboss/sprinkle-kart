// node dev/tracks-adventure-cup/shot.mjs <url> <out.png> [w] [h] [waitMs]
import { chromium } from 'playwright';
const [,, url, out, w = '1600', h = '1000', wait = '800'] = process.argv;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: +w, height: +h } });
pg.on('console', (m) => { if (m.type() !== 'debug') console.log('[console]', m.type(), m.text()); });
pg.on('pageerror', (e) => console.log('[pageerror]', e.message));
await pg.goto(url);
await pg.waitForTimeout(+wait);
await pg.screenshot({ path: out, fullPage: url.startsWith('file:') });
await b.close();
