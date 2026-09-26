/**
 * Unlock reveals on the mode result screens (Grand Prix ceremony, Time Trial,
 * Team, Battle, How to Play) — celebrationQueue in src/ui/screens/_modes.js.
 * Play-test finding: the ceremony headline, podium and buttons showed through
 * the reveal while it faded in and out, and the GP reveals had no
 * "Surprise 1 of N" ribbon. Now the host is covered (CELEBRATING_CLASS) from the
 * first frame of a reveal until the last one has faded away.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { installFakeDom } from './helpers/fakeOverlayDom.js';
import { celebrationQueue, CELEBRATING_CLASS } from '../src/ui/screens/_modes.js';

const fakeCtx = () => ({ sfx: vi.fn(), setCooldown: vi.fn(), portraits: null, audio: null });
const unlocks = () => [
  { kind: 'track', def: { id: 'cupcake-carnival', name: 'Cupcake Carnival' } },
  { kind: 'character', def: { id: 'luna', name: 'Luna Lollicorn', colors: { primary: 0xfffbff } } },
];
const confirm = { deviceId: 'kb1', action: 'confirm' };

beforeEach(() => { vi.useFakeTimers(); installFakeDom(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('celebrationQueue covers the screen underneath', () => {
  it('no cover before the first reveal, cover from its first frame, until the last one has faded out', () => {
    const host = document.createElement('div');
    const q = celebrationQueue(fakeCtx(), host, unlocks(), { delay: 1 });
    expect(host.classList.contains(CELEBRATING_CLASS)).toBe(false); // the ceremony shows first
    expect(q.active()).toBe(true);
    q.update(1.01);
    const first = host.querySelector('.sk-unlock');
    expect(first).not.toBe(null);
    expect(host.classList.contains(CELEBRATING_CLASS)).toBe(true); // fading in: covered already
    q.update(5); // long enough to continue
    q.handle(confirm);
    expect(first.classList.contains('sk-leaving')).toBe(true);
    expect(host.classList.contains(CELEBRATING_CLASS)).toBe(true); // fading out: still covered
    vi.advanceTimersByTime(460);
    expect(host.querySelectorAll('.sk-unlock')).toHaveLength(0);
    expect(host.classList.contains(CELEBRATING_CLASS)).toBe(true); // the breath before reveal 2
    q.update(0.71);
    expect(host.querySelectorAll('.sk-unlock')).toHaveLength(1);
    q.update(5);
    q.handle(confirm);
    expect(q.active()).toBe(true); // last one still fading
    vi.advanceTimersByTime(460);
    expect(host.classList.contains(CELEBRATING_CLASS)).toBe(false);
    expect(q.active()).toBe(false);
  });

  it('GP reveals show the "Surprise 1 of 2" ribbon and dots like the results screen', () => {
    const host = document.createElement('div');
    const q = celebrationQueue(fakeCtx(), host, unlocks(), { delay: 0.1 });
    q.update(0.2);
    const html = host.querySelector('.sk-unlock').innerHTML;
    expect(html).toMatch(/1 of 2/);
  });

  it('with nothing to celebrate it is never active and never covers', () => {
    const host = document.createElement('div');
    const q = celebrationQueue(fakeCtx(), host, [], { delay: 1 });
    q.update(3);
    expect(q.active()).toBe(false);
    expect(q.handle(confirm)).toBe(false);
    expect(host.classList.contains(CELEBRATING_CLASS)).toBe(false);
  });

  it('the cover hides everything but the reveal (CSS)', () => {
    const css = readFileSync('src/modes/modes.css', 'utf8');
    expect(css).toMatch(/\.sk-celebrating > :not\(\.sk-unlock\) \{ visibility: hidden !important; \}/);
  });
});

describe('Grand Prix ceremony wiring', () => {
  const src = readFileSync('src/ui/screens/gpStandings.js', 'utf8');
  it('reveals start before the Play again / Menu buttons appear, and the buttons wait for them', () => {
    const delay = Number(/celebrationQueue\(ctx, node, unlocks, \{ delay: ([\d.]+) \}\)/.exec(src)?.[1]);
    const intro = Number(/introTime: ([\d.]+)/.exec(src)?.[1]);
    expect(delay).toBeLessThan(intro);
    expect(src).toMatch(/'sk-show', state\.phase === 'choose' && !celebrations\?\.active\(\)/);
  });
  it('the ceremony buttons show once the last reveal has faded out between frames (net review #18)', () => {
    // the last reveal stops being "active" on its fade-out TIMER, between two frames: an update that compares
    // active() before and after its own celebrations.update() never sees the change, so the Play again / Menu
    // buttons never appeared (the offline smoke's modes-grand-prix timed out on them)
    const q = celebrationQueue(fakeCtx(), document.createElement('div'), unlocks().slice(0, 1), { delay: 0.1 });
    q.update(0.2);
    q.update(5);
    q.handle(confirm);
    const before = q.active();
    vi.advanceTimersByTime(460); // between frames
    const startOfNextUpdate = q.active();
    q.update(1 / 60);
    const endOfNextUpdate = q.active();
    expect([before, startOfNextUpdate, endOfNextUpdate]).toEqual([true, false, false]);
    // so the screen compares with the PREVIOUS frame
    expect(src).toMatch(/if \(before !== state\.phase \|\| busy !== lastBusy\) sync\(\);\n\s+lastBusy = busy;/);
    expect(src).not.toMatch(/busy !== !!celebrations\?\.active\(\)/);
  });

  it('the Free Race results screen covers its podium the same way', () => {
    expect(readFileSync('src/ui/screens/results.js', 'utf8')).toMatch(/classList\.toggle\('sk-celebrating'/);
  });
});
