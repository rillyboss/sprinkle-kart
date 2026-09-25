import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('ERR', e)); p.on('console', (m) => m.type() === 'error' && console.log('CERR', m.text()));
await p.goto('http://localhost:5183/dev/race/closeup.html'); await p.waitForFunction(() => window.done);
await p.screenshot({ path: 'dev/race/closeup.png' }); await b.close();
