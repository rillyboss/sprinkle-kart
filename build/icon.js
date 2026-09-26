/**
 * The Sprinkle Kart app icon, drawn in code (SVG). OWNER: mobile platform.
 * `scripts/gen-icons.mjs` renders it to every PNG size in public/icons/ (committed); the build copies them.
 *
 *   iconSvg()                     the icon on a rounded pastel tile (browser tab, iOS home screen)
 *   iconSvg({ maskable: true })   full-bleed background, art inside the 80% safe zone (Android adaptive icons)
 */

/** Archimedean spiral as an SVG path (centre cx, cy; from r0 to r1 over `turns`). */
export function spiralPath(cx, cy, r0, r1, turns, steps = 220) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  return `M${pts.join(' L')}`;
}

const SPRINKLES = [
  // x, y, angle, colour (in the 512 box)
  [92, 118, -30, '#7fd8ff'], [410, 96, 25, '#ffd23f'], [440, 300, -60, '#8be08b'], [70, 330, 50, '#b57bff'],
  [120, 440, 10, '#ffd23f'], [395, 430, -20, '#ff6fa8'], [250, 58, 80, '#8be08b'], [460, 196, 5, '#b57bff'],
];

/**
 * @param {{ maskable?: boolean, fullBleed?: boolean }} [opts] fullBleed = square, opaque (apple-touch-icon:
 *        iOS rounds the corners itself and would show transparent corners black)
 * @returns {string} a standalone SVG document (512 × 512 viewBox)
 */
export function iconSvg({ maskable = false, fullBleed = false } = {}) {
  // maskable: everything important inside the central 80% circle; background fills the whole square
  const k = maskable ? 0.78 : fullBleed ? 0.92 : 1;
  const tf = k !== 1 ? ` transform="translate(${(256 * (1 - k)).toFixed(1)} ${(256 * (1 - k)).toFixed(1)}) scale(${k})"` : '';
  const bg = maskable || fullBleed
    ? '<rect width="512" height="512" fill="url(#bg)"/>'
    : '<rect x="8" y="8" width="496" height="496" rx="112" fill="url(#bg)"/>';
  const sprinkles = SPRINKLES.map(([x, y, a, c]) => `<rect x="${x - 16}" y="${y - 6}" width="32" height="12" rx="6" fill="${c}" transform="rotate(${a} ${x} ${y})"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd6ec"/><stop offset="0.5" stop-color="#f3d4ff"/><stop offset="1" stop-color="#d5e9ff"/></linearGradient>
<radialGradient id="candy" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#ff9fd0"/><stop offset="1" stop-color="#ff4fa8"/></radialGradient>
</defs>
${bg}
<g${tf}>
${sprinkles}
<rect x="238" y="300" width="36" height="176" rx="18" fill="#ffffff" stroke="#3a2046" stroke-width="10" transform="rotate(-18 256 300)"/>
<circle cx="256" cy="226" r="150" fill="url(#candy)" stroke="#3a2046" stroke-width="12"/>
<path d="${spiralPath(256, 226, 6, 128, 3.2)}" fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round"/>
<ellipse cx="204" cy="160" rx="34" ry="20" fill="#ffffff" opacity="0.55" transform="rotate(-30 204 160)"/>
</g>
</svg>`;
}

/** PNG sizes rendered into public/icons/ (name → px). */
export const ICON_SIZES = Object.freeze({
  'icon-32.png': 32,
  'icon-48.png': 48,
  'icon-72.png': 72,
  'icon-96.png': 96,
  'icon-128.png': 128,
  'icon-144.png': 144,
  'icon-152.png': 152,
  'icon-167.png': 167,
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-256.png': 256,
  'icon-384.png': 384,
  'icon-512.png': 512,
});
export const MASKABLE_SIZES = Object.freeze({ 'maskable-192.png': 192, 'maskable-512.png': 512 });
/** Rendered full-bleed (opaque square) instead of on the rounded tile. */
export const FULL_BLEED = Object.freeze(['apple-touch-icon.png', 'icon-152.png', 'icon-167.png']);
