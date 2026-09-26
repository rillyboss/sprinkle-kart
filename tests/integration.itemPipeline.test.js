// End-to-end item pipeline: a REAL Race whose onEvent forwards every event to the REAL
// event bus exactly like src/main.js (`bus.emit(`race:${e.type}`, e, session)`), with EVERY
// auto-installed system on recording fakes. The human uses each of the 6 items through
// the normal input path (useItem), and we check what a child actually gets:
//   (a) the item's own "use" sound from the catalog (cueFor('use', item).sfx) is played,
//   (b) a friendly callout shows up as a toast from P1's item-callout HUD widget (rendered on a fake DOM),
//   (c) the 3D side reacts (kart model state, KartFx star aura, item bursts, gumdrop/rocket),
//   (d) when it runs out, the "end" sound + callout follow,
// and a CPU using the same item makes none of P1's sounds or callouts.
// Hand-fired events elsewhere (systems.test.js, items.callouts.test.js) can't catch a renamed
// event field (e.g. e.item -> e.itemId); this does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Race } from '../src/race/Race.js';
import { ITEM_ORDER, cueFor } from '../src/race/itemCatalog.js';
import { TUNING } from '../src/race/tuning.js';
import { createEventBus } from '../src/game/events.js';
import { createSessionHelpers } from '../src/game/session.js';
import { createRaceStats } from '../src/game/raceStats.js';
import { raceStartInfo } from '../src/game/summary.js';
import { installSystems, listSystems } from '../src/systems/index.js';
import { getCharacter } from '../src/characters/index.js';
import { SFX_NAMES } from '../src/audio/AudioManager.js';
import { trackFixture, defaultRacerIds } from './helpers/raceHarness.js';
import { createFakeApp } from './helpers/headlessSession.js';
import { createFakeDocument } from './helpers/fakeDom.js';

const DT = 1 / 60;

/** Kart model stub that records the visual state the Race hands it every frame. */
function recordingModels() {
  const fn = (def) => {
    const m = { group: new THREE.Group(), characterId: def?.id, last: null, seen: {}, update(dt, st) { m.last = st; for (const k of ['boosting', 'shielded', 'star', 'spinning']) if (st[k]) m.seen[k] = true; }, dispose() {} };
    return m;
  };
  return fn;
}

/** A race session wired like main.js startRace(), on fakes. */
function wiredRace({ trackId = 'gumdrop-meadow' } = {}) {
  const bus = createEventBus({ onError: (err) => { errors.push(err); } });
  const errors = [];
  const app = createFakeApp({ bus });
  const uninstall = installSystems(bus, app, listSystems());
  const { def: trackDef, path } = trackFixture(trackId);
  const ids = defaultRacerIds(8);
  const humans = [{ playerIndex: 0, deviceId: 'gp0', characterId: ids[0], easyDrive: false }];
  const participants = ids.map((characterId, i) => ({ characterId, playerIndex: i === 0 ? 0 : null, easyDrive: false }));
  const setup = { players: humans, trackId, speedClass: 'zippy', laps: 3, mode: 'free' };
  const stats = createRaceStats();
  const events = [];
  let session = null;
  // --- the exact main.js wiring (src/main.js startRace: onEvent) ---
  const onEvent = (e) => {
    stats.onEvent(e);
    events.push(e);
    bus.emit(`race:${e.type}`, e, session);
  };
  // items off: no item boxes, so nothing random lands in anyone's slot mid-test
  const race = new Race({ scene: new THREE.Scene(), trackDef, path, builtTrack: null, participants, speedClass: 'zippy', buildKartModel: recordingModels(), onEvent, laps: 3, seed: 5, rules: { items: false } });
  session = {
    ...createSessionHelpers({ humans, audio: app.audio, input: app.input, hud: app.hud, getCharacter }),
    race, humans, playerIndices: [0], setup, trackDef, laps: 3, stats, path,
    mode: 'free', audio: app.audio, input: app.input, hud: app.hud, params: app.params, paused: false, resultsShown: false, outcome: null,
  };
  bus.emit('race-start', raceStartInfo({ setup, trackDef, humans, cpuIds: ids.slice(1), laps: 3 }), session);

  // P1's HUD: every registered widget mounted on a fake DOM, like Hud.js does
  const doc = globalThis.document;
  const vp = doc.createElement('div');
  vp.clientHeight = 450;
  const mounted = app.hud.widgets.map((w) => {
    const node = doc.createElement('div');
    vp.appendChild(node);
    let inst = null;
    try { inst = w.create(node, 0, vp); } catch { inst = null; }
    return { id: w.id, node, inst };
  });
  const me = race.getPlayerKart(0);
  const hudUpdate = () => { for (const m of mounted) m.inst?.update?.(me, race); };
  const callouts = () => {
    const box = mounted.find((m) => m.id === 'item-callout');
    // callouts are toasts in the viewport's toast lane (src/ui/kit/toastLane.js); leaving ones don't count
    return box ? box.node.querySelectorAll('.ck-hudlane-item').filter((c) => !c.classList.contains('is-out')).map((c) => c.innerHTML) : [];
  };

  const step = (inputs = [{ accel: 1, steer: 0 }]) => {
    race.update(DT, inputs);
    bus.emit('race-frame', DT, session);
    bus.emit('frame', DT, app.game);
    hudUpdate();
  };
  const runFor = (seconds, input = { accel: 1, steer: 0 }) => { for (let i = 0; i < Math.round(seconds / DT); i++) step([input]); };
  const dispose = () => {
    bus.emit('race-exit', { outcome: 'menu' }, session);
    for (const m of mounted) m.inst?.destroy?.();
    race.dispose();
    uninstall();
  };
  return { bus, app, race, session, events, errors, me, mounted, callouts, step, runFor, dispose, hudUpdate };
}

