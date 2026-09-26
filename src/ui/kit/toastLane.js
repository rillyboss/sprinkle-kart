/**
 * HUD toast lane — the ONE place in-race event popups go (flashes like
 * "Mini-Turbo!", item callouts, record toasts, rocket warnings …).
 *
 * Rules (Candy Arcade art direction): a lane per player viewport, edge-anchored
 * in the item-side column under the item / lap cluster; at most LANE_MAX toasts
 * visible (a newer one retires the oldest early); each lives ~LANE_TTL s; one
 * optional pinned toast (e.g. "Rocket coming!") sits on top while it applies.
 * Toasts never cover the centre of the view or the road ahead. Only the
 * countdown, FINAL LAP and FINISH may use the centre (Hud.js), briefly.
 *
 *   const lane = createToastLane(parentNode, { now: () => seconds });
 *   lane.push({ title: 'Mini-Turbo!', iconName: 'flame', tone: 'raspberry', key: 'drift' });
 *   lane.pin('rocket', { title: 'Rocket coming!', sub: 'Behind you', iconName: 'cupcake-rocket', tone: 'alert' });
 *   lane.unpin('rocket');
 *   lane.update(nowSeconds);      // every frame (Hud.update does this)
 *   laneFor(vpNode)               // the lane of a viewport (widgets use this)
 *
 * The model (createLaneModel) is pure and unit tested; the DOM part only
 * mirrors it. OWNER: UI art direction.
 */
import { toastHtml } from './components.js';
import { iconForEmoji, hasIcon } from './icons.js';

/** Toasts visible at once per lane (pinned toast not counted). */
export const LANE_MAX = 2;
/** Default seconds a toast stays up. */
export const LANE_TTL = 1.5;
/** Longest a toast may ask for (keeps the lane moving). */
export const LANE_TTL_MAX = 2.4;
/** Seconds the leave animation runs before a node is removed. */
export const LANE_LEAVE = 0.16;

const TAIL_EMOJI = /\s*(\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️]*)\s*$/u;
const HEAD_EMOJI = /^\s*(\p{Extended_Pictographic}[\p{Extended_Pictographic}‍️]*)\s*/u;

/**
 * Turn a legacy flash string ("Lap 2! 🍭", "📸 Photo finish!") into a toast:
 * the emoji moves to the icon chip (as an SVG icon when the kit has one).
 * @returns {{ title: string, iconName: string, emoji: string, tone: string }}
 */
export function toastFromText(text) {
  let title = String(text ?? '').trim();
  let emoji = '';
  const tail = title.match(TAIL_EMOJI);
  if (tail) { emoji = tail[1]; title = title.slice(0, tail.index).trim(); } else {
    const head = title.match(HEAD_EMOJI);
    if (head) { emoji = head[1]; title = title.slice(head[0].length).trim(); }
  }
  const iconName = iconForEmoji(emoji) ?? '';
  return { title: title || String(text ?? ''), iconName, emoji: iconName ? '' : emoji, tone: toneForText(title) };
}

/** A tone for a legacy flash by its words (laps = sky, records = lemon, the rest raspberry). */
export function toneForText(title) {
  const t = String(title ?? '').toLowerCase();
  if (/\blap\b|final/.test(t)) return 'sky';
  if (/record|best|trophy|photo/.test(t)) return 'lemon';
  if (/keep going|you can|great|nice|yay/.test(t)) return 'mint';
  return 'raspberry';
}

const clampTtl = (ttl) => Math.max(0.4, Math.min(LANE_TTL_MAX, Number.isFinite(ttl) ? ttl : LANE_TTL));

/**
 * Pure lane state. Times are seconds on any monotonic clock.
 * @param {{ max?: number, ttl?: number }} [o]
 */
export function createLaneModel({ max = LANE_MAX, ttl = LANE_TTL } = {}) {
  let seq = 0;
  let toasts = []; // oldest first: { id, key, msg, at, until }
  let pinned = null; // { key, msg }
  return {
    get max() { return max; },
    /** Add (or refresh, by `msg.key`) a toast. Returns { id, dropped: id[], refreshed: boolean }. */
    push(msg, now) {
      const life = clampTtl(msg?.ttl ?? ttl);
      const key = msg?.key ?? null;
      const same = key != null ? toasts.find((t) => t.key === key) : null;
      if (same) {
        same.msg = { ...msg };
        same.at = now;
        same.until = now + life;
        same.rev = (same.rev ?? 0) + 1;
        return { id: same.id, dropped: [], refreshed: true };
      }
      const t = { id: ++seq, key, msg: { ...msg }, at: now, until: now + life, rev: 0 };
      toasts.push(t);
      const dropped = [];
      while (toasts.length > max) dropped.push(toasts.shift().id);
      return { id: t.id, dropped, refreshed: false };
    },
    /** Remove toasts whose time is up; returns their ids. */
    expire(now) {
      const gone = toasts.filter((t) => now >= t.until).map((t) => t.id);
      if (gone.length) toasts = toasts.filter((t) => now < t.until);
      return gone;
    },
    pin(key, msg) {
      const changed = !pinned || pinned.key !== key || JSON.stringify(pinned.msg) !== JSON.stringify(msg);
      pinned = { key, msg: { ...msg } };
      return changed;
    },
    unpin(key) {
      if (!pinned || (key != null && pinned.key !== key)) return false;
      pinned = null;
      return true;
    },
    clear() { const ids = toasts.map((t) => t.id); toasts = []; pinned = null; return ids; },
    /** Visible toasts, NEWEST FIRST (the lane draws them top-down under the cluster). */
    visible() { return [...toasts].reverse(); },
    get pinned() { return pinned; },
    get size() { return toasts.length; },
  };
}

