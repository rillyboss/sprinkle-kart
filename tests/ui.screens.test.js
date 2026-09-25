import { describe, it, expect } from 'vitest';
import { SCREENS, collectScreens } from '../src/ui/screens/index.js';
import { flowOrder, nextInFlow, prevInFlow, flowStart } from '../src/ui/screenFlow.js';
import { unlockQueue } from '../src/ui/screens/results.js';
import {
  gridColumns, moveGridIndex, createTrackSelectState, trackSelectReduce, trackSelection, pageForIndex,
  createCharSelectState, charSelectReduce,
} from '../src/ui/menuState.js';
import { demoContent } from '../src/game/demoContent.js';
import { CHARACTERS } from '../src/characters/index.js';
import { TRACKS } from '../src/tracks/index.js';
import { groupTracksByCup } from '../src/data/cups.js';
import { lockHint, lockDetail, trackArt } from '../src/ui/screens/_shared.js';

const ev = (deviceId, action, extra = {}) => ({ deviceId, action, ...extra });

describe('screen registry', () => {
  it('registers every built-in screen by id', () => {
    for (const id of ['title', 'join', 'character-select', 'track-select', 'pause', 'results']) {
      expect(SCREENS.has(id), id).toBe(true);
      expect(typeof SCREENS.get(id).mount).toBe('function');
    }
  });

  it('skips helpers and duplicate ids', () => {
    const warn = console.warn;
    console.warn = () => {};
    const map = collectScreens({
      './a.js': { default: { id: 'a', mount() {} } },
      './b.js': { default: { id: 'a', mount() {} } },
      './c.js': { unlockOverlay() {} },
      './d.js': { default: { id: 'd' } },
    });
    console.warn = warn;
    expect([...map.keys()]).toEqual(['a']);
  });

  it('the default flow is title → join → character select → track select', () => {
    expect(flowOrder(SCREENS, { draft: { skip: new Set() } })).toEqual(['title', 'join', 'character-select', 'track-select']);
  });
});

describe('screen flow', () => {
  const screens = new Map([
    ['title', { id: 'title', flow: { order: 10 } }],
    ['join', { id: 'join', flow: { order: 20 } }],
    ['mode-select', { id: 'mode-select', flow: { order: 25 } }],
    ['character-select', { id: 'character-select', flow: { order: 30 } }],
    ['cup-select', { id: 'cup-select', flow: { order: 40, when: (ctx) => ctx.draft.mode === 'grand-prix' } }],
    ['track-select', { id: 'track-select', flow: { order: 40, when: (ctx) => ctx.draft.mode !== 'grand-prix' } }],
    ['pause', { id: 'pause' }],
  ]);

  it('inserts a new screen by order (mode select between join and characters)', () => {
    const ctx = { draft: { mode: 'free', skip: new Set() } };
    expect(flowOrder(screens, ctx)).toEqual(['title', 'join', 'mode-select', 'character-select', 'track-select']);
  });

  it('swaps screens with when() and skips ids in draft.skip', () => {
    expect(flowOrder(screens, { draft: { mode: 'grand-prix', skip: new Set() } }))
      .toEqual(['title', 'join', 'mode-select', 'character-select', 'cup-select']);
    expect(flowOrder(screens, { draft: { mode: 'free', skip: new Set(['mode-select']) } }))
      .toEqual(['title', 'join', 'character-select', 'track-select']);
  });

  it('a throwing when() leaves the screen out', () => {
    const s = new Map([['x', { id: 'x', flow: { order: 1, when: () => { throw new Error('no'); } } }], ['y', { id: 'y', flow: { order: 2 } }]]);
    expect(flowOrder(s, {})).toEqual(['y']);
  });

  it('next / prev / start', () => {
    const order = ['title', 'join', 'character-select', 'track-select'];
    expect(nextInFlow(order, 'join')).toBe('character-select');
    expect(nextInFlow(order, 'track-select')).toBe(null);
    expect(nextInFlow(order, 'nope')).toBe('title');
    expect(prevInFlow(order, 'join')).toBe('title');
    expect(prevInFlow(order, 'title')).toBe(null);
    expect(flowStart(order)).toBe('title');
    expect(flowStart(order, { skipTitle: true })).toBe('join');
    expect(flowStart([])).toBe(null);
  });
});

describe('results unlock queue', () => {
  it('prefers the unlock list, falls back to the legacy single character', () => {
    const ccg = { id: 'cotton-candy-girl' };
    expect(unlockQueue({ newlyUnlocked: ccg })).toEqual([{ kind: 'character', id: 'cotton-candy-girl', def: ccg }]);
    expect(unlockQueue({ unlocks: [{ kind: 'track', id: 't', def: { id: 't' } }, { kind: 'character', id: 'x', def: null }], newlyUnlocked: ccg }))
      .toEqual([{ kind: 'track', id: 't', def: { id: 't' } }]);
    expect(unlockQueue({})).toEqual([]);
  });
});

