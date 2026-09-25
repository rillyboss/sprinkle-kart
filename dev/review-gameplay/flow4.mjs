// 4-player menu flow: kb1, kb2, gp0, gp1 join; locked char check; track select; race; fps.
import { launch, newPage, BASE } from './lib.mjs';

const browser = await launch();
const t = await newPage(browser, { pads: 2 });
const { page } = t;
try {
  await page.goto(`${BASE}?unlockreset=1`);
  await t.until(() => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'));
  await t.wait(1200);
  await t.shot('f4-00-title');
  await t.key('Enter');                 // kb1 joins from title
  await t.key('Slash');                 // kb2 joins
  await t.pad(0, 0);                    // gp0 joins
  await t.pad(1, 0);                    // gp1 joins
  await t.pad(1, 3);                    // gp1 Easy drive
  await t.shot('f4-01-join');
  const join = await page.evaluate(() => window.__game.menus._joinState);
  console.log('join', JSON.stringify(join));
  await t.key('Enter', 120, 900);       // P1 continues
  await t.shot('f4-02-chars');
  // P1 moves to the last tile (locked CCG?) and tries to pick it
  for (let i = 0; i < 8; i++) await t.key('KeyD', 80, 250);
  await t.shot('f4-03-p1-on-locked');
  await t.key('Enter', 120, 600);
  await t.shot('f4-04-locked-shake');
  await t.key('KeyD', 80, 300);         // wrap to rocco
  await t.key('Enter');
  await t.key('ArrowRight', 80, 300);
  await t.key('Slash');                 // kb2 lenny?
  await t.pad(0, 15, 300); await t.pad(0, 15, 300); await t.pad(0, 0);
  await t.pad(1, 15, 300); await t.pad(1, 15, 300); await t.pad(1, 15, 300); await t.pad(1, 0, 300);
  await t.shot('f4-05-all-ready');
  await t.wait(2000);
  await t.shot('f4-06-tracks');
  // gp0 (not P1) tries to change track -> should be ignored
  await t.pad(0, 15, 400);
  await t.key('KeyD', 80, 400);          // P1 selects gumdrop meadow
  await t.key('KeyS', 80, 300);          // speed row
  await t.key('KeyA', 80, 300);          // cozy
  await t.key('KeyS', 80, 300);          // laps row
  await t.key('KeyA', 80, 300); await t.key('KeyA', 80, 300); await t.key('KeyA', 80, 300); // 1 lap
  await t.shot('f4-07-tracks-set');
  await t.key('Enter', 120, 500);
  await t.until(() => window.__game?.state === 'race', null, 60000);
  const setup = await page.evaluate(() => window.__game.setup);
  console.log('setup', JSON.stringify(setup));
  await t.wait(1500);
  await t.shot('f4-08-countdown');
  await t.until(() => window.__game?.race?.state === 'racing', null, 60000);
  // everyone drives
  await page.keyboard.down('KeyW'); await page.keyboard.down('ArrowUp');
  await page.evaluate(() => { window.__pads.set(0, 7, true); window.__pads.set(1, 0, true); });
  await t.wait(6000);
  await t.shot('f4-09-racing');
  const info = await page.evaluate(() => {
    const g = window.__game;
    return {
      fps: g.fps,
      karts: g.race.karts.map((k) => ({ c: k.characterId, pi: k.playerIndex, easy: k.easyDrive, prog: +k.progress.toFixed(1), sp: +k.speed.toFixed(1) })),
      info: g.session && window.__game.race ? null : null,
    };
  });
  console.log(JSON.stringify(info, null, 0));
  await t.wait(4000);
  console.log('fps later', await page.evaluate(() => window.__game.fps));
  console.log('errors', t.errors.slice(0, 10));
} catch (e) {
  console.log('FAIL', e.message);
  await t.shot('f4-FAIL');
} finally {
  await browser.close();
}
