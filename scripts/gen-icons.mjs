#!/usr/bin/env node
/**
 * Render the app icon (build/icon.js, SVG drawn in code) to every PNG size in public/icons/.
 *   node scripts/gen-icons.mjs
 * Uses system Chrome through Playwright (like the smoke test). The PNGs are committed, so a normal build
 * never needs a browser; re-run this only when the icon art changes. OWNER: mobile platform.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { iconSvg, ICON_SIZES, MASKABLE_SIZES, FULL_BLEED } from '../build/icon.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'icons');
mkdirSync(OUT, { recursive: true });

writeFileSync(path.join(OUT, 'icon.svg'), iconSvg());
writeFileSync(path.join(OUT, 'maskable.svg'), iconSvg({ maskable: true }));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (file, size, svg) => {
    await page.setViewportSize({ width: size, height: size });
    const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setContent(`<html><body style="margin:0;background:transparent"><img src="${url}" width="${size}" height="${size}" style="display:block"></body></html>`);
    await page.waitForFunction(() => document.querySelector('img').complete);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(path.join(OUT, file), png);
    console.log(`[icons] ${file} ${size}px`);
  };
  for (const [file, size] of Object.entries(ICON_SIZES)) await render(file, size, iconSvg({ fullBleed: FULL_BLEED.includes(file) }));
  for (const [file, size] of Object.entries(MASKABLE_SIZES)) await render(file, size, iconSvg({ maskable: true }));
} finally {
  await browser.close();
}
