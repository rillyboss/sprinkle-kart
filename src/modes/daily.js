/**
 * Daily Sprinkle — one fun challenge a day (pure, DOM-free, unit tested).
 *
 * Every date picks, from a seed made of the date: a track (among the ones the
 * family has unlocked), a speed, a goal ("Do 4 drift turbos", "Finish in the
 * top 3", "Finish without getting bonked" ...) and a silly twist ("Everyone
 * starts with a Rainbow Star!"). The same day always gives the same challenge
 * on every device; completing it counts once per day and grows a streak.
 *
 *   dailyChallenge(dateStr, trackIds)   -> Challenge
 *   dailyProgress(challenge, tally)     -> { current, target, done, text }   (live, during the race)
 *   dailyResult(challenge, summary)     -> the same from a RaceSummary
 *   dailyRules(challenge)               -> race rules (src/modes/rules.js) for the twist
 *   recordDaily(store, dateStr, done)   -> new store { lastDone, streak, best, days: [...] }
 *
 * OWNER: showcase features & modes.
 */
import { normalizeRules } from './rules.js';

export const DAILY_GOALS = Object.freeze([
  Object.freeze({ kind: 'podium', emoji: '🥉', weight: 3, text: () => 'Finish in the top 3!' }),
  Object.freeze({ kind: 'win', emoji: '🥇', weight: 1, text: () => 'Win the race!' }),
  Object.freeze({ kind: 'drifts', emoji: '🌀', weight: 3, min: 3, max: 6, text: (n) => `Do ${n} drift turbos` }),
  Object.freeze({ kind: 'items', emoji: '🎁', weight: 2, min: 3, max: 5, text: (n) => `Use ${n} items` }),
  Object.freeze({ kind: 'boxes', emoji: '❓', weight: 2, min: 5, max: 9, text: (n) => `Pop ${n} item boxes` }),
  Object.freeze({ kind: 'bonks', emoji: '🎯', weight: 2, min: 2, max: 3, text: (n) => `Bonk ${n} racers with items` }),
  Object.freeze({ kind: 'clean', emoji: '🫧', weight: 2, text: () => 'Finish without getting bonked' }),
  Object.freeze({ kind: 'boosts', emoji: '🚀', weight: 2, min: 6, max: 10, text: (n) => `Zoom through ${n} boosts` }),
]);

export const DAILY_TWISTS = Object.freeze([
  Object.freeze({ id: 'none', emoji: '🍭', text: 'A classic sprinkly race', rules: {} }),
  Object.freeze({ id: 'star-start', emoji: '🌟', text: 'Everyone starts with a Rainbow Star!', rules: { startItem: 'rainbow-star' } }),
  Object.freeze({ id: 'triple-boost', emoji: '🍬', text: 'Start with three sprinkle boosts!', rules: { startItem: 'triple-sprinkle', startItemCharges: 3 } }),
  Object.freeze({ id: 'bubble-start', emoji: '🫧', text: 'Start inside a bubble shield!', rules: { startItem: 'bubble-shield' } }),
  Object.freeze({ id: 'rocket-start', emoji: '🧁', text: 'Start with a cupcake rocket!', rules: { startItem: 'cupcake-rocket' } }),
]);

const SPEEDS = ['cozy', 'zippy', 'zippy', 'zoomy'];

