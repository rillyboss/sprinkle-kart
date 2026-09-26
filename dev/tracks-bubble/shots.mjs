// node dev/tracks-bubble/shots.mjs <id> [kinds...]   (vite must be serving on PORT, default 5211)
// kinds: top | race | at:<frac>[:lat[:h]] | free:<x,y,z,lx,ly,lz>
import { chromium } from 'playwright';
const PORT = process.env.PORT || 5211;
const [,, id, ...kinds0] = process.argv;
const kinds = kinds0.length ? kinds0 : ['top', 'race'];
const out = (n) => `dev/tracks-bubble/${id}-${n}.png`;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
pg.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.startsWith('info')) console.log('[console]', m.type(), t); });
pg.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const k of kinds) {
  if (k === 'race') {
    const sim = process.env.SIM || 2;
    await pg.goto(`http://localhost:${PORT}/?quick=${id}&players=${process.env.PLAYERS || 1}&autodrive=1&simspeed=${sim}`);
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: out('race-start') });
    const times = (process.env.TIMES || '9000,9000').split(',').map(Number);
    let i = 0;
    for (const t of times) {
      await pg.waitForTimeout(t);
      const info = await pg.evaluate(() => { const g = window.__game; const hs = (g?.race?.karts || []).filter((q) => !q.isCPU).map((k) => ({ pi: k.playerIndex, s: Math.round(k.s), lat: +k.lateral.toFixed(1), y: +k.position.y.toFixed(2), place: k.place, off: k.offRoad })); return { fps: g?.fps, hs, errors: g?.errors?.length }; });
      console.log('race', i, JSON.stringify(info));
      await pg.screenshot({ path: out(`race-mid${++i}`) });
    }
  } else {
    let q = '';
    if (k === 'top') q = 'view=top';
    else if (k.startsWith('at:')) { const [, s, lat = 0, h = 5] = k.split(':'); q = `view=at&s=${s}&lat=${lat}&h=${h}`; }
    else if (k.startsWith('free:')) q = `view=free&cam=${k.slice(5)}`;
    else q = 'view=chase';
    await pg.goto(`http://localhost:${PORT}/dev/tracks/index.html?track=${id}&${q}`);
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: out(k.replace(/[:,.]/g, '_')) });
  }
}
await b.close();
