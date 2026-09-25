import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--window-position=-2400,0'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
for (const n of [1, 4]) {
  await p.goto(`http://localhost:5199/?quick=cotton-candy-castle&players=${n}&autodrive=1`);
  await p.waitForTimeout(14000);
  const g = await p.evaluate(() => ({ fps: window.__game.fps, state: window.__game.state, renderer: (()=>{const c=document.createElement('canvas').getContext('webgl2');const d=c.getExtension('WEBGL_debug_renderer_info');return d?c.getParameter(d.UNMASKED_RENDERER_WEBGL):'?'})() }));
  console.log(n + 'p', JSON.stringify(g));
}
await b.close();
