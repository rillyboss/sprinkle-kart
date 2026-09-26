/**
 * Pure logic behind the power-up HUD (item slot, name + button hint, pips,
 * timer rings, callouts, rocket warnings). No DOM, no THREE: unit-tested in
 * tests/items.hud.test.js. OWNER: power-up clarity workstream.
 */
import { ITEM_CATALOG, ITEM_ORDER, itemForCause, itemName, itemEmoji, effectFraction } from '../../race/itemCatalog.js';
import { gamepadLabels } from '../../input/gamepadMapping.js';
import { KEYBOARD_LAYOUTS } from '../../input/keyboardLayouts.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Button hints
// ---------------------------------------------------------------------------

/**
 * The label of the "use item" button on a device: 'LB' (Xbox / generic pads),
 * 'L1' (PlayStation), 'L' (Switch), 'E' (WASD keyboard), '/' (arrow keyboard).
 * @param {{id?:string, type?:string, kind?:string, labels?:Record<string,string>}|string|null} device
 */
export function itemButtonLabel(device) {
  if (typeof device === 'string') device = { id: device };
  if (!device) return 'LB';
  if (device.labels?.item) return device.labels.item;
  const kb = KEYBOARD_LAYOUTS[device.id];
  if (kb || device.type === 'keyboard') return (kb ?? KEYBOARD_LAYOUTS.kb1).labels.item;
  return gamepadLabels(device.kind).item;
}

/** "Press LB" / "Press E" */
export function pressHint(device) {
  return `Press ${itemButtonLabel(device)}`;
}

// ---------------------------------------------------------------------------
// Roulette: spins fast, slows down and LANDS on the real item
// ---------------------------------------------------------------------------

/** Total slot ticks in one roulette spin. */
export const ROULETTE_TICKS = 16;

/**
 * How many ticks have happened at roulette progress p (0 = just hit the box,
 * 1 = landed). Eases out, so ticks start quick and slow down like a prize wheel.
 */
export function rouletteTicks(p) {
  const q = clamp(Number.isFinite(p) ? p : 0, 0, 1);
  return Math.min(ROULETTE_TICKS, Math.floor(ROULETTE_TICKS * (1 - (1 - q) * (1 - q)) + 1e-9));
}

/**
 * Which item icon the roulette shows at progress p. The last tick is always
 * `finalItem` (when known) so the slot "lands" on what you really got.
 */
export function rouletteItemAt(p, finalItem = null) {
  const ticks = rouletteTicks(p);
  const n = ITEM_ORDER.length;
  const fi = ITEM_ORDER.indexOf(finalItem);
  const base = fi >= 0 ? fi - ROULETTE_TICKS : 0;
  return ITEM_ORDER[(((base + ticks) % n) + n) % n];
}

/** Roulette progress 0..1 from a KartState (itemRoulette counts 1 -> 0). */
export function rouletteProgress(kart) {
  const r = kart?.itemRoulette ?? 0;
  return r > 0 ? clamp(1 - r, 0, 1) : 1;
}

// ---------------------------------------------------------------------------
// Item slot + card
// ---------------------------------------------------------------------------

/**
 * Everything the item slot / name card shows for one kart.
 * @returns {{state:'empty'|'rolling'|'ready'|'spinning', item:string|null, name:string, emoji:string,
 *   pips:{total:number, left:number}|null, hint:string|null, color:string, tick:number}}
 */
export function itemSlotView(kart, device = null) {
  const rolling = (kart?.itemRoulette ?? 0) > 0;
  if (rolling) {
    const p = rouletteProgress(kart);
    const item = rouletteItemAt(p, kart?.phys?.pendingItem ?? null);
    return { state: 'rolling', item, name: '', emoji: itemEmoji(item), pips: null, hint: null, color: '#ff9ad5', tick: rouletteTicks(p) };
  }
  const item = kart?.item && ITEM_CATALOG[kart.item] ? kart.item : null;
  if (!item) return { state: 'empty', item: null, name: '', emoji: '', pips: null, hint: null, color: '#ff9ad5', tick: 0 };
  const cat = ITEM_CATALOG[item];
  const pips = cat.charges ? { total: cat.charges, left: clamp(kart.itemCharges ?? cat.charges, 0, cat.charges) } : null;
  const spinning = !!kart.spinning; // can't use items mid-twirl
  return {
    state: spinning ? 'spinning' : 'ready', item, name: cat.name, emoji: cat.emoji, pips,
    hint: spinning ? 'Wait for it…' : pressHint(device), color: cat.color, tick: 0,
  };
}

