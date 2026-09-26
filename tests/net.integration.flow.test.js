/**
 * WS7 online room glue (src/online/onlineFlow.js): phases per host screen, lobby ⇄ menus sync (seats, picks,
 * paint, ready), filling a slow friend's racer, the byte router (session vs race ctrl vs netcode), the
 * event queue, and opening / joining rooms over an in-memory transport (no browser, no network).
 */
import { describe, it, expect } from 'vitest';
import {
  phaseForScreen, desiredSeats, createDraftSync, fillMissingPicks, everyoneReady, canStart, createRoomRouter, createEventQueue,
  openHostRoom, joinGuestRoom, signalConfigFor, ONLINE_TEXT, HOST_RESULT_OPTIONS, GUEST_RESULT_OPTIONS, HOST_PAUSE_OPTIONS,
  GUEST_PAUSE_OPTIONS, READY_TIMEOUT_MS, SESSION_TICK_MS,
} from '../src/online/onlineFlow.js';
import { encodeSetup, encodeLoaded, encodeResult } from '../src/online/netRace.js';
import { netStack } from '../src/online/stack.js';
import { createLobby, lobbyReduce } from '../src/net/session/lobby.js';
import { jsonEncode } from '../src/net/session/wire.js';
import { resolveSignalConfig } from '../src/net/signaling/index.js';
import { createMemoryHub } from './helpers/netMemoryHub.js';
import { NET_SECRET } from './helpers/headlessSession.js';

const lobbyWith = (players = 1) => lobbyReduce(createLobby({ label: 'SPRINKLE-4821' }), { type: 'house-join', isHost: true, players }).lobby;
const draft = ({ players = [], picks = null, done = false } = {}) => ({
  joinState: { players: players.map((deviceId, playerIndex) => ({ playerIndex, deviceId, easyDrive: deviceId === 'kb2' })) },
  charPicks: picks, charState: done ? {} : null,
});

describe('phases and option lists', () => {
  it('maps the host\'s screens to lobby phases', () => {
    expect(phaseForScreen('online-lobby')).toBe('lobby');
    expect(phaseForScreen('join')).toBe('mode');
    expect(phaseForScreen('mode-select')).toBe('mode');
    expect(phaseForScreen('character-select')).toBe('characters');
    for (const id of ['track-select', 'cup-select', 'arena-select', 'my-cup']) expect(phaseForScreen(id)).toBe('course');
    expect(phaseForScreen('settings')).toBe(null);
    expect(phaseForScreen(null)).toBe(null);
  });

  it('host decides for everyone; guests wait or leave; host pause is for everyone, guest pause is local', () => {
    expect(HOST_RESULT_OPTIONS.map((o) => o[0])).toEqual(['again', 'next-track', 'lobby']);
    expect(GUEST_RESULT_OPTIONS.map((o) => o[0])).toEqual(['wait', 'leave']);
    expect(HOST_PAUSE_OPTIONS.map((o) => o[0])).toEqual(['resume', 'restart', 'lobby']);
    expect(GUEST_PAUSE_OPTIONS.map((o) => o[0])).toEqual(['resume', 'leave']);
    expect(READY_TIMEOUT_MS).toBe(30000);
    expect(SESSION_TICK_MS).toBeLessThanOrEqual(250);
    expect(Object.isFrozen(ONLINE_TEXT)).toBe(true);
  });
});

