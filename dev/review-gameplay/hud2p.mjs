import { launch, newPage, BASE } from './lib.mjs';
const browser = await launch();
const t = await newPage(browser);
const { page } = t;
try {
  await page.goto(`${BASE}?quick=starlight-galaxy&players=2&autodrive=1&laps=2&simspeed=3`);
  await t.until(() => window.__game?.race?.state === 'countdown', null, 60000);
  await t.wait(300);
  await t.shot('h-01-2p-countdown');
  await t.until(() => window.__game.race.getPlayerKart(0).lap === 2, null, 300000);
  await t.shot('h-02-2p-finallap');
  await t.until(() => window.__game.race.karts.some((k) => k.item && k.playerIndex !== null && k.itemRoulette > 0), null, 300000).catch(() => {});
  await t.shot('h-03-2p-roulette');
  await t.until(() => window.__game.race.getPlayerKart(0).finished, null, 300000);
  await t.wait(300);
  await t.shot('h-04-2p-finished');
  const info = await page.evaluate(() => window.__game.race.karts.map((k) => [k.characterId, k.playerIndex, k.finishPlace, k.lap, k.lapTimes.map((x) => x.toFixed(1)).join('/')]));
  console.log(JSON.stringify(info));
  console.log('fps', await page.evaluate(() => window.__game.fps));
  console.log('errors', t.errors.slice(0, 8));
} catch (e) { console.log('FAIL', e.message); await t.shot('h-FAIL'); } finally { await browser.close(); }