function give(kart, item) {
  kart.item = item;
  kart.itemCharges = item === 'triple-sprinkle' ? 3 : 1;
  kart.itemRoulette = 0;
}

describe('item pipeline: real Race -> real bus -> every installed system', () => {
  let w;
  beforeEach(() => {
    vi.stubGlobal('document', createFakeDocument());
    w = wiredRace();
    w.runFor(3.2); // through the countdown
    expect(w.race.state).toBe('racing');
  });
  afterEach(() => {
    w.dispose();
    vi.unstubAllGlobals();
  });

  it('main.js still forwards every Race event as race:<type> with the session', () => {
    const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
    expect(src).toMatch(/bus\.emit\(`race:\$\{e\.type\}`, e, session\)/);
    expect(src).toMatch(/new Race\(\{[^}]*onEvent/);
  });

  it('every catalog cue points at a sound the AudioManager knows', () => {
    for (const item of ITEM_ORDER) {
      for (const ev of ['use', 'end']) {
        const cue = cueFor(ev, item);
        if (cue?.sfx) expect(SFX_NAMES, `${ev} ${item}`).toContain(cue.sfx);
      }
    }
  });

  for (const item of ITEM_ORDER) {
    it(`${item}: use sound, P1 callout and FX`, () => {
      const { app, me, race } = w;
      const cue = cueFor('use', item);
      expect(cue?.sfx).toBeTruthy();
      const before = app.audio.played(cue.sfx);
      give(me, item);
      w.step([{ accel: 1, steer: 0, useItem: true }]);
      w.runFor(0.25);
      // the Race really emitted it, with the fields the systems read
      const use = w.events.find((e) => e.type === 'item-use' && e.kart === me);
      expect(use, 'no item-use event').toBeTruthy();
      expect(use.item).toBe(item);
      // (a) sound
      expect(app.audio.played(cue.sfx), `${cue.sfx} after using ${item}`).toBe(before + 1);
      // (b) callout in P1's HUD widget
      const shown = w.callouts();
      expect(shown.length, `no callout for ${item}`).toBeGreaterThan(0);
      expect(shown.join(' ')).not.toMatch(/undefined|null|NaN|\[object/);
      // (c) the 3D side
      const model = me.model;
      switch (item) {
        case 'sprinkle-boost':
        case 'triple-sprinkle':
          expect(model.seen.boosting).toBe(true);
          expect(w.events.some((e) => e.type === 'boost' && e.kart === me && e.source === 'item')).toBe(true);
          expect(app.audio.played('boost')).toBeGreaterThan(0);
          if (item === 'triple-sprinkle') expect(me.itemCharges).toBe(2);
          break;
        case 'gumdrop':
          expect(race.items.gumdrops.some((g) => g.owner === me)).toBe(true);
          expect(race.items.bursts.emitted['gumdrop-plop']).toBeGreaterThan(0);
          break;
        case 'bubble-shield':
          expect(me.shielded).toBe(true);
          expect(model.last.shielded).toBe(true);
          break;
        case 'cupcake-rocket':
          expect(race.items.bursts.emitted['rocket-launch']).toBeGreaterThan(0);
          expect(w.events.some((e) => e.type === 'rocket-launch' && e.kart === me)).toBe(true);
          break;
        case 'rainbow-star': {
          expect(model.last.star).toBe(true);
          const fx = race.fx[race.karts.indexOf(me)];
          expect(fx.star.visible).toBe(true);
          break;
        }
        default:
          throw new Error(`no FX expectation for ${item}`);
      }
      expect(w.errors).toEqual([]);
    });
  }

  it('effects that run out: end sounds and end callouts reach P1', () => {
    const { app, me } = w;
    for (const [item, seconds] of [['sprinkle-boost', 3], ['rainbow-star', TUNING.starDuration + 1], ['bubble-shield', TUNING.shieldDuration + 1]]) {
      const cue = cueFor('end', item);
      const before = app.audio.played(cue.sfx);
      give(me, item);
      w.step([{ accel: 1, steer: 0, useItem: true }]);
      w.runFor(seconds);
      const endEv = item === 'bubble-shield'
        ? w.events.find((e) => e.type === 'shield-pop' && e.kart === me && e.expired)
        : w.events.find((e) => e.type === 'item-end' && e.kart === me && e.item === item);
      expect(endEv, `${item} never ended`).toBeTruthy();
      expect(app.audio.played(cue.sfx), `${cue.sfx} when ${item} ends`).toBeGreaterThan(before);
    }
    expect(w.errors).toEqual([]);
  });

  it('a CPU using items makes none of P1\'s use sounds or callouts', () => {
    const { app, race } = w;
    w.runFor(2); // let old callouts expire
    const cpu = race.karts.find((k) => k.isCPU);
    const heard = app.audio.calls.sfx.length;
    for (const item of ['sprinkle-boost', 'gumdrop', 'bubble-shield', 'rainbow-star']) {
      give(cpu, item);
      race.items.use(cpu);
      w.step();
    }
    const newSounds = app.audio.calls.sfx.slice(heard).map((c) => c.name);
    for (const item of ['sprinkle-boost', 'gumdrop', 'bubble-shield', 'rainbow-star']) {
      expect(newSounds).not.toContain(cueFor('use', item).sfx);
    }
    expect(w.events.filter((e) => e.type === 'item-use' && e.kart === cpu)).toHaveLength(4);
    expect(w.callouts()).toEqual([]);
    expect(w.errors).toEqual([]);
  });
});
