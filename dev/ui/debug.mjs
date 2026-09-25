import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('>', m.text()));
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:5186/dev/ui/index.html?screen=' + process.argv[2]);
await page.waitForTimeout(Number(process.argv[3] || 4000));
console.log(await page.evaluate(() => document.querySelector('.sk-screen')?.className));
await browser.close();
