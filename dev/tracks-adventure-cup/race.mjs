// node dev/tracks-adventure-cup/race.mjs <trackId> [fractions comma list] [players]
// Real quick race with autodrive; screenshots the chase cam at the start and
// when the human kart passes each lap fraction. Also prints fps + errors.
import { chromium } from 'playwright';
const [,, id = 'jellybean-jungle', fr = '0.3,0.65', players = '1'] = process.argv;
const PORT = process.env.PORT || 5231;
const out = (n) => `dev/tracks-adventure-cup/${id}-${players}p-${n}.png`;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
pg.on('pageerror', (e) => errs.push(String(e)));
pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await pg.goto(`http://localhost:${PORT}/?quick=${id}&players=${players}&autodrive=1`);
await pg.waitForFunction(() => window.__game?.race, null, { timeout: 120000 });
await pg.waitForTimeout(2500);
await pg.screenshot({ path: out('start') });
await pg.waitForFunction(() => window.__game?.race?.state === 'racing', null, { timeout: 120000 });
for (const f of fr.split(',').map(Number)) {
  await pg.waitForFunction((f) => {
    const r = window.__game.race; const k = r.karts.find((q) => !q.isCPU);
    return k && k.s / r.path.length > f && k.s / r.path.length < f + 0.1;
  }, f, { timeout: 180000, polling: 100 });
  await pg.screenshot({ path: out(String(f)) });
}
const info = await pg.evaluate(() => ({ fps: window.__game.fps, state: window.__game.race.state, lap: window.__game.race.karts.find((q) => !q.isCPU).lap }));
console.log(id, JSON.stringify(info), errs.length ? '\nERRORS:\n' + errs.join('\n') : 'no errors');
await b.close();
