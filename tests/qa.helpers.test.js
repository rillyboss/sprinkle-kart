// The shared test helpers (tests/helpers/*) are infrastructure other suites rely on,
// so they are tested too: each fake must behave like the real thing where it matters.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createFakeBus } from './helpers/fakeBus.js';
import { createFakeAudio, createStrictAudioContext } from './helpers/fakeAudio.js';
import { createInputRig, createFakeInput, FakeTarget, PAD } from './helpers/fakeInput.js';
import { runCpuRace, trackFixture, kartProblems, wallLimit, stubKartModel, defaultRacerIds } from './helpers/raceHarness.js';
import { runHeadlessSession, createFakeApp, fakeSession, createFakeProgress } from './helpers/headlessSession.js';
import { collectResources, watchDisposal, nonFiniteTransforms, nonFiniteVertices } from './helpers/threeInspect.js';
import { createFakeDocument, htmlOf } from './helpers/fakeDom.js';
import { kidRace, tracksOutsideCups } from './helpers/kidRace.js';
import { AudioManager, SFX_NAMES, SONG_IDS } from '../src/audio/AudioManager.js';
import { installSystems } from '../src/systems/index.js';
import raceFlowReactions from '../src/systems/raceFlowReactions.js';
import { TRACKS } from '../src/tracks/index.js';
import { CHARACTERS } from '../src/characters/index.js';

describe('fakeBus', () => {
  it('is the real bus (name checks, error isolation) plus an emit log', () => {
    const bus = createFakeBus();
    const got = [];
    bus.on('race-start', (info) => got.push(info.trackId));
    bus.on('race-start', () => { throw new Error('boom'); });
    bus.on('race-start', () => got.push('still called'));
    expect(bus.emit('race-start', { trackId: 'x' })).toBe(3);
    expect(got).toEqual(['x', 'still called']);
    expect(bus.errors.map((e) => [e.name, e.err.message])).toEqual([['race-start', 'boom']]);
    expect(() => bus.on('race-strat', () => {})).toThrow(/unknown event/);
    expect(() => bus.emit('nope')).toThrow(/unknown event/);
    bus.emit('race:anything', { type: 'anything' });
    expect(bus.countOf('race-start')).toBe(1);
    expect(bus.last('race:anything')).toEqual([{ type: 'anything' }]);
    expect(bus.last('race-end')).toBe(null);
    expect(bus.emittedNames()).toEqual(['race-start', 'race:anything']);
    expect(bus.names()).toContain('race-end'); // the declared list, untouched
    bus.reset();
    expect(bus.emittedNames()).toEqual([]);
    expect(bus.count('race-start')).toBe(3); // handlers survive reset()
  });

  it('once / off / define behave like the real bus', () => {
    const bus = createFakeBus();
    let n = 0;
    bus.once('frame', () => n++);
    bus.emit('frame', 1 / 60);
    bus.emit('frame', 1 / 60);
    expect(n).toBe(1);
    bus.define('qa-custom', '() test event');
    const off = bus.on('qa-custom', () => n++);
    bus.emit('qa-custom');
    off();
    bus.emit('qa-custom');
    expect(n).toBe(2);
    expect(bus.emitted('qa-custom')).toEqual([[], []]);
  });
});