/** Tiny seeded rng (mulberry32) from a string. */
export function seededRng(text) {
  let h = 2166136261 >>> 0;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(list, rng) {
  const total = list.reduce((a, x) => a + (x.weight ?? 1), 0);
  let r = rng() * total;
  for (const x of list) { r -= x.weight ?? 1; if (r < 0) return x; }
  return list[list.length - 1];
}

/**
 * @typedef {Object} Challenge
 * @property {string} id           the date 'YYYY-MM-DD'
 * @property {string|null} trackId
 * @property {string} speedClass
 * @property {{ kind: string, target: number, text: string, emoji: string }} goal
 * @property {{ id: string, text: string, emoji: string }} twist
 */

/**
 * Today's challenge. `trackIds` = the tracks it may pick from (unlocked ones);
 * the pick is stable for a date as long as that list is the same.
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string[]} trackIds
 * @returns {Challenge}
 */
export function dailyChallenge(dateStr, trackIds = []) {
  const id = String(dateStr || '');
  const rng = seededRng(`sprinkle-daily:${id}`);
  const ids = (trackIds || []).filter((t) => typeof t === 'string');
  const trackId = ids.length ? ids[Math.floor(rng() * ids.length) % ids.length] : null;
  const speedClass = SPEEDS[Math.floor(rng() * SPEEDS.length) % SPEEDS.length];
  const g = pickWeighted(DAILY_GOALS, rng);
  const target = g.min ? g.min + Math.floor(rng() * (g.max - g.min + 1)) : 1;
  // Cozy days get the easier end of a goal; "win" days are never Zoomy.
  const speed = g.kind === 'win' && speedClass === 'zoomy' ? 'zippy' : speedClass;
  const tw = rng() < 0.35 ? DAILY_TWISTS[0] : DAILY_TWISTS[1 + (Math.floor(rng() * (DAILY_TWISTS.length - 1)) % (DAILY_TWISTS.length - 1))];
  return {
    id,
    trackId,
    speedClass: speed,
    goal: { kind: g.kind, target, text: g.text(target), emoji: g.emoji },
    twist: { id: tw.id, text: tw.text, emoji: tw.emoji },
  };
}

/** Race rules for the challenge's twist. */
export function dailyRules(challenge) {
  const tw = DAILY_TWISTS.find((t) => t.id === challenge?.twist?.id) ?? DAILY_TWISTS[0];
  return normalizeRules(tw.rules);
}

const num = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Live progress from a family tally (summed over the humans):
 * { miniTurbos, itemsUsed, itemBoxes, bonksGiven, boosts, bonked, bestPlace, finished, clean }.
 * `clean` = some human finished without being bonked; `bestPlace` = best real place so far.
 */
export function dailyProgress(challenge, tally = {}) {
  const g = challenge?.goal;
  const t = tally || {};
  let current = 0;
  let target = Math.max(1, num(g?.target) || 1);
  switch (g?.kind) {
    case 'drifts': current = num(t.miniTurbos); break;
    case 'items': current = num(t.itemsUsed); break;
    case 'boxes': current = num(t.itemBoxes); break;
    case 'bonks': current = num(t.bonksGiven); break;
    case 'boosts': current = num(t.boosts); break;
    case 'podium': target = 1; current = t.finished && num(t.bestPlace) >= 1 && t.bestPlace <= 3 ? 1 : 0; break;
    case 'win': target = 1; current = t.finished && t.bestPlace === 1 ? 1 : 0; break;
    case 'clean': target = 1; current = t.clean ? 1 : 0; break;
    default: break;
  }
  const done = current >= target;
  const text = target > 1 ? `${Math.min(current, target)}/${target}` : (done ? '✔' : '');
  return { current: Math.min(current, target), target, done, text };
}

/** The family tally of a RaceSummary (for dailyProgress). */
export function summaryTally(summary) {
  const humans = Array.isArray(summary?.humans) ? summary.humans : [];
  const sum = (k) => humans.reduce((a, h) => a + num(h.stats?.[k]), 0);
  const real = humans.filter((h) => h.finished && !h.estimated);
  const places = real.map((h) => h.place).filter((p) => Number.isInteger(p) && p >= 1);
  return {
    miniTurbos: sum('miniTurbos'),
    itemsUsed: sum('itemsUsed'),
    itemBoxes: sum('itemBoxes'),
    bonksGiven: sum('bonksGiven'),
    boosts: sum('boosts'),
    bonked: sum('bonked'),
    finished: real.length > 0,
    bestPlace: places.length ? Math.min(...places) : null,
    clean: real.some((h) => h.stats && num(h.stats.bonked) === 0),
  };
}

/** Was the challenge completed in this race? */
export function dailyResult(challenge, summary) {
  const pr = dailyProgress(challenge, summaryTally(summary));
  // Counting goals still need the race to be finished by someone.
  const finished = summaryTally(summary).finished;
  return { ...pr, done: pr.done && finished };
}

/** Days between two 'YYYY-MM-DD' strings (b - a), NaN for bad input. */
export function dayDiff(a, b) {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(a || ''));
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(b || ''));
  if (!pa || !pb) return NaN;
  const ta = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const tb = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((tb - ta) / 86400000);
}

export function emptyDailyStore() {
  return { lastDone: null, streak: 0, best: 0, days: [] };
}

/** Sanitise a saved store. */
export function mergeDailyStore(saved) {
  const out = emptyDailyStore();
  if (!saved || typeof saved !== 'object') return out;
  if (typeof saved.lastDone === 'string' && Number.isFinite(dayDiff(saved.lastDone, saved.lastDone))) out.lastDone = saved.lastDone;
  out.streak = Math.max(0, Math.floor(num(saved.streak)));
  out.best = Math.max(out.streak, Math.floor(num(saved.best)));
  if (Array.isArray(saved.days)) out.days = saved.days.filter((d) => typeof d === 'string').slice(-60);
  return out;
}

/**
 * Record a result for `dateStr`. Only the first completion of a day counts:
 * returns { store, counted } (counted = this completion is new today).
 * The streak grows on consecutive days and restarts at 1 after a gap.
 */
export function recordDaily(store, dateStr, done) {
  const s = mergeDailyStore(store);
  if (!done || s.days.includes(dateStr)) return { store: s, counted: false };
  const gap = s.lastDone ? dayDiff(s.lastDone, dateStr) : NaN;
  const streak = gap === 1 ? s.streak + 1 : 1;
  const next = { lastDone: dateStr, streak, best: Math.max(s.best, streak), days: [...s.days, dateStr].slice(-60) };
  return { store: next, counted: true };
}

/** The streak as shown today: it only counts if the last completion was today or yesterday. */
export function currentStreak(store, today) {
  const s = mergeDailyStore(store);
  if (!s.lastDone) return 0;
  const gap = dayDiff(s.lastDone, today);
  return gap === 0 || gap === 1 ? s.streak : 0;
}

export const doneToday = (store, today) => mergeDailyStore(store).days.includes(today);

/**
 * Daily Sprinkle screen reducer: A / Start = go, B = back. Only P1's device
 * (and the mouse) drive it. Returns { state, fx, go: 'go'|'back'|null }.
 */
export function dailyScreenReduce(state, ev) {
  const out = (go = null, fx = []) => ({ state, fx, go });
  if (state?.controllerId && ev.deviceId !== state.controllerId && ev.deviceId !== 'mouse') return out();
  switch (ev.action) {
    case 'confirm': case 'start': case 'select': return out('go', ['confirm']);
    case 'back': return out('back', ['back']);
    default: return out();
  }
}