describe('lobby ⇄ menus sync', () => {
  it('desiredSeats: local join order → seats, picks by device, paint, ready only after racer select', () => {
    const d = draft({ players: ['kb1', 'kb2'], picks: [{ playerIndex: 1, deviceId: 'kb2', characterId: 'rocco' }, { playerIndex: 0, deviceId: 'kb1', characterId: 'luna' }] });
    expect(desiredSeats(d, (id) => (id === 'luna' ? 'mint' : 'original'))).toEqual([
      { seat: 0, deviceId: 'kb1', easyDrive: false, characterId: 'luna', paintId: 'mint', ready: false },
      { seat: 1, deviceId: 'kb2', easyDrive: true, characterId: 'rocco', paintId: 'original', ready: false },
    ]);
    expect(desiredSeats({ ...d, charState: {} }).every((s) => s.ready)).toBe(true);
    expect(desiredSeats(null)).toEqual([]);
    expect(desiredSeats(draft({ players: ['kb1'] }), () => { throw new Error('storage'); })[0].paintId).toBe('original');
  });

  it('createDraftSync: seat-join / pick / ready / seat-leave until the lobby matches, with a resend limit', () => {
    let lobby = lobbyWith(1);
    let t = 0;
    const sent = [];
    const sync = createDraftSync({
      houseId: () => 0, lobby: () => lobby, now: () => t, paintOf: () => 'original',
      send: (intent) => {
        sent.push(intent.kind);
        const map = { 'seat-join': 'seat-join', 'seat-leave': 'seat-leave', pick: 'pick', ready: 'ready' };
        lobby = lobbyReduce(lobby, { type: map[intent.kind], houseId: 0, ...intent, ready: true }).lobby;
      },
    });
    const d = draft({ players: ['kb1', 'kb2'] });
    expect(sync.update(d)).toEqual(['seat-join']);
    expect(lobby.houses[0].players).toHaveLength(2);
    expect(sync.update(d)).toEqual([]); // nothing picked yet
    d.charPicks = [{ playerIndex: 0, deviceId: 'kb1', characterId: 'luna' }, { playerIndex: 1, deviceId: 'kb2', characterId: 'rocco' }];
    expect(sync.update(d)).toEqual(['pick', 'pick']);
    d.charState = {};
    expect(sync.update(d)).toEqual(['ready', 'ready']);
    expect(everyoneReady(lobby)).toBe(true);
    // one player leaves on the join screen: the extra seat goes
    const d1 = draft({ players: ['kb1'], picks: d.charPicks, done: true });
    expect(sync.update(d1)).toEqual(['seat-leave']);
    expect(lobby.houses[0].players).toHaveLength(1);
    // a lost intent is re-sent only after resendMs
    const stuck = createDraftSync({ houseId: () => 0, lobby: () => lobbyWith(1), now: () => t, send: () => {} });
    const d2 = draft({ players: ['kb1', 'kb2'] });
    expect(stuck.update(d2)).toEqual(['seat-join']);
    t += 100;
    expect(stuck.update(d2)).toEqual([]);
    t += 500;
    expect(stuck.update(d2)).toEqual(['seat-join']);
    stuck.reset();
    expect(stuck.update(d2)).toEqual(['seat-join']);
    expect(createDraftSync({ houseId: () => 5, lobby: () => lobbyWith(1), send: () => {} }).update(d2)).toEqual([]);
    expect(createDraftSync({ houseId: () => 0, lobby: () => lobbyWith(1), send: () => {} }).update(draft())).toEqual([]);
  });

  it('fillMissingPicks gives a slow friend an unused racer and never touches picked ones', () => {
    const s = { participants: [{ characterId: 'luna' }, { characterId: null }, { characterId: 'rocco' }, { characterId: undefined }] };
    const out = fillMissingPicks(s, ['luna', 'bizzy', 'rocco', 'peekaberry']);
    expect(out.participants.map((p) => p.characterId)).toEqual(['luna', 'bizzy', 'rocco', 'peekaberry']);
    expect(s.participants[1].characterId).toBe(null);
    expect(fillMissingPicks({ participants: [{ characterId: null }] }, []).participants[0].characterId).toBe('luna');
  });

  it('canStart needs players and a track', () => {
    const l = lobbyWith(1);
    expect(canStart(l)).toBe(false);
    expect(canStart(lobbyReduce(l, { type: 'choice', patch: { trackId: 'gumdrop-meadow' } }).lobby)).toBe(true);
    expect(canStart(null)).toBe(false);
  });
});

