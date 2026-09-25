import { launch, newPage, BASE } from './lib.mjs';
const browser = await launch();
const t = await newPage(browser, { pads: 4 });
const { page } = t;
try {
  await page.goto(`${BASE}?unlockreset=1&simspeed=2`);
  await t.until(() => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'));
  await t.wait(1000);
  await t.pad(2, 0);            // pad index 2 presses first -> should be P1
  await t.pad(0, 0); await t.pad(3, 0); await t.pad(1, 0);
  console.log('join', JSON.stringify(await page.evaluate(() => window.__game.menus._joinState.players.map((p) => p.deviceId))));
  await t.pad(0, 0, 400);       // non-P1 A should shake, not advance
  console.log('screen after P2 A', await page.evaluate(() => document.querySelector('.sk-menus .sk-screen')?.className));
  await t.pad(2, 0, 900);       // P1 A -> chars
  for (const p of [2, 0, 3, 1]) await t.pad(p, 0, 250);
  await t.wait(2500);
  await t.pad(2, 0, 500);       // race
  await t.until(() => window.__game?.state === 'race');
  await t.until(() => window.__game.race?.state === 'racing', null, 120000);
  // all accelerate with RT; pad index 3 (P3) steers right
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__pads.set(i, 7, true); });
  await t.wait(3000);
  const lat0 = await page.evaluate(() => [0, 1, 2, 3].map((i) => +window.__game.race.getPlayerKart(i).lateral.toFixed(2)));
  await page.evaluate(() => window.__pads.axis(3, 0, 1));
  await t.wait(1500);
  const lat1 = await page.evaluate(() => [0, 1, 2, 3].map((i) => +window.__game.race.getPlayerKart(i).lateral.toFixed(2)));
  console.log('lateral before', lat0, 'after pad3 right', lat1, 'devices', JSON.stringify(await page.evaluate(() => window.__game.setup.players.map((p) => p.deviceId))));
  await t.shot('p4-race');
  // P4 (gp1) presses Start -> pause labelled P4
  await t.pad(1, 9, 900);
  console.log('pause label', await page.evaluate(() => document.querySelector('.sk-pause .sk-lead')?.textContent));
  console.log('fps', await page.evaluate(() => window.__game.fps), 'errors', t.errors.slice(0, 5));
} catch (e) { console.log('FAIL', e.message); await t.shot('p4-FAIL'); } finally { await browser.close(); }
