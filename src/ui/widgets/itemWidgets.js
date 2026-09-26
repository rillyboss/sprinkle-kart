/**
 * Power-up HUD widgets (see src/ui/hudWidgets.js). OWNER: power-up clarity.
 *
 *   item-card     (anchor under-cluster)  item NAME + "Press LB" hint, Triple Sprinkle pips,
 *                                         Bubble Shield / Rainbow Star timer rings
 *   item-callout  (anchor callout)        "Rocket coming!" warning + friendly callouts, as toasts in
 *                                         the viewport's toast lane (src/ui/kit/toastLane.js)
 *   item-edge     (viewport overlay)      edge arrow pointing at an incoming rocket, soft warning
 *                                         vignette, boost speed lines, rainbow star frame
 *
 * The widgets only READ: `state.feed` (callouts pushed by src/systems/itemCallouts.js),
 * `state.devices` (playerIndex -> input device, for the button hint) and the race.
 */
import './items.css';
import { TUNING } from '../../race/tuning.js';
import { escapeHtml } from '../dom.js';
import { icon, itemIcon, iconForEmoji } from '../kit/icons.js';
import { laneFor, createToastLane, LANE_TTL_MAX } from '../kit/toastLane.js';
import {
  itemSlotView, activeTimers, ringDashOffset, threatsFor, edgeArrowPlacement, threatMessage,
} from './itemHudLogic.js';

const RING_C = 2 * Math.PI * 16; // svg circle r=16

function div(cls, html = '') {
  const n = document.createElement('div');
  n.className = cls;
  if (html) n.innerHTML = html;
  return n;
}

