/**
 * Registry + lineup contract tests. These run over EVERY registered racer and
 * track, so new pack content is checked automatically.
 */
import { describe, it, expect } from 'vitest';
import {
  CHARACTERS, CHARACTER_PACKS, CHARACTER_ENTRIES, CHARACTER_REGISTRY_PROBLEMS, getCharacter, getCharacterEntry,
  getSelectableCharacters,
} from '../src/characters/index.js';
import * as legacyChars from '../src/data/characters.js';
import { TRACKS, TRACK_PACKS, TRACK_MODULES, TRACK_REGISTRY_PROBLEMS, getTrack, findTrack, getTrackModule } from '../src/tracks/index.js';
import * as legacyTracks from '../src/data/tracks.js';
import { LINEUP_CHARACTERS, LINEUP_TRACKS, LINEUP_CUPS, lineupCharacter, lineupTrack } from '../src/content/lineup.js';
import { isValidUnlockRule, STAT_KEYS } from '../src/progress/schema.js';
import { SONG_IDS } from '../src/audio/songs.js';
import { UNLOCK_CHARACTER_ID } from '../src/config.js';
import { isAvailable } from '../src/progress/access.js';

describe('lineup (binding v2 content plan)', () => {
  it('has 21 racers, 20 tracks and 5 cups of 4', () => {
    expect(LINEUP_CHARACTERS).toHaveLength(21);
    expect(LINEUP_TRACKS).toHaveLength(20);
    expect(LINEUP_CUPS.map((c) => c.id)).toEqual(['sprinkle-cup', 'bubble-cup', 'cozy-cup', 'adventure-cup', 'superstar-cup']);
    for (const cup of LINEUP_CUPS) expect(cup.trackIds).toHaveLength(4);
  });

  it('ids are kebab-case and unique across characters AND tracks (one shared unlock list)', () => {
    const ids = [...LINEUP_CHARACTERS.map((c) => c.id), ...LINEUP_TRACKS.map((t) => t.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('every cup track is in the track lineup with that cup', () => {
    for (const cup of LINEUP_CUPS) {
      for (const id of cup.trackIds) expect(lineupTrack(id)?.cup, id).toBe(cup.id);
    }
  });

  it('every unlock rule is valid and only mentions real content', () => {
    for (const e of [...LINEUP_CHARACTERS, ...LINEUP_TRACKS]) {
      expect(isValidUnlockRule(e.unlock), e.id).toBe(true);
      if (e.unlock?.type === 'track') expect(lineupTrack(e.unlock.trackId), e.id).not.toBe(null);
      if (e.unlock?.type === 'cup-track') expect(LINEUP_CUPS.some((c) => c.id === e.unlock.cupId), e.id).toBe(true);
      if (e.unlock?.type === 'stat') expect(STAT_KEYS).toContain(e.unlock.stat);
    }
  });

  it('only the original 9 racers and the Sprinkle Cup start unlocked (except Cotton Candy Girl)', () => {
    const free = LINEUP_CHARACTERS.filter((c) => !c.unlock).map((c) => c.id);
    expect(free).toEqual(['rocco', 'lenny', 'stella', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy']);
    expect(LINEUP_TRACKS.filter((t) => !t.unlock).map((t) => t.cup)).toEqual(['sprinkle-cup', 'sprinkle-cup', 'sprinkle-cup', 'sprinkle-cup']);
  });

  it('packs A and B have 6 racers each', () => {
    expect(LINEUP_CHARACTERS.filter((c) => c.pack === 'a')).toHaveLength(6);
    expect(LINEUP_CHARACTERS.filter((c) => c.pack === 'b')).toHaveLength(6);
  });
});

describe('character registry', () => {
  it('aggregates the original, A and B packs with no problems', () => {
    expect(CHARACTER_PACKS.map((p) => p.id)).toEqual(['original', 'a', 'b']);
    expect(CHARACTER_REGISTRY_PROBLEMS).toEqual([]);
    expect(CHARACTERS.length).toBe(CHARACTER_PACKS.reduce((n, p) => n + p.entries.length, 0));
  });

  it('the original pack is the 9 first-edition racers, in menu order', () => {
    const orig = CHARACTER_PACKS.find((p) => p.id === 'original').entries.map((e) => e.def.id);
    expect(orig).toEqual(['rocco', 'lenny', 'stella', 'peachy', 'gumbo', 'muffin', 'dino', 'bizzy', 'cotton-candy-girl']);
    expect(CHARACTERS.slice(0, 9).map((c) => c.id)).toEqual(orig);
  });

  it.each(CHARACTER_ENTRIES.map((e) => [e.def.id, e]))('%s matches the lineup and has a builder', (id, entry) => {
    const plan = lineupCharacter(id);
    expect(plan, `${id} is not in src/content/lineup.js`).not.toBe(null);
    expect(entry.def.name).toBe(plan.name);
    expect(entry.def.pack).toBe(plan.pack);
    expect(entry.def.unlock).toEqual(plan.unlock);
    expect(entry.def.locked).toBe(plan.unlock !== null);
    expect(typeof entry.build).toBe('function');
    const pack = CHARACTER_PACKS.find((p) => p.entries.some((e) => e.def.id === id));
    expect(pack.id).toBe(plan.pack);
  });

  it('lookups work and the legacy data module is the same registry', () => {
    expect(getCharacter('rocco').name).toBe('Rocco Ravioli');
    expect(getCharacter('nobody')).toBe(null);
    expect(getCharacterEntry('rocco').def).toBe(getCharacter('rocco'));
    expect(legacyChars.CHARACTERS).toBe(CHARACTERS);
    expect(legacyChars.getCharacter).toBe(getCharacter);
    expect(getCharacter(UNLOCK_CHARACTER_ID).unlock).toEqual({ type: 'stat', stat: 'wins', count: 1 });
  });

  it('locked racers are hidden until unlocked; isAvailable agrees', () => {
    const none = getSelectableCharacters(() => false).map((c) => c.id);
    for (const c of CHARACTERS) {
      expect(none.includes(c.id), c.id).toBe(!c.locked);
      expect(isAvailable(c, () => false)).toBe(!c.locked);
      expect(isAvailable(c, () => true)).toBe(true);
    }
  });
});

describe('track registry', () => {
  it('aggregates one pack per cup with no problems', () => {
    expect(TRACK_PACKS.map((p) => p.cup)).toEqual(LINEUP_CUPS.map((c) => c.id));
    expect(TRACK_REGISTRY_PROBLEMS).toEqual([]);
    expect(TRACKS.length).toBe(TRACK_PACKS.reduce((n, p) => n + p.modules.length, 0));
  });

  it('the original pack is the Sprinkle Cup, in cup order', () => {
    const orig = TRACK_PACKS[0].modules.map((m) => m.def.id);
    expect(orig).toEqual(LINEUP_CUPS[0].trackIds);
    expect(TRACKS.slice(0, 4).map((t) => t.id)).toEqual(orig);
  });

  it.each(TRACK_MODULES.map((m) => [m.def.id, m]))('%s matches the lineup, its pack and has scenery', (id, mod) => {
    const plan = lineupTrack(id);
    expect(plan, `${id} is not in src/content/lineup.js`).not.toBe(null);
    expect(mod.def.name).toBe(plan.name);
    expect(mod.def.cup).toBe(plan.cup);
    expect(mod.def.unlock).toEqual(plan.unlock);
    expect(typeof mod.buildScenery).toBe('function');
    const pack = TRACK_PACKS.find((p) => p.modules.some((m) => m.def.id === id));
    expect(pack.cup).toBe(plan.cup);
    expect(SONG_IDS, `theme.music '${mod.def.theme.music}'`).toContain(mod.def.theme.music);
  });

  it('lookups work and the legacy data module is the same registry', () => {
    expect(getTrack('sundae-slopes').name).toBe('Sundae Slopes');
    expect(getTrack('nope').id).toBe(TRACKS[0].id);
    expect(findTrack('nope')).toBe(null);
    expect(getTrackModule('sundae-slopes').def).toBe(getTrack('sundae-slopes'));
    expect(typeof getTrackModule('sundae-slopes').prepare).toBe('function');
    expect(legacyTracks.TRACKS).toBe(TRACKS);
  });
});
