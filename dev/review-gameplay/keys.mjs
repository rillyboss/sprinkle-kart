import { launch, newPage, BASE } from './lib.mjs';
const browser = await launch();
const t = await newPage(browser);
const { page } = t;
const k = (i) => page.evaluate((i) => { const x = window.__game.race.getPlayerKart(i); return { sp: +x.speed.toFixed(1), lat: +x.lateral.toFixed(2), prog: +x.progress.toFixed(1), drifting: x.drifting, lvl: x.driftLevel, item: x.item, boosting: x.boosting, shielded: x.shielded, lookBack: null }; }, i);
try {
  await page.goto(`${BASE}?quick=gumdrop-meadow&players=2&cpus=0`);
  await t.until(() => window.__game?.race?.state === 'racing', null, 120000);
  await page.keyboard.down('KeyW'); await page.keyboard.down('ArrowUp');
  await t.wait(5000);
  console.log('both accelerating', JSON.stringify(await k(0)), JSON.stringify(await k(1)));
  await page.keyboard.down('ArrowLeft'); await t.wait(1500); await page.keyboard.up('ArrowLeft');
  console.log('kb2 left', JSON.stringify(await k(1)));
  // kb1 drift: hold space + A
  await page.keyboard.down('Space'); await page.keyboard.down('KeyA');
  await t.wait(2500);
  console.log('kb1 drifting', JSON.stringify(await k(0)));
  await page.keyboard.up('Space'); await page.keyboard.up('KeyA');
  await t.wait(300);
  for (let i = 0; i < 10; i++) { console.log('hold W/Up', JSON.stringify(await k(0)), JSON.stringify(await k(1)), await page.evaluate(() => { const r = window.__game.race; const a = r.getPlayerKart(0), b = r.getPlayerKart(1); return [a.position.distanceTo(b.position).toFixed(2), ((a.heading - r.path.headingAt(a.s)) * 57.3).toFixed(0), ((b.heading - r.path.headingAt(b.s)) * 57.3).toFixed(0)]; })); await t.wait(500); } await t.shot('k-00-stuck');
  // items
  await page.evaluate(() => { const r = window.__game.race; r.getPlayerKart(0).item = 'bubble-shield'; r.getPlayerKart(0).itemCharges = 1; r.getPlayerKart(1).item = 'sprinkle-boost'; r.getPlayerKart(1).itemCharges = 1; });
  await t.wait(500);
  await t.shot('k-01-items');
  await t.key('KeyE', 100, 400); await t.key('Slash', 100, 400);
  console.log('after E and /', JSON.stringify(await k(0)), JSON.stringify(await k(1)));
  await t.shot('k-02-items-used');
  // look back
  await page.keyboard.down('KeyQ'); await t.wait(800); await t.shot('k-03-lookback'); await page.keyboard.up('KeyQ');
  // kb2 pause via Backspace, resume via Backspace (back)
  await t.key('Backspace', 100, 900);
  console.log('kb2 pause', await page.evaluate(() => window.__game.state));
  await t.key('Backspace', 100, 900);
  console.log('kb2 resume', await page.evaluate(() => window.__game.state));
  console.log('errors', t.errors.slice(0, 8));
} catch (e) { console.log('FAIL', e.message); await t.shot('k-FAIL'); } finally { await browser.close(); }
