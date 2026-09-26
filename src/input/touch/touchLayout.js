/**
 * Where the on-screen race controls go (pure maths, CSS px, y grows DOWN).
 *
 *   const lay = computeTouchLayout({ width, height, safe, settings, zones });
 *   lay.players[0].controls   // [{ id, kind, x, y, w, h, cx, cy, r, zone? }]
 *   lay.players[0].steerZone  // the invisible "drag anywhere here to steer" area
 *   touchSafeRects(lay)       // what the HUD must not cover (visible controls only)
 *
 * One control SET per touch player. A set lives inside its zone: the whole screen for one
 * player, or the left / right half for two touch players on one tablet (twoPlayers).
 *
 * Default (right-handed) set, landscape:
 *
 *   ┌─────────────────────────────────────────────────┐
 *   │ [item slot]            (timer)   [⏸]   [minimap] │
 *   │                                                  │
 *   │                ( road centre stays free )        │
 *   │                                           [BRK]  │
 *   │   ( stick )                          [DRIFT][ITEM]│   ← auto-gas: ITEM in the corner
 *   └─────────────────────────────────────────────────┘      manual gas: GAS in the corner,
 *                                                             ITEM above it
 *
 * leftHanded mirrors the set inside its zone. Sizes scale with the zone's short side and
 * the `size` setting, never below the 44 px accessibility minimum for the small buttons.
 */
import { SIZE_SCALE, normalizeTouchSettings } from './touchSettings.js';

