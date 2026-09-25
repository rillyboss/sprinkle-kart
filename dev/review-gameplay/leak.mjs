// Leak check: count live WebGL buffers/textures/programs + scene graph across 4 races (again, again, next-track, again).
import { launch, newPage, BASE } from './lib.mjs';

const HOOK = () => {
  const c = { buf: 0, tex: 0, prog: 0, vao: 0 };
  window.__gl = c;
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const wrap = (n, key, d) => { const o = P[n]; P[n] = function (...a) { const r = o.apply(this, a); if (d > 0 ? r : true) c[key] += d; return r; }; };
    wrap('createBuffer', 'buf', 1); wrap('deleteBuffer', 'buf', -1);
    wrap('createTexture', 'tex', 1); wrap('deleteTexture', 'tex', -1);
    wrap('createProgram', 'prog', 1); wrap('deleteProgram', 'prog', -1);
  }
  const P2 = WebGL2RenderingContext.prototype;
  const cv = P2.createVertexArray, dv = P2.deleteVertexArray;
  P2.createVertexArray = function (...a) { c.vao++; return cv.apply(this, a); };
  P2.deleteVertexArray = function (...a) { c.vao--; return dv.apply(this, a); };
};

const browser = await launch();
const t = await newPage(browser);
await t.ctx.addInitScript(HOOK);
const { page } = t;
const snap = () => page.evaluate(() => {
  const g = window.__game;
  let objs = 0; g.session?.scene?.traverse(() => objs++);
  return { ...window.__gl, objs, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null, ui: document.querySelectorAll('#ui *').length, track: g.setup?.trackId };
});
try {
  await page.goto(`${BASE}?quick=cotton-candy-castle&players=1&autodrive=1&fastfinish=1&simspeed=8&unlockreset=1`);
  const choices = ['again', 'again', 'next-track', 'again', 'again'];
  for (let r = 0; r < choices.length + 1; r++) {
    await t.until(() => window.__game?.state === 'race' && window.__game.race?.state === 'racing', null, 120000);
    await t.wait(1500);
    console.log(`race ${r + 1}`, JSON.stringify(await snap()));
    if (r === choices.length) break;
    await t.until(() => window.__game?.state === 'results', null, 240000);
    await t.wait(2500);
    if (r === 0) await t.shot('leak-results1');
    // dismiss unlock celebration if present
    if (await page.evaluate(() => !!document.querySelector('.sk-unlock:not(.sk-leaving)'))) { await t.key('Enter', 100, 900); }
    if (choices[r] === 'next-track') await t.key('KeyD', 100, 500);
    await t.key('Enter', 100, 500);
  }
  console.log('errors', t.errors.slice(0, 8));
} catch (e) {
  console.log('FAIL', e.message, JSON.stringify(await snap().catch(() => null)));
  await t.shot('leak-FAIL');
} finally { await browser.close(); }
