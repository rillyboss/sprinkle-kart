/**
 * "✨ Effects & comfort" — a title-screen menu entry for how much sparkle the
 * game shows: gentle motion (reduced motion), screen wobble, speech bubbles,
 * weather, the title-screen show and colour-friendly player shapes.
 * Up/Down pick a row, Left/Right/A change it, B goes back.
 * Logic: src/presentation/effectsMenu.js (pure) + src/presentation/prefs.js (saved).
 * OWNER: showcase presentation.
 */
import './progress.css';
import '../../presentation/presentation.css';
import { el, escapeHtml, hint, kbd, floatiesLayer } from '../dom.js';
import { hintsBar, backButton } from './_shared.js';
import { prefs as sharedPrefs } from '../../presentation/prefs.js';
import { EFFECTS_ROWS, createEffectsState, effectsReduce } from '../../presentation/effectsMenu.js';

/** Row labels: [emoji, title, helper]. */
export const EFFECT_ROW_LABELS = {
  motion: ['🌈', 'Motion', 'Gentle = calmer cameras, fewer wiggles and sparkles'],
  shake: ['📳', 'Screen wobble', 'A tiny wiggle when you get bonked'],
  bubbles: ['💬', 'Racer chatter', 'Speech bubbles when racers zoom past or giggle'],
  weather: ['❄️', 'Weather & sparkles', 'Sprinkle-snow, bubbles, petals and fireflies'],
  attract: ['🎬', 'Title show', 'Karts racing behind the title screen'],
  colorAssist: ['🔷', 'Colour-friendly shapes', 'Each player also gets a shape: ♥ ★ ◆ ●'],
  back: ['🏠', 'Back', ''],
};

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'effects',
  menuEntry: { label: 'Effects', emoji: '✨', order: 95 },
  mount(ctx, nav, params = {}) {
    const store = params.store ?? sharedPrefs;
    let state = createEffectsState(store.get());
    const leave = () => nav.goto(params.returnTo ?? 'title');

    const rowEls = EFFECTS_ROWS.map((key, i) => el(`button.skp-set-row.skx-eff-row.skx-eff-${key}${key === 'back' ? '.skp-set-back' : ''}`, {
      onclick: (e) => { e.stopPropagation(); handle({ deviceId: 'mouse', action: 'select', index: i }); },
    }));
    const pill = (on, onText = 'ON', offText = 'OFF') => `<span class="skp-toggle ${on ? 'on' : ''}"><i></i><b>${onText && on ? onText : offText}</b></span>`;

    const render = () => {
      EFFECTS_ROWS.forEach((key, i) => {
        const [emoji, title, help] = EFFECT_ROW_LABELS[key];
        let ctl = '';
        if (key === 'motion') {
          const gentle = state.prefs.motion === 'gentle';
          ctl = `<span class="skx-seg"><b class="${gentle ? '' : 'on'}">✨ Full</b><b class="${gentle ? 'on' : ''}">🍃 Gentle</b></span>`;
        } else if (key !== 'back') ctl = pill(!!state.prefs[key]);
        rowEls[i].innerHTML = `<span class="skp-set-e">${emoji}</span><span class="skp-set-t">${escapeHtml(title)}${help ? `<small>${escapeHtml(help)}</small>` : ''}</span>${ctl}`;
        rowEls[i].classList.toggle('sk-sel', i === state.row);
      });
    };

    const handle = (ev) => {
      const res = effectsReduce(state, ev);
      state = res.state;
      ctx.fx(res);
      if (res.patch) {
        try { state = { ...state, prefs: store.set(res.patch) }; } catch (err) { console.warn('[effects] could not save', err); }
      }
      render();
      if (res.go === 'back') leave();
    };

    const node = el('div.sk-screen.skp-settings.skx-effects', {},
      floatiesLayer(14, 53),
      el('div.sk-header', {},
        backButton(() => handle({ deviceId: 'mouse', action: 'back' })),
        el('h1.sk-h1', { html: 'Effects &amp; comfort <span class="sk-wiggle">✨</span>' })),
      el('div.skp-set-list', {}, rowEls),
      hintsBar([
        `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Choose / change</span></span>`,
        hint('A', 'Enter', 'Change'),
        hint('B', 'Esc', 'Back'),
      ]),
    );
    render();
    return { node, cls: 'sk-mode-full skx-mode-effects', handle, refresh: render };
  },
};
