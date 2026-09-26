/**
 * "Touch controls" — a title-screen menu entry that shows on phones / tablets (or after a
 * first touch): steering style (thumb stick / ◀ ▶ buttons / tilt), auto-gas, button size,
 * left-handed swap, two touch players on one tablet, buzz, and "straighten tilt".
 * Works with taps and controllers alike. Logic: src/input/touch/touchSettingsState.js;
 * values live in src/input/touch/touchSettings.js (localStorage). Reuses the Grown-ups
 * corner row look (progress.css) so a restyle of that screen restyles this one.
 * OWNER: touch controls (src/input/touch/README.md).
 */
import './progress.css';
import { el, escapeHtml, hint, kbd } from '../dom.js';
import { hintsBar, backButton } from './_shared.js';
import { createTouchSettingsState, touchSettingsReduce, TOUCH_ROW_TEXT, rowValueText } from '../../input/touch/touchSettingsState.js';
import { getTouchRuntime, touchUiWanted } from '../../input/touch/touchRuntime.js';

/** Apply a reducer result's effects to the live runtime (pure enough to test with fakes). */
export function applyTouchSettingsResult(rt, res) {
  if (!rt?.touch) return;
  if (res.patch) rt.touch.store.set(res.patch);
  if (res.effect === 'tilt') rt.touch.enableTilt?.();
  if (res.effect === 'calibrate') {
    const t = rt.touch;
    if (t.tiltState !== 'on') t.enableTilt?.().then(() => t.calibrateTilt?.());
    else t.calibrateTilt?.();
  }
}

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'touch-settings',
  menuEntry: { label: 'Touch', emoji: '👆', order: 85, when: () => touchUiWanted() },
  mount(ctx, nav, params = {}) {
    const rt = getTouchRuntime();
    let state = createTouchSettingsState(rt?.touch?.store?.get?.() ?? {});
    const leave = () => nav.goto(params.returnTo ?? 'title');
    const list = el('div.skp-set-list.sk-touchset-list', {});
    let rowEls = [];

    const pill = (on) => `<span class="skp-toggle ${on ? 'on' : ''}"><i></i><b>${on ? 'ON' : 'OFF'}</b></span>`;
    const chip = (text) => `<span class="skp-vol"><i class="skp-step" data-step="-1">◀</i><b>${escapeHtml(text)}</b><i class="skp-step" data-step="1">▶</i></span>`;
    const tiltNote = () => {
      const ts = rt?.touch?.tiltState;
      if (ts === 'denied') return ' (tilt was not allowed: try again or pick another style)';
      if (ts === 'unsupported') return ' (this device cannot tilt-steer)';
      return '';
    };

    const build = () => {
      rowEls = state.rows.map((key, i) => el(`button.skp-set-row.skp-set-${key}`, {
        onclick: (e) => {
          e.stopPropagation();
          const step = e.target.closest?.('[data-step]')?.dataset.step;
          if (step) {
            ctx.setCooldown?.(0);
            state = { ...state, index: i };
            handle({ deviceId: 'mouse', action: Number(step) < 0 ? 'left' : 'right' });
          } else handle({ deviceId: 'mouse', action: 'select', index: i });
        },
      }));
      list.innerHTML = '';
      rowEls.forEach((r) => list.appendChild(r));
    };

    const render = () => {
      if (rowEls.length !== state.rows.length) build();
      state.rows.forEach((key, i) => {
        const [emoji, title, help] = TOUCH_ROW_TEXT[key];
        const v = rowValueText(state.settings, key);
        let ctl = '';
        if (key === 'style' || key === 'size') ctl = chip(v);
        else if (v) ctl = pill(v === 'ON');
        const extra = key === 'style' && state.settings.style === 'tilt' ? tiltNote() : '';
        rowEls[i].innerHTML = `<span class="skp-set-e">${emoji}</span><span class="skp-set-t">${escapeHtml(title)}${help || extra ? `<small>${escapeHtml(help + extra)}</small>` : ''}</span>${ctl}`;
        rowEls[i].classList.toggle('sk-sel', i === state.index);
      });
    };

    const handle = (ev) => {
      const res = touchSettingsReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      applyTouchSettingsResult(rt, res);
      render();
      if (res.go === 'back') leave();
    };

    const node = el('div.sk-screen.skp-settings.sk-touch-settings', {},
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Touch controls <span class="sk-wiggle">👆</span>' })),
      list,
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose / change</span></span>`,
        hint('A', 'Enter', 'OK'),
        hint('B', 'Esc', 'Back'),
      ]),
    );
    build();
    render();
    return { node, cls: 'sk-mode-full skp-mode-settings', handle, refresh: render };
  },
};
