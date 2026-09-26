// node dev/feat-showcase-presentation/probe.mjs "<query>" "<waitExpr>" "<evalExpr returning JSON-able>"
import { chromium } from 'playwright';
const [query, waitExpr, evalExpr] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`); });
await page.goto(`http://localhost:5411/${query}`);
await page.waitForFunction(new Function(`return (${waitExpr});`), null, { timeout: 600000, polling: 100 });
console.log(JSON.stringify(await page.evaluate(new Function(`return (${evalExpr});`)), null, 1));
await browser.close();
