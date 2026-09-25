import { describe, it, expect } from 'vitest';
import { buildUtterance, voiceSeed, VOICE_KINDS, VOICE_STYLES, VOWELS } from '../src/audio/voice.js';

describe('character voice babble', () => {
  it('builds a short, well-formed utterance for every style, kind and pitch', () => {
    for (const style of VOICE_STYLES) {
      for (const kind of VOICE_KINDS) {
        for (const pitch of [0.5, 1, 1.5, 2]) {
          const u = buildUtterance({ pitch, style }, kind, 7);
          expect(u.syllables.length).toBeGreaterThanOrEqual(2);
          expect(u.duration).toBeGreaterThan(0.2);
          expect(u.duration).toBeLessThan(2);
          let prevEnd = 0;
          for (const s of u.syllables) {
            expect(s.t).toBeGreaterThanOrEqual(prevEnd);
            expect(s.dur).toBeGreaterThan(0.05);
            for (const f of [s.f0Start, s.f0End]) {
              expect(f).toBeGreaterThanOrEqual(80);
              expect(f).toBeLessThanOrEqual(1100);
            }
            for (const f of [...s.from, ...s.to]) {
              expect(Number.isFinite(f)).toBe(true);
              expect(f).toBeGreaterThan(150);
              expect(f).toBeLessThan(5000);
            }
            prevEnd = s.t + s.dur;
          }
        }
      }
    }
  });

  it('higher pitch voices are higher', () => {
    const lo = buildUtterance({ pitch: 0.6, style: 'yay' }, 'yay', 1);
    const hi = buildUtterance({ pitch: 1.8, style: 'yay' }, 'yay', 1);
    expect(hi.syllables[0].f0Start).toBeGreaterThan(lo.syllables[0].f0Start * 2);
  });

  it('is deterministic per seed and tolerant of junk input', () => {
    expect(buildUtterance({ pitch: 1.2, style: 'giggle' }, 'win', 3)).toEqual(buildUtterance({ pitch: 1.2, style: 'giggle' }, 'win', 3));
    expect(() => buildUtterance(undefined, 'nonsense', 1)).not.toThrow();
    expect(buildUtterance({ pitch: 'x', style: 'robot' }, 'select', 1).style).toBe('yay');
    expect(voiceSeed({ id: 'rocco' }, 'yay', 0)).not.toBe(voiceSeed({ id: 'lenny' }, 'yay', 0));
    expect(voiceSeed(null, 'yay')).toBeTypeOf('number');
  });

  it('vowel table has 3 formants each', () => {
    for (const v of Object.values(VOWELS)) expect(v).toHaveLength(3);
  });
});
