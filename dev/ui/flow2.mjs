import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR ' + e.message));
await page.goto('http://localhost:5186/dev/ui/index.html?screen=none');
await page.waitForTimeout(500);
const out = await page.evaluate(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const m = window.__menus;
  const log = [];
  const scr = () => document.querySelector('.sk-screen')?.className.split(' ')[1];
  const seq = async (list) => { for (const [d, a] of list) { window.__push(d, a); await wait(350); } };
  const p = m.run();
  await wait(300);
  await seq([['gp0', 'confirm']]); log.push(scr());                  // join, gp0 = P1
  await seq([['kb1', 'confirm'], ['gp0', 'confirm']]); log.push(scr()); // chars
  await seq([['gp0', 'back']]); log.push(scr());                      // back to join
  await seq([['gp0', 'confirm'], ['gp0', 'right'], ['gp0', 'confirm'], ['kb1', 'confirm']]);
  await wait(1400); log.push(scr());                                  // auto -> tracks
  await seq([['kb1', 'right']]);                                      // ignored (not P1)
  await seq([['gp0', 'back']]); log.push(scr());                      // back to chars (picks kept)
  await seq([['gp0', 'confirm'], ['kb1', 'confirm']]); await wait(1400);
  await seq([['gp0', 'left'], ['gp0', 'confirm']]);
  log.push(JSON.stringify(await p));
  const pp = m.showPause('P1'); await wait(300);
  await seq([['gp0', 'down'], ['gp0', 'confirm']]); log.push('pause:' + await pp);
  const pp2 = m.showPause('P2'); await wait(300);
  await seq([['kb1', 'start']]); log.push('pause2:' + await pp2);
  const cotton = window.__chars.find((c) => c.id === 'cotton-candy-girl');
  const rp = m.showResults({ standings: [], trackDef: null, humanWinner: null, newlyUnlocked: cotton });
  await wait(2400); log.push('unlock shown:' + !!document.querySelector('.sk-unlock'));
  await seq([['gp0', 'confirm']]); await wait(500);
  log.push('unlock gone:' + !document.querySelector('.sk-unlock'));
  await seq([['gp0', 'right'], ['gp0', 'confirm']]); log.push('results:' + await rp);
  return log;
});
console.log(out.join('\n'));
await browser.close();
