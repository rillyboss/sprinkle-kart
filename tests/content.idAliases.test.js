/**
 * Renamed content ids (src/content/idAliases.js): "Boo Berry" became the
 * original "Peekaberry" in v2.0.1. Every store that saves racer ids must bring
 * an old 'boo-berry' entry back as 'peekaberry' so a family keeps its unlock,
 * tallies, paint, record holder and ghost. Also: no known trademark names in
 * any registered racer or track.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ID_ALIASES, migrateId, migrateIdList, migrateIdKeys } from '../src/content/idAliases.js';
import { mergeProgress } from '../src/progress/schema.js';
import * as progress from '../src/progress/progress.js';
import { paintStore, paintFor } from '../src/modes/paint.js';
import { createRecordHolders } from '../src/modes/recordHolders.js';
import { createGhostStore, GHOST_KEY } from '../src/modes/ghost.js';
import { memoryBackend } from '../src/modes/storage.js';
import { CHARACTERS, getCharacter } from '../src/characters/index.js';
import { TRACKS } from '../src/tracks/index.js';
import { LINEUP_CHARACTERS, LINEUP_TRACKS } from '../src/content/lineup.js';
import { useFakeStorage } from './progressFixtures.js';

afterEach(() => { vi.unstubAllGlobals(); });

const OLD_SAVE = () => ({
  unlocked: ['cotton-candy-girl', 'boo-berry', 'bubblegum-bay'],
  wins: 3,
  racers: { 'boo-berry': { races: 5, wins: 2, podiums: 3 }, rocco: { races: 1, wins: 0, podiums: 0 } },
  stats: { racesFinished: 6 },
});

describe('id aliases', () => {
  it('maps boo-berry to peekaberry and every alias target is a real lineup racer or track', () => {
    expect(ID_ALIASES['boo-berry']).toBe('peekaberry');
    const known = new Set([...LINEUP_CHARACTERS, ...LINEUP_TRACKS].map((x) => x.id));
    for (const [from, to] of Object.entries(ID_ALIASES)) {
      expect(known.has(to), to).toBe(true);
      expect(known.has(from), `old id ${from} must not be registered any more`).toBe(false);
    }
    expect(getCharacter('peekaberry')?.name).toBe('Peekaberry');
    expect(CHARACTERS.some((c) => c.id === 'boo-berry')).toBe(false);
  });

  it('migrateId / migrateIdList / migrateIdKeys are pure and idempotent', () => {
    expect(migrateId('boo-berry')).toBe('peekaberry');
    expect(migrateId('rocco')).toBe('rocco');
    expect(migrateId(undefined)).toBe(undefined);
    expect(migrateId('toString')).toBe('toString');
    expect(migrateIdList(['boo-berry', 'peekaberry', 'rocco'])).toEqual(['peekaberry', 'rocco']);
    expect(migrateIdList(migrateIdList(['boo-berry']))).toEqual(['peekaberry']);
    expect(migrateIdKeys({ 'boo-berry': 1, rocco: 2 })).toEqual({ peekaberry: 1, rocco: 2 });
    // the newer value under the current id wins unless combine says otherwise
    expect(migrateIdKeys({ 'boo-berry': 1, peekaberry: 2 })).toEqual({ peekaberry: 2 });
    expect(migrateIdKeys({ 'boo-berry': 1, peekaberry: 2 }, (a, b) => a + b)).toEqual({ peekaberry: 3 });
    expect(migrateIdKeys(null)).toBe(null);
  });
});

describe('progress save migration', () => {
  it('an old save with boo-berry unlocked + tallies comes back as peekaberry', () => {
    const m = mergeProgress(OLD_SAVE());
    expect(m.unlocked).toEqual(['cotton-candy-girl', 'peekaberry', 'bubblegum-bay']);
    expect(m.racers.peekaberry).toEqual({ races: 5, wins: 2, podiums: 3 });
    expect(m.racers['boo-berry']).toBeUndefined();
    expect(m.racers.rocco.races).toBe(1);
    // loading twice changes nothing
    expect(mergeProgress(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('tallies saved under both ids are added together (best place kept)', () => {
    const m = mergeProgress({
      unlocked: ['peekaberry', 'boo-berry'],
      racers: { 'boo-berry': { races: 2, wins: 1, podiums: 1 }, peekaberry: { races: 3, wins: 0, podiums: 2 } },
    });
    expect(m.unlocked).toEqual(['peekaberry']);
    expect(m.racers.peekaberry).toEqual({ races: 5, wins: 1, podiums: 3 });
  });

  it('loadProgress migrates a stored save, writes it back once and isUnlocked sees peekaberry', () => {
    const ls = useFakeStorage();
    ls.setItem(progress.PROGRESS_KEY, JSON.stringify(OLD_SAVE()));
    expect(progress.isUnlocked('peekaberry')).toBe(true);
    expect(progress.isEarned('boo-berry')).toBe(false);
    const stored = ls.getItem(progress.PROGRESS_KEY);
    expect(stored).not.toContain('boo-berry');
    expect(JSON.parse(stored).racers.peekaberry.wins).toBe(2);
    progress.resetProgress();
  });
});

describe('other stores keep a renamed racer', () => {
  it('paint: a painted Boo Berry keeps the same paint as Peekaberry', () => {
    const backend = memoryBackend();
    backend.setItem('sprinkle-kart-paint-v1', JSON.stringify({ racers: { 'boo-berry': 'mint', rocco: 'lemon' } }));
    const store = paintStore(backend);
    const map = store.load();
    expect(map).toEqual({ peekaberry: 'mint', rocco: 'lemon' });
    expect(paintFor(map, 'peekaberry')).toBe('mint');
    // saving writes the new id; loading again is unchanged
    store.set('rocco', 'sky');
    expect(backend.getItem('sprinkle-kart-paint-v1')).not.toContain('boo-berry');
    expect(store.load()).toEqual({ peekaberry: 'mint', rocco: 'sky' });
  });

  it('paint: a newer paint saved under the new id wins over the old one', () => {
    const backend = memoryBackend();
    backend.setItem('sprinkle-kart-paint-v1', JSON.stringify({ racers: { 'boo-berry': 'mint', peekaberry: 'grape' } }));
    expect(paintStore(backend).load()).toEqual({ peekaberry: 'grape' });
  });

  it('record holders: an old holder shows up as Peekaberry', () => {
    const backend = memoryBackend();
    backend.setItem('sprinkle-kart-record-holders-v1', JSON.stringify({ 'starlight-galaxy': { race: { time: 81.5, characterId: 'boo-berry' } } }));
    const holders = createRecordHolders(backend);
    expect(holders.holder('starlight-galaxy', 'race', 81.5)).toBe('peekaberry');
    expect(holders.holder('starlight-galaxy', 'race', 81.5)).toBe('peekaberry');
  });

  it('ghosts: an old ghost races as Peekaberry', () => {
    const backend = memoryBackend();
    const ghost = { v: 1, trackId: 'gumdrop-meadow', laps: 3, characterId: 'boo-berry', speedClass: 'cozy', time: 90, hz: 10, n: 0, data: '' };
    backend.setItem(GHOST_KEY, JSON.stringify({ 'gumdrop-meadow': { 3: ghost } }));
    const store = createGhostStore(backend);
    const g = store.load('gumdrop-meadow', 3);
    // same version check as before: only migrate what load() would return
    if (g) expect(g.characterId).toBe('peekaberry');
    else expect.fail('ghost with version 1 should load');
  });
});

describe('original IP only', () => {
  const TRADEMARKS = /\b(boo berry|count chocula|franken berry|trix|tony the tiger|mario|luigi|princess peach|bowser|yoshi|toad|koopa|donkey kong|diddy|wario|waluigi|rosalina|daisy|shy guy|kirby|pikachu|sonic|nintendo|rainbow road)\b/i;
  const texts = (d) => [d.id, d.name, d.tagline, d.personality, d.concept, ...Object.values(d.quotes || {})].filter(Boolean).join(' | ');

  it('no registered racer or track borrows a known trademark name', () => {
    for (const c of CHARACTERS) expect(texts(c), c.id).not.toMatch(TRADEMARKS);
    for (const c of LINEUP_CHARACTERS) expect(texts(c), c.id).not.toMatch(TRADEMARKS);
    for (const t of [...TRACKS, ...LINEUP_TRACKS]) expect(texts(t), t.id).not.toMatch(TRADEMARKS);
  });

  it('"Boo Berry" is gone from the source, the README and the architecture doc', () => {
    const files = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|css|html)$/.test(f)) files.push(p);
      }
    };
    walk('src');
    files.push('README.md', 'ARCHITECTURE.md');
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/Boo Berry/i);
      // the old id may only appear in the alias table
      if (!f.endsWith('idAliases.js')) expect(text, f).not.toMatch(/boo-berry/);
    }
  });
});