const lanes = new WeakMap();

/** The lane registered for a viewport node (or null). */
export function laneFor(node) {
  if (!node || typeof node !== 'object') return null;
  return lanes.get(node) ?? null;
}

/** A normalized toast message from a string or an object. */
export function toToast(msg) {
  if (typeof msg === 'string') return toastFromText(msg);
  const m = { ...(msg ?? {}) };
  if (!m.iconName && m.emoji) {
    const ic = iconForEmoji(m.emoji);
    if (ic) { m.iconName = ic; m.emoji = ''; }
  }
  if (m.iconName && !hasIcon(m.iconName)) m.iconName = '';
  return m;
}

/**
 * DOM lane inside `parent` (a viewport column). Headless-safe: without a DOM it keeps the model only.
 * @param {HTMLElement|null} parent
 * @param {{ max?: number, ttl?: number, now?: () => number, register?: HTMLElement }} [o]
 *   `register` = the node laneFor() should find this lane by (the viewport node).
 */
export function createToastLane(parent, { max = LANE_MAX, ttl = LANE_TTL, now = null, register = null } = {}) {
  const model = createLaneModel({ max, ttl });
  const canDom = !!parent && typeof parent.appendChild === 'function' && typeof document !== 'undefined';
  let clock = 0;
  const time = () => (now ? now() : clock);
  const nodes = new Map(); // id -> node
  let pinNode = null;
  let root = null;
  let pinBox = null;
  let list = null;
  if (canDom) {
    root = document.createElement('div');
    root.className = 'ck-hudlane';
    pinBox = document.createElement('div');
    pinBox.className = 'ck-hudlane-pin';
    list = document.createElement('div');
    list.className = 'ck-hudlane-list';
    root.appendChild(pinBox);
    root.appendChild(list);
    parent.appendChild(root);
  }

  const render = (msg, extra = '') => {
    const wrap = document.createElement('div');
    wrap.className = `ck-hudlane-item${extra ? ` ${extra}` : ''}`;
    wrap.innerHTML = toastHtml(msg);
    return wrap;
  };
  const leave = (node) => {
    if (!node) return;
    node.classList?.add?.('is-out');
    setTimeout(() => node.remove?.(), LANE_LEAVE * 1000);
  };

  const lane = {
    model,
    node: root,
    /** Show a toast (string or { title, sub?, iconName?|emoji?, tone?, key?, ttl? }). Returns its id. */
    push(msg, at = time()) {
      const m = toToast(msg);
      const r = model.push(m, at);
      if (!canDom) return r.id;
      for (const id of r.dropped) { leave(nodes.get(id)); nodes.delete(id); }
      const first = () => list.firstElementChild ?? list.firstChild ?? null;
      if (r.refreshed) {
        const old = nodes.get(r.id);
        const fresh = render(m, 'is-in is-bump');
        if (old && old.parentNode === list) { list.insertBefore(fresh, old); old.remove(); } else if (first()) list.insertBefore(fresh, first()); else list.appendChild(fresh);
        nodes.set(r.id, fresh);
      } else {
        const n = render(m, 'is-in');
        if (first()) list.insertBefore(n, first()); else list.appendChild(n);
        nodes.set(r.id, n);
      }
      return r.id;
    },
    pin(key, msg) {
      const m = toToast(msg);
      if (!model.pin(key, m) || !canDom) return;
      pinNode?.remove?.();
      pinNode = render(m, 'is-in is-pinned');
      pinBox.appendChild(pinNode);
    },
    unpin(key) {
      if (!model.unpin(key) || !canDom) return;
      leave(pinNode);
      pinNode = null;
    },
    update(at) {
      if (Number.isFinite(at)) clock = at;
      const gone = model.expire(time());
      if (!canDom) return gone;
      for (const id of gone) { leave(nodes.get(id)); nodes.delete(id); }
      return gone;
    },
    clear() {
      model.clear();
      if (!canDom) return;
      nodes.clear();
      pinNode = null;
      list.innerHTML = '';
      pinBox.innerHTML = '';
    },
    destroy() {
      lane.clear();
      root?.remove?.();
      if (register) lanes.delete(register);
    },
  };
  if (register && typeof register === 'object') lanes.set(register, lane);
  return lane;
}
