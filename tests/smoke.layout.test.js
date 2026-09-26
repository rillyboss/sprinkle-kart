// The pure layout geometry behind the smoke test's "nothing overlaps, nothing is clipped"
// checks (scripts/smoke-layout.mjs). The browser half (collectRects) runs in Chrome; here we
// pin the maths and the problem messages, plus a fake-DOM run of collectRects.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  LAYOUT_TOLERANCE, intersection, rectsOverlap, isInside, sticksOut,
  overlapProblems, crossOverlapProblems, insideProblems, clippedTextProblems, collectRects,
  visibleFraction, marksOfVisibleOwners,
} from '../scripts/smoke-layout.mjs';

const R = (left, top, w, h, label) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, label });

describe('rect geometry', () => {
  it('intersection is 0 for touching / apart rects', () => {
    expect(intersection(R(0, 0, 10, 10), R(10, 0, 10, 10)).area).toBe(0);
    expect(intersection(R(0, 0, 10, 10), R(30, 30, 5, 5)).area).toBe(0);
    expect(intersection(R(0, 0, 10, 10), R(5, 5, 10, 10))).toEqual({ w: 5, h: 5, area: 25 });
  });

  it('overlap needs more than the tolerance in both directions', () => {
    expect(rectsOverlap(R(0, 0, 10, 10), R(9, 0, 10, 10))).toBe(false); // 1px: a shared border
    expect(rectsOverlap(R(0, 0, 10, 10), R(8, 0, 10, 10))).toBe(true);
    expect(rectsOverlap(R(0, 0, 10, 10), R(5, 9.5, 10, 10))).toBe(false); // wide but only 0.5px tall
    expect(LAYOUT_TOLERANCE).toBeGreaterThan(0);
    expect(LAYOUT_TOLERANCE).toBeLessThan(3);
  });

  it('inside / sticks out, per side', () => {
    const box = R(0, 0, 100, 50);
    expect(isInside(R(10, 10, 20, 20), box)).toBe(true);
    expect(isInside(R(-1, 0, 20, 20), box)).toBe(true); // within tolerance
    expect(isInside(R(-5, 0, 20, 20), box)).toBe(false);
    expect(sticksOut(R(-5, -8, 120, 70), box)).toEqual({ left: 5, top: 8, right: 15, bottom: 12 });
    expect(sticksOut(R(10, 10, 5, 5), box)).toEqual({});
  });
});

