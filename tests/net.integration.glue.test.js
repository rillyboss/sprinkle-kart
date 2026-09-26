/**
 * WS7 glue units: session helpers online (isHuman = LOCAL, allHumans / isAnyHuman / isLocal), the race-level
 * ctrl messages (SETUP / LOADED / RESULT), setup → local players / houses mapping, input latching and the
 * guest seat sampler's press counters, and progress ignoring predicted events (NETWORKING.md §9.6, §10.8, §12).
 */
import { describe, it, expect } from 'vitest';
import { createSessionHelpers } from '../src/game/session.js';
import { netStack } from '../src/online/stack.js';
import {
  isSessionBytes, encodeSetup, encodeLoaded, encodeResult, decodeRaceCtrl, raceTiming, raceParticipants, houseKartIds, setupHouses,
  driverHouses, localHumans, allSetupHumans, buildHostRaceSummary, localRaceSummary, createInputLatch, createSeatSampler,
  createPendingBytes, LOAD_TIMEOUT_MS,
} from '../src/online/netRace.js';
import { jsonEncode } from '../src/net/session/wire.js';
import { createFakeApp } from './helpers/headlessSession.js';
import { installSystems } from '../src/systems/index.js';
import progressUnlocks from '../src/systems/progressUnlocks.js';
import { createRaceStats } from '../src/game/raceStats.js';

const kart = (playerIndex, extra = {}) => ({ id: playerIndex ?? 9, playerIndex, isCPU: playerIndex === null, ...extra });

const SETUP = {
  raceId: 7, seed: 99, mode: 'free', speedClass: 'zippy', laps: 2, trackId: 'gumdrop-meadow', cpuIds: ['a', 'b'], protocol: 1, rules: {},
  participants: [
    { kartId: 0, gridSlot: 0, playerIndex: null, houseId: null, seat: null, characterId: 'a', easyDrive: false, paintId: 'original' },
    { kartId: 1, gridSlot: 1, playerIndex: null, houseId: null, seat: null, characterId: 'b', easyDrive: false, paintId: 'original' },
    { kartId: 2, gridSlot: 4, playerIndex: 0, houseId: 0, seat: 0, characterId: 'luna', easyDrive: false, paintId: 'original' },
    { kartId: 3, gridSlot: 2, playerIndex: 1, houseId: 1, seat: 1, characterId: 'rocco', easyDrive: true, paintId: 'mint' },
    { kartId: 4, gridSlot: 3, playerIndex: 2, houseId: 1, seat: 0, characterId: 'bizzy', easyDrive: false, paintId: 'original' },
  ],
};

describe('session helpers online (§10.8)', () => {
  const humans = [{ playerIndex: 1, deviceId: 'gp0' }, { playerIndex: 2, deviceId: 'kb1' }];
  const allHumans = [{ playerIndex: 0 }, ...humans, { playerIndex: 3 }];
  const flashes = [];
  const rumbles = [];
  const h = createSessionHelpers({ humans, allHumans, hud: { flash: (pi, t) => flashes.push([pi, t]) }, input: { rumble: (d) => rumbles.push(d) } });

  it('isHuman / isLocal = players on THIS machine; isAnyHuman = every human; CPUs are neither', () => {
    expect(h.online).toBe(true);
    expect(h.isHuman(kart(1))).toBe(true);
    expect(h.isHuman(kart(0))).toBe(false);
    expect(h.isLocal(kart(3))).toBe(false);
    expect(h.isAnyHuman(kart(3))).toBe(true);
    expect(h.isAnyHuman(kart(null))).toBe(false);
    expect(h.isLocal(kart(null))).toBe(false);
    expect(h.allHumans.map((p) => p.playerIndex)).toEqual([0, 1, 2, 3]);
    expect(h.playerIndices).toEqual([1, 2]);
  });

  it('flashes, rumble and devices only ever go to local karts (a friend\'s moment is never "yours")', () => {
    h.flash(kart(0), 'Mini-Turbo!');
    h.flash(kart(2), 'Lap 2!');
    h.rumble(kart(3), 1, 100);
    h.rumble(kart(1), 1, 100);
    expect(flashes).toEqual([[2, 'Lap 2!']]);
    expect(rumbles).toEqual(['gp0']);
    expect(h.deviceFor(kart(0))).toBe(null);
    expect(h.panFor(kart(0))).toBe(0);
  });

  it('offline (no allHumans) is exactly the old behaviour: every human is local', () => {
    const off = createSessionHelpers({ humans: [{ playerIndex: 0, deviceId: 'kb1' }] });
    expect(off.online).toBe(false);
    expect(off.isHuman(kart(5))).toBe(true);
    expect(off.isLocal(kart(5))).toBe(true);
    expect(off.isAnyHuman(kart(5))).toBe(true);
    expect(off.allHumans.map((p) => p.playerIndex)).toEqual([0]);
  });
});

