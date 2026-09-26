// Throwaway visual checks for the modes workstream: node dev/feat/modes-timing/shots.mjs [names...]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = `http://localhost:${process.env.PORT || 5281}/`;
const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
async function page(vp = { width: 1280, height: 720 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts/.test(m.text())) errors.push(m.text()); });
  return { ctx, p, errors };
}
const shot = (p, n) => p.screenshot({ path: path.join(OUT, `${n}.png`) });
const press = async (p, k, ms = 700) => { await p.keyboard.press(k); await p.waitForTimeout(ms); };
const wf = (p, fn, t = 60000) => p.waitForFunction(fn, null, { timeout: t, polling: 200 });

try {
  if (want('menus')) {
    const { ctx, p, errors } = await page();
    await p.goto(`${BASE}?unlockreset=1`);
    await wf(p, () => window.__game?.state === 'menu' && document.querySelector('.sk-menus:not([hidden])'));
    await p.waitForTimeout(1000);
    await press(p, 'Enter', 900);
    await press(p, 'Slash', 700); // P2 joins
    await press(p, 'Enter', 1100);
    await shot(p, 'm1-mode-select');
    await press(p, 'KeyD', 600);
    await shot(p, 'm2-mode-gp');
    await press(p, 'Enter', 1000);
    await press(p, 'Enter', 400);
    await press(p, 'Slash', 2400);
    await shot(p, 'm3-cup-select');
    await press(p, 'KeyD', 500);
    await shot(p, 'm4-cup-locked');
    await press(p, 'Enter', 600);
    await press(p, 'Escape', 900); // back to characters
    await press(p, 'Escape', 900); // back to mode select
    await shot(p, 'm5-mode-back');
    await press(p, 'KeyS', 500);
    await shot(p, 'm6-mode-entries');
    await press(p, 'Enter', 1000);
    await shot(p, 'm7-records');
    console.log('menus errors', errors);
    await ctx.close();
  }
  if (want('hud')) {
    for (const n of [1, 2, 4]) {
      const { ctx, p, errors } = await page();
      await p.goto(`${BASE}?quick=gumdrop-meadow&players=${n}&autodrive=1&simspeed=4&speed=zoomy`);
      await wf(p, () => window.__game?.race?.getPlayerKart(0)?.lapTimes?.length >= 1, 120000);
      await p.waitForTimeout(600);
      await shot(p, `h-${n}p`);
      console.log(`hud ${n}p errors`, errors);
      await ctx.close();
    }
  }
  if (want('tt')) {
    const { ctx, p, errors } = await page();
    await p.goto(`${BASE}?mode=tt&quick=cotton-candy-castle&autodrive=1&simspeed=4&laps=2&speed=zoomy`);
    await wf(p, () => window.__game?.state === 'race');
    await p.waitForTimeout(2500);
    await shot(p, 't1-countdown');
    await wf(p, () => window.__game?.state === 'results', 240000);
    await p.waitForTimeout(1800);
    await shot(p, 't2-results-first');
    await press(p, 'Enter', 400);
    await press(p, 'Enter', 400);
    await wf(p, () => window.__game?.state === 'race' && window.__game?.race?.state === 'racing');
    await p.waitForTimeout(3000);
    await shot(p, 't3-ghost');
    await p.waitForTimeout(4000);
    await shot(p, 't4-ghost-later');
    console.log('tt info', await p.evaluate(() => window.__game.timeTrial));
    await wf(p, () => window.__game?.state === 'results', 240000);
    await p.waitForTimeout(1800);
    await shot(p, 't5-results-second');
    console.log('tt errors', errors);
    await ctx.close();
  }
  if (want('gp')) {
    const { ctx, p, errors } = await page();
    await p.goto(`${BASE}?mode=gp&cup=sprinkle-cup&players=2&autodrive=1&fastfinish=1&simspeed=8&speed=zoomy&unlockreset=1`);
    for (let r = 0; r < 4; r++) {
      await wf(p, () => window.__game?.state === 'results', 240000);
      await p.waitForTimeout(1500);
      if (r === 0) await shot(p, 'g1-results');
      // dismiss unlock celebrations if any, then continue
      for (let i = 0; i < 6 && await p.evaluate(() => window.__game.state === 'results'); i++) {
        await press(p, 'Enter', 2600);
      }
      await wf(p, () => document.querySelector('.sk-gp'), 20000);
      await p.waitForTimeout(1100);
      if (r === 0) await shot(p, 'g2-standings-tally');
      await p.waitForTimeout(2200);
      await shot(p, `g3-standings-${r + 1}`);
      if (r < 3) { await press(p, 'Enter', 800); }
    }
    await press(p, 'Enter', 1500);
    await shot(p, 'g4-ceremony');
    await p.waitForTimeout(2500);
    await shot(p, 'g5-ceremony-later');
    console.log('gp', await p.evaluate(() => ({ last: window.__game.lastGp?.standings?.map((s) => [s.characterId, s.points]), fin: window.__game.lastGp?.finished })));
    console.log('gp errors', errors);
    await ctx.close();
  }
} finally {
  await browser.close();
}
