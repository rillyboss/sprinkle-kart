/**
 * "Grown-ups corner" — Settings (a title-screen menu entry): music / sound
 * volume, Kid-Assist for new players, "Unlock everything" and "Start a fresh
 * Sticker Book" (reset progress). The last two sit behind a simple parent
 * gate (an addition question answered with the d-pad). Everything works with
 * a controller: Up/Down pick a row, Left/Right change it, A acts, B goes back.
 * Logic: src/progress/screenState.js (settingsReduce / gateReduce).
 * OWNER: progression/unlocks workstream.
 */
import './progress.css';
import './settingsOnline.css';
import { el, escapeHtml, hint, glyph, kbd, floatiesLayer } from '../dom.js';
import { hintsBar, backButton, shake } from './_shared.js';
import { createSettingsState, settingsReduce, VOLUME_STEPS, GATE_TRIES } from '../../progress/screenState.js';
import { TEXT } from '../../net/session/texts.js';

/** Row labels: [emoji, title, helper]. */
export const ROWS = {
  music: ['🎵', 'Music', 'Bouncy tunes'],
  sfx: ['🔔', 'Sounds', 'Boings, bonks and sparkles'],
  kidAssist: ['✨', 'Kid-Assist for new players', 'Always full gas + extra steering help'],
  unlockAll: ['🎁', 'Unlock everything', 'Every racer and track, right away'],
  reset: ['🧹', 'Start a fresh Sticker Book', 'Clears stickers, trophies and totals'],
  online: ['🌐', 'Online play with friends', 'Race friends in other houses with a secret room code'],
  approvalGate: ['🚪', 'Only a grown-up can let houses in', 'Saying yes to a new house needs the grown-up question'],
  relayOnly: ['🛟', 'Use the relay for game traffic', TEXT.relayHint],
  back: ['🏠', 'Back', ''],
};

/** Is our own relay (the Worker build) available? (NETWORKING.md §1 rule 6: the relay row shows only then.) */
export function relayAvailable() {
  try { return !!import.meta.env?.VITE_SIGNAL_URL; } catch { return false; }
}

