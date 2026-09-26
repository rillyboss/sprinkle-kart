// Throwaway screenshot helper for the showcase features branch.
// usage: node dev/feat-showcase-features/shots.mjs <scenario...>   (dev server on :5421)
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
fs.mkdirSync(DIR, { recursive: true });
const BASE = process.env.BASE || 'http://localhost:5421/';
const W = Number(process.env.W || 1280), H = Number(process.env.H || 720);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const wait = (fn, arg, ms = 240000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 250 });
const shot = (n) => page.screenshot({ path: path.join(DIR, `${n}.png`) });
const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(350); };
const menusReady = () => wait(() => window.__game?.menus && !window.__game.menus.cooldown || true);

const scenarios = {
  async modes() {
    await page.goto(`${BASE}?unlockreset=1`);
    await wait(() => window.__game?.state === 'menu' && window.__game.menus?.screenId === 'title');
    await page.waitForTimeout(800);
    await key('Enter');
    await wait(() => window.__game.menus.screenId === 'join');
    await page.waitForTimeout(600);
    await key('Enter');
    await wait(() => window.__game.menus.screenId === 'mode-select');
    await page.waitForTimeout(900);
    for (let i = 0; i < 4; i++) await key('KeyD');
    await page.waitForTimeout(600);
    await shot('modes-select');
    await key('Enter');
    await wait(() => window.__game.menus.screenId === 'character-select');
    await page.waitForTimeout(700);
    await key('Enter');
    await wait(() => window.__game.menus.screenId === 'arena-select');
    await page.waitForTimeout(1200);
    await shot('arena-select');
  },
  async battle() {
    const players = process.env.P || '2';
    await page.goto(`${BASE}?mode=battle&players=${players}&autodrive=1&simspeed=${process.env.SIM || 1}&arena=${process.env.ARENA || 'bubble-bath-bowl'}`);
    await wait(() => window.__game?.state === 'race' && window.__game.race?.state === 'racing');
    await wait((t1) => (window.__game.race?.time ?? 0) > t1, Number(process.env.T1 || 8));
    await shot(`battle-${process.env.ARENA || 'bath'}-${players}p`);
    if (process.env.RESULTS) {
      await wait(() => window.__game?.state === 'results', null, 900000);
      await page.waitForTimeout(2500);
      await shot(`battle-results-${players}p`);
    }
  },
  async daily() {
    await page.goto(`${BASE}?unlockreset=1`);
    await wait(() => window.__game?.state === 'menu' && window.__game.menus?.screenId === 'title');
    await page.waitForTimeout(800);
    await key('Enter');
    await wait(() => window.__game.menus.screenId === 'join');
    await page.waitForTimeout(600);
    await key('Enter');
    await wait(() => window.__game.menus.screenId === 'mode-select');
    await page.waitForTimeout(900);
    await key('KeyS');
    await key('KeyD');
    await page.waitForTimeout(500);
    await shot('daily-0-modes');
    await key('Enter');
    await wait(() => window.__game.menus.screenId === 'daily');
    await page.waitForTimeout(1500);
    await shot('daily-1-card');
    await key('Enter');
    await wait(() => window.__game.menus.screenId === 'character-select');
    await page.waitForTimeout(700);
    await key('Enter');
    await wait(() => window.__game.menus.screenId === 'daily');
    await page.waitForTimeout(700);
    await key('Enter');
    await wait(() => window.__game?.state === 'race' && window.__game.race?.state === 'racing');
    await wait((t1) => (window.__game.race?.time ?? 0) > t1, 6);
    await shot('daily-2-race');
  },
  async team() {
    const players = process.env.P || '2';
    await page.goto(`${BASE}?quick=${process.env.TRACK || 'gumdrop-meadow'}&mode=team&players=${players}&autodrive=1&fastfinish=1&simspeed=${process.env.SIM || 1}`);
    await wait(() => window.__game?.state === 'race' && window.__game.race?.state === 'racing');
    await wait((t1) => (window.__game.race?.time ?? 0) > t1, Number(process.env.T1 || 8));
    await shot(`team-${players}p`);
    if (process.env.RESULTS) {
      await wait(() => window.__game?.state === 'results', null, 900000);
      await page.waitForTimeout(2500);
      await shot(`team-results-${players}p`);
    }
  },
};

try {
  for (const name of process.argv.slice(2)) {
    console.log('scenario', name);
    await scenarios[name]();
  }
} catch (err) {
  console.error('FAILED', err.message);
  await shot('FAIL');
} finally {
  console.log('errors:', JSON.stringify(errors.slice(0, 10)));
  await browser.close();
}