// ---------------------------------------------------------------------------
// Timers (shield / star as shrinking rings)
// ---------------------------------------------------------------------------

/**
 * Active timed effects on a kart as shrinking rings.
 * @param {object} kart KartState
 * @param {{shieldDuration:number, starDuration:number}} tuning
 * @returns {{item:string, frac:number, left:number, emoji:string, ending:boolean}[]}
 */
export function activeTimers(kart, tuning) {
  const out = [];
  if (kart?.starPower > 0) {
    const left = kart.starPower;
    out.push({ item: 'rainbow-star', frac: effectFraction(left, tuning.starDuration), left, emoji: itemEmoji('rainbow-star'), ending: left < 1.5 });
  }
  if (kart?.shielded) {
    const left = kart.phys?.shieldTime ?? 0;
    out.push({ item: 'bubble-shield', frac: effectFraction(left, tuning.shieldDuration), left, emoji: itemEmoji('bubble-shield'), ending: left < 3 });
  }
  return out;
}

/** SVG stroke-dashoffset for a ring of circumference C showing `frac` left. */
export function ringDashOffset(frac, C) {
  return C * (1 - clamp(Number.isFinite(frac) ? frac : 0, 0, 1));
}

// ---------------------------------------------------------------------------
// Rocket warnings
// ---------------------------------------------------------------------------

/** Rocket warnings start this far (track units) behind you. */
export const THREAT_RANGE = 180;

/** Seconds between warning beeps: slow far away, quick when it is right behind. */
export function beepInterval(gap) {
  if (!Number.isFinite(gap)) return 0.9;
  const k = clamp((gap - 8) / (THREAT_RANGE - 8), 0, 1);
  return 0.12 + k * (0.9 - 0.12);
}

/** 0 (far) .. 1 (about to boop you). */
export function threatCloseness(gap) {
  if (!Number.isFinite(gap)) return 0;
  return clamp(1 - gap / THREAT_RANGE, 0, 1);
}

/**
 * Bearing of `from` as seen from a kart (radians): 0 = straight ahead,
 * +PI/2 = to the driver's (and the chase camera's) right, ±PI = right behind.
 * ARCHITECTURE §10: forward = (sin h, 0, cos h), right = (-cos h, 0, sin h).
 */
export function bearingTo(kart, from) {
  const h = kart?.heading ?? 0;
  const dx = (from?.x ?? 0) - (kart?.position?.x ?? 0);
  const dz = (from?.z ?? 0) - (kart?.position?.z ?? 0);
  const fwd = dx * Math.sin(h) + dz * Math.cos(h);
  const right = -(dx * Math.cos(h) - dz * Math.sin(h));
  return Math.atan2(right, fwd);
}

/**
 * Rockets chasing `kart`, closest first.
 * @param {object} kart KartState
 * @param {Array<{target, distance, mesh?}>} rockets race.items.rockets
 * @returns {{rocket:object, gap:number, closeness:number, interval:number, bearing:number, from:string}[]}
 */
export function threatsFor(kart, rockets) {
  if (!kart || !Array.isArray(rockets)) return [];
  const out = [];
  for (const r of rockets) {
    if (!r || r.target !== kart || r.owner === kart) continue;
    const gap = (kart.distance ?? 0) - (r.distance ?? 0);
    if (!(gap > -6) || gap > THREAT_RANGE) continue;
    const pos = r.mesh?.position ?? null;
    out.push({
      rocket: r, gap: Math.max(0, gap), closeness: threatCloseness(gap), interval: beepInterval(gap),
      bearing: pos ? bearingTo(kart, pos) : Math.PI, from: r.owner?.name ?? '',
    });
  }
  return out.sort((a, b) => a.gap - b.gap);
}

/**
 * Where the edge arrow sits on the viewport for a bearing: returns
 * { x, y } in 0..1 viewport fractions (on a rounded rectangle just inside the
 * edges) and `rot` in degrees for an arrow drawn pointing UP at rot 0.
 * Rockets come from behind, so they mostly sit on the bottom edge.
 */
