import { describe, it, expect } from 'vitest';
import {
  CUPS, GP_POINTS, pointsForPlace, getCup, cupOfTrack, cupTracks, groupTracksByCup, completeCups, isCupPlayable,
} from '../src/data/cups.js';
import { TRACKS } from '../src/tracks/index.js';
import { isAvailable } from '../src/progress/access.js';

const fake = (id, extra = {}) => ({ id, unlock: null, ...extra });

describe('cups', () => {
  it('has the five v2 cups with names and emoji', () => {
    expect(CUPS.map((c) => [c.id, c.name, c.emoji])).toEqual([
      ['sprinkle-cup', 'Sprinkle Cup', '🍭'],
      ['bubble-cup', 'Bubble Cup', '🫧'],
      ['cozy-cup', 'Cozy Cup', '☕'],
      ['adventure-cup', 'Adventure Cup', '🌋'],
      ['superstar-cup', 'Superstar Cup', '🌟'],
    ]);
    expect(Object.isFrozen(CUPS[0])).toBe(true);
    expect(getCup('cozy-cup').trackIds).toEqual(['pumpkin-patch', 'teacup-garden', 'peppermint-village', 'pillow-fort']);
    expect(getCup('nope')).toBe(null);
  });

  it('awards Grand Prix points 15/12/10/8/6/4/2/1', () => {
    expect(GP_POINTS).toEqual([15, 12, 10, 8, 6, 4, 2, 1]);
    expect([1, 2, 8, 9, 0].map(pointsForPlace)).toEqual([15, 12, 1, 0, 0]);
  });

  it('knows which cup a track is in', () => {
    expect(cupOfTrack('sundae-slopes').id).toBe('sprinkle-cup');
    expect(cupOfTrack('ribbon-sky').id).toBe('superstar-cup');
    expect(cupOfTrack('nope')).toBe(null);
  });

  it('skips tracks that are not registered yet', () => {
    const reg = [fake('mermaid-lagoon'), fake('bubblegum-bay')];
    expect(cupTracks('bubble-cup', reg).map((t) => t.id)).toEqual(['bubblegum-bay', 'mermaid-lagoon']);
    expect(cupTracks('cozy-cup', reg)).toEqual([]);
    expect(cupTracks('nope', reg)).toEqual([]);
    expect(cupTracks('sprinkle-cup').map((t) => t.id)).toEqual(['cotton-candy-castle', 'gumdrop-meadow', 'starlight-galaxy', 'sundae-slopes']);
  });

  it('groups tracks by cup for menus (empty cups skipped, strays last)', () => {
    const reg = [...TRACKS.slice(0, 4), fake('teacup-garden'), fake('wip-track')];
    const groups = groupTracksByCup(reg);
    expect(groups.map((g) => g.cup?.id ?? null)).toEqual(['sprinkle-cup', 'cozy-cup', null]);
    expect(groups[1].tracks.map((t) => t.id)).toEqual(['teacup-garden']);
    expect(groups[2].tracks.map((t) => t.id)).toEqual(['wip-track']);
  });

  it('a cup is ready / playable only with all 4 tracks registered and available', () => {
    expect(completeCups().map((c) => c.id)).toContain('sprinkle-cup');
    expect(isCupPlayable(getCup('sprinkle-cup'), (t) => isAvailable(t, () => false))).toBe(true);
    const bubble = ['bubblegum-bay', 'mermaid-lagoon', 'teddy-toyland', 'honeycomb-hive'].map((id) => fake(id, { unlock: { type: 'stat', stat: 'wins', count: 1 } }));
    expect(isCupPlayable(getCup('bubble-cup'), (t) => isAvailable(t, () => false), bubble)).toBe(false);
    expect(isCupPlayable(getCup('bubble-cup'), (t) => isAvailable(t, () => true), bubble)).toBe(true);
    expect(isCupPlayable(getCup('bubble-cup'), () => true, bubble.slice(0, 3))).toBe(false);
    expect(isCupPlayable(getCup('bubble-cup'), () => { throw new Error('x'); }, bubble)).toBe(false);
  });
});
