// Showcase presentation: every sound in the presentation pack plays cleanly on the strict
// Web Audio mock, and the Effects screen switch sounds follow the new value.
import { describe, it, expect } from 'vitest';
import pack from '../src/audio/sfx/presentation.js';
import { SFX } from '../src/audio/sfx.js';
import { AudioManager } from '../src/audio/AudioManager.js';
import { toggleSound } from '../src/presentation/effectsMenu.js';
import { createStrictAudioContext } from './helpers/fakeAudio.js';

describe('presentation sound pack', () => {
  const names = Object.keys(pack.recipes);
  it('is registered and namespaced skx-*', () => {
    expect(names.length).toBeGreaterThanOrEqual(9);
    for (const n of names) {
      expect(n).toMatch(/^skx-/);
      expect(SFX[n], n).toBeTypeOf('function');
    }
    expect(names).toEqual(expect.arrayContaining(['skx-toggle-on', 'skx-toggle-off']));
  });
  it.each(names)('%s plays with no Web Audio violations', (name) => {
    const { ctx, stats } = createStrictAudioContext();
    const am = new AudioManager({ createContext: () => ctx, startTimer: false, autoUnlock: false });
    am.unlock();
    am.sfx(name, { pan: -0.4 });
    ctx.advance(3);
    am.sfx(name, { pitch: 1.3 });
    ctx.advance(2);
    am.dispose();
    expect(stats.errors).toEqual([]);
    expect(stats.started).toBeGreaterThan(0);
  });
});

describe('toggleSound', () => {
  it('on / Full motion rise, off / Gentle fall', () => {
    expect(toggleSound('shake', { shake: true })).toBe('skx-toggle-on');
    expect(toggleSound('shake', { shake: false })).toBe('skx-toggle-off');
    expect(toggleSound('colorAssist', { colorAssist: true })).toBe('skx-toggle-on');
    expect(toggleSound('motion', { motion: 'full' })).toBe('skx-toggle-on');
    expect(toggleSound('motion', { motion: 'gentle' })).toBe('skx-toggle-off');
    expect(toggleSound('weather', null)).toBe('skx-toggle-off');
  });
});
