/**
 * WS7 online HUD + emotes (NETWORKING.md §9.1, §10.7, §13.1): the neutral "Finish! ✨" until the host
 * confirms, the snack-break banner, Robo Driver flashes only for THIS machine's karts, the wobbly and
 * keep-the-tab-open lines, and the emote chime. Offline sessions never see any of it.
 */
import { describe, it, expect } from 'vitest';
import netHud, { netHudModel, NET_HUD_TEXT } from '../src/systems/netHud.js';
import netEmotes, { emoteView, EMOTES, EMOTE_LOG_SIZE } from '../src/systems/netEmotes.js';
import { installSystems } from '../src/systems/index.js';
import { createFakeApp, fakeSession } from './helpers/headlessSession.js';
import { createSessionHelpers } from '../src/game/session.js';
import { LOBBY_EMOTES } from '../src/net/session/texts.js';

const race = (over = {}) => ({ path: { length: 500 }, lapsTotal: 2, state: 'racing', isPredicted: (id) => id === 1, ...over });

describe('netHudModel', () => {
  it('offline (no session.net) shows nothing', () => {
    expect(netHudModel({ kart: { id: 1, distance: 5000 }, race: race(), net: null })).toEqual({ finishHold: false, banner: null });
    expect(netHudModel({ kart: null, race: race(), net: { role: 'guest' } })).toEqual({ finishHold: false, banner: null });
  });

  it('a predicted own kart past the line waits with "Finish! ✨" until the host says finished', () => {
    const net = { role: 'guest', paused: false };
    expect(netHudModel({ kart: { id: 1, distance: 999, finished: false }, race: race(), net }).finishHold).toBe(false);
    expect(netHudModel({ kart: { id: 1, distance: 1000, finished: false }, race: race(), net }).finishHold).toBe(true);
    expect(netHudModel({ kart: { id: 1, distance: 1000, finished: true }, race: race(), net }).finishHold).toBe(false);
    // a remote / host-side kart never holds (only the guest's own predicted karts guess ahead)
    expect(netHudModel({ kart: { id: 2, distance: 1200, finished: false }, race: race(), net }).finishHold).toBe(false);
    expect(netHudModel({ kart: { id: 1, distance: 1200 }, race: race({ isPredicted: undefined }), net }).finishHold).toBe(false);
    expect(netHudModel({ kart: { id: 1, distance: 1200 }, race: race({ state: 'finished' }), net }).finishHold).toBe(false);
  });

  it('Pause everyone: a snack-break banner on every machine (host words vs guest words)', () => {
    expect(netHudModel({ kart: { id: 3 }, race: race(), net: { role: 'guest', paused: true } }).banner).toBe(NET_HUD_TEXT.snackGuest);
    expect(netHudModel({ kart: { id: 3 }, race: race(), net: { role: 'host', paused: true } }).banner).toBe(NET_HUD_TEXT.snackHost);
  });
});