describe('fakeAudio', () => {
  it('records the AudioManager API and returns a core only once unlocked', () => {
    const audio = createFakeAudio();
    expect(audio.sfxCore()).toBe(null);
    audio.sfx('boost', { pan: -0.3 });
    audio.sfx('boost');
    audio.voice({ id: 'rocco' }, 'win', { pan: 0 });
    audio.playMusic('castle');
    audio.setMusicTempo(1.12);
    audio.setVolume({ sfx: 0.5 });
    expect(audio.played('boost')).toBe(2);
    expect(audio.sfxNames()).toEqual(['boost', 'boost']);
    expect(audio.calls.voice).toEqual([{ id: 'rocco', kind: 'win', opts: { pan: 0 } }]);
    expect(audio.currentMusic).toBe('castle');
    expect(audio.tempo).toBe(1.12);
    expect(audio.volume.sfx).toBe(0.5);
    audio.unlock();
    const core = audio.sfxCore();
    expect(core && core.ctx && core.out && core.wet && core.noise).toBeTruthy();
    expect(audio.sfxCore()).toBe(core);
    // a sound built on the fake core goes through the strict checks
    const o = core.ctx.createOscillator();
    o.connect(core.out);
    o.start(core.ctx.currentTime);
    o.stop(core.ctx.currentTime + 0.1);
    audio.reset();
    expect(audio.calls.sfx).toEqual([]);
  });

  it('the strict context rejects what browsers reject', () => {
    const { ctx, stats } = createStrictAudioContext();
    const g = ctx.createGain();
    expect(() => g.gain.exponentialRampToValueAtTime(0, 1)).toThrow(/non-positive/);
    expect(() => g.gain.setValueAtTime(NaN, 0)).toThrow(/not finite/);
    expect(() => g.gain.linearRampToValueAtTime(1, -1)).toThrow(/negative/);
    const o = ctx.createOscillator();
    expect(() => o.stop(0)).toThrow(/before start/);
    o.start(1);
    expect(() => o.start(2)).toThrow(/twice/);
    expect(() => g.connect({})).toThrow(/non-node/);
    expect(stats.errors.length).toBe(6);
  });

  it('drives the real AudioManager through every sfx and song without a single violation', () => {
    const { ctx, stats } = createStrictAudioContext();
    const am = new AudioManager({ createContext: () => ctx, startTimer: false, autoUnlock: false });
    am.unlock();
    for (const name of SFX_NAMES) { am.sfx(name, { pan: 0.4, level: 2 }); ctx.advance(0.05); }
    for (const id of SONG_IDS) { am.playMusic(id); ctx.advance(0.3); am.tick?.(); }
    am.dispose();
    expect(stats.errors).toEqual([]);
    expect(stats.started).toBeGreaterThan(SFX_NAMES.length);
  });
});

describe('fakeInput', () => {
  it('createInputRig: the real InputManager on a fake window, pads and clock', () => {
    const rig = createInputRig();
    rig.target.keydown('KeyW');
    rig.frame();
    expect(rig.im.getDriveInput('kb1').accel).toBe(1);
    rig.target.keyup('KeyW');
    rig.target.tap('Enter'); // shorter than a frame: still delivered
    rig.frame();
    expect(rig.im.getDriveInput('kb1').accel).toBe(0);
    expect(rig.im.consumeMenuEvents().map((e) => `${e.deviceId}:${e.action}`)).toContain('kb1:confirm');

    const pad = rig.connectPad(0);
    rig.frame();
    expect(rig.im.getDevices().some((d) => d.id === 'gp0')).toBe(true);
    pad.press(PAD.A);
    rig.frame();
    expect(rig.im.consumeMenuEvents().map((e) => `${e.deviceId}:${e.action}`)).toContain('gp0:confirm');
    pad.release(PAD.A);
    pad.press(PAD.RT);
    pad.axis(0, 1);
    rig.frame();
    const drive = rig.im.getDriveInput('gp0');
    expect(drive.accel).toBeGreaterThan(0.5);
    expect(drive.steer).toBeGreaterThan(0.5);
    rig.disconnectPad(0);
    rig.frame();
    expect(rig.im.isConnected('gp0')).toBe(false);
    rig.im.dispose();
    expect(rig.target.count()).toBe(0);
  });

  it('createFakeInput: scripted menu / drive / pause / device events', () => {
    const input = createFakeInput();
    input.pushMenu('kb1', 'confirm');
    input.pushMenu('kb2', 'left');
    expect(input.consumeMenuEvents().map((e) => e.action)).toEqual(['confirm', 'left']);
    expect(input.consumeMenuEvents()).toEqual([]);
    input.setDrive('kb1', { accel: 1, steer: -0.5 });
    expect(input.getDriveInput('kb1')).toMatchObject({ accel: 1, steer: -0.5, brake: 0, drift: false });
    expect(input.getDriveInput('kb2').accel).toBe(0);
    input.pressPause('kb2');
    expect(input.isPausePressed('kb1')).toBe(false);
    expect(input.isPausePressed('kb2')).toBe(true);
    expect(input.isPausePressed('kb2')).toBe(false); // edge: once
    const changes = [];
    const off = input.onDeviceChange((e) => changes.push(`${e.type}:${e.deviceId}`));
    input.connect('gp1');
    input.disconnect('gp1');
    off();
    input.connect('gp2');
    expect(changes).toEqual(['connected:gp1', 'disconnected:gp1']);
    expect(input.isConnected('gp1')).toBe(false);
    input.rumble('gp2', 0.4, 100);
    expect(input.rumbles).toEqual([{ deviceId: 'gp2', strength: 0.4, ms: 100 }]);
    expect(new FakeTarget().count()).toBe(0);
  });
});

