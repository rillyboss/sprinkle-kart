/**
 * Pure helpers shared by the HUD and results screens (no DOM, unit-tested).
 */

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

/** 'gold' | 'silver' | 'bronze' | 'candy' */
export function medalFor(place) {
  return { 1: 'gold', 2: 'silver', 3: 'bronze' }[place] || 'candy';
}

const TOP_CHEERS = {
  1: 'Super Champion!',
  2: 'Amazing Racer!',
  3: 'Fantastic Driving!',
};
const CHEERS = [
  'Super Speedy!',
  'Sparkle Star!',
  'Awesome Drifting!',
  'Zoom Zoom Hero!',
  'Big Smiles!',
  'So Brave!',
  'Candy Cruiser!',
];

/**
 * A happy message for every finisher — nobody loses!
 * Last place always gets "Great Driving!".
 */
export function cheerMessage(place, total) {
  if (TOP_CHEERS[place]) return TOP_CHEERS[place];
  if (place === total) return 'Great Driving!';
  return CHEERS[(place - 4) % CHEERS.length];
}

/** 83.456 -> "1:23.45"; null/undefined/NaN -> "--:--.--" */
export function formatTime(sec) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--.--';
  const cs = Math.floor(sec * 100 + 1e-6);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Number (0xffaacc) or string -> CSS colour string. */