describe('room router', () => {
  const fakeTransport = () => {
    const fns = new Set();
    return { onMessage: (fn) => { fns.add(fn); return () => fns.delete(fn); }, deliver: (p, ch, b) => fns.forEach((f) => f(p, ch, b)), get n() { return fns.size; } };
  };

  it('race ctrl → listeners, netcode → the race (buffered between SETUP and the race), session JSON ignored', () => {
    const tr = fakeTransport();
    const r = createRoomRouter({ transport: tr });
    const got = [];
    r.on('setup', (rc) => got.push(['setup', rc.setup.raceId]));
    const offLoaded = r.on('loaded', (rc, peer) => got.push(['loaded', rc.raceId, peer]));
    r.on('result', (rc) => got.push(['result', rc.raceId]));
    tr.deliver('h', 'ctrl', encodeSetup(netStack, { raceId: 4, participants: [] }));
    tr.deliver('g', 'ctrl', encodeLoaded(netStack, 4));
    tr.deliver('h', 'ctrl', encodeResult(netStack, 4, { humans: [] }));
    tr.deliver('h', 'ctrl', jsonEncode({ type: 'LOBBY', lobby: {} }));
    const start = netStack.wire.encodeCtrl(netStack.wire.MSG.START, { raceId: 4, startTick: 1, goTick: 181, epoch: 0 });
    tr.deliver('h', 'ctrl', start); // no race, not expecting: dropped
    expect(r.buffered).toBe(0);
    r.expectRace();
    tr.deliver('h', 'ctrl', start);
    tr.deliver('h', 'state', new Uint8Array([2, 0]));
    expect(r.buffered).toBe(2);
    const race = { seen: [], onBytes(p, ch, b) { this.seen.push([p, ch, b[0]]); } };
    r.setRace(race);
    expect(race.seen).toEqual([['h', 'ctrl', netStack.wire.MSG.START], ['h', 'state', 2]]);
    tr.deliver('h', 'state', new Uint8Array([2, 1]));
    expect(race.seen).toHaveLength(3);
    expect(r.race).toBe(race);
    r.setRace(null);
    tr.deliver('h', 'state', new Uint8Array([2, 2]));
    expect(race.seen).toHaveLength(3);
    expect(got).toEqual([['setup', 4], ['loaded', 4, 'g'], ['result', 4]]);
    offLoaded();
    tr.deliver('g', 'ctrl', encodeLoaded(netStack, 5));
    expect(got).toHaveLength(3);
    r.dispose();
    expect(tr.n).toBe(0);
  });

  it('the event queue hands items to waiters in order and can take one out early', async () => {
    const q = createEventQueue();
    q.push({ type: 'phase', phase: 'mode' });
    q.push({ type: 'setup' });
    expect(q.size).toBe(2);
    expect(q.take((x) => x.type === 'setup')).toEqual({ type: 'setup' });
    expect(q.take((x) => x.type === 'nope')).toBe(null);
    expect(await q.next()).toEqual({ type: 'phase', phase: 'mode' });
    const later = q.next();
    q.push({ type: 'ended' });
    expect(await later).toEqual({ type: 'ended' });
  });
});

