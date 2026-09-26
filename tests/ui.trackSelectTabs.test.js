/**
 * Track select cup tabs are real tabs: LB / RB, Q / E, PgUp / PgDn flip whole cups, a click on a tab
 * opens that cup (keeping the spot inside the cup), and the track row stays focused.
 */
import { describe, it, expect } from 'vitest';
import {
  createTrackSelectState, trackSelectReduce, flipPage, pageStart, pageForIndex,
} from '../src/ui/menuState.js';
import { createBookState, bookReduce, BOOK_TABS } from '../src/progress/screenState.js';

const tracks = Array.from({ length: 11 }, (_, i) => ({ id: `t${i}` }));
const sizes = [4, 4, 3];
const make = (o = {}) => createTrackSelectState({ tracks, pageSizes: sizes, controllerId: 'kb1', ...o });

describe('page helpers', () => {
  it('pageStart sums the earlier pages', () => {
    expect(pageStart(sizes, 0)).toBe(0);
    expect(pageStart(sizes, 1)).toBe(4);
    expect(pageStart(sizes, 2)).toBe(8);
  });
  it('flipPage keeps the offset, clamps into a smaller cup and wraps both ways', () => {
    expect(flipPage(sizes, 1, 1)).toBe(5);
    expect(flipPage(sizes, 7, 1)).toBe(10); // offset 3 -> last of a 3-track cup
    expect(flipPage(sizes, 9, 1)).toBe(1); // wraps to the first cup
    expect(flipPage(sizes, 2, -1)).toBe(10); // wraps backwards, clamped
    expect(flipPage([], 3, 1)).toBe(3);
  });
});

describe('trackSelectReduce tabs', () => {
  it('state keeps valid page sizes, else one page', () => {
    expect(make().pageSizes).toEqual(sizes);
    expect(make({ pageSizes: [4, 4] }).pageSizes).toEqual([11]);
    expect(make({ pageSizes: null }).pageSizes).toEqual([11]);
    expect(make({ pageSizes: [4, 0, 7] }).pageSizes).toEqual([11]);
  });

  it('tabNext / tabPrev flip cups and focus the track row', () => {
    let s = { ...make(), row: 2 };
    let r = trackSelectReduce(s, { deviceId: 'kb1', action: 'tabNext' });
    expect(r.state.trackIndex).toBe(4);
    expect(r.state.row).toBe(0);
    expect(r.fx).toContain('move');
    s = r.state;
    r = trackSelectReduce(s, { deviceId: 'kb1', action: 'tabPrev' });
    expect(pageForIndex(sizes, r.state.trackIndex).page).toBe(0);
    r = trackSelectReduce(r.state, { deviceId: 'kb1', action: 'tabPrev' });
    expect(pageForIndex(sizes, r.state.trackIndex).page).toBe(2);
  });

  it('the other keyboard may flip tabs (PgUp / PgDn live on kb2), other pads may not', () => {
    const s = make();
    expect(trackSelectReduce(s, { deviceId: 'kb2', action: 'tabNext' }).state.trackIndex).toBe(4);
    expect(trackSelectReduce(s, { deviceId: 'gp1', action: 'tabNext' }).state.trackIndex).toBe(0);
    expect(trackSelectReduce(s, { deviceId: 'kb2', action: 'right' }).state.trackIndex).toBe(0);
    const pad = make({ controllerId: 'gp0' });
    expect(trackSelectReduce(pad, { deviceId: 'kb1', action: 'tabNext' }).state.trackIndex).toBe(0);
    expect(trackSelectReduce(pad, { deviceId: 'gp0', action: 'tabNext' }).state.trackIndex).toBe(4);
  });

  it('a single page ignores tab flips', () => {
    const s = createTrackSelectState({ tracks, controllerId: null });
    const r = trackSelectReduce(s, { deviceId: 'kb1', action: 'tabNext' });
    expect(r.state).toBe(s);
  });

  it('pointer on a tab opens that cup at the same spot', () => {
    let s = { ...make(), trackIndex: 2, row: 3 };
    let r = trackSelectReduce(s, { deviceId: 'mouse', action: 'page', value: 2 });
    expect(r.state.trackIndex).toBe(10);
    expect(r.state.row).toBe(0);
    r = trackSelectReduce(r.state, { deviceId: 'mouse', action: 'page', value: 2 });
    expect(r.fx).toEqual([]); // same cup: just focus
    expect(trackSelectReduce(s, { deviceId: 'mouse', action: 'page', value: 9 }).state).toBe(s);
    expect(trackSelectReduce(s, { deviceId: 'mouse', action: 'page', value: 'x' }).state).toBe(s);
    s = { ...make(), trackIndex: 5 };
    expect(trackSelectReduce(s, { deviceId: 'mouse', action: 'page', value: 0 }).state.trackIndex).toBe(1);
  });

  it('the Sticker Book pages flip with tabPrev / tabNext too', () => {
    let b = createBookState({ racers: 5, tracks: 5, goals: 5 });
    b = bookReduce(b, { deviceId: 'kb1', action: 'tabNext' }).state;
    expect(b.tab).toBe(1);
    b = bookReduce(b, { deviceId: 'kb1', action: 'tabPrev' }).state;
    b = bookReduce(b, { deviceId: 'kb1', action: 'tabPrev' }).state;
    expect(b.tab).toBe(BOOK_TABS.length - 1);
  });

  it('locked tracks can be browsed by tab (they only refuse to race)', () => {
    const s = make({ isLocked: (t) => Number(t.id.slice(1)) >= 4 });
    const r = trackSelectReduce(s, { deviceId: 'kb1', action: 'tabNext' });
    expect(r.state.trackIndex).toBe(4);
    const go = trackSelectReduce(r.state, { deviceId: 'kb1', action: 'confirm' });
    expect(go.go).toBeFalsy();
    expect(go.shake).toBe('track');
  });
});
