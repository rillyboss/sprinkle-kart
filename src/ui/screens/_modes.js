/**
 * Helpers shared by the modes screens (mode select, cup select, GP standings,
 * time-trial results, records). Not a screen: files starting with "_" are
 * skipped by the screen registry. OWNER: modes + timing workstream.
 */
import '../../modes/modes.css';
import { el, escapeHtml, portraitHtml } from '../dom.js';
import { pc, UNLOCK_MIN_SHOW } from './_shared.js';
import { unlockOverlay } from './unlock.js';
import { playerLabel } from '../../net/session/playerLabel.js';

/** "P1" tag for a human row. */
export function playerTag(row) {
  return row && row.playerIndex != null && !row.isCPU
    ? `<b class="sk-tag" style="--pc:${pc(row.playerIndex)}">${escapeHtml(playerLabel(row.playerIndex))}</b>` : '';
}

export function nameOf(ctx, characterId) {
  return ctx.char(characterId)?.name ?? 'Racer';
}

/** A shiny CSS trophy cup (gold / silver / bronze) with a cute face. */
export function trophyHtml(kind = 'gold', { big = false } = {}) {
  return `<div class="sk-trophy sk-trophy-${kind}${big ? ' sk-trophy-big' : ''}" aria-hidden="true">`
    + '<i class="sk-trophy-handle l"></i><i class="sk-trophy-handle r"></i>'
    + '<div class="sk-trophy-bowl"><i class="sk-trophy-shine"></i><i class="sk-trophy-face"></i></div>'
    + '<div class="sk-trophy-stem"></div><div class="sk-trophy-base"></div>'
    + `<i class="sk-trophy-star">${kind === 'gold' ? '⭐' : kind === 'silver' ? '✨' : '💫'}</i></div>`;
}

/** Portrait markup for a character id. */
export function portraitFor(ctx, characterId, cls = '') {
  return portraitHtml(ctx.char(characterId) ?? { id: characterId, name: characterId }, ctx.portraits, { cls });
}

/** Class on the host while a reveal is up: the screen underneath is hidden (no see-through text). */
export const CELEBRATING_CLASS = 'sk-celebrating';

/**
 * Plays unlock celebrations one after another on top of `host`
 * (same feel as the results screen, incl. the "Surprise 1 of N" ribbon).
 * While a reveal is showing (fading in, up, or fading out) the host gets
 * CELEBRATING_CLASS, which hides everything else on the screen, so the
 * podium / headline / buttons never show through a half-faded reveal.
 * Returns { active(), pending(), update(dt), handle(ev) -> consumed }.
 * @param {Array<{kind, def}>} queue
 */
export function celebrationQueue(ctx, host, queue, { delay = 1.2 } = {}) {
  const list = (queue || []).filter((u) => u && u.def);
  const total = list.length;
  let shown = 0;
  let current = null;
  let leaving = 0; // reveals still fading out
  let age = 0;
  let wait = list.length ? delay : 0;
  const cover = () => host.classList?.toggle?.(CELEBRATING_CLASS, !!current || leaving > 0 || (shown > 0 && wait > 0));
  const show = () => {
    wait = 0;
    const u = list.shift();
    if (!u) return;
    current = unlockOverlay(ctx, u, () => handle({ deviceId: 'mouse', action: 'confirm' }), { index: shown, total });
    shown++;
    host.appendChild(current);
    cover();
    ctx.sfx('unlock');
    if (u.kind !== 'track') { try { ctx.audio?.voice?.(u.def, 'win'); } catch { /* ignore */ } }
    age = 0;
    ctx.setCooldown(0.6);
  };
  function handle(ev) {
    if (wait > 0) {
      if (['confirm', 'start', 'select'].includes(ev.action)) show();
      return true;
    }
    if (!current) return false;
    if (age < UNLOCK_MIN_SHOW) return true;
    if (['confirm', 'start', 'back', 'select'].includes(ev.action)) {
      ctx.sfx('confirm');
      current.classList.add('sk-leaving');
      const c = current;
      current = null;
      leaving++;
      setTimeout(() => { c.remove(); leaving--; cover(); }, 450);
      ctx.setCooldown(0.9);
      if (list.length) wait = 0.7;
      cover();
    }
    return true;
  }
  return {
    active: () => wait > 0 || !!current || leaving > 0,
    pending: () => list.length + (current ? 1 : 0),
    update(dt) {
      if (wait > 0) { wait -= dt; if (wait <= 0) show(); }
      if (current) { age += dt; current.classList.toggle('sk-can-continue', age >= UNLOCK_MIN_SHOW); }
    },
    handle,
  };
}

/** Option buttons row ([id, label, icon]) wired to a handler; returns { node, buttons, sync(index) }. */
export function optionButtons(options, onSelect) {
  const buttons = options.map(([, label, icon], i) => el('button.sk-listbtn', {
    onclick: (e) => { e.stopPropagation(); onSelect(i); },
    html: `<span class="sk-listbtn-i">${icon}</span><span>${escapeHtml(label)}</span>`,
  }));
  const node = el('div.sk-list.sk-list-row', {}, buttons);
  return { node, buttons, sync: (index) => buttons.forEach((b, i) => b.classList.toggle('sk-sel', i === index)) };
}
