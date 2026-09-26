/**
 * Photo Mode overlay (opened from the pause menu by src/systems/photoMode.js).
 * Shows the chosen frame exactly as it will be saved (drawn with the same
 * drawPhotoFrame() as the PNG), the controls, and a flash + "Saved!" toast.
 * Resolves with 'back'. Logic: src/presentation/photo.js (photoReduce).
 * OWNER: showcase presentation.
 */
import '../../presentation/presentation.css';
import { el, hint, kbd, escapeHtml } from '../dom.js';
import { PHOTO_FRAMES, createPhotoState, photoReduce, drawPhotoFrame } from '../../presentation/photo.js';

/** @type {import('./index.js').ScreenDef} */
export default {
  id: 'photo-mode',
  mount(ctx, nav, params = {}) {
    const ctl = params.ctl ?? { state: createPhotoState(), snap() {}, info: {} };
    if (!ctl.state) ctl.state = createPhotoState();
    const preview = el('canvas.skx-photo-preview');
    const frameChip = el('div.skx-photo-chip');
    const toast = el('div.skx-photo-toast');
    const flash = el('div.skx-photo-snapflash');

    const drawPreview = () => {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (preview.width !== Math.round(w * dpr) || preview.height !== Math.round(h * dpr)) {
        preview.width = Math.round(w * dpr);
        preview.height = Math.round(h * dpr);
      }
      const g = preview.getContext?.('2d');
      if (!g) return;
      g.clearRect(0, 0, preview.width, preview.height);
      drawPhotoFrame(g, preview.width, preview.height, ctl.state.frame, ctl.info ?? {});
      const f = PHOTO_FRAMES[ctl.state.frame];
      frameChip.innerHTML = `${escapeHtml(f.emoji)} ${escapeHtml(f.label)}`;
    };

    let toastTimer = null;
    ctl.onSaved = (name) => {
      flash.classList.remove('skx-go');
      void flash.offsetWidth;
      flash.classList.add('skx-go');
      toast.textContent = name ? '📸 Saved! Look in your downloads' : '📸 Snap!';
      toast.classList.add('skx-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('skx-on'), 2200);
    };

    const handle = (ev) => {
      const res = photoReduce(ctl.state, ev);
      ctl.state = res.state;
      ctx.fx(res);
      if (res.snap) { try { ctl.snap(); } catch (err) { console.warn('[photo] snap', err); } }
      drawPreview();
      if (res.go === 'back') nav.resolve('back');
    };

    const hints = el('div.sk-hints.skx-photo-hints', {
      html: `<span class="sk-hint"><span class="sk-g sk-g-dpad">✚</span>${kbd('Arrows')}<span class="sk-hint-t">Move camera</span></span>`
        + hint('Y', 'Tab', 'Frame')
        + hint('A', 'Enter', 'Snap!')
        + hint('B', 'Esc', 'Done'),
    });
    const node = el('div.sk-screen.skx-photo', {},
      preview,
      flash,
      el('div.skx-photo-top', {}, el('div.skx-photo-title', { html: '📸 Photo mode' }), frameChip),
      hints,
      toast,
    );
    const onResize = () => drawPreview();
    window.addEventListener('resize', onResize);
    drawPreview();
    return {
      node,
      cls: 'skx-mode-photo',
      handle,
      destroy() { window.removeEventListener('resize', onResize); clearTimeout(toastTimer); ctl.onSaved = null; },
    };
  },
};