describe('raceHarness', () => {
  it('runs a full CPU race quickly and deterministically for a seed', () => {
    const a = runCpuRace(TRACKS[0].id, { laps: 1, seed: 42 });
    const b = runCpuRace(TRACKS[0].id, { laps: 1, seed: 42 });
    expect(a.finished).toBe(true);
    expect(a.problems).toEqual([]);
    expect(a.standings).toHaveLength(8);
    expect(a.standings.map((s) => s.characterId)).toEqual(b.standings.map((s) => s.characterId));
    expect(a.raceTime).toBeCloseTo(b.raceTime, 9);
    expect(a.eventCounts.countdown).toBe(3);
    expect(a.eventCounts.finish).toBeGreaterThanOrEqual(7);
    expect(a.models.every((m) => m.disposed)).toBe(true); // race.dispose() ran
  });

  it('autodriven humans go through the human input path', () => {
    const r = runCpuRace(TRACKS[0].id, { laps: 1, humans: 2, easyDrive: true });
    expect(r.standings.filter((s) => s.playerIndex !== null)).toHaveLength(2);
    expect(r.finished).toBe(true);
  });

  it('kartProblems spots NaN, runaway laterals and silly speeds', () => {
    const { path } = trackFixture(TRACKS[0].id);
    const kart = { characterId: 'qa', position: new THREE.Vector3(), velocity: new THREE.Vector3(), heading: 0, speed: 10, s: 5, lateral: 0, progress: 0, stats: { maxSpeed: 30 } };
    expect(kartProblems(kart, path)).toEqual([]);
    expect(kartProblems({ ...kart, position: new THREE.Vector3(NaN, 0, 0) }, path)[0]).toMatch(/position is not finite/);
    expect(kartProblems({ ...kart, lateral: wallLimit(path) + 1 }, path)[0]).toMatch(/beyond the soft wall/);
    expect(kartProblems({ ...kart, speed: 500 }, path)[0]).toMatch(/silly fast/);
    expect(kartProblems({ ...kart, s: -3 }, path)[0]).toMatch(/outside/);
    expect(kartProblems({ ...kart, heading: 9 }, path)[0]).toMatch(/not wrapped/);
  });

  it('knows every registered track and racer, and complains clearly about unknown tracks', () => {
    for (const t of TRACKS) expect(trackFixture(t.id).path.length).toBeGreaterThan(100);
    expect(trackFixture(TRACKS[0].id).path).toBe(trackFixture(TRACKS[0].id).path); // cached
    expect(() => trackFixture('no-such-track')).toThrow(/no registered track/);
    expect(defaultRacerIds(8)).toEqual(CHARACTERS.slice(0, 8).map((c) => c.id));
    expect(defaultRacerIds(CHARACTERS.length + 2)).toHaveLength(CHARACTERS.length + 2);
    const stub = stubKartModel();
    stub({ id: 'x' }).update();
    expect(stub.models[0]).toMatchObject({ characterId: 'x', updates: 1, disposed: false });
  });
});