describe('race-level ctrl messages', () => {
  it('SETUP round-trips the NetRaceSetup itself (§10.5)', () => {
    const b = encodeSetup(netStack, SETUP);
    expect(b[0]).toBe(netStack.wire.MSG.SETUP);
    expect(isSessionBytes(b)).toBe(false);
    expect(decodeRaceCtrl(netStack, b)).toEqual({ kind: 'setup', setup: SETUP });
  });

  it('LOADED is the 5-byte binary §6.2 layout', () => {
    const b = encodeLoaded(netStack, 0x01020304);
    expect(Array.from(b)).toEqual([0x2a, 4, 3, 2, 1]);
    expect(decodeRaceCtrl(netStack, b)).toEqual({ kind: 'loaded', raceId: 0x01020304 });
    expect(decodeRaceCtrl(netStack, b.subarray(0, 4))).toBe(null);
  });

  it('RESULT carries the summary', () => {
    const b = encodeResult(netStack, 7, { humans: [], online: true });
    expect(decodeRaceCtrl(netStack, b)).toEqual({ kind: 'result', raceId: 7, summary: { humans: [], online: true } });
  });

  it('session JSON, other netcode messages and junk are not race ctrl', () => {
    const session = jsonEncode({ type: 'LOBBY', lobby: {} });
    expect(isSessionBytes(session)).toBe(true);
    expect(decodeRaceCtrl(netStack, session)).toBe(null);
    expect(decodeRaceCtrl(netStack, netStack.wire.encodeCtrl(netStack.wire.MSG.PAUSE, { paused: true, reason: 0, tick: 1, epoch: 0 }))).toBe(null);
    expect(decodeRaceCtrl(netStack, new Uint8Array([0x29, 0x7b]))).toBe(null);
    expect(decodeRaceCtrl(netStack, netStack.wire.encodeCtrl(netStack.wire.MSG.SETUP, { participants: 'nope' }))).toBe(null);
    expect(decodeRaceCtrl(netStack, 'nope')).toBe(null);
    expect(isSessionBytes(new Uint8Array())).toBe(false);
  });
});

