// Showcase presentation: the 3D podium at the Grand Prix trophy ceremony, and the
// racers cheering in their own voices when the podium appears.
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import victoryPodium, {
  podiumMode, podiumSource, podiumCheers, CHEER_TIMES, readPodiumRects, PODIUM_CLASS,
} from '../src/systems/victoryPodium.js';
import { getCharacter } from '../src/characters/index.js';
import { VOICE_KINDS } from '../src/audio/voice.js';
import { installSystems } from '../src/systems/index.js';
import { createFakeApp } from './helpers/headlessSession.js';

const rect = (left, top) => ({ left, top, width: 120, height: 120 });
const step = (cls, place, r, portraitCls) => ({
  className: `${cls} ${cls === 'sk-step' ? 'sk-step' : 'sk-cer'}-${place}`,
  querySelector: (sel) => (sel.includes(portraitCls) ? { getBoundingClientRect: () => r } : null),
});
/** A fake DOM root with a ceremony podium (DOM order 2nd, 1st, 3rd like the screen). */
const ceremonyRoot = () => ({
  querySelector: (sel) => (sel === '.sk-cer-podium' ? {} : null),
  querySelectorAll: () => [
    step('sk-cer-step', 2, rect(300, 300), 'sk-cer-portrait'),
    step('sk-cer-step', 1, rect(500, 250), 'sk-cer-portrait'),
    step('sk-cer-step', 3, rect(700, 330), 'sk-cer-portrait'),
  ],
});
const gpResult = (finished = true) => ({
  finished,
  bestHumanPlace: 1,
  standings: [
    { characterId: 'stella', place: 1, points: 50 }, { characterId: 'dino', place: 2, points: 40 },
    { characterId: 'gumbo', place: 3, points: 31 }, { characterId: 'rocco', place: 4, points: 20 },
  ],
});

describe('podiumMode', () => {
  const results = { state: 'results', lastResults: { standings: [{ characterId: 'rocco', place: 1 }] } };
  it('results screen -> results', () => {
    expect(podiumMode(results, { screenId: 'results' }, {})).toBe('results');
    expect(podiumMode(results, { screenId: 'results' }, null)).toBe(null);
  });
  it('the final GP standings only once the trophy ceremony is on screen', () => {
    const game = { state: 'standings', lastGp: gpResult() };
    const menus = { screenId: 'gp-standings' };
    expect(podiumMode(game, menus, {}, ceremonyRoot())).toBe('ceremony');
    expect(podiumMode(game, menus, {}, { querySelector: () => null })).toBe(null); // still tallying points
    expect(podiumMode(game, menus, {}, null)).toBe(null);
    expect(podiumMode(game, menus, null, ceremonyRoot())).toBe(null);
    expect(podiumMode({ ...game, lastGp: gpResult(false) }, menus, {}, ceremonyRoot())).toBe(null); // between races
    expect(podiumMode({ ...game, lastGp: { finished: true, standings: [] } }, menus, {}, ceremonyRoot())).toBe(null);
    expect(podiumMode({ ...game, state: 'menu' }, menus, {}, ceremonyRoot())).toBe(null);
    expect(podiumMode(game, { screenId: 'results' }, {}, ceremonyRoot())).toBe(null);
  });
  it('podiumSource hands back the standings and their identity', () => {
    const gp = gpResult();
    expect(podiumSource('ceremony', { lastGp: gp })).toEqual({ key: gp, standings: gp.standings });
    expect(podiumSource('results', results).standings).toBe(results.lastResults.standings);
    expect(podiumSource(null, results)).toBe(null);
  });
});

describe('readPodiumRects on the ceremony', () => {
  it('maps the ceremony steps to places', () => {
    const out = readPodiumRects(ceremonyRoot());
    expect(out.rects.map((r) => r.left)).toEqual([500, 300, 700]);
    expect(out.winnerRect.left).toBe(500);
  });
});

