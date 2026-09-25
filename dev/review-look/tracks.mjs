import { chromium } from 'playwright';
const [,, track, players='1', extra=''] = process.argv;
const OUT='smoke-out/review-look/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5192/?quick=${track}&players=${players}&autodrive=1${extra}`);
await page.waitForFunction(() => window.__game?.state === 'race', null, {timeout: 90000});
const tag = `${track}-${players}p`;
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT+tag+'-a-countdown.png' });
await page.waitForFunction(() => window.__game?.race?.state === 'racing', null, {timeout: 60000});
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT+tag+'-b-go.png' });
// speed up sim
for (let i=0;i<3;i++){
  await page.evaluate(() => { window.__game.params.simSpeed = 4; });
  await page.waitForTimeout(5000);
  await page.evaluate(() => { window.__game.params.simSpeed = 1; });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => { const g=window.__game; const k=g.race.getPlayerKart(0); return {state:g.state, fps:g.fps, p:+k.progress.toFixed(1), lap:k.lap}; });
  console.log(JSON.stringify(info));
  await page.screenshot({ path: OUT+tag+`-c-mid${i}.png` });
}
await browser.close();
