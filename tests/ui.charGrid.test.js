/**
 * Character select with a big roster (play-test findings v2): with 2+ players
 * the grid used to show 2 of 3 rows, cut the second row's progress bars in
 * half and clip the P1..P4 tags on the top row. Now:
 *  - rosterColumns() goes wide (2 rows of up to 11) when 2+ players share the screen
 *  - fitRosterGrid() sizes a scrolling grid to whole rows and toggles a "more" cue
 *  - the cursor tags sit inside the tile (characterSelect.css)
 * The browser smoke (menu-scale) measures the real layout at full size.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { rosterColumns, gridColumns, WIDE_ROSTER_MAX_COLS, createCharSelectState, charSelectReduce } from '../src/ui/menuState.js';
import { fitRosterGrid, updateGridCue } from '../src/ui/screens/characterSelect.js';

afterEach(() => vi.unstubAllGlobals());

describe('rosterColumns', () => {
  it('one player keeps the roomy grid; small rosters are unchanged', () => {
    expect(rosterColumns(21, 1)).toBe(gridColumns(21));
    expect(rosterColumns(9, 2)).toBe(gridColumns(9));
    expect(rosterColumns(12, 4)).toBe(gridColumns(12));
  });

  it('2-4 players: the 21-racer roster fits in 2 rows of 11', () => {
    for (const p of [2, 3, 4]) {
      const cols = rosterColumns(21, p);
      expect(cols).toBe(11);
      expect(Math.ceil(21 / cols)).toBe(2);
    }
  });

  it('never wider than WIDE_ROSTER_MAX_COLS, even for a huge roster', () => {
    expect(rosterColumns(40, 2)).toBe(WIDE_ROSTER_MAX_COLS);
    expect(rosterColumns(13, 2)).toBe(7);
  });

  it('cursor movement follows the wide columns (down from Rocco lands on the 12th racer)', () => {
    const characters = Array.from({ length: 21 }, (_, i) => ({ id: `r${i}` }));
    const players = [{ playerIndex: 0, deviceId: 'kb1' }, { playerIndex: 1, deviceId: 'kb2' }];
    const s = createCharSelectState({ players, characters, cols: rosterColumns(21, 2) });
    expect(s.cols).toBe(11);
    const r = charSelectReduce(s, { deviceId: 'kb1', action: 'down' });
    expect(r.state.cursors[0].index).toBe(11);
  });
});

/** A scroll box + tiles laid out in rows of `cols`, each row rowH px apart. */
function fakeGrid({ n = 21, cols = 7, tileH = 180, gap = 12, clientH = 380, pad = 10, scrollTop = 0 } = {}) {
  const tiles = Array.from({ length: n }, (_, i) => ({ offsetTop: pad + Math.floor(i / cols) * (tileH + gap), offsetHeight: tileH }));
  const rows = Math.ceil(n / cols);
  const classes = new Set();
  const grid = {
    style: { maxHeight: '' },
    get clientHeight() { const m = parseFloat(this.style.maxHeight); return Number.isFinite(m) ? Math.min(m, clientH) : clientH; },
    get scrollHeight() { return rows * (tileH + gap) - gap + pad * 2; },
    scrollTop,
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
  };
  vi.stubGlobal('getComputedStyle', () => ({ paddingTop: `${pad}px`, paddingBottom: `${pad}px` }));
  return { grid, tiles, classes, rowH: tileH + gap };
}

describe('fitRosterGrid', () => {
  it('shrinks the scroll box to whole rows, so no card (or its progress bar) is cut in half', () => {
    const { grid, tiles, rowH } = fakeGrid({ clientH: 420 }); // room for 2.1 rows
    fitRosterGrid(grid, tiles, 7);
    const h = parseFloat(grid.style.maxHeight);
    expect(h).toBeLessThanOrEqual(420);
    // exactly 2 rows + padding
    expect(h).toBe(Math.ceil(2 * rowH - 12 + 20));
    expect(grid.classList.contains('sk-grid-more')).toBe(true); // a 3rd row is below: show the cue
  });

  it('leaves the box alone when every row already fits, and hides the cue', () => {
    const { grid, tiles } = fakeGrid({ n: 21, cols: 11, tileH: 150, clientH: 400 });
    fitRosterGrid(grid, tiles, 11);
    expect(grid.style.maxHeight).toBe('');
    expect(grid.classList.contains('sk-grid-more')).toBe(false);
  });

  it('the cue hides once the family has scrolled to the bottom', () => {
    const { grid, tiles } = fakeGrid({ clientH: 380 });
    fitRosterGrid(grid, tiles, 7);
    grid.scrollTop = grid.scrollHeight - grid.clientHeight;
    updateGridCue(grid);
    expect(grid.classList.contains('sk-grid-more')).toBe(false);
  });

  it('is safe before layout and with odd input', () => {
    const { grid } = fakeGrid();
    expect(() => fitRosterGrid(grid, [], 7)).not.toThrow();
    expect(() => fitRosterGrid(null, null, 7)).not.toThrow();
    const tiles = [{ offsetTop: 0, offsetHeight: 0 }, { offsetTop: 0, offsetHeight: 0 }];
    expect(() => fitRosterGrid(grid, tiles, 1)).not.toThrow();
    expect(grid.style.maxHeight).toBe('');
    expect(() => updateGridCue(null)).not.toThrow();
  });
});

describe('characterSelect.css', () => {
  const css = readFileSync('src/ui/screens/characterSelect.css', 'utf8');
  it('draws the cursor tags inside the tile (never above the scroll box edge)', () => {
    const m = /\.sk-grid-many \.sk-tags \{[^}]*top:\s*(-?[\d.]+)em/.exec(css);
    expect(m).not.toBe(null);
    expect(parseFloat(m[1])).toBeGreaterThanOrEqual(0);
  });
  it('has a sticky "more friends" cue that only shows while rows are hidden', () => {
    expect(css).toMatch(/\.sk-grid-cue \{[^}]*position: sticky/);
    expect(css).toMatch(/\.sk-grid-more \.sk-grid-cue \{ opacity: 1; \}/);
  });
  it('is imported by the character select screen', () => {
    const src = readFileSync('src/ui/screens/characterSelect.js', 'utf8');
    expect(src).toContain("import './characterSelect.css';");
    expect(src).toContain('S.rosterColumns(');
    expect(src).toContain('More friends below!');
  });
});
