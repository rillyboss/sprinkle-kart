import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (!m.text().startsWith('sfx') && !m.text().includes('vite')) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('ERR ' + e.message));
await page.goto('http://localhost:5186/dev/ui/index.html?screen=title');
await page.waitForTimeout(600);
await page.mouse.click(640, 360);                       // title -> join (kb1 auto-joined)
await page.waitForTimeout(600);
await page.locator('.sk-slot').nth(1).click({ force: true });          // join kb2 by clicking empty slot
await page.waitForTimeout(400);
await page.locator('.sk-slot').nth(1).locator('[data-act=toggle]').click({ force: true }); // easy drive P2
await page.waitForTimeout(400);
await page.locator('.sk-go').click({ force: true });                   // continue
await page.waitForTimeout(600);
await page.locator('.sk-tile').nth(3).click({ force: true });          // P1 picks peachy
await page.waitForTimeout(400);
await page.locator('.sk-tile').nth(6).click({ force: true });          // P2 picks dino -> auto advance
await page.waitForTimeout(1800);
await page.locator('.sk-card').nth(2).click({ force: true });          // select galaxy
await page.waitForTimeout(400);
await page.locator('.sk-pill').nth(2).click({ force: true });          // zoomy
await page.waitForTimeout(400);
await page.locator('.sk-pill-num').nth(3).click({ force: true });      // 5 laps
await page.waitForTimeout(400);
await page.locator('.sk-race').click({ force: true });
await page.waitForTimeout(500);
console.log(logs.join('\n'));
console.log('menus hidden:', await page.evaluate(() => document.querySelector('.sk-menus').hidden));
await browser.close();
