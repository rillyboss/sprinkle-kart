import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`http://localhost:5181/?quick=cotton-candy-castle&players=3&autodrive=1`);
await p.waitForFunction(() => window.__game?.race?.state === 'racing', null, { timeout: 120000 });
await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const s = window.__game.session; const race = s.race;
  return s.rigs.map((rig, i) => {
    const own = race.getPlayerKart(i); const c = rig.camera.position;
    return race.karts.filter(k => k !== own).map(k => ({ id: k.characterId, d: +Math.hypot(k.position.x - c.x, k.position.y + 0.8 - c.y, k.position.z - c.z).toFixed(1), vis: k.model.group.visible })).filter(x => x.d < 9);
  });
});
console.log(JSON.stringify(r));
await p.screenshot({ path: 'dev/fixer/occ3p.png' });
await b.close();