export function cssColor(c, fallback = '#ff9ad5') {
  if (typeof c === 'number' && Number.isFinite(c)) return `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  if (typeof c === 'string' && c) return c;
  return fallback;
}

/** Mix a CSS hex colour toward white by t (0..1). */
export function lighten(hex, t) {
  const h = cssColor(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * t));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Item icons for the HUD item slot. `html` is the glyph markup, `label` a kid-friendly name. */
export const ITEM_ICONS = {
  'sprinkle-boost': { emoji: '🍬', extra: '✨', label: 'Sprinkle Boost' },
  'triple-sprinkle': { emoji: '🍬', extra: '✨', count: 3, label: 'Triple Sprinkle' },
  gumdrop: { emoji: '', gumdrop: true, label: 'Gumdrop' },
  'bubble-shield': { emoji: '🫧', label: 'Bubble Shield' },
  'cupcake-rocket': { emoji: '🧁', extra: '🚀', label: 'Cupcake Rocket' },
  'rainbow-star': { emoji: '⭐', extra: '🌈', label: 'Rainbow Star' },
};
export const ITEM_IDS = Object.keys(ITEM_ICONS);

/** Which item icon the roulette shows at time t (seconds). */
export function rouletteFrame(t, speed = 12) {
  return ITEM_IDS[Math.floor(Math.max(0, t) * speed) % ITEM_IDS.length];
}

/**
 * Big centre countdown text from a Race-like object.
 * '3' | '2' | '1' during countdown, 'GO!' for the first ~0.9 s of racing, else null.
 */
export function countdownLabel(race) {
  if (!race) return null;
  if (race.state === 'countdown') {
    const n = Math.ceil(race.countdown ?? 0);
    return n >= 1 ? String(Math.min(3, n)) : 'GO!';
  }
  if (race.state === 'racing' && (race.time ?? 99) < 0.9) return 'GO!';
  return null;
}

/** "Lap 2/3" parts; lap clamps into 1..lapsTotal. */
export function lapInfo(kart) {
  const total = Math.max(1, kart?.lapsTotal ?? 3);
  const lap = Math.max(1, Math.min(total, kart?.lap ?? 1));
  return { lap, total, final: lap === total && total > 1 };
}

/**
 * Turn rects into CSS px. Rects are CSS px relative to the HUD root's top-left
 * (y grows DOWN, like the DOM). If every value is <= 1 they're treated as
 * fractions of the root size.
 */
export function normalizeRects(rects, W, H) {
  if (!rects?.length) return [];
  const frac = rects.every((r) => r.x <= 1 && r.y <= 1 && r.w <= 1 && r.h <= 1);
  return rects.map((r) => (frac
    ? { playerIndex: r.playerIndex, x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H }
    : { playerIndex: r.playerIndex, x: r.x, y: r.y, w: r.w, h: r.h }));
}

/**
 * Which side HUD clusters sit on inside a viewport so they hug the outer
 * screen edge and leave the middle of the screen free for the minimap.
 * Full-width viewports: item cluster left, place badge right.
 */
export function hudSides(rect, W) {
  const cx = rect.x + rect.w / 2;
  if (rect.w >= W * 0.75) return { item: 'left', place: 'right' };
  const side = cx < W / 2 ? 'left' : 'right';
  return { item: side, place: side };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Where the single shared minimap canvas goes (CSS px square {x,y,size}).
 *  1 player: top-right corner.
 *  2 players: right edge, centred on the divider so it belongs to both halves.
 *  3 players: bottom-right corner of the empty (spectator) quadrant, ~45% of
 *             its height, so the TV camera stays visible.
 *  4+: centre of the screen.
 */
export function minimapRect(rects, W, H) {
  const m = Math.round(Math.min(W, H) * 0.025);
  const n = rects.length;
  if (n <= 1) {
    const r = rects[0] ?? { x: 0, y: 0, w: W, h: H };
    const size = clamp(Math.min(r.w, r.h) * 0.28, 90, 300);
    return { x: r.x + r.w - size - m, y: r.y + m, size };
  }
  if (n === 2) {
    const top = rects.reduce((a, b) => (b.y < a.y ? b : a));
    const bottom = rects.reduce((a, b) => (b.y > a.y ? b : a));
    const divider = (top.y + top.h + bottom.y) / 2;
    const size = clamp(Math.min(W, top.h, bottom.h) * 0.46, 80, 260);
    return { x: W - size - m, y: divider - size / 2, size };
  }
  if (n === 3) {
    const qw = W / 2, qh = H / 2;
    const quads = [[0, 0], [qw, 0], [0, qh], [qw, qh]];
    const inside = (px, py) => rects.some((r) => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h);
    const free = quads.find(([qx, qy]) => !inside(qx + qw / 2, qy + qh / 2)) ?? quads[3];
    const size = Math.min(qw, qh) * 0.45;
    return { x: free[0] + qw - size - m, y: free[1] + qh - size - m, size };
  }
  const size = clamp(Math.min(W, H) * 0.24, 80, 280);
  return { x: (W - size) / 2, y: (H - size) / 2, size };
}

/**
 * Fit minimap points ([x, z] pairs) into a size x size square, keeping aspect.
 * Returns { map(x, z) -> [px, py], scale }.
 */
export function fitMinimap(points, size, pad = 0.1) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!points.length) { minX = minZ = -1; maxX = maxZ = 1; }
  const inner = size * (1 - pad * 2);
  const span = Math.max(maxX - minX, maxZ - minZ, 1e-6);
  const scale = inner / span;
  const ox = (size - (maxX - minX) * scale) / 2;
  const oy = (size - (maxZ - minZ) * scale) / 2;
  return {
    scale,
    map: (x, z) => [ox + (x - minX) * scale, oy + (z - minZ) * scale],
  };
}

/** Shorten a gamepad id like "Xbox 360 Controller (XInput STANDARD GAMEPAD)". */
export function prettyDeviceName(device) {
  if (!device) return 'Controller';
  if (device.type === 'keyboard' || /^kb/.test(device.id ?? '')) {
    return device.id === 'kb2' ? 'Keyboard (Arrows)' : 'Keyboard (WASD)';
  }
  let name = String(device.name || 'Controller').replace(/\(.*?\)/g, '').replace(/Vendor:.*$/i, '').trim();
  if (!name) name = 'Controller';
  if (name.length > 26) name = `${name.slice(0, 24).trim()}…`;
  return name;
}

export function deviceIcon(deviceId, devices = []) {
  const d = devices.find((x) => x.id === deviceId);
  if (d?.icon) return d.icon; // e.g. touch controls: 👆
  const type = d?.type ?? (/^kb/.test(deviceId) ? 'keyboard' : 'gamepad');
  return type === 'keyboard' ? '⌨️' : '🎮';
}

/** SVG polyline "x,y x,y" for a track's control points drawn into a w x h box. */
export function trackOutlinePoints(controlPoints, w, h, pad = 0.12) {
  const pts = (controlPoints || []).map((p) => [p[0], p[2]]);
  if (pts.length < 2) return '';
  const size = Math.min(w, h);
  const fit = fitMinimap(pts, size, pad);
  const dx = (w - size) / 2, dy = (h - size) / 2;
  return pts.map(([x, z]) => {
    const [px, py] = fit.map(x, z);
    return `${(px + dx).toFixed(1)},${(py + dy).toFixed(1)}`;
  }).join(' ');
}

/**
 * Menu key hints per device (mirrors src/input/keyboardLayouts.js). Gamepads get
 * null so callers show the coloured A/B/Y glyphs instead.
 */
export const KEY_HINTS = {
  kb1: { confirm: 'Enter', back: 'Esc', toggle: 'Tab', start: 'P' },
  kb2: { confirm: '/', back: 'Backspace', toggle: "'", start: '\\' },
};
export function keyHintsFor(deviceId) {
  return KEY_HINTS[deviceId] ?? null;
}
