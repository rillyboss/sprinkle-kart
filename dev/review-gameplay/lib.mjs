import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

export const BASE = 'http://localhost:5191/';
export const OUT = path.resolve('D:/dev/sprinkle-kart/smoke-out/review-gameplay');
mkdirSync(OUT, { recursive: true });

export const FAKE_PADS = (count) => {
  const pads = [];
  for (let i = 0; i < 4; i++) {
    pads.push({
      id: `Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13) #${i}`,
      index: i, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      vibrationActuator: { playEffect: (...a) => { (window.__rumbles ||= []).push([i, a[1]]); return Promise.resolve('complete'); } },
    });
  }
  const present = pads.map((_, i) => i < count);
  window.__pads = {
    set(p, b, on) { pads[p].buttons[b] = { pressed: on, touched: on, value: on ? 1 : 0 }; pads[p].timestamp++; },
    axis(p, i, v) { pads[p].axes[i] = v; pads[p].timestamp++; },
    plug(p, on) { present[p] = on; pads[p].connected = on; },
  };
  navigator.getGamepads = () => pads.map((p, i) => (present[i] ? p : null));
};

export async function launch() {
  return chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
}

export async function newPage(browser, { pads = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (pads) await ctx.addInitScript(FAKE_PADS, pads);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`) });
  const wait = (ms) => page.waitForTimeout(ms);
  const key = async (code, hold = 120, after = 500) => {
    await page.keyboard.down(code); await wait(hold); await page.keyboard.up(code); await wait(after);
  };
  const pad = async (p, b, after = 600) => {
    await page.evaluate(([p, b]) => window.__pads.set(p, b, true), [p, b]);
    await wait(200);
    await page.evaluate(([p, b]) => window.__pads.set(p, b, false), [p, b]);
    await wait(after);
  };
  const until = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 250 });
  return { ctx, page, errors, shot, wait, key, pad, until };
}