describe('net-hud system', () => {
  const setup = () => {
    const app = createFakeApp();
    const off = installSystems(app.bus, app, [netHud]);
    const humans = [{ playerIndex: 2, deviceId: 'kb1' }];
    const session = {
      ...createSessionHelpers({ humans, allHumans: [{ playerIndex: 0 }, ...humans], hud: app.hud }),
      net: { role: 'guest', paused: false, wobbly: false, hostHidden: false },
    };
    return { app, off, session };
  };

  it('adds one widget and removes it on uninstall', () => {
    const { app, off } = setup();
    expect(app.hud.widgets.map((w) => w.id)).toEqual(['net-hud']);
    expect(app.hud.widgets[0].anchor).toBe('callout');
    const inst = app.hud.widgets[0].create(null, 0);
    expect(() => { inst.update({ id: 1 }, race()); inst.reset(); inst.destroy(); }).not.toThrow();
    off();
    expect(app.hud.widgets).toHaveLength(0);
  });

  it('Robo Driver flashes only for this machine\'s karts (a friend\'s robo is not "yours")', () => {
    const { app, off, session } = setup();
    app.bus.emit('race-start', {}, session);
    app.bus.emit('race:robo', { type: 'robo', kart: { playerIndex: 2, isCPU: false }, on: true }, session);
    app.bus.emit('race:robo', { type: 'robo', kart: { playerIndex: 0, isCPU: false }, on: true }, session);
    app.bus.emit('race:robo', { type: 'robo', kart: { playerIndex: 2, isCPU: false }, on: false }, session);
    app.bus.emit('race:robo', { type: 'robo', kart: null, on: true }, session);
    expect(app.hud.flashes).toEqual([{ playerIndex: 2, text: NET_HUD_TEXT.robo }, { playerIndex: 2, text: NET_HUD_TEXT.roboBack }]);
    // offline sessions never flash
    app.bus.emit('race:robo', { type: 'robo', kart: { playerIndex: 2, isCPU: false }, on: true }, fakeSession(app, { humans: 3 }));
    expect(app.hud.flashes).toHaveLength(2);
    off();
  });

  it('wobbly connection and "keep this tab open" lines, once per change', () => {
    const { app, off, session } = setup();
    app.bus.emit('race-start', {}, session);
    app.bus.emit('race-frame', 1 / 60, session);
    session.net.wobbly = true;
    app.bus.emit('race-frame', 1 / 60, session);
    app.bus.emit('race-frame', 1 / 60, session);
    expect(app.hud.flashes.map((f) => f.text)).toEqual([NET_HUD_TEXT.wobbly]);
    session.net.role = 'host';
    session.net.hostHidden = true;
    app.bus.emit('race-frame', 1 / 60, session);
    session.net.hostHidden = false;
    app.bus.emit('race-frame', 1 / 60, session);
    expect(app.hud.flashes.map((f) => f.text)).toEqual([NET_HUD_TEXT.wobbly, NET_HUD_TEXT.keepTab]);
    app.bus.emit('race-exit', {}, session);
    app.bus.emit('race-frame', 1 / 60, fakeSession(app));
    expect(app.hud.flashes).toHaveLength(2);
    off();
  });

  it('installs nothing on a HUD without widgets', () => {
    const app = createFakeApp({ hud: { flash() {} } });
    expect(() => installSystems(app.bus, app, [netHud])()).not.toThrow();
  });
});

describe('net-emotes system', () => {
  it('the 8 presets match the lobby table, and anything else is never shown', () => {
    expect(EMOTES).toHaveLength(8);
    expect(EMOTES.map(([e, t]) => ({ e, t }))).toEqual(LOBBY_EMOTES.map((x) => ({ e: x.emoji, t: x.text })));
    expect(emoteView(2)).toEqual({ id: 2, emoji: '🎉', text: 'Yay!' });
    for (const bad of [-1, 8, 1.5, 'x', null]) expect(emoteView(bad)).toBe(null);
  });

  it('chimes softly for every emote in the room and keeps a short log', () => {
    const app = createFakeApp();
    const off = installSystems(app.bus, app, [netEmotes]);
    app.bus.emit('net-emote', { globalPi: 3, emote: 1, local: false });
    app.bus.emit('net-emote', { globalPi: 0, emote: 7, local: true });
    app.bus.emit('net-emote', { globalPi: 0, emote: 99, local: true });
    expect(app.audio.played('bubble')).toBe(2);
    expect(app.game.netEmotes).toEqual([{ globalPi: 3, emote: 1, local: false }, { globalPi: 0, emote: 7, local: true }]);
    for (let i = 0; i < 20; i++) app.bus.emit('net-emote', { globalPi: 1, emote: i % 8 });
    expect(app.game.netEmotes).toHaveLength(EMOTE_LOG_SIZE);
    off();
    app.bus.emit('net-emote', { globalPi: 3, emote: 1 });
    expect(app.audio.played('bubble')).toBe(22);
  });
});
