import { describe, it, expect } from 'vitest';
import { CHARACTERS, getCharacter, getSelectableCharacters, toCss } from '../src/data/characters.js';
import { UNLOCK_CHARACTER_ID } from '../src/config.js';
import { CHARACTER_PACKS } from '../src/characters/index.js';

// v2: packs A and B add unlockable racers; these tests stay valid as they land.
const ORIGINAL = CHARACTER_PACKS.find((p) => p.id === 'original').entries.map((e) => e.def);
const FREE = CHARACTERS.filter((c) => !c.locked);
const LOCKED = CHARACTERS.filter((c) => c.locked);

const VOICE_STYLES = ['giggle', 'hoho', 'yay', 'boing', 'hum'];

describe('character roster', () => {
  it('has 8 original racers plus one unlockable (plus any v2 packs)', () => {
    expect(ORIGINAL).toHaveLength(9);
    expect(FREE).toHaveLength(8);
    expect(CHARACTERS.length).toBeGreaterThanOrEqual(9);
  });

  it('has unique kebab-case ids and unique names', () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    const names = CHARACTERS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('contains the whole planned original cast', () => {
    const ids = ORIGINAL.map((c) => c.id);
    expect(ids).toEqual(['rocco', 'lenny', 'stella', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy', 'cotton-candy-girl']);
    expect(CHARACTERS.slice(0, 9).map((c) => c.id)).toEqual(ids);
  });

  it('has exactly one locked original character: Cotton Candy Girl', () => {
    const locked = ORIGINAL.filter((c) => c.locked);
    expect(locked).toHaveLength(1);
    expect(locked[0].id).toBe(UNLOCK_CHARACTER_ID);
    expect(locked[0].name).toBe('Cotton Candy Girl');
    expect(locked[0].unlockHint).toMatch(/win/i);
    for (const c of CHARACTERS) expect(typeof c.locked).toBe('boolean');
    for (const c of CHARACTERS) expect(c.locked, c.id).toBe(c.unlock !== null);
  });

  it('keeps stats as whole numbers from 1 to 5', () => {
    for (const c of CHARACTERS) {
      for (const k of ['speed', 'accel', 'handling', 'weight']) {
        const v = c.stats[k];
        expect(Number.isInteger(v), `${c.id}.${k}`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(5);
      }
    }
  });

  it('keeps racers roughly balanced so anyone can win', () => {
    for (const c of CHARACTERS) {
      const total = c.stats.speed + c.stats.accel + c.stats.handling + c.stats.weight;
      expect(total, c.id).toBeGreaterThanOrEqual(11);
      expect(total, c.id).toBeLessThanOrEqual(14);
    }
  });

  it('has valid voices and colours', () => {
    for (const c of CHARACTERS) {
      expect(c.voice.pitch).toBeGreaterThanOrEqual(0.5);
      expect(c.voice.pitch).toBeLessThanOrEqual(2.0);
      expect(VOICE_STYLES).toContain(c.voice.style);
      for (const k of ['primary', 'secondary', 'accent', 'kart']) {
        const v = c.colors[k];
        expect(Number.isInteger(v), `${c.id}.colors.${k}`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('gives everyone a tagline, personality, emoji and quotes', () => {
    for (const c of CHARACTERS) {
      expect(c.tagline.length).toBeGreaterThan(5);
      expect(c.personality.length).toBeGreaterThan(20);
      expect(c.emoji.length).toBeGreaterThan(0);
      for (const k of ['select', 'win', 'oops']) expect(c.quotes[k].length, `${c.id}.${k}`).toBeGreaterThan(3);
    }
  });

  it('uses friendly, kid-safe words only', () => {
    const banned = /\b(hit|hits|kill|killed|destroy|destroyed|die|dies|dead|attack|hate|stupid|weapon)\b/i;
    for (const c of CHARACTERS) {
      const text = [c.name, c.tagline, c.personality, ...Object.values(c.quotes), c.unlockHint ?? ''].join(' ');
      expect(text, c.id).not.toMatch(banned);
    }
  });

  it('is original (no borrowed trademark names)', () => {
    const borrowed = /\b(mario|luigi|princess peach|bowser|yoshi|toad|rosalina|nintendo|daisy|wario)\b/i;
    for (const c of CHARACTERS) expect(`${c.name} ${c.tagline} ${c.personality}`, c.id).not.toMatch(borrowed);
  });
});

describe('getCharacter', () => {
  it('finds characters by id', () => {
    expect(getCharacter('rocco').name).toBe('Rocco Ravioli');
    expect(getCharacter(UNLOCK_CHARACTER_ID).locked).toBe(true);
  });

  it('returns null for unknown ids', () => {
    expect(getCharacter('nobody')).toBeNull();
    expect(getCharacter(undefined)).toBeNull();
  });
});

describe('getSelectableCharacters', () => {
  it('hides locked characters by default', () => {
    const list = getSelectableCharacters();
    expect(list).toHaveLength(FREE.length);
    expect(list.some((c) => c.locked)).toBe(false);
  });

  it('hides locked characters that are not unlocked yet', () => {
    const list = getSelectableCharacters(() => false);
    expect(list.map((c) => c.id)).not.toContain(UNLOCK_CHARACTER_ID);
  });

  it('shows unlocked characters, in roster order', () => {
    const list = getSelectableCharacters((id) => id === UNLOCK_CHARACTER_ID);
    expect(list).toHaveLength(FREE.length + 1);
    expect(list[8].id).toBe(UNLOCK_CHARACTER_ID);
    expect(list.map((c) => c.id)).toEqual(CHARACTERS.filter((c) => !c.locked || c.id === UNLOCK_CHARACTER_ID).map((c) => c.id));
    expect(getSelectableCharacters(() => true).map((c) => c.id)).toEqual(CHARACTERS.map((c) => c.id));
  });

  it('only asks about locked characters', () => {
    const asked = [];
    getSelectableCharacters((id) => (asked.push(id), true));
    expect(asked).toEqual(LOCKED.map((c) => c.id));
  });

  it('treats a throwing unlock check as locked', () => {
    const list = getSelectableCharacters(() => {
      throw new Error('storage blocked');
    });
    expect(list).toHaveLength(FREE.length);
  });

  it('works with the real progress module', async () => {
    const { isUnlocked, unlock, resetProgress } = await import('../src/save/progress.js');
    resetProgress();
    expect(getSelectableCharacters(isUnlocked)).toHaveLength(FREE.length);
    unlock(UNLOCK_CHARACTER_ID);
    expect(getSelectableCharacters(isUnlocked)).toHaveLength(FREE.length + 1);
    resetProgress();
  });
});

describe('toCss', () => {
  it('formats hex colours for the UI', () => {
    expect(toCss(0xff8fc8)).toBe('#ff8fc8');
    expect(toCss(0x00000a)).toBe('#00000a');
  });
});
