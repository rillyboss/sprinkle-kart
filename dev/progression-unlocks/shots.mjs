// Screenshot the progression screens. Usage: node dev/progression-unlocks/shots.mjs [WxH] [only]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = `http://localhost:${process.env.PORT || 5271}/`;
const [W, H] = (process.argv[2] || '1280x720').split('x').map(Number);
const only = process.argv[3] || '';
const tag = `${W}x${H}`;
const SAVE = {
  unlocked: ['cotton-candy-girl', 'bubblegum-bay'], wins: 1, trophies: { 'gumdrop-meadow': 1 },
  stats: { racesFinished: 2, wins: 1, podiums: 2, itemsUsed: 7, bonksGiven: 4, miniTurbos: 9, miniTurbos1: 6, miniTurbos2: 2, miniTurbos3: 1, itemBoxes: 12, boosts: 20, multiplayerRaces: 1, bonked: 3 },
  tracks: { 'gumdrop-meadow': { finishes: 1, wins: 1, top3: 1, bestPlace: 1 }, 'starlight-galaxy': { finishes: 1, wins: 0, top3: 0, bestPlace: 4 } },
  cups: {}, records: { 'gumdrop-meadow': { bestRace: 83.4, bestLap: 26.9 } }, racers: { rocco: { races: 2, wins: 1, podiums: 2 } },
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const press = async (k, ms = 450) => { await page.keyboard.press(k); await page.waitForTimeout(ms); };
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}-${tag}.png`) });
async function boot(q = '', save = SAVE) {
  await page.goto(`${BASE}?unlockreset=1${q}`);
  await page.waitForFunction(() => window.__game?.state === 'menu' && !!document.querySelector('.sk-menus:not([hidden])'), null, { timeout: 60000 });
  await page.evaluate((s) => localStorage.setItem('sprinkle-kart-progress-v1', JSON.stringify(s)), save);
  await page.waitForTimeout(900);
}
const want = (n) => !only || n.includes(only);
if (want('book') || want('settings')) {
  await boot();
  await page.evaluate(() => window.__game.menus.goto('title'));
  await page.waitForTimeout(700);
  await press('KeyS'); await shot('title');
  await press('Enter', 900); await shot('book-racers');
  for (let i = 0; i < 8; i++) await press('KeyD', 200);
  await shot('book-racers-locked');
  await press('Tab', 600); await shot('book-tracks');
  await press('KeyS'); await shot('book-tracks-2');
  await press('Tab', 600); await shot('book-stats');
  await press('Escape', 900);
  await press('KeyS'); await press('KeyD'); await press('Enter', 900); await shot('settings');
  await press('KeyD'); await press('KeyD');
  await press('KeyS'); await press('KeyS'); await press('KeyS'); await press('Enter', 700); await shot('settings-gate');
  const ans = await page.evaluate(() => { const q = document.querySelector('.skp-gate-q').textContent.match(/(\d+)\D+(\d+)/); return +q[1] + +q[2]; });
  await press('KeyW', 150); await press('KeyW', 150); await press('Enter', 500); await shot('settings-gate-wrong');
  for (let i = 2; i < ans; i++) await press('KeyW', 120);
  await press('Enter', 700); await shot('settings-done');
  await press('Enter', 600); await press('KeyS'); await press('Enter', 600); await shot('settings-reset');
  const all = await page.evaluate(() => JSON.parse(localStorage.getItem('sprinkle-kart-progress-v1')).unlockAll);
  console.log('unlockAll after gate:', all);
}
if (want('unlock') || want('results')) {
  await boot();
  await page.evaluate(() => {
    const m = window.__game.menus;
    const chars = m.characters;
    const tr = m.tracks;
    const standings = chars.slice(0, 8).map((c, i) => ({ characterId: c.id, playerIndex: i === 0 ? 0 : null, isCPU: i !== 0, finishPlace: i + 1, finished: true, finishTime: 80 + i }));
    window.__done = m.showResults({ standings, trackDef: tr[0], humanWinner: standings[0], unlocks: [
      { kind: 'character', id: 'cotton-candy-girl', def: chars.find((c) => c.id === 'cotton-candy-girl') },
      { kind: 'track', id: tr[1].id, def: tr[1] },
      { kind: 'character', id: 'dino', def: chars.find((c) => c.id === 'dino') },
    ] });
  });
  await page.waitForTimeout(4500); await shot('unlock-1');
  await press('Enter', 3300); await shot('unlock-2');
  await press('Enter', 3300); await shot('unlock-3');
  await press('Enter', 1500); await shot('results');
}
if (want('teaser')) {
  await boot('', { ...SAVE, unlocked: [], stats: { racesFinished: 1 } });
  await page.evaluate(() => {
    const m = window.__game.menus;
    const standings = m.characters.slice(0, 8).map((c, i) => ({ characterId: c.id, playerIndex: i === 2 ? 0 : null, isCPU: i !== 2, finishPlace: i + 1, finished: true, finishTime: 80 + i }));
    m.showResults({ standings, trackDef: m.tracks[0], humanWinner: null, unlocks: [] });
  });
  await page.waitForTimeout(2000); await shot('results-teaser');
}
if (want('select')) {
  await boot('&democontent=1');
  await page.evaluate(() => window.__game.menus.goto('title'));
  await page.waitForTimeout(600);
  await press('Enter', 900); await press('Enter', 1000);
  await press('KeyS'); await press('KeyS'); await shot('select-chars');
  await press('KeyW'); await press('KeyW'); await press('Enter', 2400);
  for (let i = 0; i < 4; i++) await press('KeyD', 250);
  await shot('select-tracks');
}
console.log('errors:', errors);
await browser.close();
