import { describe, it, expect, beforeEach } from 'vitest';
import { createEventBus } from '../src/game/events.js';
import { createSessionHelpers } from '../src/game/session.js';
import { listSystems, installSystems } from '../src/systems/index.js';
import { buildRaceSummary } from '../src/game/summary.js';
import * as progress from '../src/progress/progress.js';

/** Fake audio / input / hud that record every call. */
function fakes() {
  const log = [];
  return {
    log,
    audio: {
      sfx: (name, opts) => log.push(['sfx', name, opts]),
      voice: (def, kind, opts) => log.push(['voice', def.id, kind, opts]),
      setMusicTempo: (m) => log.push(['tempo', m]),
    },
    input: { rumble: (dev, s, ms) => log.push(['rumble', dev, s, ms]) },
    hud: { flash: (pi, text) => log.push(['flash', pi, text]) },
  };
}

const human = (pi, extra = {}) => ({ playerIndex: pi, isCPU: false, characterId: 'rocco', charDef: { id: 'rocco' }, ...extra });
const cpu = (extra = {}) => ({ playerIndex: null, isCPU: true, characterId: 'lenny', charDef: { id: 'lenny' }, ...extra });

function setup(humansCount = 1) {
  const f = fakes();
  const bus = createEventBus({ onError: (err) => { throw err; } });
  const humans = Array.from({ length: humansCount }, (_, i) => ({ playerIndex: i, deviceId: `gp${i}`, characterId: 'rocco' }));
  const session = { ...createSessionHelpers({ humans, ...f }), race: { lapsTotal: 3 } };
  installSystems(bus, { audio: f.audio, input: f.input, hud: f.hud, progress });
  const fire = (type, e) => bus.emit(`race:${type}`, { type, ...e }, session);
  return { f, bus, session, fire };
}

describe('systems registry', () => {
  it('discovers the built-in reaction systems in order', () => {
    const ids = listSystems().map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['race-flow-reactions', 'driving-reactions', 'item-reactions', 'progress-unlocks']));
    const orders = listSystems().map((s) => s.order ?? 100);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    for (const s of listSystems()) expect(typeof s.install).toBe('function');
  });

  it('sorts by order then file name and skips non-systems', () => {
    const mods = {
      './b.js': { default: { id: 'b', install() {} } },
      './a.js': { default: { id: 'a', install() {} } },
      './early.js': { default: { id: 'early', order: 1, install() {} } },
      './helper.js': { something: 1 },
    };
    expect(listSystems(mods).map((s) => s.id)).toEqual(['early', 'a', 'b']);
  });

  it('keeps going when a system fails to install, and uninstalls all', () => {
    const bus = createEventBus();
    const errors = [];
    const orig = console.error;
    console.error = (...a) => errors.push(a);
    const offAll = installSystems(bus, {}, [
      { id: 'bad', install() { throw new Error('nope'); } },
      { id: 'good', install(b) { return b.on('frame', () => {}); } },
    ]);
    console.error = orig;
    expect(errors.length).toBe(1);
    expect(bus.count('frame')).toBe(1);
    offAll();
    expect(bus.count('frame')).toBe(0);
  });
});

