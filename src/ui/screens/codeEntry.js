/**
 * code-entry — "Type a code": the 4 big letters of a friend's room on a chunky letter grid
 * (NETWORKING.md §10.1). Controller: the arrows move, A presses a letter, B erases. Keyboard: just type
 * the letters (Backspace erases, pasting a code or an invite link works too). Mouse: click the letters.
 * The 4th letter joins right away — no extra press.
 * Logic: codeEntryReduce in src/net/session/roomCode.js.
 *
 * Params: { returnTo?, prefill?: string }.
 * OWNER: online session & screens.
 */
import './online.css';
import { el, hint, kbd, floatiesLayer } from '../dom.js';
import { hintsBar, backButton, shake } from './_shared.js';
import {
  createCodeEntryState, codeEntryReduce, CODE_KEYS, CODE_LENGTH,
} from '../../net/session/roomCode.js';
import { parseInviteCode } from '../../net/session/inviteLink.js';
import { TEXT } from '../../net/session/texts.js';

/** Ignore keyboard menu events this long after a typed key (WASD / Backspace are menu keys too). */
export const TYPING_SUPPRESS_S = 0.25;

/** keydown → a code-entry typing event (or null). Pure. */
export function keyToTyping(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === 'Backspace') return { action: 'erase' };
  if (typeof e.key === 'string' && /^[a-z]$/i.test(e.key)) return { action: 'type', text: e.key };
  return null;
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'code-entry',
  mount(ctx, nav, params = {}) {
    let state = createCodeEntryState(params.prefill ?? '');
    let typedAt = -Infinity;
    let joining = false;
    const msg = el('div.skn-msg', { role: 'status' });

    const slots = Array.from({ length: CODE_LENGTH }, () => el('span.skn-slot'));
    const slotRow = el('div.skn-slots', { 'aria-label': 'room code' }, slots);
    const keys = CODE_KEYS.map((k, i) => el(`button.skn-key${k === 'erase' ? '.skn-key-erase' : ''}`, {
      'aria-label': k === 'erase' ? 'erase' : k,
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'press', index: i }); },
    }, k === 'erase' ? '⌫' : k));
    const grid = el('div.skn-keys', {}, keys);

    const node = el('div.sk-screen.skn-screen.skn-codeentry', {},
      floatiesLayer(12, 33),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Type a code <span class="sk-wiggle">🔤</span>' })),
      el('div.skn-lead', {}, TEXT.codeHelp),
      slotRow,
      msg,
      grid,
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Move</span></span>`,
        hint('A', 'Enter', 'Press'),
        hint('B', 'Esc', 'Erase'),
        `<span class="sk-hint">${kbd('A–Z')}<span class="sk-hint-t">Type it</span></span>`,
      ]),
    );

    const sync = () => {
      slots.forEach((sl, k) => {
        const ch = state.letters[k];
        sl.textContent = ch ?? '';
        sl.classList.toggle('on', ch !== undefined);
        sl.classList.toggle('next', k === state.letters.length);
      });
      keys.forEach((b, i) => b.classList.toggle('sk-sel', i === state.cursor));
    };

    const handle = (ev) => {
      if (joining) return;
      if (String(ev.deviceId ?? '').startsWith('kb') && (ctx.time ?? 0) - typedAt < TYPING_SUPPRESS_S) return;
      const res = codeEntryReduce(state, ev, { parseInvite: parseInviteCode });
      state = res.state;
      ctx.fx(res);
      sync();
      if (res.shake) shake(slotRow);
      if (res.go === 'back') nav.goto(params.returnTo ?? 'online-hub');
      else if (res.go === 'join' && res.code) {
        if (ctx.online?.join) { joining = true; msg.textContent = `${TEXT.knocking} ${res.code}`; ctx.online.join(res.code); }
        else msg.textContent = TEXT.comingSoon;
      }
    };

    // Keyboard typing + paste (letters / Backspace; a pasted code or invite link).
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
