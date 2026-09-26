/**
 * Power-up HUD widgets (see src/ui/hudWidgets.js). OWNER: power-up clarity.
 *
 *   item-card     (anchor under-cluster)  item NAME + "Press LB" hint, Triple Sprinkle pips,
 *                                         Bubble Shield / Rainbow Star timer rings
 *   item-callout  (anchor callout)        "🧁 Rocket coming!" warning + big friendly callouts
 *   item-edge     (viewport overlay)      edge arrow pointing at an incoming rocket, soft warning
 *                                         vignette, boost speed lines, rainbow star frame
 *
 * The widgets only READ: `state.feed` (callouts pushed by src/systems/itemCallouts.js),
 * `state.devices` (playerIndex -> input device, for the button hint) and the race.
 */
import './items.css';
import { TUNING } from '../../race/tuning.js';
import { escapeHtml } from '../dom.js';
import {
  itemSlotView, activeTimers, ringDashOffset, threatsFor, edgeArrowPlacement, threatMessage,
} from './itemHudLogic.js';

const RING_C = 2 * Math.PI * 16; // svg circle r=16
/** Callouts end this far down the viewport (0..1): just above the chase-cam kart. */
export const CALLOUT_BOTTOM = 0.4;

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
    + `<span>${t.emoji}</span></div>`;
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

/** @param {{feed}} state */
export function itemCalloutWidget(state) {
  return {
    id: 'item-callout',
    anchor: 'callout',
    order: 10,
    create(node, pi, vpNode) {
      const threat = div('ski-threat');
      threat.hidden = true;
      const list = div('ski-callouts');
      node.append(list, threat);
      node.classList.add('ski-callout-box');
      const cache = { ids: '', threat: '', h: -1, measuredAt: -9 };
      // The callout zone starts at 50% of the viewport, right on top of the
      // player's kart. Lift the stack so its bottom edge sits just above the
      // kart (CALLOUT_BOTTOM of the viewport height) and it grows upward.
      const place = (now) => {
        if (Math.abs(now - cache.measuredAt) < 0.5) return;
        cache.measuredAt = now;
        const h = vpNode?.clientHeight || 0;
        if (h === cache.h) return;
        cache.h = h;
        node.style.transform = `translateY(calc(${(-(0.5 - CALLOUT_BOTTOM) * h).toFixed(1)}px - 100%))`;
      };
      return {
        update(kart, race) {
          const now = race?.clock ?? 0;
          place(now);
          // pinned rocket warning
          const th = threatsFor(kart, race?.items?.rockets)[0] ?? null;
          const tsig = th ? `${th.closeness > 0.8}|${th.from}` : '';
          if (tsig !== cache.threat) {
            cache.threat = tsig;
            threat.hidden = !th;
            if (th) {
              const m = threatMessage(th);
              threat.innerHTML = `<span class="e">${m.emoji}</span><div><b>${escapeHtml(m.title)}</b><small>${escapeHtml(m.sub)}</small></div>`;
            }
          }
          if (th) threat.style.setProperty('--beat', `${th.interval.toFixed(2)}s`);
          // friendly callouts
          const msgs = state.feed.active(pi, now);
          const ids = msgs.map((m) => m.id).join(',');
          if (ids !== cache.ids) {
            cache.ids = ids;
            const keep = new Set(msgs.map((m) => String(m.id)));
            for (const c of [...list.children]) if (!keep.has(c.dataset.id)) c.remove();
            const have = new Set([...list.children].map((c) => c.dataset.id));
            for (const m of msgs) {
              if (have.has(String(m.id))) continue;
              const c = div(`ski-callout ski-tone-${m.tone}`,
                `${m.emoji ? `<span class="e">${m.emoji}</span>` : ''}<div><b>${escapeHtml(m.title)}</b>${m.sub ? `<small>${escapeHtml(m.sub)}</small>` : ''}</div>`);
              c.dataset.id = String(m.id);
              if (m.color) c.style.setProperty('--ic', m.color);
              c.style.setProperty('--ttl', `${Math.max(0.5, m.until - m.at).toFixed(2)}s`);
              list.appendChild(c);
            }
          }
        },
        reset() { list.innerHTML = ''; threat.hidden = true; cache.ids = ''; cache.threat = ''; },
        destroy() { threat.remove(); list.remove(); },
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
      const arrow = div('ski-arrow', '<i class="tip"></i><span class="e">🧁</span>');
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