describe('setup → machines', () => {
  it('timing matches the Race countdown (3 s at 60 Hz, START at tick 1)', () => {
    const t = raceTiming(netStack);
    expect(t.startTick).toBe(1);
    // the host's exact float countdown (3 − 1/60 − 1/60 …) reaches 0 on its 181st step
    expect(t.goTick).toBe(netStack.makeCountdown(3).goTick);
    expect([180, 181]).toContain(t.goTick);
    expect(t.countdownAfter(0)).toBe(3);
    expect(t.countdownAfter(t.goTick)).toBe(0);
  });

  it('participants keep kart order, paint and grid slots', () => {
    const p = raceParticipants(SETUP);
    expect(p.map((x) => x.characterId)).toEqual(['a', 'b', 'luna', 'rocco', 'bizzy']);
    expect(p[3]).toMatchObject({ playerIndex: 1, easyDrive: true, paintId: 'mint', gridSlot: 2, houseId: 1, seat: 1 });
    expect(raceParticipants(null)).toEqual([]);
  });

  it('houses, kart ids in seat order and the host driver houses', () => {
    expect(setupHouses(SETUP)).toEqual([0, 1]);
    expect(houseKartIds(SETUP, 1)).toEqual([4, 3]); // seat 0 = kart 4, seat 1 = kart 3
    const houses = driverHouses(SETUP, 0, (h) => (h === 1 ? 'peer-b' : null));
    expect([...houses.entries()]).toEqual([[1, { peerId: 'peer-b', karts: [4, 3] }]]);
    expect(driverHouses(SETUP, 0, () => null).get(1).peerId).toBe('gone-1');
  });

  it('local humans map seats onto this machine\'s devices with GLOBAL player indices', () => {
    expect(localHumans(SETUP, 1, ['kb1', 'gp0'])).toEqual([
      { playerIndex: 2, deviceId: 'kb1', characterId: 'bizzy', easyDrive: false, seat: 0, kartId: 4, paintId: 'original' },
      { playerIndex: 1, deviceId: 'gp0', characterId: 'rocco', easyDrive: true, seat: 1, kartId: 3, paintId: 'mint' },
    ]);
    expect(localHumans(SETUP, 0, [])[0].deviceId).toBe(null);
    expect(allSetupHumans(SETUP, [{ playerIndex: 0, deviceId: 'kb1' }]).map((h) => [h.playerIndex, h.deviceId])).toEqual([[0, 'kb1'], [1, null], [2, null]]);
  });

  it('the HostRaceSummary has every human and no devices; each machine localizes it with its own devices', () => {
    const k = (id, pi, place, extra = {}) => ({ id, characterId: SETUP.participants[id].characterId, playerIndex: pi, isCPU: pi === null, finishPlace: place, finished: true, finishTime: 60 + place, lapTimes: [30, 30 + place], ...extra });
    const standings = [k(3, 1, 1), k(0, null, 2), k(2, 0, 3), k(4, 2, 4), k(1, null, 5)];
    const stats = createRaceStats();
    stats.onEvent({ type: 'item-use', kart: standings[0] });
    const host = buildHostRaceSummary({ setup: SETUP, trackDef: { id: 'gumdrop-meadow' }, standings, stats, laps: 2, raceTime: 64, local: [{ playerIndex: 0, deviceId: 'kb1' }] });
    expect(host.online).toBe(true);
    expect(host.raceId).toBe(7);
    expect(host.humans.map((h) => [h.playerIndex, h.deviceId])).toEqual([[0, null], [1, null], [2, null]]);
    expect(host.winner).toEqual({ playerIndex: 1, characterId: 'rocco' });
    const guest = localRaceSummary(host, [2, 1], [{ playerIndex: 2, deviceId: 'kb1' }, { playerIndex: 1, deviceId: 'gp0' }]);
    expect(guest.humans.map((h) => [h.playerIndex, h.deviceId])).toEqual([[1, 'gp0'], [2, 'kb1']]);
    expect(guest.winner).toEqual({ playerIndex: 1, characterId: 'rocco' });
    expect(guest.totals.itemsUsed).toBe(1);
    const hostLocal = localRaceSummary(host, [0], [{ playerIndex: 0, deviceId: 'kb1' }]);
    expect(hostLocal.winner).toBe(null);
    expect(hostLocal.humanCount).toBe(3);
    expect(hostLocal.humans.map((h) => h.deviceId)).toEqual(['kb1']);
  });
});