describe('podiumCheers', () => {
  it('winner first with a win line, then 2nd and 3rd say yay, panned to their steps', () => {
    const defs = ['stella', 'dino', 'gumbo'].map(getCharacter);
    const c = podiumCheers(defs);
    expect(c.map((x) => x.def.id)).toEqual(['stella', 'dino', 'gumbo']);
    expect(c.map((x) => x.kind)).toEqual(['win', 'yay', 'yay']);
    for (const x of c) expect(VOICE_KINDS).toContain(x.kind);
    expect(c.map((x) => x.at)).toEqual([...CHEER_TIMES]);
    expect(c[1].pan).toBeLessThan(0);
    expect(c[2].pan).toBeGreaterThan(0);
    for (let i = 1; i < CHEER_TIMES.length; i++) expect(CHEER_TIMES[i]).toBeGreaterThan(CHEER_TIMES[i - 1]);
  });
  it('copes with fewer racers and junk', () => {
    expect(podiumCheers([getCharacter('rocco')])).toHaveLength(1);
    expect(podiumCheers([null, getCharacter('rocco')])).toHaveLength(1);
    expect(podiumCheers()).toEqual([]);
  });
});

describe('victory-podium system with a (fake) DOM + renderer', () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup(game, menus) {
    const classes = new Set();
    vi.stubGlobal('document', { body: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } } });
    vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 720 });
    const renderer = {
      domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) },
      getSize: (v) => v.set(1280, 720), setScissorTest: vi.fn(), setViewport: vi.fn(), render: vi.fn(),
    };
    const fakeModel = () => ({ group: new THREE.Group(), update() {}, dispose() {} });
    const app = createFakeApp({ game, menus, renderer, buildKartModel: fakeModel, prefs: { get: () => ({}), subscribe: () => () => {} } });
    const uninstall = installSystems(app.bus, app, [victoryPodium]);
    return { app, renderer, classes, uninstall };
  }

  it('dances at the trophy ceremony; 2nd and 3rd cheer (the screen voices the winner itself)', () => {
    const game = { state: 'standings', lastGp: gpResult(), errors: [] };
    const menus = { screenId: 'gp-standings', el: ceremonyRoot() };
    const { app, renderer, classes, uninstall } = setup(game, menus);
    for (let i = 0; i < 70; i++) app.bus.emit('frame', 1 / 30, game);
    const p = game.podium();
    expect(p.mode).toBe('ceremony');
    expect(p.racers.map((r) => r.id)).toEqual(['stella', 'dino', 'gumbo']);
    expect(p.racers.every((r) => r.visible)).toBe(true);
    expect(classes.has(PODIUM_CLASS)).toBe(true);
    expect(renderer.render).toHaveBeenCalled();
    expect(app.audio.calls.voice.map((v) => `${v.id}:${v.kind}`)).toEqual(['dino:yay', 'gumbo:yay']);
    expect(app.audio.played('skx-podium')).toBe(0); // the ceremony has its own trophy fanfare
    // leaving the screen tears it all down
    game.state = 'menu';
    app.bus.emit('frame', 1 / 30, game);
    expect(game.podium()).toBe(null);
    expect(classes.has(PODIUM_CLASS)).toBe(false);
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });

  it('results screen: ta-da, then winner / 2nd / 3rd cheer in order, once each', () => {
    const game = {
      state: 'results', errors: [],
      lastResults: { standings: [{ characterId: 'muffin', place: 1 }, { characterId: 'bizzy', place: 2 }, { characterId: 'lenny', place: 3 }] },
    };
    const root = { querySelector: () => null, querySelectorAll: () => [1, 2, 3].map((pl) => step('sk-step', pl, rect(pl * 200, 300), 'sk-step-portrait')) };
    const menus = { screenId: 'results', el: root };
    const { app, uninstall } = setup(game, menus);
    app.bus.emit('frame', 1 / 30, game);
    expect(app.audio.played('skx-podium')).toBe(1);
    expect(app.audio.calls.voice).toHaveLength(0); // nobody talks over the ta-da
    for (let i = 0; i < 100; i++) app.bus.emit('frame', 1 / 30, game);
    expect(app.audio.calls.voice.map((v) => `${v.id}:${v.kind}`)).toEqual(['muffin:win', 'bizzy:yay', 'lenny:yay']);
    expect(game.podium()).toMatchObject({ mode: 'results', cheersLeft: 0 });
    // a new race's results build a fresh podium (and fresh cheers)
    game.lastResults = { standings: [{ characterId: 'rocco', place: 1 }] };
    for (let i = 0; i < 30; i++) app.bus.emit('frame', 1 / 30, game);
    expect(app.audio.calls.voice.at(-1)).toMatchObject({ id: 'rocco', kind: 'win' });
    uninstall();
    expect(app.bus.errors).toEqual([]);
  });
});
