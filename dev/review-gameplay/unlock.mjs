import { launch, newPage, BASE } from './lib.mjs';

const browser = await launch();
const t = await newPage(browser, { pads: 1 });
const { page } = t;
const st = () => page.evaluate(() => ({ state: window.__game.state, screen: document.querySelector('.sk-menus:not([hidden]) .sk-screen')?.className ?? null }));
try {
  await page.goto(`${BASE}?quick=cotton-candy-castle&players=1&cpus=0&autodrive=1&fastfinish=1&unlockreset=1&simspeed=8`);
  await t.until(() => window.__game?.state === 'results', null, 240000);
  await t.until(() => !!document.querySelector('.sk-unlock'), null, 10000);
  await t.wait(1500);
  await t.shot('u-01-celebration');
  await t.key('Enter', 100, 900);
  await t.key('KeyD', 100, 300); await t.key('KeyD', 100, 300);
  await t.key('Enter', 100, 1200);
  console.log('after Menu', JSON.stringify(await st()), JSON.stringify(await page.evaluate(() => window.__game.menus._joinState)));
  await t.shot('u-02-join');
  await t.key('Enter', 100, 1000);
  await t.key('KeyA', 100, 500);
  await t.shot('u-03-chars-ccg');
  await t.key('Enter', 100, 2500);
  console.log('after pick', JSON.stringify(await st()));
  await t.key('Enter', 100, 500);
  await t.until(() => window.__game?.state === 'race', null, 60000);
  console.log('setup', JSON.stringify(await page.evaluate(() => window.__game.setup)));
  await t.wait(2500);
  await t.shot('u-04-ccg-countdown');
  await t.until(() => window.__game.race?.state === 'racing', null, 60000);
  await t.wait(1500);
  await t.shot('u-05-ccg-racing');
  // pause -> quit to menu
  await t.key('Escape', 100, 900);
  await t.shot('u-06-pause');
  await t.key('KeyS', 100, 300); await t.key('KeyS', 100, 300);
  await t.key('Enter', 100, 1500);
  console.log('after quit', JSON.stringify(await st()), JSON.stringify(await page.evaluate(() => window.__game.menus._joinState)));
  await t.shot('u-07-after-quit');
  // gamepad joins now as P2, then go race; unplug mid race
  await t.pad(0, 0, 600);
  await t.key('Enter', 100, 1000);   // P1 continue
  await t.key('Enter', 100, 300);     // P1 pick
  await t.pad(0, 0, 2500);            // P2 pick
  await t.key('Enter', 100, 500);     // track -> race
  await t.until(() => window.__game?.state === 'race', null, 60000);
  await t.until(() => window.__game.race?.state === 'racing', null, 60000);
  await t.wait(1000);
  await page.evaluate(() => window.__pads.plug(0, false));
  await t.wait(1500);
  console.log('after unplug', JSON.stringify(await st()));
  await t.shot('u-08-unplug-pause');
  await page.evaluate(() => window.__pads.plug(0, true));
  await t.wait(800);
  await t.pad(0, 9, 1200);            // Start to resume
  console.log('after replug + Start', JSON.stringify(await st()));
  // restart from pause via pad
  await t.pad(0, 9, 1200);
  await t.pad(0, 13, 400);            // down -> restart
  await t.pad(0, 0, 2500);
  console.log('after restart', JSON.stringify(await st()), await page.evaluate(() => window.__game.race?.state));
  console.log('rumbles', await page.evaluate(() => (window.__rumbles || []).length));
  console.log('errors', t.errors.slice(0, 8));
} catch (e) {
  console.log('FAIL', e.message, JSON.stringify(await st().catch(() => null)));
  await t.shot('u-FAIL');
} finally { await browser.close(); }
