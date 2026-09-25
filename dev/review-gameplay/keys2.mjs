import { launch, newPage, BASE } from './lib.mjs';
const browser = await launch();
const t = await newPage(browser);
const { page } = t;
const k = (i) => page.evaluate((i) => { const r = window.__game.race; const x = r.getPlayerKart(i); const th = r.path.headingAt(x.s); const d = Math.atan2(Math.sin(x.heading - th), Math.cos(x.heading - th)); return { t: +r.time.toFixed(1), sp: +x.speed.toFixed(1), lat: +x.lateral.toFixed(2), prog: +x.progress.toFixed(1), headRelDeg: +(d * 180 / Math.PI).toFixed(0), vx: +x.velocity.length().toFixed(1), shielded: x.shielded, shieldT: +x.phys.shieldTime.toFixed(1), spin: x.spinning, wrong: x.wrongWay }; }, i);
try {
  await page.goto(`${BASE}?quick=gumdrop-meadow&players=1&cpus=0`);
  await t.until(() => window.__game?.race?.state === 'racing', null, 120000);
  await page.evaluate(() => { const r = window.__game.race; window.__ev = []; const o = r.onEvent; r.onEvent = (e) => { window.__ev.push(`${r.time.toFixed(1)} ${e.type}${e.item ? ':' + e.item : ''}${e.wall ? ':wall' : ''}${e.expired ? ':expired' : ''}`); o(e); }; });
  await page.keyboard.down('KeyW');
  await t.wait(4000);
  console.log('cruise', JSON.stringify(await k(0)));
  await page.evaluate(() => { const r = window.__game.race; r.getPlayerKart(0).item = 'bubble-shield'; r.getPlayerKart(0).itemCharges = 1; });
  await t.wait(300);
  await t.key('KeyE', 100, 100);
  for (let i = 0; i < 4; i++) { console.log('after shield', JSON.stringify(await k(0))); await t.wait(400); }
  // now steer into the left wall for 1.5s, then just hold W
  await page.keyboard.down('KeyA'); await t.wait(1500); await page.keyboard.up('KeyA');
  for (let i = 0; i < 8; i++) { console.log('W only after wall', JSON.stringify(await k(0))); await t.wait(500); }
  await t.shot('k2-wall');
  console.log(await page.evaluate(() => window.__ev.join('\n')));
} catch (e) { console.log('FAIL', e.message); } finally { await browser.close(); }