describe('race reactions (moved out of main.js — behaviour unchanged)', () => {
  it('countdown / go beeps', () => {
    const { f, fire } = setup();
    fire('countdown', { n: 3 });
    fire('go', {});
    expect(f.log).toEqual([['sfx', 'countdown', { n: 3 }], ['sfx', 'go', {}]]);
  });

  it('lap callouts only for humans and not on the last lap; final lap speeds the music once', () => {
    const { f, fire } = setup();
    fire('lap', { kart: human(0), lap: 2 });
    fire('lap', { kart: human(0), lap: 3 });
    fire('lap', { kart: cpu(), lap: 2 });
    fire('final-lap', { kart: human(0) });
    fire('final-lap', { kart: human(0) });
    expect(f.log.filter((c) => c[0] === 'flash')).toEqual([['flash', 0, 'Lap 2! 🍭']]);
    expect(f.log.filter((c) => c[0] === 'tempo')).toEqual([['tempo', 1.12]]);
    expect(f.log.filter((c) => c[1] === 'final-lap')).toHaveLength(2);
  });

  it('winning and finishing celebrate with sound, voice and rumble', () => {
    const { f, fire } = setup();
    fire('finish', { kart: human(0), place: 1 });
    fire('finish', { kart: human(0), place: 4 });
    fire('finish', { kart: cpu(), place: 2 });
    expect(f.log).toEqual([
      ['sfx', 'win', { pan: 0 }], ['voice', 'rocco', 'win', { pan: 0 }], ['rumble', 'gp0', 0.6, 500],
      ['sfx', 'finish', { pan: 0 }], ['voice', 'rocco', 'yay', { pan: 0 }], ['rumble', 'gp0', 0.4, 250],
    ]);
  });

  it('rocket start and drift turbos show callouts', () => {
    const { f, fire } = setup();
    fire('boost', { kart: human(0), source: 'start' });
    fire('drift-level', { kart: human(0), level: 2 });
    fire('drift-boost', { kart: human(0), level: 3 });
    expect(f.log.filter((c) => c[0] === 'flash').map((c) => c[2])).toEqual(['Rocket Start! 🚀', 'Rainbow Turbo! 🌈']);
    expect(f.log.find((c) => c[1] === 'drift-spark')).toEqual(['sfx', 'drift-spark', { level: 2, pan: 0, volume: 0.7 }]);
  });

  it('bumps rumble both humans', () => {
    const { f, fire } = setup(2);
    fire('bump', { kart: human(0), other: human(1), strength: 0.5 });
    expect(f.log.filter((c) => c[0] === 'rumble').map((c) => c[1])).toEqual(['gp0', 'gp1']);
    f.log.length = 0;
    fire('bump', { kart: cpu(), other: cpu(), strength: 0.5 });
    expect(f.log).toEqual([]);
  });

  it('bonks: the bonked human hears it, the bonker gets a "Boop!"', () => {
    const { f, fire } = setup(2);
    const a = human(0);
    const b = human(1);
    fire('bonked', { kart: a, by: b, cause: 'rocket' });
    expect(f.log.filter((c) => c[0] === 'flash')).toEqual([['flash', 0, 'Bonk! 💫'], ['flash', 1, 'Boop! 🎯']]);
    f.log.length = 0;
    fire('bonked', { kart: a, by: a, cause: 'star' });
    expect(f.log.filter((c) => c[0] === 'flash')).toEqual([['flash', 0, 'Twirly-whirly! 🌈']]);
  });

  it('item sounds', () => {
    const { f, fire } = setup();
    fire('item-box', { kart: human(0), rolling: true });
    fire('item-get', { kart: human(0), item: 'rainbow-star' });
    fire('item-use', { kart: human(0), item: 'cupcake-rocket' });
    fire('item-use', { kart: human(0), item: 'sprinkle-boost' });
    fire('shield-pop', { kart: human(0) });
    expect(f.log.map((c) => c[1])).toEqual(['item-roulette', 'item-get', 'rocco', 'rocket', 'bubble']);
  });

  it('3-4 players pan sounds by screen column', () => {
    const { f, fire } = setup(4);
    fire('item-use', { kart: human(1), item: 'gumdrop' });
    fire('item-use', { kart: human(2), item: 'gumdrop' });
    expect(f.log.map((c) => c[2].pan)).toEqual([0.35, -0.35]);
  });
});

describe('progress-unlocks system', () => {
  beforeEach(() => progress.resetProgress());

  const summaryFor = (winner) => buildRaceSummary({
    setup: { speedClass: 'zippy', players: [] },
    trackDef: { id: 'gumdrop-meadow', cup: 'sprinkle-cup' },
    humans: [{ playerIndex: 0, deviceId: 'kb1', characterId: 'rocco', easyDrive: false }],
    standings: [
      { characterId: 'rocco', playerIndex: winner ? 0 : null, isCPU: !winner, finishPlace: 1, finished: true, finishTime: 60 },
      { characterId: 'lenny', playerIndex: winner ? null : 0, isCPU: !!winner, finishPlace: 2, finished: true, finishTime: 61 },
    ],
    laps: 3,
  });

  it('a human win records the trophy and unlocks Cotton Candy Girl once', () => {
    const { bus, session } = setup();
    const s1 = summaryFor(true);
    bus.emit('race-end', s1, session);
    expect(s1.unlocks).toEqual([{ kind: 'character', id: 'cotton-candy-girl' }]);
    expect(progress.isUnlocked('cotton-candy-girl')).toBe(true);
    expect(progress.loadProgress().trophies['gumdrop-meadow']).toBe(1);
    const s2 = summaryFor(true);
    bus.emit('race-end', s2, session);
    expect(s2.unlocks).toEqual([]);
  });

  it('no unlock without a human win', () => {
    const { bus, session } = setup();
    const s = summaryFor(false);
    bus.emit('race-end', s, session);
    expect(s.unlocks).toEqual([]);
    expect(progress.isUnlocked('cotton-candy-girl')).toBe(false);
  });
});
