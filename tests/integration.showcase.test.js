// Integration of the two showcase branches (presentation + features):
// Paint Shop colours reach every kart builder (races, 3D podium, title show),
// and the new browsing screens get the calm menu music.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

// capture every def the default kart builder is asked to build
const built = vi.hoisted(() => []);
vi.mock('../src/characters/model.js', async (orig) => {
  const real = await orig();
  return {
    ...real,
    buildKartModel: (def) => {
      built.push(def);
      const group = new THREE.Group();
      return { group, characterId: def?.id, update() {}, dispose() {} };
    },
  };
});

import { paintedBuilder, paintedDef, PAINT_KEY, PAINTS, ORIGINAL } from '../src/modes/paint.js';
import { buildAttractShow } from '../src/systems/titleAttract.js';
import { CALM_SCREENS, layersFor } from '../src/systems/menuMusic.js';
import { CHARACTERS } from '../src/characters/index.js';
import { findTrack } from '../src/tracks/index.js';
import { buildPodiumStage } from '../src/presentation/podium.js';
import daily from '../src/ui/screens/daily.js';
import myCup from '../src/ui/screens/myCup.js';
import paintShop from '../src/ui/screens/paintShop.js';
import howToPlay from '../src/ui/screens/howToPlay.js';

const stubTrack = () => ({ group: new THREE.Group() });

