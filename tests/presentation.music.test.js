// Showcase presentation: the title theme, the "Good try!" tune, music layers and the
// music director system (src/systems/menuMusic.js).
import { describe, it, expect } from 'vitest';
import menuMusic, {
  menuSongFor, layersFor, resultsSongFor, cupSongFor, LAYERS, CALM_SCREENS,
  TITLE_SONG, MENU_SONG, VICTORY_SONG, GOOD_TRY_SONG,
} from '../src/systems/menuMusic.js';
import { SONGS } from '../src/audio/songs.js';
import { compileSong } from '../src/audio/compile.js';
import { AudioManager, MUSIC_LAYERS, normalizeLayers } from '../src/audio/AudioManager.js';
import { installSystems, listSystems } from '../src/systems/index.js';
import { createStrictAudioContext } from './helpers/fakeAudio.js';
import { createFakeApp, fakeSession } from './helpers/headlessSession.js';
import title from '../src/audio/songs/skx-title.js';
import goodTry from '../src/audio/songs/skx-goodtry.js';

const FRIENDLY = /(kill|die|dead|destroy|hit|attack|shoot|weapon|lose|loser|fail|defeat)/i;

/** A real AudioManager on the strict Web Audio mock, unlocked. */
function realAudio() {
  const { ctx, stats } = createStrictAudioContext();
  const am = new AudioManager({ createContext: () => ctx, startTimer: false, autoUnlock: false });
  am.unlock();
  return { am, ctx, stats };
}

/** The fake AudioManager, taught the layer API like the real one. */
function layeredFakeApp(overrides = {}) {
  const app = createFakeApp(overrides);
  const audio = app.audio;
  let layers = null;
  audio.calls.layers = [];
  const play = audio.playMusic;
  audio.playMusic = (id) => { play(id); layers = id ? normalizeLayers({}) : null; };
  audio.setMusicLayers = (lv, fade) => {
    if (!layers) return false;
    audio.calls.layers.push({ lv, fade });
    layers = normalizeLayers(lv);
    return true;
  };
  Object.defineProperty(audio, 'musicLayers', { get: () => (layers ? { ...layers } : null) });
  return app;
}

const summaryWith = (places, extra = {}) => ({
  mode: 'free',
  humans: places.map((place, i) => ({ playerIndex: i, place, finished: true })),
  ...extra,
});

describe('title theme + good try tune', () => {
  for (const [song, id] of [[title, TITLE_SONG], [goodTry, GOOD_TRY_SONG]]) {
    it(`${id} is registered, compiles and plays on a strict Web Audio mock`, () => {
      expect(song.id).toBe(id);
      expect(SONGS[id]).toBe(song);
      const c = compileSong(song);
      expect(c.introSteps).toBeGreaterThan(0); // both open with a little fanfare
      expect(c.totalSteps).toBeGreaterThan(c.introSteps);
      const { am, ctx, stats } = realAudio();
      am.playMusic(id);
      for (let i = 0; i < 40; i++) { ctx.advance(0.25); am.tick?.(); }
      expect(am.currentMusic).toBe(id);
      am.dispose();
      expect(stats.errors).toEqual([]);
      expect(stats.started).toBeGreaterThan(20);
    });
  }

  it('the good try tune is major, happy and says nothing unkind', () => {
    const chords = [...goodTry.intro.chords, ...goodTry.main.chords];
    expect(chords[0]).toBe('F'); // home chord is major
    expect(chords.at(-1)).toMatch(/^C7?$|^F$/);
    const src = JSON.stringify(goodTry);
    expect(src).not.toMatch(FRIENDLY);
    expect(goodTry.bpm).toBeGreaterThanOrEqual(100); // still bouncy, not a sad ballad
  });
});

