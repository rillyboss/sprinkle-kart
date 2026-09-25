import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [n, cd, wait] of [[1, 2.8, 250], [4, 0.2, 350]]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://localhost:5186/dev/ui/index.html?screen=hud${n}&state=countdown&cd=${cd}`);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `dev/ui/out/cd-${n}.png` });
  await page.close();
}
await browser.close();