describe('problem lists', () => {
  it('pairwise overlaps name both elements and the size', () => {
    const ps = overlapProblems([R(0, 0, 50, 50, 'Rocco'), R(40, 0, 50, 50, 'Lenny'), R(200, 0, 50, 50, 'Stella')], { what: 'racer tiles' });
    expect(ps).toEqual(['racer tiles: "Rocco" overlaps "Lenny" by 10x50px']);
    expect(overlapProblems([R(0, 0, 50, 50), R(60, 0, 50, 50)])).toEqual([]);
    expect(overlapProblems([])).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 10 }, (_, i) => R(i, 0, 50, 50, `t${i}`));
    expect(overlapProblems(many, { max: 3 })).toHaveLength(3);
  });

  it('cross-group overlaps (e.g. an unlock card over the podium names)', () => {
    const card = [R(100, 100, 300, 200, 'New racer!')];
    const names = [R(50, 50, 40, 20, '1st'), R(150, 250, 80, 20, '2nd')];
    expect(crossOverlapProblems(card, names, { what: 'ceremony' })).toEqual(['ceremony: "New racer!" overlaps "2nd" by 80x20px']);
  });

  it('inside problems use a shared container or each rect\'s own', () => {
    const vp = R(0, 0, 800, 450, 'the viewport');
    expect(insideProblems([R(790, 10, 30, 30, 'P1')], vp, { what: 'tags' })).toEqual(['tags: "P1" sticks out of the viewport {"right":20}']);
    const own = { ...R(10, 10, 20, 12, 'P2'), container: R(0, 16, 100, 100, 'its tile') };
    expect(insideProblems([own], null, { what: 'tags' })).toEqual(['tags: "P2" sticks out of its tile {"top":6}']);
    expect(insideProblems([own], null, { sides: ['left', 'right'] })).toEqual([]);
    expect(insideProblems([R(0, 0, 5, 5)], null)).toEqual([]); // no container: nothing to check
    // an explicit container wins over the rect's own (tags vs the viewport, not their grid)
    expect(insideProblems([own], vp, { what: 'tags' })).toEqual([]);
  });

  it('visible fraction and marks of visible owners (tags of scrolled-away tiles are not "clipped")', () => {
    const grid = R(0, 100, 400, 200, 'grid');
    expect(visibleFraction(R(0, 100, 100, 100), grid)).toBe(1);
    expect(visibleFraction(R(0, 50, 100, 100), grid)).toBe(0.5);
    expect(visibleFraction(R(0, 0, 100, 50), grid)).toBe(0);
    expect(visibleFraction(R(0, 0, 0, 0), grid)).toBe(0);
    const shown = { ...R(10, 110, 100, 120, 'Rocco'), container: grid };
    const hidden = { ...R(150, -200, 100, 120, 'Lenny'), container: grid };
    const tagShown = R(40, 95, 30, 20, 'P1');
    const tagHidden = R(180, -215, 30, 20, 'P2');
    const stray = R(600, 95, 30, 20, 'P3');
    expect(marksOfVisibleOwners([tagShown, tagHidden, stray], [shown, hidden]).map((m) => m.label)).toEqual(['P1']);
  });

  it('clipped text only counts boxes that really clip', () => {
    const cut = { ...R(0, 0, 50, 10, 'Princess Peachy Pie'), scroll: { w: 90, h: 10, cw: 50, ch: 10, clipX: true, clipY: false } };
    const free = { ...R(0, 0, 50, 10, 'Rocco'), scroll: { w: 90, h: 10, cw: 50, ch: 10, clipX: false, clipY: false } };
    expect(clippedTextProblems([cut, free], { what: 'names' })).toEqual(['names: "Princess Peachy Pie" is cut off (40px wide)']);
  });
});

describe('collectRects (in-page collector) on a fake DOM', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('measures visible elements, skips hidden / zero-size ones, finds containers', () => {
    const mk = (cls, r, style = {}, parent = null) => ({
      className: cls, textContent: ` ${cls}  text `, parentElement: parent,
      getAttribute: () => null,
      getBoundingClientRect: () => r,
      scrollWidth: r.width, scrollHeight: r.height, clientWidth: r.width, clientHeight: r.height,
      closest(sel) { let n = this; while (n) { if (`.${n.className}` === sel) return n; n = n.parentElement; } return null; },
      _style: { display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', textOverflow: 'clip', ...style },
    });
    const grid = mk('grid', R(0, 0, 400, 300));
    const a = mk('tile', R(10, 10, 100, 100), {}, grid);
    const b = mk('tile', R(120, 10, 100, 100), { visibility: 'hidden' }, grid);
    const c = mk('tile', R(0, 0, 0, 0), {}, grid);
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 450 });
    vi.stubGlobal('getComputedStyle', (el) => el._style);
    vi.stubGlobal('document', { querySelectorAll: (sel) => (sel === '.tile' ? [a, b, c] : []) });
    const got = collectRects({ groups: { tiles: '.tile', none: '.x' }, containerOf: { tiles: '.grid' } });
    expect(got.viewport).toMatchObject({ right: 800, bottom: 450 });
    expect(got.none).toEqual([]);
    expect(got.tiles).toHaveLength(1);
    expect(got.tiles[0]).toMatchObject({ left: 10, right: 110, label: 'tile text' });
    expect(got.tiles[0].container).toMatchObject({ right: 400, bottom: 300 });
    expect(got.tiles[0].scroll.clipX).toBe(false);
  });
});
