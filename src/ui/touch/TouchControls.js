/**
 * TouchControls — the on-screen race controls overlay (DOM). Logic lives in pure modules:
 * layout = src/input/touch/touchLayout.js, pointers = src/input/touch/pointerRouter.js,
 * the device = src/input/touch/TouchDevice.js.
 *
 *   const tc = new TouchControls({ root: uiRoot, touch });   // touch = installTouchInput(...)
 *   tc.show([{ deviceId: 'touch1', playerIndex: 0 }]);       // race start, touch players only
 *   tc.update(dt, session);                                  // every race frame (item icons, pause hide)
 *   tc.hide();                                               // race exit
 *   tc.getTouchSafeRects()                                   // [{ id, player, x, y, w, h }] for the HUD
 *
 * HUD seam (phase-2 responsive UI): while visible, the overlay
 *   - adds `sk-touch-on` (+ `sk-touch-2p` for two touch players) to the #ui root,
 *   - sets CSS vars on #ui: --sk-touch-bottom (px the bottom controls rise from the bottom edge),
 *     --sk-touch-left / --sk-touch-right (px they reach in from the sides),
 *   - dispatches `sk-touch-layout` on window with detail { visible, rects } after every layout.
 */
import './touchControls.css';
import { computeTouchLayout, touchSafeRects } from '../../input/touch/touchLayout.js';
import { TouchPointerRouter } from '../../input/touch/pointerRouter.js';
import { itemSlotView } from '../widgets/itemHudLogic.js';

const ICONS = { gas: '🚀', brake: '🐢', drift: '🌀', pause: '⏸', left: '◀', right: '▶', recenter: '🎯', item: '' };
const LABELS = { gas: 'GO', brake: 'SLOW', drift: 'HOP', item: 'ITEM', pause: '', left: '', right: '', recenter: 'LEVEL' };

/** Read env(safe-area-inset-*) through a hidden probe element (0s where unsupported). */
export function readSafeArea(doc = typeof document !== 'undefined' ? document : null) {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  if (!doc?.body || typeof getComputedStyle !== 'function') return zero;
  const p = doc.createElement('div');
  p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;'
    + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
  doc.body.appendChild(p);
  const cs = getComputedStyle(p);
  const px = (v) => parseFloat(v) || 0;
  const out = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
  p.remove();
  return out;
}

export class TouchControls {
  constructor({ root, touch, win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null } = {}) {
    this.root = root;
    this.touch = touch;
    this.win = win;
    this.doc = doc;
    this.players = [];
    this.visible = false;
    this.layout = null;
    this.router = new TouchPointerRouter({
      onRecenter: () => {
        const t = this.touch;
        if (t.tiltState !== 'on') t.enableTilt?.().then(() => t.calibrateTilt?.());
        else t.calibrateTilt?.();
      },
    });
    this.el = null;
    this._sets = [];
    this._itemSig = [];
    this._onResize = () => { if (this.visible) this.relayout(); };
    this._unsubStore = touch?.store?.subscribe?.(() => { if (this.visible) this.relayout(); }) ?? null;
  }

