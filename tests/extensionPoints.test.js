/**
 * Extension points that let workstreams add things without editing shared
 * files: HUD widgets, SFX packs, extra songs, AudioManager.sfxCore().
 */
import { describe, it, expect, vi } from 'vitest';
import { createWidgetHost } from '../src/ui/hudWidgets.js';
import { mergeSfxPacks, SFX, SFX_NAMES } from '../src/audio/sfx.js';
import { AudioManager } from '../src/audio/AudioManager.js';
import { SONGS, SONG_IDS } from '../src/audio/songs.js';

function fakeWidget(id, log) {
  return {
    id,
    create(node, pi) {
      log.push(['create', id, pi, node]);
      return {
        update: (kart, race, t) => log.push(['update', id, pi, kart, t]),
        reset: () => log.push(['reset', id, pi]),
        destroy: () => log.push(['destroy', id, pi]),
      };
    },
  };
}

describe('HUD widget host', () => {
  it('creates a widget per viewport (before or after viewports exist) and updates it', () => {
    const log = [];
    const host = createWidgetHost();
    host.attach(0, 'vp0');
    host.add(fakeWidget('timer', log));
    host.attach(1, 'vp1');
    host.update(1, 'kart1', null, 2.5);
    host.update(3, 'nobody', null, 1);
    expect(log).toEqual([
      ['create', 'timer', 0, 'vp0'],
      ['create', 'timer', 1, 'vp1'],
      ['update', 'timer', 1, 'kart1', 2.5],
    ]);
    expect(host.ids()).toEqual(['timer']);
  });

  it('resets, detaches and removes cleanly', () => {
    const log = [];
    const host = createWidgetHost();
    host.attach(0, 'vp0');
    host.attach(1, 'vp1');
    const remove = host.add(fakeWidget('w', log));
    host.reset();
    host.detach(1);
    remove();
    remove();
    expect(log.filter((l) => l[0] !== 'create')).toEqual([
      ['reset', 'w', 0], ['reset', 'w', 1], ['destroy', 'w', 1], ['destroy', 'w', 0],
    ]);
    expect(host.ids()).toEqual([]);
  });

  it('a throwing widget is reported once and skipped; others keep going', () => {
    const onError = vi.fn();
    const host = createWidgetHost({ onError });
    const log = [];
    host.add({ id: 'bad', create: () => ({ update() { throw new Error('oops'); } }) });
    host.add(fakeWidget('good', log));
    host.attach(0, 'vp');
    host.update(0, 'k', null, 0);
    host.update(0, 'k', null, 1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(log.filter((l) => l[0] === 'update')).toHaveLength(2);
    expect(() => host.add({ id: 'nope' })).toThrow();
  });
});

describe('SFX packs', () => {
  it('merges new recipes + throttles and never overrides built-ins', () => {
    const target = { go: () => 'built-in' };
    const throttle = {};
    const mine = () => 'mine';
    const added = mergeSfxPacks([
      { recipes: { go: () => 'hijack', 'drive-hum': mine }, throttle: { 'drive-hum': 0.2 } },
      null,
      { recipes: { 'not-a-fn': 3 } },
    ], target, throttle);
    expect(added).toEqual(['drive-hum']);
    expect(target.go()).toBe('built-in');
    expect(target['drive-hum']).toBe(mine);
    expect(throttle).toEqual({ 'drive-hum': 0.2 });
  });

  it('the live SFX book lists every recipe', () => {
    expect(SFX_NAMES).toEqual(Object.keys(SFX));
  });
});

describe('audio low-level access', () => {
  it('sfxCore() is null before unlock (and in node)', () => {
    const am = new AudioManager({ autoUnlock: false, startTimer: false });
    expect(am.sfxCore()).toBe(null);
  });
});

describe('song book', () => {
  it('every song id matches its key (extra songs included)', () => {
    for (const id of SONG_IDS) expect(SONGS[id].id).toBe(id);
  });
});
