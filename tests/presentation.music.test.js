// Showcase presentation: the title theme and per-screen menu music.
import { describe, it, expect } from 'vitest';
import menuMusic, { menuSongFor, TITLE_SONG, MENU_SONG } from '../src/systems/menuMusic.js';
import { SONGS } from '../src/audio/songs.js';
import { AudioManager } from '../src/audio/AudioManager.js';
import { installSystems } from '../src/systems/index.js';
import { createStrictAudioContext } from './helpers/fakeAudio.js';
import { createFakeApp } from './helpers/headlessSession.js';
import title from '../src/audio/songs/skx-title.js';

describe('title theme', () => {
  it('is registered and plays on a strict Web Audio mock with no violations', () => {
    expect(title.id).toBe(TITLE_SONG);
    expect(SONGS[TITLE_SONG]).toBeTruthy();
    const { ctx, stats } = createStrictAudioContext();
    const am = new AudioManager({ createContext: () => ctx, startTimer: false, autoUnlock: false });
    am.unlock();
    am.playMusic(TITLE_SONG);
    for (let i = 0; i < 40; i++) { ctx.advance(0.25); am.tick?.(); }
    expect(am.currentMusic).toBe(TITLE_SONG);
    am.dispose();
    expect(stats.errors).toEqual([]);
    expect(stats.started).toBeGreaterThan(20);
  });
});

describe('menuSongFor', () => {
  it('title gets the theme, other menu screens the menu tune', () => {
    expect(menuSongFor('menu', 'title', MENU_SONG)).toBe(TITLE_SONG);
    expect(menuSongFor('menu', 'join', TITLE_SONG)).toBe(MENU_SONG);
    expect(menuSongFor('menu', 'title', TITLE_SONG)).toBe(null);
    expect(menuSongFor('menu', 'effects', MENU_SONG)).toBe(null);
  });
  it('never touches race / victory / other music, or anything outside the menus', () => {
    expect(menuSongFor('menu', 'title', 'victory')).toBe(null);
    expect(menuSongFor('menu', 'title', null)).toBe(null);
    expect(menuSongFor('race', 'title', MENU_SONG)).toBe(null);
    expect(menuSongFor('results', 'results', MENU_SONG)).toBe(null);
  });
});

describe('menu-music system', () => {
  it('swaps songs as the screen changes', () => {
    const menus = { screenId: 'title' };
    const app = createFakeApp({ menus, game: { state: 'menu', errors: [] } });
    app.audio.playMusic(MENU_SONG);
    const uninstall = installSystems(app.bus, app, [menuMusic]);
    app.bus.emit('frame', 0.016, app.game);
    expect(app.audio.currentMusic).toBe(TITLE_SONG);
    app.bus.emit('frame', 0.016, app.game);
    expect(app.audio.calls.music.filter((m) => m === TITLE_SONG)).toHaveLength(1); // no re-requests
    menus.screenId = 'join';
    app.bus.emit('frame', 0.016, app.game);
    expect(app.audio.currentMusic).toBe(MENU_SONG);
    menus.screenId = null;
    app.bus.emit('frame', 0.016, app.game);
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });
});