describe('opening and joining a room (in-memory transport)', () => {
  it('host opens, guest knocks with the match check, host approves, both see one lobby', async () => {
    const hub = createMemoryHub({ seed: 2 });
    const hostEp = hub.endpoint('host0000host0000', 'host');
    const guestEp = hub.endpoint('guest000guest000', 'guest');
    let t = 0;
    const now = () => t;
    const host = await openHostRoom({ progress: null, pickCpus: (n) => ['a', 'b', 'c', 'd', 'e', 'f', 'g'].slice(0, n), deps: { transport: hostEp, now, makeSecret: () => NET_SECRET } });
    expect(host.role).toBe('host');
    expect(host.session.state.phase).toBe('lobby');
    expect(host.netCtx.role).toBe('host');
    const guest = await joinGuestRoom({ secret: NET_SECRET, localPlayers: 2, deps: { transport: guestEp, now, platform: { userAgent: 'node', platform: 'Win32', maxTouchPoints: 0 } } });
    expect(guest.session.state.phase).toBe('connecting');
    hub.link('host0000host0000', 'guest000guest000');
    t = 50; hub.advance(50);
    const prompt = host.session.prompt();
    expect(prompt?.peerId).toBe('guest000guest000');
    host.session.dispatch({ type: 'approve', peerId: prompt.peerId, yes: true });
    t = 100; hub.advance(100);
    expect(guest.session.state.phase).toBe('joined');
    expect(guest.hostId()).toBe('host0000host0000');
    expect(host.peerOf(guest.session.state.houseId)).toBe('guest000guest000');
    expect(host.peerOf(7)).toBe(null);
    expect(guest.netCtx.role).toBe('guest');
    expect(guest.session.lobby().houses.map((h) => h.players.length)).toEqual([1, 2]);
    // SETUP from the host reaches the guest's router listener
    const seen = [];
    guest.router.on('setup', (rc) => seen.push(rc.setup.raceId));
    hostEp.broadcast('ctrl', encodeSetup(netStack, { raceId: 9, participants: [] }));
    t = 150; hub.advance(150);
    expect(seen).toEqual([9]);
    guest.close();
    t = 200; hub.advance(200);
    host.close();
    expect(host.session.state.phase).toBe('idle');
  });

  it('a room that cannot be reached turns into the friendly sentence (never a crash)', async () => {
    const guest = await joinGuestRoom({
      secret: NET_SECRET,
      deps: { openOnline: async () => { const e = new Error('nope'); e.code = 'no-host'; throw e; }, deriveRoomIds: async () => ({ topic: 't', password: 'p', workerRoom: 'r' }), selfId: 'abcdabcdabcdabcd' },
    });
    expect(guest.session.state.phase).toBe('ended');
    expect(guest.session.state.end.text).toMatch(/couldn't find that room/i);
    expect(guest.router).toBe(null);
    guest.close();
  });

  it('opening a room goes through deriveRoomIds + openOnline with the relay setting', async () => {
    const calls = [];
    const hub = createMemoryHub({ seed: 3 });
    const ep = hub.endpoint('host0000host0000', 'host');
    const host = await openHostRoom({
      progress: { getSettings: () => ({ relayOnly: true }) }, pickCpus: () => [],
      signal: { signalUrl: 'https://signal.example', forced: null, relays: null },
      deps: {
        makeSecret: () => NET_SECRET, selfId: 'host0000host0000',
        deriveRoomIds: async (s) => { calls.push(['ids', s.label]); return { topic: 'sk-x', password: 'pw', workerRoom: 'r1' }; },
        openOnline: async (o) => { calls.push(['open', o.role, o.relayOnly, o.signalUrl, o.ids.workerRoom]); return { transport: ep, signaling: { kind: 'worker', leave() {} } }; },
      },
    });
    expect(calls).toEqual([['ids', 'SPRINKLE-4821'], ['open', 'host', true, 'https://signal.example', 'r1']]);
    expect(host.signaling.kind).toBe('worker');
    host.close();
  });

  it('signal config: the Worker iff VITE_SIGNAL_URL, dev overrides only on localhost', () => {
    const at = (search, hostname = 'localhost') => ({ search, hostname });
    expect(signalConfigFor({ env: {}, location: at(''), resolve: resolveSignalConfig })).toEqual({ signalUrl: null, forced: null, relays: null });
    expect(signalConfigFor({ env: { VITE_SIGNAL_URL: 'https://sig.example/' }, location: at('', 'rillyboss.github.io'), resolve: resolveSignalConfig }).signalUrl).toBe('https://sig.example');
    expect(signalConfigFor({ env: {}, location: at('?signal=public&relays=ws://127.0.0.1:5662'), resolve: resolveSignalConfig })).toEqual({ signalUrl: null, forced: 'public', relays: ['ws://127.0.0.1:5662'] });
    expect(signalConfigFor({ env: {}, location: at('?signal=public&relays=ws://evil', 'rillyboss.github.io'), resolve: resolveSignalConfig }).forced).toBe(null);
  });
});

describe('friendly words (§1 rule 7) in every WS7 string', () => {
  it('online glue texts, option lists, HUD lines and emotes pass the tone check', async () => {
    const { NET_HUD_TEXT } = await import('../src/systems/netHud.js');
    const { EMOTES } = await import('../src/systems/netEmotes.js');
    const BANNED = /\b(hit|hits|kill|killed|crash|crashed|destroy|destroyed|die|dies|dead|blood|weapon|shoot|attack|hate|stupid|loser|lose|fail|failed|failure|error|errors|broken|blocked|scary|hurt|banned|kick|kicked|reject|rejected|denied|forbidden|invalid|illegal|abort)\b/i;
    const all = [
      ...Object.values(ONLINE_TEXT), ...Object.values(NET_HUD_TEXT), ...EMOTES.map((e) => e[1]),
      ...[HOST_RESULT_OPTIONS, GUEST_RESULT_OPTIONS, HOST_PAUSE_OPTIONS, GUEST_PAUSE_OPTIONS].flat().map((o) => o[1]),
    ];
    expect(all.length).toBeGreaterThan(25);
    for (const t of all) expect(t, t).not.toMatch(BANNED);
    // the pause card adds "paused the race" to a short label, so the host's line is a full sentence
    expect(ONLINE_TEXT.pausedEveryone).toMatch(/[!.?]$/);
  });
});
