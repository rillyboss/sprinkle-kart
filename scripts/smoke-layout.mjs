/**
 * Layout checks for scripts/smoke.mjs: "nothing overlaps, nothing is clipped".
 *
 * The geometry is pure (unit-tested in tests/smoke.layout.test.js). The browser half is
 * `collectRects`, a self-contained function handed to page.evaluate() that measures
 * elements with getBoundingClientRect() (visible ones only: display/visibility/opacity
 * and zero-size boxes are skipped).
 *
 *   const rects = await page.evaluate(collectRects, { groups: { tiles: '.sk-tile', tags: '.sk-tile .sk-tag' } });
 *   overlapProblems(rects.tiles, { what: 'racer tiles' })          // [] = fine
 *   insideProblems(rects.tags, rects.viewport, { what: 'P1/P2 tags' })
 */

/** Tolerance in CSS pixels (anti-aliasing, sub-pixel borders, box shadows are not boxes). */
export const LAYOUT_TOLERANCE = 1.5;

/** Width/height of the intersection of two rects (0 when they only touch). */
export function intersection(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return { w: Math.max(0, w), h: Math.max(0, h), area: Math.max(0, w) * Math.max(0, h) };
}

/** Do two rects overlap by more than `tol` pixels in BOTH directions? */
export function rectsOverlap(a, b, tol = LAYOUT_TOLERANCE) {
  const i = intersection(a, b);
  return i.w > tol && i.h > tol;
}

/** Is `inner` inside `outer` (within `tol` pixels on every side)? */
export function isInside(inner, outer, tol = LAYOUT_TOLERANCE) {
  return inner.left >= outer.left - tol && inner.top >= outer.top - tol
    && inner.right <= outer.right + tol && inner.bottom <= outer.bottom + tol;
}

/** Which sides of `outer` does `inner` stick out of (and by how much)? */
export function sticksOut(inner, outer, tol = LAYOUT_TOLERANCE) {
  const out = {};
  if (inner.left < outer.left - tol) out.left = +(outer.left - inner.left).toFixed(1);
  if (inner.top < outer.top - tol) out.top = +(outer.top - inner.top).toFixed(1);
  if (inner.right > outer.right + tol) out.right = +(inner.right - outer.right).toFixed(1);
  if (inner.bottom > outer.bottom + tol) out.bottom = +(inner.bottom - outer.bottom).toFixed(1);
  return out;
}

const label = (r, i) => r?.label || `#${i}`;

/** How much of `r` (0..1 of its area) is inside `box` (e.g. a tile inside a scrolled grid). */
export function visibleFraction(r, box) {
  const area = Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
  return area > 0 ? intersection(r, box).area / area : 0;
}

/**
 * The rects of `marks` (e.g. P1/P2 cursor tags) that belong to an `owners` rect (e.g. the
 * hot tile under each tag: same column, just above / on top of it) which is at least
 * `minVisible` inside its container: marks of a tile scrolled out of view are hidden on
 * purpose and are not "clipped".
 */
export function marksOfVisibleOwners(marks = [], owners = [], { minVisible = 0.5 } = {}) {
  return marks.filter((m) => {
    const cx = (m.left + m.right) / 2;
    const owner = owners.find((o) => cx >= o.left && cx <= o.right && m.bottom >= o.top - 4 && m.top <= o.bottom);
    return !!owner && (!owner.container || visibleFraction(owner, owner.container) >= minVisible);
  });
}

/**
 * Pairwise overlap inside one group of rects (e.g. every tile of a grid).
 * @param {Array<{left:number,top:number,right:number,bottom:number,label?:string}>} rects
 * @returns {string[]} problems
 */
export function overlapProblems(rects = [], { what = 'elements', tol = LAYOUT_TOLERANCE, max = 5 } = {}) {
  const out = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (rectsOverlap(rects[i], rects[j], tol)) {
        const x = intersection(rects[i], rects[j]);
        out.push(`${what}: "${label(rects[i], i)}" overlaps "${label(rects[j], j)}" by ${x.w.toFixed(0)}x${x.h.toFixed(0)}px`);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/** Overlap between two different groups (e.g. the unlock card vs the podium names). */
export function crossOverlapProblems(as = [], bs = [], { what = 'elements', tol = LAYOUT_TOLERANCE, max = 5 } = {}) {
  const out = [];
  for (let i = 0; i < as.length; i++) {
    for (let j = 0; j < bs.length; j++) {
      if (rectsOverlap(as[i], bs[j], tol)) {
        const x = intersection(as[i], bs[j]);
        out.push(`${what}: "${label(as[i], i)}" overlaps "${label(bs[j], j)}" by ${x.w.toFixed(0)}x${x.h.toFixed(0)}px`);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/**
 * Every rect must sit inside `container` (one rect, or per-rect via `r.container`).
 * @returns {string[]} problems
 */
export function insideProblems(rects = [], container = null, { what = 'elements', tol = LAYOUT_TOLERANCE, max = 5, sides = null } = {}) {
  const out = [];
  rects.forEach((r, i) => {
    const box = container ?? r.container;
    if (!box) return;
    let s = sticksOut(r, box, tol);
    if (sides) s = Object.fromEntries(Object.entries(s).filter(([k]) => sides.includes(k)));
    if (Object.keys(s).length && out.length < max) out.push(`${what}: "${label(r, i)}" sticks out of ${box.label || 'its box'} ${JSON.stringify(s)}`);
  });
  return out;
}

/** Text that is cut off inside its own box (scrollWidth/Height beyond the client box). */
export function clippedTextProblems(rects = [], { what = 'text', tol = 2, max = 5 } = {}) {
  const out = [];
  rects.forEach((r, i) => {
    if (!r.scroll) return;
    const dx = r.scroll.w - r.scroll.cw;
    const dy = r.scroll.h - r.scroll.ch;
    if ((r.scroll.clipX && dx > tol) || (r.scroll.clipY && dy > tol)) {
      if (out.length < max) out.push(`${what}: "${label(r, i)}" is cut off (${dx > tol ? `${dx}px wide` : ''}${dx > tol && dy > tol ? ', ' : ''}${dy > tol ? `${dy}px tall` : ''})`);
    }
  });
  return out;
}

/**
 * In-page (page.evaluate) collector. Self-contained: no closures over this module.
 * @param {{ groups: Record<string, string>, containerOf?: Record<string, string> }} spec
 *   groups: name -> CSS selector; containerOf: group name -> selector of the closest
 *   ancestor each element must stay inside (stored on each rect as `container`).
 * @returns {Record<string, Array>} rects per group + `viewport`
 */
export function collectRects(spec) {
  const vis = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const box = (el, extra = {}) => {
    const r = el.getBoundingClientRect();
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, label: text || el.className, ...extra };
  };
  const out = { viewport: { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, label: 'the viewport' } };
  for (const [name, sel] of Object.entries(spec.groups || {})) {
    const up = spec.containerOf?.[name];
    out[name] = [...document.querySelectorAll(sel)].filter(vis).map((el) => {
      const cs = getComputedStyle(el);
      const scroll = {
        w: el.scrollWidth, h: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight,
        clipX: /hidden|clip/.test(cs.overflowX), // text-overflow only matters when this clips
        clipY: /hidden|clip/.test(cs.overflowY),
      };
      const c = up ? el.parentElement?.closest(up) : null;
      return box(el, { scroll, container: c && vis(c) ? box(c) : undefined });
    });
  }
  return out;
}