describe('AudioManager music layers', () => {
  it('ramps each part of the playing song and reads the levels back', () => {
    const { am, ctx, stats } = realAudio();
    expect(am.setMusicLayers({ drums: 0 })).toBe(false); // no song yet
    expect(am.musicLayers).toBe(null);
    am.playMusic('castle');
    expect(am.musicLayers).toEqual(Object.fromEntries(MUSIC_LAYERS.map((k) => [k, 1])));
    ctx.advance(0.5);
    expect(am.setMusicLayers({ drums: 0, lead: 0.5 }, 0.4)).toBe(true);
    expect(am.musicLayers).toMatchObject({ drums: 0, lead: 0.5, bass: 1, pad: 1 });
    const drums = am._seq.buses.drums.gain.events;
    expect(drums.at(-1)).toEqual(['lin', 0, 0.5 + 0.4]);
    expect(drums.some((e) => e[0] === 'cancel')).toBe(true);
    // a new song starts with the whole band back
    am.playMusic('meadow');
    expect(am.musicLayers.drums).toBe(1);
    for (let i = 0; i < 20; i++) { ctx.advance(0.1); am.tick?.(); }
    am.dispose();
    expect(stats.errors).toEqual([]);
  });

  it('clamps silly levels and ignores unknown parts', () => {
    expect(normalizeLayers({ drums: 9, lead: -3, bass: NaN, kazoo: 0 })).toEqual({
      lead: 0, counter: 1, arp: 1, pad: 1, bass: 1, drums: 1.5,
    });
    expect(normalizeLayers()).toEqual(Object.fromEntries(MUSIC_LAYERS.map((k) => [k, 1])));
    const { am, ctx, stats } = realAudio();
    am.playMusic('menu');
    expect(am.setMusicLayers({ drums: Infinity }, NaN)).toBe(true);
    expect(am.musicLayers.drums).toBe(1);
    ctx.advance(1);
    am.dispose();
    expect(stats.errors).toEqual([]);
  });

  it('is a silent no-op before audio unlocks (node / no Web Audio)', () => {
    const am = new AudioManager({ createContext: () => null, startTimer: false, autoUnlock: false });
    am.playMusic('menu');
    expect(am.setMusicLayers({ drums: 0 })).toBe(false);
    expect(am.musicLayers).toBe(null);
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
    expect(menuSongFor('menu', 'title', VICTORY_SONG)).toBe(null);
    expect(menuSongFor('menu', 'title', null)).toBe(null);
    expect(menuSongFor('race', 'title', MENU_SONG)).toBe(null);
    expect(menuSongFor('results', 'results', MENU_SONG)).toBe(null);
  });
});