  _build() {
    if (this.el || !this.doc) return;
    const el = this.doc.createElement('div');
    el.className = 'sk-touch';
    el.setAttribute('aria-hidden', 'true');
    el.hidden = true;
    const t = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const pt = (e) => {
      const r = el.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      return [e.clientX - r.left, e.clientY - r.top];
    };
    el.addEventListener('pointerdown', (e) => {
      const [x, y] = pt(e);
      const got = this.router.down(e.pointerId, x, y, t());
      if (got) {
        e.preventDefault?.();
        try { el.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
      }
      this.render();
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.router.owners.has(e.pointerId)) return;
      const [x, y] = pt(e);
      this.router.move(e.pointerId, x, y);
      this.render();
    });
    const end = (e) => { this.router.up(e.pointerId); this.render(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault?.());
    this.root.appendChild(el);
    this.el = el;
  }

  /** Mount for these touch players (order = zone order). Non-touch players are ignored. */
  show(players = []) {
    const list = players
      .filter((p) => this.touch?.isTouchDevice?.(p.deviceId))
      .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
    this.players = list;
    if (!list.length) { this.hide(); return false; }
    this._build();
    if (!this.el) return false;
    this.visible = true;
    this.el.hidden = false;
    this.win?.addEventListener?.('resize', this._onResize);
    this.win?.addEventListener?.('orientationchange', this._onResize);
    this.relayout();
    return true;
  }

  hide() {
    const was = this.visible;
    this.visible = false;
    this.router.cancelAll();
    if (this.el) this.el.hidden = true;
    this.win?.removeEventListener?.('resize', this._onResize);
    this.win?.removeEventListener?.('orientationchange', this._onResize);
    this.root?.classList?.remove('sk-touch-on', 'sk-touch-2p', 'sk-touch-paused');
    if (was) this._announce();
  }

  /** Temporarily hide (pause menu / results) without forgetting the players. */
  setSuspended(on) {
    if (!this.el || !this.visible) return;
    const want = !!on;
    if (want === this.el.classList.contains('sk-touch-suspended')) return;
    this.el.classList.toggle('sk-touch-suspended', want);
    this.root?.classList?.toggle('sk-touch-paused', want);
    if (want) this.router.cancelAll();
    this.render();
  }

  relayout() {
    if (!this.el) return;
    const W = this.win?.innerWidth || this.root?.clientWidth || 800;
    const H = this.win?.innerHeight || this.root?.clientHeight || 450;
    const settings = this.touch.store.get();
    const n = Math.min(2, this.players.length);
    this.layout = computeTouchLayout({ width: W, height: H, safe: readSafeArea(this.doc), settings, players: n });
    const routed = this.players.slice(0, n).map((p) => ({ deviceId: p.deviceId, device: this.touch.device(p.deviceId) }));
    this.router.setLayout(this.layout, routed);
    this.el.style.setProperty('--sk-touch-opacity', String(settings.opacity));
    this._draw();
    const cls = this.root?.classList;
    cls?.add('sk-touch-on');
    cls?.toggle('sk-touch-2p', n > 1);
    // how far the controls reach in from the edges, for the HUD to move out of the way
    let bottom = 0, left = 0, right = 0;
    for (const r of touchSafeRects(this.layout)) {
      if (r.id === 'pause') continue;
      bottom = Math.max(bottom, H - r.y);
      if (r.x + r.w / 2 < W / 2) left = Math.max(left, r.x + r.w); else right = Math.max(right, W - r.x);
    }
    const st = this.root?.style;
    st?.setProperty?.('--sk-touch-bottom', `${Math.round(bottom)}px`);
    st?.setProperty?.('--sk-touch-left', `${Math.round(left)}px`);
    st?.setProperty?.('--sk-touch-right', `${Math.round(right)}px`);
    this._announce();
  }

  _announce() {
    try {
      const Ev = this.win?.CustomEvent;
      if (Ev) this.win.dispatchEvent(new Ev('sk-touch-layout', { detail: { visible: this.visible, rects: this.getTouchSafeRects() } }));
    } catch { /* ignore */ }
  }

  _draw() {
    const doc = this.doc;
    this.el.innerHTML = '';
    this._sets = [];
    this._itemSig = [];
    this.layout.players.forEach((set, si) => {
      const wrap = doc.createElement('div');
      wrap.className = `sk-touch-set sk-touch-set-${si}`;
      const nodes = new Map();
      for (const c of set.controls) {
        const n = doc.createElement('div');
        n.className = `sk-tc sk-tc-${c.id}${c.kind === 'stick' ? ' sk-tc-stickbase' : ''}`;
        Object.assign(n.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
        n.dataset.control = c.id;
        if (c.kind === 'stick') {
          const knob = doc.createElement('div');
          knob.className = 'sk-tc-knob';
          Object.assign(knob.style, { width: `${c.knobR * 2}px`, height: `${c.knobR * 2}px` });
          n.appendChild(knob);
          n._knob = knob;
          n._rest = { x: c.x, y: c.y, r: c.r };
        } else {
          const icon = ICONS[c.id] ?? '';
          const label = LABELS[c.id] ?? '';
          n.innerHTML = `<span class="sk-tc-i">${icon}</span>${label ? `<span class="sk-tc-l">${label}</span>` : ''}`;
        }
        wrap.appendChild(n);
        nodes.set(c.id, n);
      }
      this.el.appendChild(wrap);
      this._sets.push({ wrap, nodes });
    });
    this.render();
  }

  /** Reflect pressed states + the floating stick. */
  render() {
    if (!this.el || !this._sets.length) return;
    const views = this.router.view();
    views.forEach((v, si) => {
      const s = this._sets[si];
      if (!s) return;
      for (const [id, n] of s.nodes) n.classList.toggle('sk-tc-on', v.pressed.has(id));
      const base = s.nodes.get('stick');
      if (base) {
        const rest = base._rest;
        if (v.stick.active) {
          base.style.left = `${v.stick.origin.x - rest.r}px`;
          base.style.top = `${v.stick.origin.y - rest.r}px`;
          base._knob.style.transform = `translate(calc(-50% + ${(v.stick.thumb.x - v.stick.origin.x).toFixed(1)}px), calc(-50% + ${(v.stick.thumb.y - v.stick.origin.y).toFixed(1)}px))`;
          base.classList.add('sk-tc-on');
        } else {
          base.style.left = `${rest.x}px`;
          base.style.top = `${rest.y}px`;
          base._knob.style.transform = 'translate(-50%, -50%)';
          base.classList.remove('sk-tc-on');
        }
      }
    });
  }

  /** Per race frame: item icons on the ITEM buttons; hide while paused / on results. */
  update(dt, session) {
    if (!this.visible || !this.el) return;
    this.setSuspended(!!(session?.paused || session?.resultsShown));
    const race = session?.race;
    this.players.slice(0, this._sets.length).forEach((p, si) => {
      const item = this._sets[si]?.nodes.get('item');
      if (!item || !race?.getPlayerKart) return;
      let view;
      try { view = itemSlotView(race.getPlayerKart(p.playerIndex)); } catch { view = null; }
      const sig = view ? `${view.state}:${view.emoji}` : 'none';
      if (sig === this._itemSig[si]) return;
      this._itemSig[si] = sig;
      const has = view && (view.state === 'ready' || view.state === 'rolling');
      item.classList.toggle('sk-tc-has', !!has && view.state === 'ready');
      item.classList.toggle('sk-tc-rolling', view?.state === 'rolling');
      const i = item.querySelector?.('.sk-tc-i');
      if (i) i.textContent = has ? view.emoji : '';
    });
  }

  getTouchSafeRects() {
    return this.visible && this.layout && !this.el?.classList?.contains('sk-touch-suspended') ? touchSafeRects(this.layout) : [];
  }

  dispose() {
    this.hide();
    this._unsubStore?.();
    this.el?.remove();
    this.el = null;
  }
}
