/**
 * Self-hosted web fonts — a generic Vite plugin (mobile platform / offline PWA). OWNER: mobile platform.
 *
 * Any Google Fonts stylesheet the game uses is downloaded ONCE into public/fonts/ (committed, so builds are
 * reproducible and offline) and the page links the local copy instead:
 *
 *   index.html   <link href="https://fonts.googleapis.com/css2?family=…" rel="stylesheet">
 *                  → <link rel="stylesheet" href="./fonts/gf-<hash>.css?family=…">   (preconnects dropped)
 *   any .js      the same URL as a string literal (a script injecting the <link>) → the local href
 *   any .css     @import url('https://fonts.googleapis.com/css2?family=…');
 *                  → the @font-face rules inlined, pointing at /fonts/files/*.woff2
 *
 * So a new font family (e.g. the v3.1 UI kit) needs NO change here: add the usual Google Fonts <link> or
 * @import, run `npx vite build` (or the dev server) once with internet, and commit public/fonts/.
 * Only the `latin` and `latin-ext` subsets are kept (every word in the game is English; emoji are system
 * fonts), which keeps the offline precache small. Without internet and without a cached copy the original
 * link is left alone (the game still works online) and a warning is printed.
 *
 * Pure helpers (unit tested with a fake fetch): findGoogleFontUrls, fontCacheKey, pickSubsets, localizeCss,
 * ensureFontCached.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** A browser UA so Google serves woff2 (it sniffs the user agent). */