describe('layersFor', () => {
  it('menus: lighter join screen, calm grown-up corners, full band elsewhere', () => {
    expect(layersFor({ state: 'menu', screenId: 'title' })).toBe('full');
    expect(layersFor({ state: 'menu', screenId: 'join' })).toBe('join');
    expect(layersFor({ state: 'menu', screenId: 'character-select' })).toBe('full');
    expect(layersFor({ state: 'menu', screenId: 'track-select' })).toBe('full');
    for (const id of CALM_SCREENS) expect(layersFor({ state: 'menu', screenId: id })).toBe('calm');
    expect(LAYERS.calm.drums).toBe(0);
  });
  it('races: countdown heartbeat, full band after GO, final lap turned up, soft when paused', () => {
    expect(layersFor({ state: 'race', raceState: 'countdown' })).toBe('countdown');
    expect(layersFor({ state: 'race', raceState: 'racing' })).toBe('full');
    expect(layersFor({ state: 'race', raceState: 'racing', finalLap: true })).toBe('finalLap');
    expect(layersFor({ state: 'race', raceState: 'finished', finalLap: true })).toBe('full');
    expect(layersFor({ state: 'paused', screenId: 'pause', raceState: 'racing', finalLap: true })).toBe('paused');
    expect(layersFor({ state: 'paused', screenId: 'photo-mode' })).toBe('paused');
    expect(layersFor({ state: 'results', screenId: 'results' })).toBe('full');
    expect(layersFor({ state: 'standings' })).toBe('full');
    expect(layersFor()).toBe('full');
    expect(LAYERS.countdown.lead).toBe(0);
    expect(LAYERS.finalLap.drums).toBeGreaterThan(1);
    expect(LAYERS.paused.drums).toBe(0);
  });
  it('every mix is valid for AudioManager.setMusicLayers', () => {
    for (const [name, mix] of Object.entries(LAYERS)) {
      for (const [k, v] of Object.entries(mix)) {
        expect(MUSIC_LAYERS, `${name}.${k}`).toContain(k);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

describe('results songs', () => {
  it('podium places keep the fanfare, 4th and lower get the good try tune', () => {
    expect(resultsSongFor(summaryWith([1]))).toBe(VICTORY_SONG);
    expect(resultsSongFor(summaryWith([3]))).toBe(VICTORY_SONG);
    expect(resultsSongFor(summaryWith([4]))).toBe(GOOD_TRY_SONG);
    expect(resultsSongFor(summaryWith([8]))).toBe(GOOD_TRY_SONG);
  });
  it('split-screen: the best player at home decides', () => {
    expect(resultsSongFor(summaryWith([7, 2, 6]))).toBe(VICTORY_SONG);
    expect(resultsSongFor(summaryWith([7, 5, 6, 8]))).toBe(GOOD_TRY_SONG);
  });
  it('time trials, unknown places and estimated-only rows keep the fanfare', () => {
    expect(resultsSongFor(summaryWith([8], { mode: 'time-trial' }))).toBe(VICTORY_SONG);
    expect(resultsSongFor(null)).toBe(VICTORY_SONG);
    expect(resultsSongFor({ humans: [] })).toBe(VICTORY_SONG);
    expect(resultsSongFor({ humans: [{ place: 6, finished: false }] })).toBe(VICTORY_SONG);
  });
  it('a Grand Prix cup follows the best human place on points', () => {
    expect(cupSongFor({ bestHumanPlace: 1 })).toBe(VICTORY_SONG);
    expect(cupSongFor({ bestHumanPlace: 5 })).toBe(GOOD_TRY_SONG);
    expect(cupSongFor({})).toBe(VICTORY_SONG);
    expect(cupSongFor(null)).toBe(VICTORY_SONG);
  });
});

describe('menu-music system', () => {
  it('is auto-registered after the built-in systems', () => {
    expect(listSystems().map((s) => s.id)).toContain('menu-music');
    expect(menuMusic.order).toBeGreaterThan(40);
  });

  it('swaps songs as the screen changes, once per change', () => {
    const menus = { screenId: 'title' };
    const app = layeredFakeApp({ menus, game: { state: 'menu', errors: [] } });
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

  it('thins the band out per menu screen and only asks when the mix changes', () => {
    const menus = { screenId: 'join' };
    const app = layeredFakeApp({ menus, game: { state: 'menu', errors: [] } });
    app.audio.playMusic(MENU_SONG);
    const uninstall = installSystems(app.bus, app, [menuMusic]);
    const frame = () => app.bus.emit('frame', 0.016, app.game);
    frame(); frame(); frame();
    expect(app.audio.calls.layers).toHaveLength(1);
    expect(app.audio.musicLayers.drums).toBeCloseTo(LAYERS.join.drums);
    menus.screenId = 'settings';
    frame(); frame();
    expect(app.audio.calls.layers).toHaveLength(2);
    expect(app.audio.musicLayers.drums).toBe(0);
    menus.screenId = 'character-select';
    frame();
    expect(app.audio.musicLayers).toEqual(normalizeLayers({}));
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });

  it('race: countdown heartbeat, band in at GO, final lap up, pause soft, back again', () => {
    const race = { state: 'countdown', lapsTotal: 3, karts: [], getPlayerKart: () => null };
    const game = { state: 'race', race, errors: [] };
    const app = layeredFakeApp({ menus: { screenId: null }, game });
    const uninstall = installSystems(app.bus, app, [menuMusic]);
    const session = fakeSession(app, { humans: 1, race });
    const frame = () => app.bus.emit('frame', 0.016, game);
    app.bus.emit('race-start', {}, session);
    app.audio.playMusic('castle');
    frame();
    expect(app.audio.musicLayers.lead).toBe(0);
    expect(app.audio.musicLayers.drums).toBeCloseTo(LAYERS.countdown.drums);
    expect(game.music()).toMatchObject({ song: 'castle', mix: 'countdown', layers: { lead: 0 } }); // window.__game.music()
    race.state = 'racing';
    frame();
    expect(app.audio.musicLayers).toEqual(normalizeLayers({}));
    expect(app.audio.calls.layers.at(-1).fade).toBeLessThan(0.5); // the band crashes in fast at GO
    // a CPU on its final lap changes nothing; a human does
    app.bus.emit('race:final-lap', { kart: { playerIndex: null, isCPU: true } }, session);
    frame();
    expect(app.audio.musicLayers.drums).toBe(1);
    app.bus.emit('race:final-lap', { kart: { playerIndex: 0, isCPU: false } }, session);
    frame();
    expect(app.audio.musicLayers.drums).toBeCloseTo(LAYERS.finalLap.drums);
    game.state = 'paused';
    frame();
    expect(app.audio.musicLayers.drums).toBe(0);
    expect(app.audio.musicLayers.lead).toBeCloseTo(LAYERS.paused.lead);
    expect(game.music().mix).toBe('paused');
    game.state = 'race';
    frame();
    expect(app.audio.musicLayers.drums).toBeCloseTo(LAYERS.finalLap.drums);
    // next race starts plain again
    app.bus.emit('race-start', {}, session);
    app.audio.playMusic('meadow');
    frame();
    expect(app.audio.musicLayers.drums).toBe(1);
    uninstall();
    expect(game.music()).toBe(null);
    expect(app.bus.errors).toEqual([]);
  });

  it('results: swaps the fanfare for the good try tune only when nobody made the top 3', () => {
    const game = { state: 'race', race: { state: 'finished' }, errors: [] };
    const app = layeredFakeApp({ menus: { screenId: null }, game });
    const uninstall = installSystems(app.bus, app, [menuMusic]);
    const session = fakeSession(app, { humans: 2 });
    const frame = () => app.bus.emit('frame', 0.016, game);
    // like main.js: race-end, then the fanfare, then the results screen
    app.bus.emit('race-start', {}, session);
    app.bus.emit('race-end', summaryWith([5, 7]), session);
    app.audio.playMusic(VICTORY_SONG);
    game.state = 'results';
    frame();
    expect(app.audio.currentMusic).toBe(GOOD_TRY_SONG);
    frame();
    expect(app.audio.calls.music.filter((m) => m === GOOD_TRY_SONG)).toHaveLength(1);
    // a podium finish keeps the fanfare
    game.state = 'race';
    app.bus.emit('race-start', {}, session);
    app.bus.emit('race-end', summaryWith([5, 2]), session);
    app.audio.playMusic(VICTORY_SONG);
    game.state = 'results';
    frame(); frame();
    expect(app.audio.currentMusic).toBe(VICTORY_SONG);
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });

  it('Grand Prix: the race results and the cup ceremony each pick their own tune', () => {
    const game = { state: 'race', race: { state: 'finished' }, errors: [] };
    const app = layeredFakeApp({ menus: { screenId: null }, game });
    const uninstall = installSystems(app.bus, app, [menuMusic]);
    const session = fakeSession(app, { humans: 1 });
    const frame = () => app.bus.emit('frame', 0.016, game);
    app.bus.emit('race-start', {}, session);
    // won the last race (fanfare) but finished the cup 4th on points (good try)
    app.bus.emit('race-end', summaryWith([1], { mode: 'grand-prix' }), session);
    app.bus.emit('gp-end', { bestHumanPlace: 4 }, session);
    app.audio.playMusic(VICTORY_SONG);
    game.state = 'results';
    frame();
    expect(app.audio.currentMusic).toBe(VICTORY_SONG);
    game.state = 'standings';
    app.audio.playMusic(VICTORY_SONG);
    frame();
    expect(app.audio.currentMusic).toBe(GOOD_TRY_SONG);
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });

  it('a pending swap is dropped when the players leave for the menus', () => {
    const game = { state: 'race', race: null, errors: [] };
    const app = layeredFakeApp({ menus: { screenId: 'join' }, game });
    const uninstall = installSystems(app.bus, app, [menuMusic]);
    const session = fakeSession(app, { humans: 1 });
    app.bus.emit('race-start', {}, session);
    app.bus.emit('race-end', summaryWith([8]), session);
    game.state = 'menu';
    app.audio.playMusic(MENU_SONG);
    app.bus.emit('frame', 0.016, game);
    app.audio.playMusic(VICTORY_SONG); // e.g. something else plays the fanfare later
    game.state = 'results';
    app.bus.emit('frame', 0.016, game);
    expect(app.audio.currentMusic).toBe(VICTORY_SONG);
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });

  it('works with the real AudioManager: layers ramp on the song buses, no Web Audio violations', () => {
    const { am, ctx, stats } = realAudio();
    const menus = { screenId: 'title' };
    const game = { state: 'menu', race: null, errors: [] };
    const app = createFakeApp({ audio: am, menus, game });
    am.playMusic(MENU_SONG);
    const uninstall = installSystems(app.bus, app, [menuMusic]);
    const run = (n = 5) => { for (let i = 0; i < n; i++) { ctx.advance(0.05); am.tick?.(); app.bus.emit('frame', 0.05, game); } };
    run();
    expect(am.currentMusic).toBe(TITLE_SONG);
    menus.screenId = 'join';
    run();
    expect(am.currentMusic).toBe(MENU_SONG);
    expect(am.musicLayers.drums).toBeCloseTo(LAYERS.join.drums);
    menus.screenId = 'collection';
    run();
    expect(am.musicLayers.drums).toBe(0);
    expect(am._seq.buses.drums.gain.events.at(-1)[1]).toBe(0);
    game.state = 'race';
    game.race = { state: 'countdown' };
    am.playMusic('galaxy');
    run();
    expect(am.musicLayers.lead).toBe(0);
    game.race.state = 'racing';
    run();
    expect(am.musicLayers.lead).toBe(1);
    uninstall();
    am.dispose();
    expect(stats.errors).toEqual([]);
    expect(app.bus.errors).toEqual([]);
  });

  it('copes with a bare audio object (no layer API) and with no audio at all', () => {
    const game = { state: 'menu', errors: [] };
    const app = createFakeApp({ menus: { screenId: 'settings' }, game });
    app.audio.playMusic(MENU_SONG);
    const uninstall = installSystems(app.bus, app, [menuMusic]);
    app.bus.emit('frame', 0.016, game);
    app.audio = null;
    app.bus.emit('frame', 0.016, game);
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });
});
