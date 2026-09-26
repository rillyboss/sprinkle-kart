/**
 * Hud — per-viewport race overlays + one shared minimap.
 *
 *   const hud = new Hud(document.getElementById('ui'), { characters });   // characters optional (CPU dot colours)
 *   hud.layout(rects);   // whenever split-screen rects change
 *   hud.update(race, path, { playerIndices: [0, 1], portraits });         // every frame
 *   hud.flash(0, 'Mini-Turbo!');
 *
 * `layout(rects)`: rects = [{ playerIndex, x, y, w, h }] in CSS pixels relative
 * to the top-left of the HUD root (the #ui element, which covers the canvas).
 * y grows DOWNWARD (DOM convention — convert from WebGL's bottom-left viewport
 * origin: y_css = canvasCssHeight - (glY + glH) / dpr). If every value is <= 1 the
 * rects are treated as fractions of the root size instead.
 *
 * The HUD never takes pointer events (pointer-events: none).
 *
 * Extension point: `hud.addWidget({ id, create(vpNode, playerIndex) })` adds a
 * per-player widget from any module (see ./hudWidgets.js) — no edit to this file.
 */
import './ui.css';
import { PLAYER_COLORS } from '../config.js';
import { ensureFont, el, escapeHtml, portraitHtml } from './dom.js';
import {
  ordinal, medalFor, ITEM_ICONS, countdownLabel, lapInfo,
  normalizeRects, hudSides, minimapRect, fitMinimap, cssColor,
} from './hudLogic.js';
import { createWidgetHost } from './hudWidgets.js';
import './widgets/items.css';
import { itemSlotView } from './widgets/itemHudLogic.js';
import { ITEM_CATALOG } from '../race/itemCatalog.js';

/** Flashes ("Mini-Turbo!", "Lap 2!") shown at once per player; a newer one retires the oldest. */
export const MAX_FLASHES = 2;

/**
 * Item slot glyph. One big readable icon per item; Triple Sprinkle shows a
 * "×N" charge badge (pass `pips` = { total, left }).
 */
function itemHtml(id, pips = null) {
  const it = ITEM_ICONS[id];
  if (!it) return '';
  if (it.gumdrop) return '<span class="sk-gumdrop"><i></i></span>';
  const main = `<span class="sk-item-e">${ITEM_CATALOG[id]?.emoji ?? it.emoji}</span>`;
  const extra = it.extra ? `<span class="sk-item-x">${it.extra}</span>` : '';
  // the 3 pips themselves live on the item card under the slot (itemWidgets.js)
  const dots = pips ? `<span class="ski-count">×${pips.left}</span>` : '';
  return `${main}${extra}${dots}`;
}

export class Hud {
  constructor(root, { characters = [] } = {}) {
    ensureFont();
    this.root = root;
    this.characters = characters;
    this.el = el('div.sk-hud', { hidden: true });
    this.vpLayer = el('div.sk-vps');
    this.minimap = el('canvas.sk-minimap');
    this.el.append(this.vpLayer, this.minimap);
    root.appendChild(this.el);
    this.vps = new Map();
    this._mm = { rect: null, key: null, bg: null, fit: null, path: null };
    this._t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.widgets = createWidgetHost();
  }

  /** Add a per-player HUD widget (see ./hudWidgets.js). Returns remove(). */
  addWidget(def) {
    return this.widgets.add(def);
  }

