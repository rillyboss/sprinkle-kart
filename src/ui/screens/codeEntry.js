/**
 * code-entry — "Join a friend": the room label on a word wheel + 4 digit wheels,
 * then 6 secret sweets from an 8 × 8 grid (NETWORKING.md §1 rule 2, §10.1).
 * Works with only a controller; on a keyboard letters search the word list,
 * digits fill the wheels, Backspace removes the last sweet, and pasting a code
 * or a whole invite link fills everything in. Nothing typed is ever sent
 * anywhere: the label + sweets only become the (key-derived) room ids.
 * Logic: codeEntryReduce in src/net/session/roomCode.js.
 *
 * Params: { returnTo?, prefill?: RoomSecret | { label } }.
 * OWNER: WS6 (session, lobby & screens).
 */
import './online.css';
import { el, escapeHtml, hint, kbd, floatiesLayer } from '../dom.js';
import { hintsBar, backButton, shake } from './_shared.js';
import {
  createCodeEntryState, codeEntryReduce, entryLabel, ROOM_WORDS, SECRET_SWEETS, SWEETS_COUNT, LABEL_DIGITS,
} from '../../net/session/roomCode.js';
import { parseInviteFragment } from '../../net/session/inviteLink.js';
import { TEXT } from '../../net/session/texts.js';

/** Ignore keyboard menu events this long after a typed key (WASD / Backspace are menu keys too). */
export const TYPING_SUPPRESS_S = 0.25;

/** keydown → a code-entry typing event (or null). Pure. */
export function keyToTyping(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === 'Backspace') return { action: 'erase' };
  if (typeof e.key === 'string' && /^[a-z0-9]$/i.test(e.key)) return { action: 'type', text: e.key };
  return null;
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'code-entry',
  mount(ctx, nav, params = {}) {
    let state = createCodeEntryState(params.prefill ?? {});
    let typedAt = -Infinity;
    const msg = el('div.skn-msg', { role: 'status' });

    const wordWheel = el('button.skn-wheel.skn-word', { onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'word', value: state.wordIndex + 1 }); } });
    const digitWheels = Array.from({ length: LABEL_DIGITS }, (_, k) => el('button.skn-wheel.skn-digit', {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'set', key: 'digit', col: k + 1, value: state.digits[k] + 1 }); },
    }));
    const pickedEls = Array.from({ length: SWEETS_COUNT }, (_, k) => el('span', { onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'unpick', index: k }); } }));
    const grid = el('div.skn-grid', {}, SECRET_SWEETS.map((s, i) => el('button.skn-sweet', {
      'aria-label': `sweet ${i + 1}`,
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'pick', index: i }); },
    }, s)));
    const sweetEls = [...grid.children];
    const goBtn = el('button.skn-btn.skn-code-go', { onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'focus', focus: 'go' }); handle({ deviceId: 'mouse', action: 'confirm' }); } });

    const node = el('div.sk-screen.skn-screen.skn-codeentry', {},
      floatiesLayer(12, 33),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Join a friend <span class="sk-wiggle">🏡</span>' })),
      el('div.skn-code', {},
        el('div.skn-row-label', {}, '1 · The room code'),
        el('div.skn-wheels', {}, wordWheel, el('span.skn-dash', {}, '-'), ...digitWheels),
        el('div.skn-row-label', {}, `2 · The ${SWEETS_COUNT} secret sweets, in order`),
        el('div.skn-picked', {}, pickedEls),
        grid,
        msg,
        goBtn),
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Spin / move</span></span>`,
        hint('A', 'Enter', 'OK'),
        hint('B', 'Esc', 'Undo'),
        `<span class="sk-hint">${kbd('A-Z 0-9')}<span class="sk-hint-t">Type the code</span></span>`,
      ]),
    );

    const sync = () => {
      const w = ROOM_WORDS[state.wordIndex];
      wordWheel.innerHTML = `<i>▲</i><b>${escapeHtml(w)}</b><i>▼</i>`;
      wordWheel.classList.toggle('sk-sel', state.focus === 'label' && state.col === 0);
      digitWheels.forEach((d, k) => {
        d.innerHTML = `<i>▲</i><b>${state.digits[k]}</b><i>▼</i>`;
        d.classList.toggle('sk-sel', state.focus === 'label' && state.col === k + 1);
      });
      pickedEls.forEach((p, k) => {
        const i = state.picks[k];
        p.textContent = i === undefined ? '' : SECRET_SWEETS[i];
        p.classList.toggle('on', i !== undefined);
      });
      grid.classList.toggle('skn-dim', state.focus === 'label');
      sweetEls.forEach((b, i) => b.classList.toggle('sk-sel', state.focus === 'sweets' && i === state.cursor));
      const ready = state.picks.length === SWEETS_COUNT;
      goBtn.innerHTML = ready ? `🚪 Knock on ${escapeHtml(entryLabel(state))}!` : `Pick ${SWEETS_COUNT - state.picks.length} more sweet${SWEETS_COUNT - state.picks.length === 1 ? '' : 's'} 🍬`;
      goBtn.toggleAttribute?.('disabled', !ready);
      goBtn.classList.toggle('sk-sel', state.focus === 'go');
    };

    const handle = (ev) => {
      if (String(ev.deviceId ?? '').startsWith('kb') && (ctx.time ?? 0) - typedAt < TYPING_SUPPRESS_S) return;
      const res = codeEntryReduce(state, ev, { parseInvite: parseInviteFragment });
      state = res.state;
      ctx.fx(res);
      sync();
      if (res.shake) shake(grid);
      if (res.go === 'back') nav.goto(params.returnTo ?? 'online-hub');
      else if (res.go === 'join' && res.secret) {
        if (ctx.online?.join) ctx.online.join(res.secret);
        else msg.textContent = TEXT.comingSoon;
      }
    };

    // Keyboard typing + paste (letters / digits / Backspace; a pasted code or invite link).
    const doc = typeof document !== 'undefined' ? document : null;
    const onKey = (e) => {
      const t = keyToTyping(e);
      if (!t) return;
      typedAt = ctx.time ?? 0;
      e.preventDefault?.();
      handle({ deviceId: 'typing', ...t });
    };
    const onPaste = (e) => {
      const text = e.clipboardData?.getData?.('text') ?? '';
      if (!text) return;
      typedAt = ctx.time ?? 0;
      handle({ deviceId: 'typing', action: 'paste', text });
    };
    doc?.addEventListener?.('keydown', onKey, true);
    doc?.addEventListener?.('paste', onPaste, true);

    sync();
    return {
      node,
      cls: 'sk-mode-full skn-mode-online',
      handle,
      destroy() {
        doc?.removeEventListener?.('keydown', onKey, true);
        doc?.removeEventListener?.('paste', onPaste, true);
      },
    };
  },
};