describe('headlessSession', () => {
  it('runs a race through the bus + every real system like main.js', () => {
    const s = runHeadlessSession(TRACKS[0].id, { humans: 2, laps: 1, seed: 5 });
    expect(s.errors).toEqual([]);
    expect(s.problems).toEqual([]);
    const flow = s.bus.emittedNames();
    expect(flow[0]).toBe('race-start');
    expect(flow.at(-1)).toBe('race-exit');
    expect(flow.indexOf('race-end')).toBeGreaterThan(flow.lastIndexOf('race:race-complete'));
    expect(s.bus.countOf('race:countdown')).toBe(3);
    expect(s.bus.countOf('race-frame')).toBe(s.frames);
    expect(s.audio.played('countdown')).toBe(3);
    expect(s.audio.played('go')).toBe(1);
    expect(s.summary.humans).toHaveLength(2);
    for (const h of s.summary.humans) expect(h.finished).toBe(true);
    expect(s.summary.standings).toHaveLength(8);
  });

  it('fake app + session for hand-fired events', () => {
    const app = createFakeApp();
    installSystems(app.bus, app, [raceFlowReactions]);
    const session = fakeSession(app, { humans: 1 });
    const kart = { playerIndex: 0, isCPU: false, characterId: 'rocco', charDef: { id: 'rocco' } };
    app.bus.emit('race:finish', { type: 'finish', kart, place: 1 }, session);
    expect(app.audio.played('win')).toBe(1);
    expect(app.audio.calls.voice[0]).toMatchObject({ id: 'rocco', kind: 'win' });
    expect(app.input.rumbles[0]).toMatchObject({ deviceId: 'gp0' });
    app.bus.emit('race:lap', { type: 'lap', kart, lap: 2 }, session);
    expect(app.hud.flashes[0]).toMatchObject({ playerIndex: 0 });
    expect(app.bus.errors).toEqual([]);
  });

  it('fake progress keeps records like the real API contract', () => {
    const p = createFakeProgress();
    expect(p.unlock('luna')).toBe(true);
    expect(p.unlock('luna')).toBe(false);
    expect(p.isUnlocked('luna')).toBe(true);
    const first = p.submitRecord('x', { raceTime: 90, bestLap: 30 });
    expect(first).toMatchObject({ newBestRace: true, newBestLap: true });
    const worse = p.submitRecord('x', { raceTime: 95, bestLap: NaN });
    expect(worse).toMatchObject({ newBestRace: false, newBestLap: false, record: { bestRace: 90, bestLap: 30 } });
  });
});

describe('threeInspect', () => {
  it('finds NaN transforms and vertices', () => {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    g.add(mesh);
    expect(nonFiniteTransforms(g)).toEqual([]);
    expect(nonFiniteVertices(g)).toEqual([]);
    mesh.position.x = NaN;
    mesh.geometry.attributes.position.array[4] = Infinity;
    expect(nonFiniteTransforms(g)[0]).toMatch(/position\.x = NaN/);
    expect(nonFiniteVertices(g)[0]).toMatch(/vertex component 4/);
  });

  it('reports resources that dispose() forgot', () => {
    const g = new THREE.Group();
    const tex = new THREE.Texture();
    const kept = new THREE.MeshBasicMaterial({ map: tex });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), kept), new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial()));
    const res = collectResources(g);
    expect([res.geometries.size, res.materials.size, res.textures.size]).toEqual([2, 2, 1]);
    const watch = watchDisposal(res);
    g.traverse((o) => o.geometry?.dispose());
    const left = watch.undisposed();
    expect(left.geometries).toEqual([]);
    expect(left.materials).toHaveLength(2);
    expect(left.textures).toEqual([tex]);
  });
});

describe('fakeDom', () => {
  it('builds a node tree with classes, text, queries and removal', () => {
    const doc = createFakeDocument();
    const root = doc.createElement('div');
    const a = doc.createElement('span');
    a.className = 'x y';
    a.textContent = 'hi';
    const b = doc.createElement('b');
    b.classList.add('y', 'z');
    root.append(a, b);
    expect(root.querySelectorAll('.y')).toEqual([a, b]);
    expect(root.querySelector('.y.z')).toBe(b);
    expect(root.querySelector('span')).toBe(a);
    expect(root.querySelector('.nope')).toBeNull();
    expect(root.textContent).toBe('hi');
    expect(b.classList.toggle('z')).toBe(false);
    expect(b.className).toBe('y');
    b.classList.toggle('on', true);
    expect(b.classList.contains('on')).toBe(true);
    a.remove();
    expect(root.children).toEqual([b]);
    expect(a.parentNode).toBeNull();
    root.innerHTML = '<i class="q">x</i>';
    expect(root.children).toEqual([]);
    expect(htmlOf(root)).toContain('class="q"');
    b.style.setProperty('--k', 3);
    expect(b.style['--k']).toBe('3');
    expect(doc.writes).toBeGreaterThan(0);
    expect(() => root.querySelector('div > p')).toThrow(/unsupported selector/);
  });
});

describe('kidRace (fairness driver)', () => {
  it('races one seed to a real finish and reports the place', () => {
    const { def, path } = trackFixture('starlight-galaxy');
    const r = kidRace(def, path, null, 1, 'zippy');
    expect(r.finished).toBe(true);
    expect(r.place).toBeGreaterThanOrEqual(1);
    expect(r.place).toBeLessThanOrEqual(8);
    expect(r.won).toBe(r.place === 1 && !r.estimated);
  });

  it('knows which tracks sit outside every cup', () => {
    expect(tracksOutsideCups().map((t) => t.id)).toEqual([]);
  });
});