export const FONT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
export const KEEP_SUBSETS = Object.freeze(['latin', 'latin-ext']);
const GF_URL = /https:\/\/fonts\.googleapis\.com\/css2?\?[^"'()\s>]+/g;

/** Google Fonts stylesheet URLs in some HTML / CSS text (HTML entities decoded, unique, in order). */
export function findGoogleFontUrls(text = '') {
  const out = [];
  for (const m of String(text).matchAll(GF_URL)) {
    const url = m[0].replace(/&amp;/g, '&');
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** Stable short file key for a stylesheet URL (FNV-1a 32, hex). */
export function fontCacheKey(url) {
  let h = 0x811c9dc5;
  const s = String(url);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `gf-${h.toString(16).padStart(8, '0')}`;
}

/**
 * Keep only @font-face blocks of the wanted subsets (Google labels each block with a comment: `/* latin *\/`).
 * CSS without labels is returned unchanged.
 */
export function pickSubsets(css, subsets = KEEP_SUBSETS) {
  const parts = String(css).split(/(?=\/\*\s*[\w-]+\s*\*\/)/);
  if (parts.length <= 1) return String(css);
  return parts.filter((p) => {
    const m = p.match(/^\/\*\s*([\w-]+)\s*\*\//);
    return !m || subsets.includes(m[1]);
  }).join('').trim() + '\n';
}

/**
 * Rewrite remote font URLs to local file names. Returns { css, files: [{ url, name }] }.
 * @param {string} css
 * @param {(name: string) => string} localUrl e.g. (n) => `./files/${n}`
 */
export function localizeCss(css, localUrl) {
  const files = [];
  const out = String(css).replace(/url\((['"]?)(https:\/\/fonts\.gstatic\.com\/[^'")]+)\1\)/g, (all, q, url) => {
    const base = url.split('?')[0].split('/').filter(Boolean);
    // family folder + file name keeps names unique and readable: fredoka-v17-X7n64….woff2
    const name = `${base[base.length - 3] ?? 'font'}-${base[base.length - 2] ?? ''}-${base[base.length - 1]}`.replace(/[^\w.-]/g, '_');
    if (!files.some((f) => f.name === name)) files.push({ url, name });
    return `url(${localUrl(name)})`;
  });
  return { css: out, files };
}

/**
 * Make sure a stylesheet (and its font files) is in `dir`. Returns the css file name (`gf-xxxx.css`) or null.
 * @param {string} url
 * @param {string} dir absolute path of public/fonts
 * @param {{ fetch?: typeof fetch, log?: (msg: string) => void, subsets?: string[] }} [opts]
 */
export async function ensureFontCached(url, dir, { fetch: f = globalThis.fetch, log = () => {}, subsets = KEEP_SUBSETS } = {}) {
  const key = fontCacheKey(url);
  const cssFile = path.join(dir, `${key}.css`);
  if (existsSync(cssFile)) return `${key}.css`;
  if (typeof f !== 'function') return null;
  try {
    const res = await f(url, { headers: { 'user-agent': FONT_UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = pickSubsets(await res.text(), subsets);
    const { css, files } = localizeCss(raw, (n) => `./files/${n}`);
    mkdirSync(path.join(dir, 'files'), { recursive: true });
    for (const file of files) {
      const target = path.join(dir, 'files', file.name);
      if (existsSync(target)) continue;
      const r = await f(file.url, { headers: { 'user-agent': FONT_UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${file.url}`);
      writeFileSync(target, Buffer.from(await r.arrayBuffer()));
    }
    writeFileSync(cssFile, `/* self-hosted by build/fonts.js from ${url} */\n${css}`);
    log(`[fonts] cached ${url} → public/fonts/${key}.css (${files.length} files)`);
    return `${key}.css`;
  } catch (err) {
    log(`[fonts] could not self-host ${url} (${err.message}); keeping the remote stylesheet`);
    return null;
  }
}

/**
 * The page-relative href of a cached stylesheet. The original query rides along (`?family=Fredoka:…`) so code
 * that looks for "family=Fredoka" in a link's href still sees the font as loaded; servers and the service
 * worker ignore it.
 */
export function localHref(cssName, url) {
  const q = String(url).split('?')[1];
  return `./fonts/${cssName}${q ? `?${q}` : ''}`;
}

/** The @font-face CSS of a cached stylesheet, with URLs from the site root (for inlining into a .css file). */
export function cachedCssForInline(dir, cssName) {
  const css = readFileSync(path.join(dir, cssName), 'utf8');
  return css.replace(/url\(\.\/files\//g, 'url(/fonts/files/');
}

/**
 * The Vite plugin.
 * @param {{ dir?: string, fetch?: typeof fetch }} [opts] dir defaults to <root>/public/fonts
 */
export function selfHostFonts({ dir: dirOpt, fetch: f } = {}) {
  let dir = dirOpt;
  const log = (m) => console.log(m);
  return {
    name: 'sk-self-host-fonts',
    enforce: 'pre',
    configResolved(config) {
      dir ??= path.join(config.publicDir || path.join(config.root, 'public'), 'fonts');
    },
    async transformIndexHtml(html) {
      let out = html;
      for (const url of findGoogleFontUrls(html)) {
        const css = await ensureFontCached(url, dir, { fetch: f, log });
        if (!css) continue;
        const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '(?:&|&amp;)');
        out = out.replace(new RegExp(`<link[^>]*href=["']${escaped}["'][^>]*>`, 'g'), `<link rel="stylesheet" href="${localHref(css, url)}" />`);
        out = out.replace(/\s*<link[^>]*rel=["']preconnect["'][^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, '');
      }
      return out;
    },
    async transform(code, id) {
      if (!code.includes('fonts.googleapis.com') || id.includes('node_modules')) return null;
      if (/\.[cm]?js($|\?)/.test(id)) {
        // a script that injects the stylesheet at run time (src/ui/dom.js ensureFont) gets the local copy too
        let js = code;
        for (const url of findGoogleFontUrls(code)) {
          const css = await ensureFontCached(url, dir, { fetch: f, log });
          if (css) js = js.split(url).join(localHref(css, url));
        }
        return js === code ? null : { code: js, map: null };
      }
      if (!/\.css($|\?)/.test(id)) return null;
      let out = code;
      for (const url of findGoogleFontUrls(code)) {
        const css = await ensureFontCached(url, dir, { fetch: f, log });
        if (!css) continue;
        const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(`@import\\s+(?:url\\()?["']?${escaped}["']?\\)?\\s*;?`, 'g'), cachedCssForInline(dir, css));
      }
      return out === code ? null : { code: out, map: null };
    },
  };
}