function fakeStorage(init = {}) {
  const data = { ...init };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

describe('paintedBuilder', () => {
  const rocco = CHARACTERS[0];

  it('builds each kart in its saved paint and leaves unpainted racers alone', () => {
    const seen = [];
    const build = paintedBuilder((def) => { seen.push(def); return def; }, () => ({ [rocco.id]: 'mint' }));
    const a = build(rocco);
    const b = build(CHARACTERS[1]);
    expect(a.paintId).toBe('mint');
    expect(a.colors.kart).toBe(PAINTS.find((p) => p.id === 'mint').color);
    expect(a.paint).toBe(a.colors.kart);
    expect(b).toBe(CHARACTERS[1]);
    expect(rocco.paintId).toBeUndefined(); // original def untouched
    expect(seen).toHaveLength(2);
  });

  it('matches paintedDef exactly for every paint pot', () => {
    for (const p of PAINTS) {
      const build = paintedBuilder((d) => d, () => ({ [rocco.id]: p.id }));
      expect(build(rocco)).toEqual(paintedDef(rocco, p.id));
    }
  });

  it('storage that throws or returns junk means own colours, never a crash', () => {
    const boom = paintedBuilder((d) => d, () => { throw new Error('storage off'); });
    expect(boom(rocco)).toBe(rocco);
    const nul = paintedBuilder((d) => d, () => null);
    expect(nul(rocco)).toBe(rocco);
    const junk = paintedBuilder((d) => d, () => ({ [rocco.id]: 'glitter-bomb' }));
    expect(junk(rocco)).toBe(rocco);
    const orig = paintedBuilder((d) => d, () => ({ [rocco.id]: ORIGINAL }));
    expect(orig(rocco)).toBe(rocco);
  });

  it('copes with a missing def', () => {
    const build = paintedBuilder((d) => d ?? 'none', () => ({}));
    expect(build(undefined)).toBe('none');
  });

  it('reads paints once when made (a race keeps the paint it started with)', () => {
    let calls = 0;
    const build = paintedBuilder((d) => d, () => { calls++; return {}; });
    build(rocco); build(rocco); build(rocco);
    expect(calls).toBe(1);
  });
});

describe('Paint Shop colours in the showcase extras', () => {
  let saved;
  beforeEach(() => {
    built.length = 0;
    saved = globalThis.localStorage;
  });
  afterEach(() => {
    if (saved === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = saved;
  });

  it('the title show paints its CPU karts from the saved Paint Shop choices by default', () => {
    const racers = CHARACTERS.slice(0, 4);
    globalThis.localStorage = fakeStorage({ [PAINT_KEY]: JSON.stringify({ racers: { [racers[1].id]: 'grape' } }) });
    const show = buildAttractShow({ trackDef: findTrack('gumdrop-meadow'), racers, seed: 1, preroll: 0.2, deps: { buildTrackFn: stubTrack } });
    try {
      const byId = new Map(built.map((d) => [d.id, d]));
      expect(byId.get(racers[1].id).paintId).toBe('grape');
      for (const r of [racers[0], racers[2], racers[3]]) expect(byId.get(r.id).paintId).toBeUndefined();
    } finally {
      show.dispose?.();
    }
  });

  it('an injected title-show builder still wins (tests / tools)', () => {
    const racers = CHARACTERS.slice(0, 2);
    globalThis.localStorage = fakeStorage({ [PAINT_KEY]: JSON.stringify({ racers: { [racers[0].id]: 'grape' } }) });
    const mine = [];
    const show = buildAttractShow({
      trackDef: findTrack('gumdrop-meadow'), racers, seed: 1, preroll: 0.2,
      deps: { buildTrackFn: stubTrack, buildKartModelFn: (def) => { mine.push(def); return { group: new THREE.Group(), update() {}, dispose() {} }; } },
    });
    try {
      expect(mine.map((d) => d.id).sort()).toEqual(racers.map((r) => r.id).sort());
      expect(mine.every((d) => d.paintId === undefined)).toBe(true);
      expect(built).toHaveLength(0);
    } finally {
      show.dispose?.();
    }
  });

  it('the 3D podium builds painted karts through paintedBuilder', () => {
    const defs = CHARACTERS.slice(0, 3);
    const build = paintedBuilder((def) => { built.push(def); return { group: new THREE.Group(), update() {}, dispose() {} }; }, () => ({ [defs[0].id]: 'lemon' }));
    const st = buildPodiumStage({ charDefs: defs, buildKartModel: build });
    try {
      expect(built.map((d) => d.paintId)).toEqual(['lemon', undefined, undefined]);
    } finally {
      st?.dispose?.();
    }
  });

  it('the podium system and main.js default to the painted builder', () => {
    const podium = readFileSync(new URL('../src/systems/victoryPodium.js', import.meta.url), 'utf8');
    expect(podium).toMatch(/app\.buildKartModel \?\? paintedBuilder\(buildKartModel\)/);
    const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/paintedBuilder\(buildKartModel\)/);
  });
});

describe('calm music on the new browsing screens', () => {
  const newScreens = [daily, myCup, paintShop, howToPlay];

  it('Daily Sprinkle, My Cup, Paint Shop and How to Play play the calm mix (no drums)', () => {
    for (const s of newScreens) {
      expect(typeof s.id).toBe('string');
      expect(CALM_SCREENS.has(s.id)).toBe(true);
      expect(layersFor({ state: 'menu', screenId: s.id })).toBe('calm');
    }
  });

  it('the title and play-flow screens keep the full band (join has its own lighter mix)', () => {
    expect(CALM_SCREENS.has('join')).toBe(false);
    expect(layersFor({ state: 'menu', screenId: 'join' })).toBe('join');
    for (const id of ['title', 'mode-select', 'character-select', 'cup-select', 'arena-select']) {
      expect(CALM_SCREENS.has(id)).toBe(false);
      expect(layersFor({ state: 'menu', screenId: id })).toBe('full');
    }
  });
});

describe('CI has room for every smoke scenario', () => {
  it('the smoke job timeout fits the showcase scenarios (the old 45 min cut it off mid-run)', () => {
    const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const smokeJob = yml.slice(yml.indexOf('\n  smoke:'));
    const m = /timeout-minutes:\s*(\d+)/.exec(smokeJob);
    expect(m).not.toBe(null);
    expect(Number(m[1])).toBeGreaterThanOrEqual(75);
    const smoke = readFileSync(new URL('../scripts/smoke.mjs', import.meta.url), 'utf8');
    for (const id of ['showcase', 'modes-battle', 'modes-team', 'modes-daily', 'modes-my-cup', 'modes-tutorial', 'modes-paint']) {
      expect(smoke).toContain(`'${id}'` === "'showcase'" ? 'showcase: showcaseTest' : `'${id}':`);
    }
  });
});