/** Retrigger a one-shot CSS animation class. */
function retrigger(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

function ringHtml(t) {
  return `<div class="ski-ring${t.ending ? ' ski-ending' : ''}" data-item="${t.item}">`
    + '<svg viewBox="0 0 40 40"><circle class="bg" cx="20" cy="20" r="16"/>'
    + `<circle class="fg" cx="20" cy="20" r="16" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${ringDashOffset(t.frac, RING_C).toFixed(2)}"/></svg>`
    + `<span>${icon(itemIcon(t.item))}</span></div>`;
}

/** @param {{feed, devices: Map}} state */
export function itemCardWidget(state) {
  return {
    id: 'item-card',
    anchor: 'under-cluster',
    order: 10,
    create(node, pi) {
      const card = div('ski-card');
      const name = div('ski-name');
      const hint = div('ski-hint');
      const pips = div('ski-pips');
      const timers = div('ski-timers');
      card.append(name, hint, pips);
      node.append(card, timers);
      const cache = {};
      return {
        update(kart) {
          const v = itemSlotView(kart, state.devices.get(pi) ?? null);
          const sig = `${v.state}|${v.item}|${v.hint}|${v.pips?.left ?? ''}`;
          if (sig !== cache.sig) {
            const was = cache.state;
            cache.sig = sig;
            cache.state = v.state;
            card.dataset.state = v.state;
            card.style.setProperty('--ic', v.color);
            if (v.state === 'rolling') {
              name.textContent = 'Ooh! What will it be?';
              hint.innerHTML = '';
            } else if (v.item) {
              name.textContent = v.name;
              hint.innerHTML = v.state === 'spinning'
                ? escapeHtml(v.hint)
                : `Press <b class="ski-key">${escapeHtml(v.hint.replace(/^Press /, ''))}</b>`;
            }
            pips.innerHTML = v.pips
              ? Array.from({ length: v.pips.total }, (_, i) => `<i class="${i < v.pips.left ? 'on' : ''}"></i>`).join('')
              : '';
            pips.hidden = !v.pips;
            card.hidden = v.state === 'empty';
            if (was === 'rolling' && v.state === 'ready') retrigger(card, 'ski-tada');
          }
          const tm = activeTimers(kart, TUNING);
          const tsig = tm.map((t) => `${t.item}:${Math.round(t.frac * 60)}:${t.ending}`).join(',');
          if (tsig !== cache.tsig) {
            cache.tsig = tsig;
            timers.innerHTML = tm.map(ringHtml).join('');
          }
        },
        reset() { for (const k of Object.keys(cache)) delete cache[k]; timers.innerHTML = ''; card.hidden = true; },
        destroy() { card.remove(); timers.remove(); },
      };
    },
  };
}

/** Item-feed tones -> Candy Arcade toast tones. */
export const CALLOUT_TONES = Object.freeze({ use: 'raspberry', good: 'mint', oops: 'lemon', block: 'sky', info: 'grape' });

/**
 * A feed callout ({ id, emoji, title, sub, tone, at, until }) as a toast-lane message (pure).
 * Item emoji become the kit's SVG item icons; the lane keeps each one ≤ LANE_TTL_MAX.
 */
export function calloutToast(m) {
  const ic = iconForEmoji(m?.emoji);
  const life = Number.isFinite(m?.until) && Number.isFinite(m?.at) ? m.until - m.at : undefined;
  return {
    title: String(m?.title ?? ''),
    sub: m?.sub ? String(m.sub) : '',
    iconName: ic ?? '',
    emoji: ic ? '' : (m?.emoji ?? ''),
    tone: CALLOUT_TONES[m?.tone] ?? 'raspberry',
    ttl: life !== undefined ? Math.min(LANE_TTL_MAX, Math.max(0.8, life)) : undefined,
  };
}

/** The pinned "Rocket coming!" warning as a lane message (pure). */
export function threatToast(th) {
  const m = threatMessage(th);
  return { title: m.title, sub: m.sub, iconName: 'cupcake-rocket', tone: 'alert' };
}

/**
 * Item callouts + the rocket warning, drawn as toasts in the viewport's toast lane
 * (src/ui/kit/toastLane.js: edge column, max 2, never mid-screen). Without a Hud lane
 * (tests, other hosts) it makes its own lane inside its zone box.
 * @param {{feed}} state
 */
export function itemCalloutWidget(state) {
  return {
    id: 'item-callout',
    anchor: 'callout',
    order: 10,
    create(node, pi, vpNode) {
      let clock = 0;
      const hudLane = laneFor(vpNode);
      const lane = hudLane ?? createToastLane(node, { now: () => clock });
      const own = !hudLane;
      const shown = new Set(); // feed ids already pushed
      const cache = { threat: '' };
      return {
        update(kart, race) {
          const now = race?.clock ?? 0;
          clock = now;
          // pinned rocket warning
          const th = threatsFor(kart, race?.items?.rockets)[0] ?? null;
          const tsig = th ? `${th.closeness > 0.8}|${th.from}` : '';
          if (tsig !== cache.threat) {
            cache.threat = tsig;
            if (th) lane.pin('rocket', threatToast(th)); else lane.unpin('rocket');
          }
          // friendly callouts: each feed message becomes one toast, once
          const msgs = state.feed.active(pi, now);
          for (const m of msgs) {
            if (shown.has(m.id)) continue;
            shown.add(m.id);
            lane.push(calloutToast(m));
          }
          if (shown.size > 64) for (const id of [...shown].slice(0, shown.size - 32)) shown.delete(id);
          if (own) lane.update();
        },
        reset() { shown.clear(); cache.threat = ''; lane.unpin('rocket'); },
        destroy() { lane.unpin('rocket'); if (own) lane.destroy(); },
      };
    },
  };
}

/** Full-viewport overlay (no anchor: it hugs the edges). */
export function itemEdgeWidget() {
  return {
    id: 'item-edge',
    create(vpNode) {
      const root = div('ski-edge');
      const vignette = div('ski-vignette');
      const speed = div('ski-speed', Array.from({ length: 12 }, (_, i) => `<i style="--i:${i}"></i>`).join(''));
      const star = div('ski-star-frame');
      const arrow = div('ski-arrow', `<i class="tip"></i><span class="e">${icon('cupcake-rocket')}</span>`);
      root.append(vignette, speed, star, arrow);
      vpNode.appendChild(root);
      const cache = {};
      const set = (k, v, fn) => { if (cache[k] !== v) { cache[k] = v; fn(v); } };
      return {
        update(kart, race) {
          const racing = (race?.state ?? 'racing') !== 'finished' && !kart.finished;
          set('boost', racing && !!kart.boosting, (v) => speed.classList.toggle('on', v));
          set('star', racing && kart.starPower > 0, (v) => star.classList.toggle('on', v));
          const th = racing ? threatsFor(kart, race?.items?.rockets)[0] : null;
          set('threat', !!th, (v) => { arrow.classList.toggle('on', v); vignette.classList.toggle('on', v); });
          if (th) {
            const p = edgeArrowPlacement(th.bearing);
            arrow.style.left = `${(p.x * 100).toFixed(1)}%`;
            arrow.style.top = `${(p.y * 100).toFixed(1)}%`;
            arrow.style.setProperty('--rot', `${p.rot.toFixed(0)}deg`);
            arrow.style.setProperty('--beat', `${th.interval.toFixed(2)}s`);
            arrow.style.setProperty('--near', th.closeness.toFixed(2));
            vignette.style.setProperty('--near', th.closeness.toFixed(2));
          }
        },
        reset() {
          for (const k of Object.keys(cache)) delete cache[k];
          for (const n of [speed, star, arrow, vignette]) n.classList.remove('on');
        },
        destroy() { root.remove(); },
      };
    },
  };
}

/** All power-up widgets, in registration order. */
export function itemWidgets(state) {
  return [itemCardWidget(state), itemCalloutWidget(state), itemEdgeWidget(state)];
}