describe('menus at full v2 size (21 racers, 20 tracks)', () => {
  const demo = demoContent(CHARACTERS, TRACKS);

  it('demo content pads to the whole lineup with locked placeholders', () => {
    expect(demo.characters).toHaveLength(21);
    expect(demo.tracks).toHaveLength(20);
    for (const c of demo.characters.filter((x) => x.placeholder)) expect(c.locked).toBe(true);
    for (const t of demo.tracks.filter((x) => x.placeholder)) expect(t.unlock).not.toBe(null);
    expect(groupTracksByCup(demo.tracks).map((g) => g.tracks.length)).toEqual([4, 4, 4, 4, 4]);
  });

  it('the character grid is 7 wide and every tile is reachable with the stick', () => {
    expect(gridColumns(9)).toBe(5);
    expect(gridColumns(21)).toBe(7);
    expect(gridColumns(15)).toBe(5);
    const n = 21;
    const cols = gridColumns(n);
    const seen = new Set([0]);
    let frontier = [0];
    while (frontier.length) {
      const next = [];
      for (const i of frontier) {
        for (const a of ['up', 'down', 'left', 'right']) {
          const j = moveGridIndex(i, a, n, cols);
          if (!seen.has(j)) { seen.add(j); next.push(j); }
        }
      }
      frontier = next;
    }
    expect(seen.size).toBe(n);
  });

  it('locked placeholders cannot be picked', () => {
    const players = [{ playerIndex: 0, deviceId: 'kb1' }];
    let s = createCharSelectState({ players, characters: demo.characters, isLocked: (c) => c.locked });
    s = { ...s, cursors: s.cursors.map((c) => ({ ...c, index: 20 })) };
    const r = charSelectReduce(s, ev('kb1', 'confirm'));
    expect(r.state.cursors[0].ready).toBe(false);
    expect(r.shake).toBe(0);
  });

  it('track select pages by cup and refuses locked tracks', () => {
    const groups = groupTracksByCup(demo.tracks);
    const tracks = groups.flatMap((g) => g.tracks);
    const sizes = groups.map((g) => g.tracks.length);
    let s = createTrackSelectState({ tracks, controllerId: 'kb1', isLocked: (t) => !!t.unlock });
    expect(s.locked.filter(Boolean)).toHaveLength(16);
    expect(pageForIndex(sizes, s.trackIndex)).toEqual({ page: 0, offset: 0 });
    for (let k = 0; k < 4; k++) s = trackSelectReduce(s, ev('kb1', 'right')).state;
    expect(pageForIndex(sizes, s.trackIndex)).toEqual({ page: 1, offset: 0 });
    const r = trackSelectReduce(s, ev('kb1', 'confirm'));
    expect(r.go).toBe(null);
    expect(r.shake).toBe('track');
    expect(r.fx).toEqual(['back']);
    s = trackSelectReduce(s, ev('kb1', 'left')).state;
    expect(trackSelectReduce(s, ev('kb1', 'confirm')).go).toBe('next');
    expect(pageForIndex(sizes, 19)).toEqual({ page: 4, offset: 3 });
    expect(pageForIndex([], 3)).toEqual({ page: 0, offset: 0 });
  });

  it('a remembered track that is locked falls back to the first open track', () => {
    const tracks = [{ id: 'a', unlock: { type: 'stat', stat: 'wins', count: 1 } }, { id: 'b', unlock: null }];
    const s = createTrackSelectState({ tracks, previous: { trackId: 'a' }, isLocked: (t) => !!t.unlock });
    expect(trackSelection(s, tracks).trackId).toBe('b');
  });

  it('locked hints come from the unlock rule (CCG wording kept)', () => {
    const ccg = CHARACTERS.find((c) => c.id === 'cotton-candy-girl');
    expect(lockHint(ccg)).toBe('Win a race to unlock!');
    expect(lockDetail(ccg)).toBe('Finish in 1st place to meet a sweet new racer…');
    const lagoon = demo.tracks.find((t) => t.id === 'mermaid-lagoon');
    expect(lockHint(lagoon)).toBe('Win a race to unlock!');
    expect(lockHint(demo.tracks.find((t) => t.id === 'jellybean-jungle'))).toBe('Win on any Bubble Cup track to unlock!');
    expect(trackArt(TRACKS[0])).toEqual(['🏰', '🍭', '💗']);
    expect(trackArt({})).toEqual(['🏁', '🍬', '✨']);
  });
});