  _now() {
    return ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - this._t0) / 1000;
  }

  _rootSize() {
    const r = this.root.getBoundingClientRect?.();
    return { W: r?.width || window.innerWidth, H: r?.height || window.innerHeight };
  }

  layout(rects) {
    const { W, H } = this._rootSize();
    const list = normalizeRects(rects, W, H);
    const keep = new Set(list.map((r) => r.playerIndex));
    for (const [pi, vp] of this.vps) {
      if (!keep.has(pi)) { this.widgets.detach(pi); vp.node.remove(); this.vps.delete(pi); }
    }
    for (const r of list) {
      let vp = this.vps.get(r.playerIndex);
      if (!vp) {
        vp = this._makeViewport(r.playerIndex);
        this.vps.set(r.playerIndex, vp);
        this.vpLayer.appendChild(vp.node);
        this.widgets.attach(r.playerIndex, vp.node);
      }
      const sides = hudSides(r, W);
      const fs = Math.max(12, Math.min(44, Math.sqrt(r.w * r.h) / 30));
      Object.assign(vp.node.style, {
        left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, fontSize: `${fs.toFixed(1)}px`,
      });
      vp.node.dataset.itemSide = sides.item;
      vp.node.dataset.placeSide = sides.place;
      // 2 players: the shared minimap sits on the divider at the right edge, so
      // the top player's place badge moves up to the (empty) top-right corner.
      vp.node.dataset.placeV = list.length === 2 && r.y <= Math.min(...list.map((q) => q.y)) ? 'top' : 'bottom';
      vp.node.classList.toggle('sk-vp-multi', list.length > 1);
    }
    // Minimap
    const mm = minimapRect(list.length ? list : [{ x: 0, y: 0, w: W, h: H }], W, H);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    Object.assign(this.minimap.style, { left: `${mm.x}px`, top: `${mm.y}px`, width: `${mm.size}px`, height: `${mm.size}px` });
    this.minimap.width = Math.round(mm.size * dpr);
    this.minimap.height = Math.round(mm.size * dpr);
    this._mm.rect = mm;
    this._mm.dpr = dpr;
    this._mm.key = null; // force outline redraw
    this.minimap.classList.toggle('sk-minimap-big', list.length === 3);
  }

  _makeViewport(pi) {
    const color = PLAYER_COLORS[pi] ?? '#ff9ad5';
    const refs = {};
    const node = el('div.sk-vp', { '--pc': color },
      (refs.cluster = el('div.sk-cluster', {},
        el('div.sk-pchip', {}, `P${pi + 1}`),
        (refs.item = el('div.sk-item.ski-slot', {}, (refs.itemInner = el('div.sk-item-inner')))),
        (refs.lap = el('div.sk-lap')))),
      (refs.place = el('div.sk-place', {},
        (refs.placePortrait = el('div.sk-place-portrait')),
        (refs.placeText = el('div.sk-place-text')))),
      (refs.count = el('div.sk-count')),
      (refs.banner = el('div.sk-banner', { html: '<span>🏁 FINAL LAP! 🏁</span>' })),
      (refs.finish = el('div.sk-finish')),
      (refs.wrong = el('div.sk-wrongway', { html: '<span>Oops! Turn around 🔄</span>' })),
      (refs.flashes = el('div.sk-flashes')),
    );
    return { node, refs, pi, cache: {} };
  }

  update(race, path, { playerIndices = null, portraits = null } = {}) {
    if (!race) return;
    const t = this._now();
    const indices = playerIndices ?? [...this.vps.keys()];
    const cd = countdownLabel(race);
    for (const pi of indices) {
      const vp = this.vps.get(pi);
      if (!vp) continue;
      const kart = race.getPlayerKart?.(pi) ?? race.karts?.find((k) => k.playerIndex === pi);
      if (kart) {
        this._updateViewport(vp, kart, cd, t, portraits, race);
        this.widgets.update(pi, kart, race, t);
      }
    }
    if (path) this._drawMinimap(race, path);
  }

  _updateViewport(vp, kart, cd, t, portraits, race = null) {
    const { refs, cache } = vp;

    // Friendly "turn around" hint while facing backwards
    const wrong = !!kart.wrongWay && !kart.finished && (race?.state ?? 'racing') === 'racing';
    if (wrong !== cache.wrong) {
      cache.wrong = wrong;
      refs.wrong.classList.toggle('show', wrong);
    }

    // Place badge (+ portrait)
    const place = kart.finished ? (kart.finishPlace ?? kart.place) : kart.place;
    if (place !== cache.place && place != null) {
      cache.place = place;
      const txt = ordinal(place);
      refs.placeText.innerHTML = `<b>${place}</b><small>${escapeHtml(txt.slice(String(place).length))}</small>`;
      refs.place.className = `sk-place sk-medal-${medalFor(place)}`;
      this._retrigger(refs.placeText, 'sk-bump');
    }
    if (kart.characterId !== cache.charId || portraits !== cache.portraits) {
      cache.charId = kart.characterId;
      cache.portraits = portraits;
      const def = this.characters.find((c) => c.id === kart.characterId) ?? { id: kart.characterId, name: kart.name };
      refs.placePortrait.innerHTML = portraitHtml(def, portraits);
    }

    // Lap counter + FINAL LAP banner
    const li = lapInfo(kart);
    const lapSig = `${li.lap}/${li.total}`;
    if (lapSig !== cache.lap) {
      const first = cache.lap === undefined;
      cache.lap = lapSig;
      refs.lap.innerHTML = `<small>LAP</small> <b>${li.lap}</b><small>/${li.total}</small>`;
      refs.lap.classList.toggle('sk-lap-final', li.final);
      if (!first) this._retrigger(refs.lap, 'sk-bump');
      if (li.final && !first && !kart.finished) this._retrigger(refs.banner, 'show');
    }

    // Item slot with roulette: spins fast, slows down and lands on the real item.
    const view = itemSlotView(kart);
    const rolling = view.state === 'rolling';
    let itemSig;
    let itemMarkup;
    if (rolling) {
      itemSig = `r:${view.tick}:${view.item}`;
      itemMarkup = itemHtml(view.item);
    } else if (view.item) {
      itemSig = `i:${view.item}:${view.pips?.left ?? ''}`;
      itemMarkup = itemHtml(view.item, view.pips);
    } else {
      itemSig = 'none';
      itemMarkup = '<span class="sk-item-empty">?</span>';
    }
    if (itemSig !== cache.item) {
      const wasRolling = cache.item?.startsWith('r:');
      cache.item = itemSig;
      refs.itemInner.innerHTML = itemMarkup;
      refs.item.style.setProperty('--ic', view.color);
      refs.item.classList.toggle('sk-rolling', rolling);
      refs.item.classList.toggle('sk-has', !rolling && !!view.item);
      if (rolling) this._retrigger(refs.itemInner, 'ski-tick');
      if (wasRolling && !rolling && view.item) this._retrigger(refs.item, 'sk-got');
    }

    // Countdown
    const cdShown = kart.finished ? null : cd;
    if (cdShown !== cache.cd) {
      cache.cd = cdShown;
      if (cdShown) {
        refs.count.innerHTML = `<span>${cdShown}</span>`;
        refs.count.dataset.n = cdShown === 'GO!' ? 'go' : cdShown;
        this._retrigger(refs.count, 'show');
      } else {
        refs.count.classList.remove('show');
        refs.count.innerHTML = '';
      }
    }

    // Finished banner
    const fin = kart.finished ? `f:${place}` : '';
    if (fin !== cache.fin) {
      cache.fin = fin;
      if (kart.finished) {
        refs.finish.innerHTML = `<div class="sk-finish-top">Finished! 🎉</div>`
          + `<div class="sk-finish-place sk-medal-${medalFor(place)}">${ordinal(place)}</div>`
          + '<div class="sk-finish-sub">Cheer on your friends! 📣</div>';
        this._retrigger(refs.finish, 'show');
        refs.banner.classList.remove('show');
      } else {
        refs.finish.classList.remove('show');
      }
    }
  }

  _retrigger(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  flash(playerIndex, text) {
    const vp = this.vps.get(playerIndex);
    if (!vp) return;
    const box = vp.refs.flashes;
    // at most MAX_FLASHES at once (the oldest goes early), so the lane never grows into the callouts
    while (box.childElementCount >= MAX_FLASHES) box.firstElementChild?.remove();
    [...box.children].forEach((c, i) => c.style.setProperty('--k', i));
    const f = el('div.sk-flash', {}, String(text));
    f.style.setProperty('--k', box.childElementCount);
    box.appendChild(f);
    setTimeout(() => f.remove(), 1400);
  }

  _drawMinimap(race, path) {
    const mm = this._mm;
    if (!mm.rect) return;
    const cv = this.minimap;
    const size = cv.width;
    if (!size) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const key = `${size}`;
    if (mm.path !== path || mm.key !== key) {
      mm.path = path;
      mm.key = key;
      const pts = path.getMinimapPoints(6);
      mm.fit = fitMinimap(pts, size, 0.1);
      mm.bg = document.createElement('canvas');
      mm.bg.width = mm.bg.height = size;
      const b = mm.bg.getContext('2d');
      const trace = () => {
        b.beginPath();
        pts.forEach(([x, z], i) => {
          const [px, py] = mm.fit.map(x, z);
          if (i) b.lineTo(px, py); else b.moveTo(px, py);
        });
        b.closePath();
      };
      b.lineJoin = 'round';
      b.lineCap = 'round';
      const u = size / 100;
      b.strokeStyle = 'rgba(122, 64, 140, 0.25)';
      b.lineWidth = 11 * u;
      b.save(); b.translate(0, 1.4 * u); trace(); b.stroke(); b.restore();
      b.strokeStyle = '#ffffff';
      b.lineWidth = 9.5 * u;
      trace(); b.stroke();
      b.strokeStyle = '#ffb3dc';
      b.lineWidth = 5.5 * u;
      trace(); b.stroke();
      b.setLineDash([2 * u, 3 * u]);
      b.strokeStyle = 'rgba(255,255,255,0.9)';
      b.lineWidth = 1.2 * u;
      trace(); b.stroke();
      b.setLineDash([]);
      // Start line marker
      if (pts.length) {
        const [sx, sy] = mm.fit.map(pts[0][0], pts[0][1]);
        b.fillStyle = '#6b3a7a';
        b.beginPath(); b.arc(sx, sy, 3.2 * u, 0, Math.PI * 2); b.fill();
        b.fillStyle = '#fff';
        b.font = `${5 * u}px sans-serif`;
        b.textAlign = 'center'; b.textBaseline = 'middle';
        b.fillText('🏁', sx, sy - 0.2 * u);
      }
    }
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(mm.bg, 0, 0);
    const u = size / 100;
    const karts = race.karts ?? [];
    const humans = [];
    for (const k of karts) {
      if (!k?.position) continue;
      if (k.playerIndex != null && !k.isCPU) { humans.push(k); continue; }
      const [x, y] = mm.fit.map(k.position.x, k.position.z);
      const def = this.characters.find((c) => c.id === k.characterId);
      ctx.fillStyle = cssColor(def?.colors?.primary, '#c9a7ff');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2 * u;
      ctx.beginPath(); ctx.arc(x, y, 2.6 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const k of humans) {
      const [x, y] = mm.fit.map(k.position.x, k.position.z);
      const r = 4.4 * u;
      ctx.fillStyle = 'rgba(80, 30, 90, 0.25)';
      ctx.beginPath(); ctx.arc(x, y + 0.8 * u, r + 1.2 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, r + 1.2 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PLAYER_COLORS[k.playerIndex] ?? '#ff5fb4';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${5.2 * u}px Fredoka, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(k.playerIndex + 1), x, y + 0.3 * u);
    }
  }

  show() { this.el.hidden = false; }

  hide() { this.el.hidden = true; }

  /** Clear per-race state (call between races so banners/caches reset). */
  reset() {
    for (const vp of this.vps.values()) {
      vp.cache = {};
      vp.refs.flashes.innerHTML = '';
      vp.refs.banner.classList.remove('show');
      vp.refs.finish.classList.remove('show');
      vp.refs.count.classList.remove('show');
      vp.refs.wrong.classList.remove('show');
    }
    this.widgets.reset();
    this._mm.path = null;
  }

  dispose() {
    this.el.remove();
    this.vps.clear();
  }
}