describe('inputs', () => {
  it('the host latch uses a frame\'s input for every tick but fires useItem once', () => {
    const l = createInputLatch();
    l.setFrame([{ steer: 1, useItem: true }, undefined, { steer: -1, useItem: false }]);
    expect(l.pending).toBe(1);
    const a = l.forTick();
    const b = l.forTick();
    expect(a[0]).toEqual({ steer: 1, useItem: true });
    expect(b[0]).toEqual({ steer: 1, useItem: false });
    expect(a[1]).toBeUndefined();
    expect(a[2].useItem).toBe(false);
    // a frame with 0 ticks keeps the press for the next tick
    l.setFrame([{ steer: 0, useItem: true }]);
    l.setFrame([{ steer: 0, useItem: false }]);
    expect(l.forTick()[0].useItem).toBe(true);
  });

  it('the guest seat counts item presses and drift edges (mod 8), holds analog, and robo sends neutral + the robo bit', () => {
    const s = createSeatSampler(4);
    expect(s.kartId).toBe(4);
    s.setFrame({ steer: 0.5, accel: 1, brake: 0, drift: true, useItem: true, lookBack: true });
    const t1 = s.sample();
    expect(t1).toMatchObject({ steer: 0.5, accel: 1, drift: true, lookBack: true, robo: false, itemCount: 1, hopCount: 1 });
    const t2 = s.sample(); // same frame, next tick: no second press, drift still held (no new edge)
    expect(t2).toMatchObject({ itemCount: 1, hopCount: 1, drift: true });
    s.setFrame({ drift: false });
    s.sample();
    s.setFrame({ drift: true });
    expect(s.sample().hopCount).toBe(2);
    for (let i = 0; i < 7; i++) { s.setFrame({ useItem: true }); s.sample(); }
    expect(s.counts.item).toBe(0); // 8 presses wrap to 0 (mod 8)
    s.setFrame({ steer: 1, accel: 1, useItem: true }, { robo: true });
    expect(s.sample()).toMatchObject({ steer: 0, accel: 0, robo: true, itemCount: 0 });
    s.setFrame(null);
    expect(s.sample()).toMatchObject({ steer: 0, accel: 0, drift: false, robo: false });
  });

  it('pending bytes replay in order and stop at the limit', () => {
    const p = createPendingBytes(2);
    p.push('h', 'ctrl', new Uint8Array([1]));
    p.push('h', 'state', new Uint8Array([2]));
    p.push('h', 'state', new Uint8Array([3]));
    const got = [];
    expect(p.size).toBe(2);
    expect(p.flush((peer, ch, b) => got.push([peer, ch, b[0]]))).toBe(2);
    expect(got).toEqual([['h', 'ctrl', 1], ['h', 'state', 2]]);
    p.push('h', 'ctrl', new Uint8Array([4]));
    p.clear();
    expect(p.size).toBe(0);
    expect(LOAD_TIMEOUT_MS).toBe(20000);
  });
});

describe('progress ignores predicted events (§9.6)', () => {
  it('a guest\'s predicted drift-boost / item-use never reaches the fallback tally', () => {
    const app = createFakeApp();
    let tallied = null;
    app.progress = { recordRace: (summary, { tallies }) => { tallied = tallies(0); return []; }, loadProgress: () => ({}) };
    const off = installSystems(app.bus, app, [progressUnlocks]);
    const k = { id: 0, playerIndex: 0, isCPU: false };
    app.bus.emit('race-start', {}, null);
    app.bus.emit('race:drift-boost', { type: 'drift-boost', kart: k, level: 2, predicted: true }, null);
    app.bus.emit('race:item-use', { type: 'item-use', kart: k, item: 'gumdrop', predicted: true }, null);
    app.bus.emit('race:item-use', { type: 'item-use', kart: k, item: 'gumdrop' }, null);
    app.bus.emit('race-end', { humans: [{ playerIndex: 0 }], unlocks: [] }, null);
    expect(tallied.miniTurbos).toBe(0);
    expect(tallied.itemsUsed).toBe(1);
    off();
  });
});