/** Apply reducer effects to the saved settings / progress / audio. */
export function applySettingsEffects(ctx, effects = []) {
  const pr = ctx.progress;
  for (const e of effects) {
    try {
      if (e.type === 'volume') {
        pr?.setSettings?.({ music: e.music, sfx: e.sfx });
        ctx.audio?.setVolume?.({ music: e.music, sfx: e.sfx });
      } else if (e.type === 'kidAssist') pr?.setSettings?.({ kidAssistDefault: !!e.on });
      else if (e.type === 'online') pr?.setSettings?.({ onlineEnabled: !!e.on });
      else if (e.type === 'approvalGate') pr?.setSettings?.({ approvalGate: !!e.on });
      else if (e.type === 'relayOnly') pr?.setSettings?.({ relayOnly: !!e.on });
      else if (e.type === 'unlockAll') pr?.setUnlockAll?.(!!e.on);
      else if (e.type === 'reset') pr?.resetProgress?.({ keepSettings: true });
    } catch (err) { console.warn('[settings] could not apply', e.type, err); }
  }
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'settings',
  menuEntry: { label: 'Grown-ups', emoji: '⚙️', order: 90 },
  mount(ctx, nav, params = {}) {
    let saved = {};
    let unlockAll = false;
    try {
      saved = ctx.progress?.getSettings?.() ?? {};
      unlockAll = !!ctx.progress?.loadProgress?.()?.unlockAll;
    } catch { /* ignore */ }
    let state = createSettingsState(saved, unlockAll, { online: { relayAvailable: params.relayAvailable ?? relayAvailable() } });
    const leave = () => nav.goto(params.returnTo ?? 'title');
    const SETTINGS_ROWS = state.rows;
    const gridRows = Math.ceil((SETTINGS_ROWS.length - 1) / 2);

    const rowEls = SETTINGS_ROWS.map((key, i) => el(`button.skp-set-row.skp-set-${key}`, {
      style: key === 'back' && SETTINGS_ROWS.length > 6 ? { gridRow: String(gridRows + 1) } : null,
      onclick: (e) => {
        e.stopPropagation();
        const step = e.target.closest('[data-step]')?.dataset.step;
        if (step && (key === 'music' || key === 'sfx')) handle({ deviceId: 'mouse', action: 'set', key, value: state[key] + Number(step) });
        else if (key !== 'music' && key !== 'sfx') handle({ deviceId: 'mouse', action: 'select', index: i });
      },
    }));
    const modal = el('div.skp-modal', { hidden: true, onclick: (e) => e.stopPropagation() });

    const volHtml = (v) => `<span class="skp-vol"><i class="skp-step" data-step="-1">◀</i><span class="skp-pips">${
      Array.from({ length: VOLUME_STEPS }, (_, j) => `<i class="${j < v ? 'on' : ''}" style="--j:${j}"></i>`).join('')
    }</span><i class="skp-step" data-step="1">▶</i><b>${v === 0 ? 'shh!' : v * 10}</b></span>`;
    const pill = (on, onText = 'ON', offText = 'OFF') => `<span class="skp-toggle ${on ? 'on' : ''}"><i></i><b>${on ? onText : offText}</b></span>`;

    const renderRows = () => {
      SETTINGS_ROWS.forEach((key, i) => {
        const [emoji, title, help] = ROWS[key];
        let ctl = '';
        if (key === 'music' || key === 'sfx') ctl = volHtml(state[key]);
        else if (key === 'kidAssist') ctl = pill(state.kidAssist);
        else if (key === 'unlockAll') ctl = state.unlockAll ? pill(true, 'ALL OPEN') : '<span class="skp-lockchip">🔒 Grown-ups only</span>';
        else if (key === 'reset') ctl = '<span class="skp-lockchip">🔒 Grown-ups only</span>';
        else if (key === 'online') ctl = state.online ? pill(true) : '<span class="skp-lockchip">🔒 Grown-ups only</span>';
        else if (key === 'approvalGate' || key === 'relayOnly') ctl = pill(state[key]);
        rowEls[i].innerHTML = `<span class="skp-set-e">${emoji}</span><span class="skp-set-t">${escapeHtml(title)}${help ? `<small>${escapeHtml(help)}</small>` : ''}</span>${ctl}`;
        rowEls[i].classList.toggle('sk-sel', i === state.row && !state.modal);
      });
    };

    const renderModal = () => {
      modal.hidden = !state.modal;
      if (!state.modal) { modal.innerHTML = ''; return; }
      if (state.modal === 'gate') {
        const g = state.gate;
        const tries = Array.from({ length: GATE_TRIES }, (_, i) => `<i class="${i < g.tries ? 'used' : ''}"></i>`).join('');
        modal.innerHTML = '<div class="skp-card skp-gate">'
          + '<div class="skp-gate-k">Grown-ups only! 🧁</div>'
          + `<div class="skp-gate-q">What is <b>${g.a}</b> + <b>${g.b}</b>?</div>`
          + '<div class="skp-dial"><button class="skp-dial-b" data-d="1">▲</button>'
          + `<div class="skp-dial-v">${g.value}</div><button class="skp-dial-b" data-d="-1">▼</button></div>`
          + `<div class="skp-gate-oops">${g.tries ? 'Hmm, not quite! Try again 🙈' : ''}</div>`
          + `<div class="skp-gate-tries">${tries}</div>`
          + `<div class="skp-gate-h"><span class="sk-g sk-g-dpad">✚</span> pick the number · ${glyph('A')} answer · ${glyph('B')} never mind</div>`
          + '<div class="skp-gate-kids">Little racers: ask a grown-up to help! 💖</div>'
          + '</div>';
        modal.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', (e) => {
          e.stopPropagation();
          handle({ deviceId: 'mouse', action: Number(b.dataset.d) > 0 ? 'up' : 'down' });
        }));
        modal.querySelector('.skp-dial-v').addEventListener('click', (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'confirm' }); });
      } else if (state.modal === 'confirm-reset') {
        modal.innerHTML = '<div class="skp-card skp-confirm">'
          + '<div class="skp-gate-k">Start a brand-new Sticker Book? 📒</div>'
          + '<div class="skp-confirm-t">All stickers, trophies and totals go away. Volumes stay the same.</div>'
          + '<div class="skp-confirm-b">'
          + `<button class="skp-btn ${state.confirmIndex === 0 ? 'sk-sel' : ''}" data-i="0">💖 Keep it!</button>`
          + `<button class="skp-btn skp-btn-warn ${state.confirmIndex === 1 ? 'sk-sel' : ''}" data-i="1">🧹 Reset</button>`
          + '</div></div>';
        modal.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', (e) => {
          e.stopPropagation();
          handle({ deviceId: 'mouse', action: 'select', index: Number(b.dataset.i) });
        }));
      } else if (state.modal === 'privacy') {
        modal.innerHTML = '<div class="skp-card skp-confirm skn-privacy">'
          + '<div class="skp-gate-k">Online play with friends 🌐</div>'
          + `<div class="skp-confirm-t skn-privacy-t">${escapeHtml(TEXT.privacy)}</div>`
          + '<div class="skp-confirm-b">'
          + `<button class="skp-btn ${state.confirmIndex === 0 ? 'sk-sel' : ''}" data-i="0">🌐 ${escapeHtml(TEXT.privacyOk)}</button>`
          + `<button class="skp-btn ${state.confirmIndex === 1 ? 'sk-sel' : ''}" data-i="1">💖 ${escapeHtml(TEXT.privacyNo)}</button>`
          + '</div></div>';
        modal.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', (e) => {
          e.stopPropagation();
          handle({ deviceId: 'mouse', action: 'select', index: Number(b.dataset.i) });
        }));
      } else if (state.modal === 'done' && state.gateFor === 'online') {
        modal.innerHTML = '<div class="skp-card skp-done"><div class="skp-done-e">🌐🎉</div>'
          + '<div class="skp-gate-k">Online play is on!</div>'
          + '<div class="skp-confirm-t">Find "Online" on the title screen. Only friends with your secret room code can ask to join 💖</div>'
          + `<div class="sk-press">Press ${glyph('A')} or ${kbd('Enter')}</div></div>`;
        modal.firstChild.addEventListener('click', (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'confirm' }); });
      } else if (state.modal === 'done') {
        const all = state.gateFor === 'unlockAll';
        modal.innerHTML = `<div class="skp-card skp-done">${all ? '<div class="skp-done-e">🎁🎉</div>' : '<div class="skp-done-e">📒✨</div>'}`
          + `<div class="skp-gate-k">${all ? 'Every racer and track is open!' : 'A fresh new Sticker Book!'}</div>`
          + `<div class="skp-confirm-t">${all ? 'Have fun trying them all! 💖' : 'Time to fill it with new stickers! 🍭'}</div>`
          + `<div class="sk-press">Press ${glyph('A')} or ${kbd('Enter')}</div></div>`;
        modal.firstChild.addEventListener('click', (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'confirm' }); });
      }
    };

    const node = el('div.sk-screen.skp-settings', {},
      floatiesLayer(14, 41),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Grown-ups corner <span class="sk-wiggle">⚙️</span>' })),
      el(`div.skp-set-list${SETTINGS_ROWS.length > 6 ? '.skn-many' : ''}`, { '--rows': String(gridRows) }, rowEls),
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose / change</span></span>`,
        hint('A', 'Enter', 'OK'),
        hint('B', 'Esc', 'Back'),
      ]),
      modal,
    );

    let lastModal = null;
    const sync = () => {
      renderRows();
      if (state.modal !== lastModal || state.modal) renderModal();
      lastModal = state.modal;
    };

    const handle = (ev) => {
      const res = settingsReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      applySettingsEffects(ctx, res.effects);
      sync();
      if (res.shake) shake(modal.querySelector('.skp-card'));
      if (res.go === 'back') leave();
    };

    sync();
    return { node, cls: 'sk-mode-full skp-mode-settings', handle };
  },
};
