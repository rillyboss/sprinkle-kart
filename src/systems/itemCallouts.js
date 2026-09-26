/**
 * Item callouts: the WORDS side of power-ups. Registers the power-up HUD
 * widgets (src/ui/widgets/itemWidgets.js) and feeds them friendly, two-sided
 * callouts from race events:
 *   you use an item      "🧁 Cupcake Rocket! Zooming after Lenny!"
 *   you get bonked       "Bonked by Captain Crumbs' Gumdrop! 💫"
 *   you bonk someone     "You bonked Lenny! 🎯"
 *   a bubble saves you   "Bubble blocked Lenny's Cupcake Rocket! 🫧"
 *   you dodge            "Phew! Dodged the Gumdrop! 😅"
 *   an effect ends       "Bubble popped! 🫧" / "Star power all done ✨"
 * OWNER: power-up clarity workstream.
 */
import { createItemFeed } from '../ui/widgets/itemFeed.js';
import { itemWidgets } from '../ui/widgets/itemWidgets.js';
import {
  useCallout, bonkMessages, blockMessages, dodgeMessages, endMessage,
} from '../ui/widgets/itemHudLogic.js';
import { itemEmoji } from '../race/itemCatalog.js';

/**
 * Shared state between this system and its widgets (exported for tests).
 * @returns {{feed: ReturnType<typeof createItemFeed>, devices: Map<number, object>}}
 */
export function createCalloutState() {
  return { feed: createItemFeed({ max: 2 }), devices: new Map() };
}

const now = (s) => s?.race?.clock ?? 0;

const TAIL = /\s*(\p{Extended_Pictographic}[\p{Extended_Pictographic}\u200d\ufe0f]*)\s*$/u;

/**
 * Callout text with its trailing emoji moved to the icon column when it is the
 * same as the icon ("Phew! Dodged it! 😅" + 😅 -> "Phew! Dodged it!").
 */
export function withIcon(text, icon) {
  const m = String(text ?? '').match(TAIL);
  if (m && m[1] === icon) return { emoji: icon, title: String(text).slice(0, m.index).trim() };
  return { emoji: icon, title: String(text ?? '') };
}

/**
 * Route one race event to callouts. Pure apart from `state.feed.push`.
 * @param {string} type race event type (without the 'race:' prefix)
 */
export function calloutsForEvent(state, type, e, s) {
  const t = now(s);
  const human = (k) => s.isHuman(k);
  const push = (kart, msg) => { if (human(kart) && msg) state.feed.push(kart.playerIndex, msg, t); };
  switch (type) {
    case 'item-use': {
      const target = e.item === 'cupcake-rocket'
        ? s.race?.items?.rockets?.find?.((r) => r.owner === e.kart)?.target ?? null
        : null;
      const c = useCallout(e.item, { chargesLeft: e.chargesLeft ?? 0, target });
      if (c) push(e.kart, { key: 'use', tone: 'use', ...c });
      break;
    }
    case 'bonked': {
      const m = bonkMessages(e);
      push(e.kart, { key: 'hit', tone: 'oops', ...withIcon(m.victim, itemEmoji(e.cause === 'star' ? 'rainbow-star' : e.cause)) });
      if (m.bonker && e.by !== e.kart) push(e.by, { key: 'score', tone: 'good', ...withIcon(m.bonker, e.cause === 'star' ? '🌟' : '🎯') });
      break;
    }
    case 'shield-pop': {
      if (e.expired) {
        push(e.kart, { key: 'end', tone: 'info', ...withIcon(endMessage('bubble-shield'), '🫧'), ttl: 1.4 });
        break;
      }
      const m = blockMessages(e);
      push(e.kart, { key: 'hit', tone: 'block', ...withIcon(m.victim, '🫧') });
      if (m.bonker && e.by !== e.kart) push(e.by, { key: 'score', tone: 'block', ...withIcon(m.bonker, '🫧') });
      break;
    }
    case 'item-dodged': {
      const m = dodgeMessages(e);
      push(e.kart, { key: 'dodge', tone: 'good', ...withIcon(m.victim, e.star ? '🌟' : '😅') });
      if (m.bonker && e.by !== e.kart) push(e.by, { key: 'score', tone: 'info', ...withIcon(m.bonker, e.star ? '🌟' : '😮') });
      break;
    }
    case 'item-end': {
      const text = endMessage(e.item);
      if (text) push(e.kart, { key: 'end', tone: 'info', ...withIcon(text, e.item === 'rainbow-star' ? '✨' : itemEmoji(e.item)), ttl: 1.4 });
      break;
    }
    default:
      break;
  }
}

/** @type {import('./index.js').SystemDef} */
export default {
  id: 'item-callouts',
  order: 32,
  install(bus, app = {}) {
    const state = createCalloutState();
    const removers = [];
    if (typeof app.hud?.addWidget === 'function') {
      for (const w of itemWidgets(state)) {
        try { removers.push(app.hud.addWidget(w)); } catch (err) { console.error('[item-callouts] widget failed', err); }
      }
    }
    const route = (type) => bus.on(`race:${type}`, (e, s) => calloutsForEvent(state, type, e, s));
    const offs = [
      bus.on('race-start', (info, s) => {
        state.feed.clear();
        state.devices.clear();
        for (const h of s?.humans ?? info?.humans ?? []) {
          let dev = null;
          try { dev = app.input?.getDevice?.(h.deviceId) ?? null; } catch { dev = null; }
          state.devices.set(h.playerIndex, dev ?? { id: h.deviceId });
        }
      }),
      bus.on('race-exit', () => { state.feed.clear(); }),
      ...['item-use', 'bonked', 'shield-pop', 'item-dodged', 'item-end'].map(route),
    ];
    return () => {
      offs.forEach((off) => off());
      removers.forEach((r) => r?.());
    };
  },
  createCalloutState,
};
