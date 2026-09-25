import { describe, it, expect, beforeEach } from 'vitest';
import { isUnlocked, unlock, recordWin, resetProgress, loadProgress } from '../src/save/progress.js';

describe('progress', () => {
  beforeEach(() => resetProgress());

  it('unlocks once', () => {
    expect(isUnlocked('cotton-candy-girl')).toBe(false);
    expect(unlock('cotton-candy-girl')).toBe(true);
    expect(unlock('cotton-candy-girl')).toBe(false);
    expect(isUnlocked('cotton-candy-girl')).toBe(true);
  });

  it('records wins per track', () => {
    recordWin('cotton-candy-castle');
    recordWin('cotton-candy-castle');
    const p = loadProgress();
    expect(p.wins).toBe(2);
    expect(p.trophies['cotton-candy-castle']).toBe(2);
  });
});
