// Character-select layout probe: N players at a viewport, screenshot + clipping report.
// usage: node dev/review-fix/chars.mjs <players 1-4> <W> <H> [downPresses]   (server: npx vite --port 5541)
import { chromium } from 'playwright';

const [,, nArg = '2', wArg = '1280', hArg = '720', downArg = '0'] = process.argv;
const N = +nArg, W = +wArg, H = +hArg, DOWN = +downArg;
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript(() => {
  const mk = (index) => ({
    id: `Xbox Wireless Controller ${index} (STANDARD GAMEPAD Vendor: 045e Product: 0b13)`,
    index, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: { playEffect: () => Promise.resolve('complete') },
  });
  const pads = [mk(0), mk(1)];
  window.__pad = { set(p, i, on) { pads[p].buttons[i] = { pressed: on, touched: on, value: on ? 1 : 0 }; pads[p].timestamp++; } };
  navigator.getGamepads = () => [pads[0], pads[1], null, null];
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`http://localhost:5541/?unlockreset=1&democontent=1`);
await p.waitForFunction(() => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, { timeout: 60000 });
await p.waitForTimeout(1500);
const key = async (k, ms = 700) => { await p.keyboard.press(k); await p.waitForTimeout(ms); };
const pad = async (i, btn, ms = 700) => { await p.evaluate(([i, btn]) => window.__pad.set(i, btn, true), [i, btn]); await p.waitForTimeout(120); await p.evaluate(([i, btn]) => window.__pad.set(i, btn, false), [i, btn]); await p.waitForTimeout(ms); };
await key('Enter', 1200);
if (N >= 2) await key('Slash', 900);
if (N >= 3) await pad(0, 0, 900);
if (N >= 4) await pad(1, 0, 900);
await key('Enter', 1200); // mode select -> Free Race
await key('Enter', 1500); // character select
for (let i = 0; i < DOWN; i++) await key('KeyS', 500);
await p.waitForTimeout(800);
const report = await p.evaluate(() => {
  const grid = document.querySelector('.sk-grid');
  if (!grid) return { error: 'no grid' };
  const g = grid.getBoundingClientRect();
  const inside = (r) => r.top >= g.top - 0.5 && r.bottom <= g.bottom + 0.5 && r.left >= g.left - 0.5 && r.right <= g.right + 0.5;
  const visible = (r) => r.bottom > g.top && r.top < g.bottom; // at least partly in the scroll box
  const clipped = [];
  for (const sel of ['.sk-tag', '.skp-bar-tile', '.sk-tile']) {
    for (const el of grid.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (visible(r) && !inside(r)) clipped.push({ sel, text: el.textContent.trim().slice(0, 20), top: Math.round(r.top), bottom: Math.round(r.bottom) });
    }
  }
  const tiles = [...grid.querySelectorAll('.sk-tile')].map((t) => t.getBoundingClientRect());
  const hidden = tiles.filter((r) => r.top >= g.bottom || r.bottom <= g.top).length;
  return {
    grid: { top: Math.round(g.top), bottom: Math.round(g.bottom), scrollTop: grid.scrollTop, scrollH: grid.scrollHeight, clientH: grid.clientHeight },
    classes: grid.className, cue: [...document.querySelectorAll('.sk-grid-cue')].map((e) => getComputedStyle(e).display + '/' + getComputedStyle(e).opacity),
    tiles: tiles.length, hiddenTiles: hidden, clipped,
  };
});
console.log(JSON.stringify(report, null, 1));
await p.screenshot({ path: `dev/review-fix/chars-${N}p-${W}x${H}-d${DOWN}.png` });
if (errs.length) console.log('ERRORS', errs);
await b.close();