export function edgeArrowPlacement(bearing) {
  const b = Number.isFinite(bearing) ? bearing : Math.PI;
  // screen direction: ahead = up (-y), right = +x
  const sx = Math.sin(b);
  const sy = -Math.cos(b);
  const m = Math.max(Math.abs(sx) / 0.42, Math.abs(sy) / 0.38, 1e-6);
  return { x: 0.5 + sx / m, y: 0.5 + sy / m, rot: (b * 180) / Math.PI };
}

// ---------------------------------------------------------------------------
// Friendly callout texts
// ---------------------------------------------------------------------------

/** "Captain Crumbs'" / "Lenny's" */
export function possessive(name) {
  const n = String(name || 'Someone').trim() || 'Someone';
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

const displayName = (kart) => (kart?.name || kart?.charDef?.name || 'a friend');

/** The big callout when YOU use an item: { emoji, title, sub }. */
export function useCallout(item, { chargesLeft = 0, target = null } = {}) {
  const cat = ITEM_CATALOG[item];
  if (!cat) return null;
  let sub = cat.call;
  if (item === 'triple-sprinkle') sub = chargesLeft > 0 ? `${chargesLeft} more to go!` : 'Last zoom!';
  if (item === 'cupcake-rocket') sub = target ? `Zooming after ${displayName(target)}!` : 'Zooming ahead!';
  return { emoji: cat.emoji, title: `${cat.name}!`, sub, color: cat.color };
}

/**
 * Friendly two-sided attribution for a bonk.
 * @returns {{victim: string, bonker: string|null}}
 */
export function bonkMessages({ kart, by, cause }) {
  const item = itemForCause(cause);
  const self = !by || by === kart;
  if (item === 'rainbow-star') {
    return {
      victim: self ? 'Twirly-whirly! 🌈' : `Twirled by ${possessive(displayName(by))} Rainbow Star! 🌈`,
      bonker: self ? null : `You twirled ${displayName(kart)}! 🌟`,
    };
  }
  const what = item ? itemName(item) : 'bonk';
  return {
    victim: self ? `Oopsie, a ${what}! 💫` : `Bonked by ${possessive(displayName(by))} ${what}! 💫`,
    bonker: self ? null : `You bonked ${displayName(kart)}! 🎯`,
  };
}

/** The shield stopped something. */
export function blockMessages({ kart, by, cause }) {
  const item = itemForCause(cause);
  const what = item ? itemName(item) : 'bonk';
  const self = !by || by === kart;
  return {
    victim: self ? `Bubble saved you! 🫧` : `Bubble blocked ${possessive(displayName(by))} ${what}! 🫧`,
    bonker: self ? null : `${possessive(displayName(kart))} bubble blocked it! 🫧`,
  };
}

/** Missed / fizzled / shrugged off by star power. */
export function dodgeMessages({ kart, by, item, star = false }) {
  const self = !by || by === kart;
  if (star) return { victim: 'Star power! Nothing can bonk you! 🌟', bonker: self ? null : `${displayName(kart)} is a superstar! 🌟` };
  const what = itemName(item);
  return {
    victim: item === 'cupcake-rocket' ? 'Phew! The rocket missed! 😅' : `Phew! Dodged the ${what}! 😅`,
    bonker: self ? null : `${displayName(kart)} dodged your ${what}! 😮`,
  };
}

/** Timed effect finished. */
export function endMessage(item) {
  if (item === 'bubble-shield') return 'Bubble popped! 🫧';
  if (item === 'rainbow-star') return 'Star power all done ✨';
  return null;
}

/** "🧁 Rocket coming!" (+ who sent it). */
export function threatMessage(threat) {
  const who = threat?.from ? ` from ${threat.from}` : '';
  return { emoji: itemEmoji('cupcake-rocket'), title: 'Rocket coming!', sub: threat?.closeness > 0.8 ? 'Here it comes!' : `Sent${who}` };
}

/** Item effects drawn by the HUD (item slot in Hud.js + ./itemWidgets.js). */
export const HUD_FX_PROVIDES = Object.freeze(['hud-roulette', 'hud-reveal', 'hud-callout', 'hud-pips', 'hud-timer-ring', 'hud-threat']);