export const MIN_TAP = 44;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** The middle of a zone the controls must leave alone (where your kart and the road are). */
export function centerKeepout(zone) {
  const portrait = zone.h > zone.w;
  const x0 = zone.x + zone.w * (portrait ? 0.34 : 0.3);
  const x1 = zone.x + zone.w * (portrait ? 0.66 : 0.7);
  const y0 = zone.y + zone.h * 0.2;
  const y1 = zone.y + zone.h * (portrait ? 0.78 : 0.8);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function circle(id, cx, cy, r, extra = {}) {
  return { id, kind: 'button', cx, cy, r, x: cx - r, y: cy - r, w: r * 2, h: r * 2, ...extra };
}

function box(id, x, y, w, h, extra = {}) {
  return { id, kind: 'button', x, y, w, h, cx: x + w / 2, cy: y + h / 2, r: Math.min(w, h) / 2, ...extra };
}

/** Base size unit for a zone. */
export function unitFor(zone, size = 'medium') {
  const short = Math.min(zone.w, zone.h);
  const s = SIZE_SCALE[size] ?? 1;
  const u = Math.min(short * 0.2, zone.w * 0.14) * s;
  return clamp(u, 40, 112 * s); // tablets: big, but the bottom band must stay under ~20% of the screen
}

/**
 * Lay out one player's controls inside `zone` ({x,y,w,h}) with safe-area insets applied
 * to the edges of the zone that touch the screen edges.
 */
export function layoutControlSet(zone, settingsIn, safe = {}) {
  const st = normalizeTouchSettings(settingsIn);
  const u = unitFor(zone, st.size);
  const m = Math.max(10, u * 0.18);      // margin from the (safe) edge
  const gap = Math.max(8, u * 0.14);
  const portrait = zone.h > zone.w;
  const inset = {
    l: safe.left ?? 0, r: safe.right ?? 0, t: safe.top ?? 0, b: safe.bottom ?? 0,
  };
  const L = zone.x + inset.l + m;
  const R = zone.x + zone.w - inset.r - m;
  const B = zone.y + zone.h - inset.b - m;
  const T = zone.y + inset.t + m;

  // Right-hand action cluster (mirrored afterwards for left-handed players)
  const bigR = u * 0.62;
  const midR = u * 0.52;
  const smallR = Math.max(MIN_TAP / 2, u * 0.36);
  const corner = { cx: R - bigR, cy: B - bigR };
  const controls = [];
  // HOP sits left of the corner button, bottom-aligned (raising it would reach into the road on tablets)
  const left = { cx: corner.cx - bigR - gap - midR, cy: corner.cy + bigR - midR };
  if (st.autoGas) {
    controls.push(circle('item', corner.cx, corner.cy, bigR, { label: 'ITEM' }));
    controls.push(circle('drift', left.cx, left.cy, midR, { label: 'HOP', hold: true }));
    if (portrait) controls.push(circle('brake', left.cx, left.cy - midR - gap - smallR, smallR, { label: 'BRAKE', hold: true }));
    else controls.push(circle('brake', corner.cx + bigR - smallR, corner.cy - bigR - gap - smallR, smallR, { label: 'BRAKE', hold: true }));
  } else {
    controls.push(circle('gas', corner.cx, corner.cy, bigR, { label: 'GO', hold: true }));
    controls.push(circle('drift', left.cx, left.cy, midR, { label: 'HOP', hold: true }));
    if (portrait) {
      controls.push(circle('item', corner.cx, corner.cy - bigR - gap - midR, midR, { label: 'ITEM' }));
      controls.push(circle('brake', left.cx, left.cy - midR - gap - smallR, smallR, { label: 'BRAKE', hold: true }));
    } else {
      controls.push(circle('item', corner.cx + bigR - midR, corner.cy - bigR - gap - midR, midR, { label: 'ITEM' }));
      controls.push(circle('brake', left.cx, left.cy - midR - gap - smallR, smallR, { label: 'BRAKE', hold: true }));
    }
  }

  // Pause: small, at the top of the zone, right of centre (the top corners belong to the HUD)
  const pauseR = Math.max(MIN_TAP / 2, u * 0.3);
  if (portrait) {
    // tall screens: the timer fills the top middle, so tuck PAUSE under the minimap (top-right,
    // same size rule as hudLogic.minimapRect for one player)
    const short = Math.min(zone.w, zone.h);
    const mm = clamp(short * 0.28, 90, 300) + Math.round(short * 0.025);
    controls.push(circle('pause', R - pauseR, zone.y + inset.t + mm + gap + pauseR, pauseR, { label: 'PAUSE' }));
  } else {
    controls.push(circle('pause', zone.x + zone.w * 0.64, T + pauseR, pauseR, { label: 'PAUSE' }));
  }

  // Left-hand steering
  const stickR = u * 0.85;
  const steerZone = {
    id: 'steer-zone', kind: 'zone',
    x: zone.x, y: zone.y + zone.h * (portrait ? 0.55 : 0.28),
    w: zone.w * (portrait ? 0.5 : 0.42), h: zone.h * (portrait ? 0.45 : 0.72),
  };
  let stick = null;
  if (st.style === 'joystick') {
    stick = { id: 'stick', kind: 'stick', cx: L + stickR, cy: B - stickR, r: stickR, knobR: stickR * 0.45 };
    Object.assign(stick, { x: stick.cx - stickR, y: stick.cy - stickR, w: stickR * 2, h: stickR * 2 });
    controls.push(stick);
  } else if (st.style === 'buttons') {
    const bw = Math.min(u * 1.1, (zone.w * 0.4 - m - gap) / 2);
    const bh = Math.max(MIN_TAP, u * 1.1);
    controls.push(box('left', L, B - bh, bw, bh, { label: '◀', hold: true }));
    controls.push(box('right', L + bw + gap, B - bh, bw, bh, { label: '▶', hold: true }));
  } else {
    controls.push(circle('recenter', L + smallR, B - smallR, smallR, { label: 'CENTER' }));
  }

  const out = st.leftHanded ? controls.map((c) => mirror(c, zone)) : controls;
  const sz = st.leftHanded ? mirror(steerZone, zone) : steerZone;
  return { zone: { ...zone }, unit: u, steerZone: sz, controls: out, stick: out.find((c) => c.kind === 'stick') ?? null };
}

function mirror(c, zone) {
  const x = zone.x + zone.w - (c.x - zone.x) - c.w;
  const o = { ...c, x };
  if (Number.isFinite(c.cx)) o.cx = x + c.w / 2;
  return o;
}

/**
 * Zones for `count` touch players on one screen: 1 → whole screen; 2 → left / right halves.
 */
export function touchZones(count, width, height) {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  if (count >= 2) {
    const half = Math.floor(W / 2);
    return [{ x: 0, y: 0, w: half, h: H }, { x: half, y: 0, w: W - half, h: H }];
  }
  return [{ x: 0, y: 0, w: W, h: H }];
}

/**
 * Full layout for the screen.
 * @param {{width:number, height:number, safe?:{top,right,bottom,left}, settings?:object, players?:number}} o
 */
export function computeTouchLayout({ width, height, safe = {}, settings = {}, players = 1 } = {}) {
  const zones = touchZones(players, width, height);
  const list = zones.map((z, i) => {
    // only the outer edges of a half touch the screen edge
    const s = {
      top: safe.top ?? 0,
      bottom: safe.bottom ?? 0,
      left: i === 0 ? (safe.left ?? 0) : 0,
      right: i === zones.length - 1 ? (safe.right ?? 0) : 0,
    };
    return layoutControlSet(z, settings, s);
  });
  return { width, height, players: list };
}

/**
 * Screen rects covered by visible touch controls (for the HUD to avoid).
 * @returns {{id:string, player:number, x:number, y:number, w:number, h:number}[]}
 */
export function touchSafeRects(layout) {
  const out = [];
  (layout?.players ?? []).forEach((p, player) => {
    for (const c of p.controls) out.push({ id: c.id, player, x: c.x, y: c.y, w: c.w, h: c.h });
  });
  return out;
}

/** Which player zone (index) a screen point belongs to, or -1. */
export function zoneAt(layout, x, y) {
  const ps = layout?.players ?? [];
  for (let i = 0; i < ps.length; i++) {
    const z = ps[i].zone;
    if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return i;
  }
  return -1;
}

/** The control under a point (buttons are hit as circles with a little extra slop), or null. */
export function hitControl(set, x, y, slop = 6) {
  let best = null;
  let bestD = Infinity;
  for (const c of set?.controls ?? []) {
    if (c.kind !== 'button') continue;
    let d;
    if (c.id === 'left' || c.id === 'right') {
      const inside = x >= c.x - slop && x <= c.x + c.w + slop && y >= c.y - slop && y <= c.y + c.h + slop;
      d = inside ? 0 : Infinity;
    } else {
      d = Math.hypot(x - c.cx, y - c.cy) - c.r - slop;
      if (d > 0) d = Infinity;
    }
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Is a point inside the steer zone of a set? */
export function inSteerZone(set, x, y) {
  const z = set?.steerZone;
  return !!z && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
}
