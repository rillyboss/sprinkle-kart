// Session liveness (NETWORKING.md §7.4, §13.1–§13.3, net review #1 / #5 / #6 / #10 / #19):
//  - the KEEP heartbeat keeps a quiet room open (30 s idle in the lobby, in "waiting for approval" and while the
//    host sits on the track screen) — before it, every guest was sent home after 8 s,
//  - a dropped house is `asleep` for the reconnect window (never a ghost for later races), a BYE house leaves,
//  - a joined house whose link drops reconnects with its WELCOME ticket instead of blaming the host,
//  - "no host ever showed up" (wrong code / sweets) vs "the host showed up but the connection never opened".
import { describe, it, expect, vi } from 'vitest';
import { createSessionHub } from './net.session.hub.js';
import { createHostSession, createHostNetContext, RECONNECT_WINDOW_MS, GUEST_WOBBLY_MS } from '../src/net/session/hostSession.js';
import {
  createGuestSession, guestReduce, createGuestState, CONNECT_TIMEOUT_MS, HOST_SILENT_MS, RECONNECT_GIVE_UP_MS, RECONNECT_ATTEMPTS_MS,
} from '../src/net/session/guestSession.js';
import { buildIdentity, jsonDecode, KEEPALIVE_MS, SESSION_MESSAGES } from '../src/net/session/wire.js';
import { lobbyAllReady, activePlayers, allPlayers } from '../src/net/session/lobby.js';
import { composeOnlineSetup } from '../src/net/session/composeSetup.js';
import { TEXT } from '../src/net/session/texts.js';

const SECRET = { label: 'SPRINKLE-4821', sweets: [1, 2, 3, 4, 5, 6] };
const MINE = buildIdentity({ proto: 1, build: 'abc123', content: 777 });
const PC = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 };

/** Host + guests on the in-memory session hub with one fake clock; `run(ms)` ticks both sides every 250 ms. */
function makeRoom({ hostPlayers = 1 } = {}) {
  const hub = createSessionHub();
  let t = 1000;
  const now = () => t;
  let tokenN = 0;
  const host = createHostSession({
    transport: hub.host(), signalings: [{ setLocked: vi.fn(), drop: vi.fn() }], now, secret: SECRET, hostPlayers, mine: MINE,
    makeToken: () => (++tokenN).toString(16).padStart(32, '0'),
  });
  const hostFx = [];
  host.onEffect((e) => hostFx.push(e));
  host.dispatch({ type: 'open' });
  host.dispatch({ type: 'opened' });
  const guests = [];
  const room = {
    hub, host, hostFx, guests,
    get now() { return t; },
    guest(id, { localPlayers = 1, tokenStore = null } = {}) {
      const ep = hub.guest(id);
      const g = createGuestSession({ transport: ep, secret: SECRET, localPlayers, now, mine: MINE, platform: PC, tokenStore });
      const fx = [];
      g.onEffect((e) => fx.push(e));
      g.dispatch({ type: 'connect' });
      hub.connect(id);
      const rec = { id, g, fx, ep, tick: true };
      guests.push(rec);
      return rec;
    },
    join(id, opts) {
      const rec = room.guest(id, opts);
      hub.flush();
      host.dispatch({ type: 'approve', peerId: id, yes: true });
      hub.flush();
      return rec;
    },
    /** Let `ms` pass in 250 ms session ticks (like SESSION_TICK_MS), delivering everything in between. */
    run(ms, { hostTicks = true } = {}) {
      const end = t + ms;
      while (t < end) {
        t = Math.min(end, t + 250);
        if (hostTicks) host.dispatch({ type: 'tick' });
        for (const g of guests) if (g.tick) g.g.dispatch({ type: 'tick' });
        hub.flush();
      }
    },
  };
  return room;
}

const sentTypes = (ep, type) => ep.sent.map((m) => jsonDecode(m.bytes)).filter((m) => m?.type === type);

describe('KEEP heartbeat: a quiet room stays open (review #1)', () => {
  it('KEEP is a session message and goes out about once a second', () => {
    expect(SESSION_MESSAGES).toContain('KEEP');
    expect(KEEPALIVE_MS).toBeLessThanOrEqual(1000);
    expect(HOST_SILENT_MS).toBeGreaterThanOrEqual(4 * KEEPALIVE_MS);
  });

  it('a guest idling 30 s in a quiet lobby stays joined and the host keeps both houses', () => {
    const room = makeRoom();
    const b = room.join('guest-b', { localPlayers: 2 });
    expect(b.g.state.phase).toBe('joined');
    room.run(30_000);
    expect(b.g.state.phase).toBe('joined');
    expect(room.host.lobby().houses).toHaveLength(2);
    expect(room.host.lobby().houses[1].net).toBe('ok');
    expect(b.fx.some((e) => e.type === 'ended')).toBe(false);
    // about one KEEP per second each way (nothing else was said)
    const toGuest = room.hostFx.filter((e) => e.type === 'send' && e.peerId === 'guest-b' && e.msg.type === 'KEEP').length;
    expect(toGuest).toBeGreaterThanOrEqual(25);
    expect(toGuest).toBeLessThanOrEqual(31);
    const fromGuest = sentTypes(b.ep, 'KEEP').length;
    expect(fromGuest).toBeGreaterThanOrEqual(25);
    expect(fromGuest).toBeLessThanOrEqual(31);
  });

  it('a guest waiting 30 s for "Let them in?" keeps waiting, and the host prompt stays up', () => {
    const room = makeRoom();
    const b = room.guest('guest-b');
    room.hub.flush();
    expect(b.g.state.phase).toBe('waiting-approval');
    room.run(30_000);
    expect(b.g.state.phase).toBe('waiting-approval');
    expect(room.host.prompt()?.peerId).toBe('guest-b');
    room.host.dispatch({ type: 'approve', peerId: 'guest-b', yes: true });
    room.hub.flush();
    expect(b.g.state.phase).toBe('joined');
  });

  it('a guest on net-waiting while the host takes 30 s on the track screen stays joined', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    room.host.dispatch({ type: 'phase', phase: 'course' });
    room.hub.flush();
    expect(b.g.state.hostPhase).toBe('course');
    room.run(30_000);
    expect(b.g.state.phase).toBe('joined');
    expect(room.host.lobby().houses).toHaveLength(2);
  });

  it('without the host heartbeat the guest does notice after HOST_SILENT_MS (the check still works)', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    room.run(HOST_SILENT_MS - 500, { hostTicks: false });
    expect(b.g.state.phase).toBe('joined');
    room.run(1000, { hostTicks: false });
    expect(b.g.state.phase).toBe('reconnecting'); // it has a ticket: it tries to come back instead of giving up
  });

  it('KEEP only fills silence: a peer that already got a message this second gets no KEEP', () => {
    const room = makeRoom();
    room.join('guest-b');
    room.run(2000);
    const before = room.hostFx.filter((e) => e.type === 'send' && e.msg.type === 'KEEP').length;
    for (let i = 0; i < 8; i++) {
      room.host.dispatch({ type: 'emote', globalPi: 0, emote: i % 8 });
      room.run(1600); // an emote every 1.6 s: KEEP only fills the second-long gaps in between
    }
    const keeps = room.hostFx.filter((e) => e.type === 'send' && e.msg.type === 'KEEP').length - before;
    expect(keeps).toBeLessThanOrEqual(8); // at most one KEEP between two emotes
  });

  it('the host marks a silent guest house wobbly 📶 after 3 s in the lobby and ok again when it is heard', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    room.run(2000);
    b.tick = false; // the guest's tab stalls: no KEEP from it
    room.run(GUEST_WOBBLY_MS + 1000);
    expect(room.host.lobby().houses[1].net).toBe('wobbly');
    b.tick = true;
    room.run(1500);
    expect(room.host.lobby().houses[1].net).toBe('ok');
  });
});

describe('a dropped house is asleep for the reconnect window, never a ghost (review #5)', () => {
  it('mid-race drop → asleep; results + 2 min later → gone; the next race waits for nobody', () => {
    const room = makeRoom();
    const b = room.join('guest-b', { localPlayers: 2 });
    b.tick = false;
    room.host.dispatch({ type: 'phase', phase: 'race' });
    room.hub.flush();
    room.hub.cut('guest-b');
    expect(room.host.lobby().houses[1].net).toBe('asleep');
    room.host.dispatch({ type: 'phase', phase: 'results' });
    room.hub.flush();
    // still inside the window: the house keeps its seats (so it can come back), but holds nothing up
    expect(room.host.lobby().houses).toHaveLength(2);
    room.host.dispatch({ type: 'host-intent', intent: { kind: 'pick', seat: 0, characterId: 'luna' } });
    room.host.dispatch({ type: 'host-intent', intent: { kind: 'ready', seat: 0 } });
    expect(lobbyAllReady(room.host.lobby())).toBe(true);
    expect(activePlayers(room.host.lobby()).map((p) => p.houseId)).toEqual([0]);
    const setup = composeOnlineSetup(room.host.lobby(), { mode: 'free', trackId: 'gumdrop-meadow', laps: 1 }, { seed: 1, raceId: 2, cpuIds: [] });
    expect(setup.participants.map((p) => p.houseId)).toEqual([0]);
    room.run(120_000);
    room.host.dispatch({ type: 'phase', phase: 'lobby' });
    room.host.dispatch({ type: 'phase', phase: 'characters' });
    room.hub.flush();
    expect(room.host.lobby().houses.map((h) => h.houseId)).toEqual([0]);
    expect(allPlayers(room.host.lobby())).toHaveLength(1);
    expect(room.host.state.tokens).toEqual({});
  });

  it('the host counts CPUs for the houses that are really there', () => {
    const room = makeRoom();
    room.join('guest-b', { localPlayers: 3 });
    room.hub.cut('guest-b');
    const net = createHostNetContext(room.host, { makeSeed: () => 7, pickCpus: (n) => Array.from({ length: n }, (_, i) => `cpu${i}`) });
    const setup = net.composeSetup({ mode: 'free', trackId: 'gumdrop-meadow', laps: 1 });
    expect(setup.participants.filter((p) => p.playerIndex !== null)).toHaveLength(1);
    expect(setup.cpuIds).toHaveLength(7);
  });

  it('a lobby drop keeps the house asleep for the window, then removes it (never during a race)', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    b.tick = false;
    room.hub.cut('guest-b');
    expect(room.host.lobby().houses[1].net).toBe('asleep');
    room.run(RECONNECT_WINDOW_MS - 1000);
    expect(room.host.lobby().houses).toHaveLength(2);
    room.host.dispatch({ type: 'phase', phase: 'race' });
    room.run(5000);
    expect(room.host.lobby().houses).toHaveLength(2); // racing: its karts are Robo Driver's until the end
    room.host.dispatch({ type: 'phase', phase: 'results' });
    expect(room.host.lobby().houses).toHaveLength(1);
  });

  it('"Leave the room" (BYE) frees the seats at once in the lobby, and at the results mid-race', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    b.g.dispatch({ type: 'leave' });
    room.hub.flush();
    expect(room.host.lobby().houses).toHaveLength(1);
    const c = room.join('guest-c');
    room.host.dispatch({ type: 'phase', phase: 'race' });
    room.hub.flush();
    c.g.dispatch({ type: 'leave' });
    room.hub.flush();
    expect(room.host.lobby().houses[1].net).toBe('asleep');
    expect(Object.values(room.host.state.tokens)).not.toContain(1);
    room.host.dispatch({ type: 'phase', phase: 'results' });
    expect(room.host.lobby().houses).toHaveLength(1);
  });

  it('a reload inside the window re-attaches with the remembered ticket (sessionStorage), no approval', () => {
    const room = makeRoom();
    const store = new Map();
    const tokenStore = { load: (s) => store.get(s.label) ?? null, save: (s, tk) => store.set(s.label, tk), clear: (s) => store.delete(s.label) };
    const b = room.join('guest-b', { localPlayers: 2, tokenStore });
    const houseId = b.g.state.houseId;
    expect(store.get(SECRET.label)).toBe(b.g.state.token);
    b.tick = false;
    room.hub.cut('guest-b'); // the tab reloads
    room.run(5000);
    const again = room.guest('guest-b-reloaded', { localPlayers: 2, tokenStore });
    expect(again.g.state.token).toBe(store.get(SECRET.label) ?? again.g.state.token);
    room.hub.flush();
    expect(room.host.prompt()).toBe(null);
    expect(again.g.state.phase).toBe('joined');
    expect(again.g.state.houseId).toBe(houseId);
    expect(room.host.lobby().houses[1].net).toBe('ok');
    expect(room.hostFx.some((e) => e.type === 'reattach' && e.houseId === houseId && e.peerId === 'guest-b-reloaded')).toBe(true);
    // a removed house loses its ticket: the store forgets it and the next knock needs approval again
    room.host.dispatch({ type: 'remove-house', houseId });
    room.hub.flush();
    expect(store.has(SECRET.label)).toBe(false);
  });
});

describe('a Wi-Fi hiccup reconnects instead of blaming the host (review #6)', () => {
  it('link cut mid-race → Reconnecting… → the same house comes back, the race hands its karts back', () => {
    const room = makeRoom();
    const b = room.join('guest-b', { localPlayers: 2 });
    const houseId = b.g.state.houseId;
    room.host.dispatch({ type: 'phase', phase: 'race' });
    room.hub.flush();
    room.hub.cut('guest-b');
    expect(b.g.state.phase).toBe('reconnecting');
    expect(b.fx).toContainEqual({ type: 'reconnect', attempt: 0 });
    expect(b.fx).toContainEqual({ type: 'net-state', reconnecting: true, text: TEXT.reconnecting });
    room.run(12_000); // the outage
    expect(b.g.state.phase).toBe('reconnecting');
    expect(b.fx.filter((e) => e.type === 'reconnect').length).toBeGreaterThanOrEqual(3);
    room.hub.connect('guest-b'); // a fresh connection (the game opens a new matchmaker for every attempt)
    room.hub.flush();
    expect(b.g.state.phase).toBe('joined');
    expect(b.g.state.houseId).toBe(houseId);
    expect(b.fx).toContainEqual({ type: 'reattached', houseId });
    expect(b.fx.filter((e) => e.type === 'net-state').at(-1)).toEqual({ type: 'net-state', reconnecting: false, text: '' });
    expect(b.fx.some((e) => e.type === 'phase' && e.phase === 'race')).toBe(true);
    expect(room.host.lobby().houses[1].net).toBe('ok');
    expect(room.hostFx.some((e) => e.type === 'reattach' && e.houseId === houseId)).toBe(true);
    expect(b.fx.some((e) => e.type === 'ended')).toBe(false);
  });

  it('gives up after RECONNECT_GIVE_UP_MS; says "your internet took a nap" when this machine is offline', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    room.hub.cut('guest-b');
    b.g.dispatch({ type: 'tick', online: false });
    expect(b.fx.filter((e) => e.type === 'net-state').at(-1)).toEqual({ type: 'net-state', reconnecting: true, text: TEXT.netNap });
    room.run(RECONNECT_GIVE_UP_MS);
    expect(b.g.state.end).toEqual({ reason: 'net-nap', text: TEXT.netNapEnd });
    expect(TEXT.netNapEnd).toMatch(/your internet took a nap/i);
    // the same drop with the internet up: the host is the one who went away
    const room2 = makeRoom();
    const c = room2.join('guest-c');
    room2.hub.cut('guest-c');
    room2.run(RECONNECT_GIVE_UP_MS);
    expect(c.g.state.end).toEqual({ reason: 'host-gone', text: TEXT.hostGone });
  });

  it('reconnect attempts follow the schedule and stop when a connection is up', () => {
    let st = createGuestState({ secret: SECRET, token: 'a'.repeat(32) });
    st = { ...st, phase: 'joined', hostPeerId: 'h', lastHeard: 0, now: 0 };
    let r = guestReduce(st, { type: 'host-leave', now: 100 });
    st = r.state;
    const attempts = [r.effects.find((e) => e.type === 'reconnect')?.attempt];
    for (let t = 200; t < RECONNECT_GIVE_UP_MS; t += 250) {
      r = guestReduce(st, { type: 'tick', now: t });
      st = r.state;
      for (const e of r.effects) if (e.type === 'reconnect') attempts.push(e.attempt);
    }
    expect(attempts).toEqual(RECONNECT_ATTEMPTS_MS.map((_, i) => i));
    // a connection surfaced: no new attempt while it is being used
    st = createGuestState({ secret: SECRET, token: 'a'.repeat(32) });
    st = guestReduce({ ...st, phase: 'joined', hostPeerId: 'h' }, { type: 'host-leave', now: 0 }).state;
    st = guestReduce(st, { type: 'connected', peerId: 'h2', now: 100 }).state;
    expect(st.hostPeerId).toBe('h2');
    r = guestReduce(st, { type: 'tick', now: 3500 });
    expect(r.effects.some((e) => e.type === 'reconnect')).toBe(false);
    // REJECT locked / full while reconnecting → home with the friendly words
    expect(guestReduce(st, { type: 'connect-failed', code: 'locked', now: 200 }).state.end.text).toBe(TEXT.closed);
  });

  it('a house without a ticket (still waiting for approval) goes home instead', () => {
    let st = createGuestState({ secret: SECRET });
    st = guestReduce(st, { type: 'connect', now: 0 }).state;
    st = guestReduce(st, { type: 'connected', peerId: 'h', now: 10 }).state;
    expect(guestReduce(st, { type: 'host-leave', now: 20 }).state.end.reason).toBe('host-gone');
    expect(guestReduce(st, { type: 'tick', now: 10 + HOST_SILENT_MS, online: false }).state.end.text).toBe(TEXT.netNapEnd);
  });
});

describe('wrong code vs NAT trouble (review #10 / #19)', () => {
  it('no host ever showed up on signaling → "We couldn\'t find that room" (check the code and sweets)', () => {
    let st = guestReduce(createGuestState({ secret: SECRET }), { type: 'connect', now: 0 }).state;
    const r = guestReduce(st, { type: 'tick', now: CONNECT_TIMEOUT_MS });
    expect(r.state.end).toEqual({ reason: 'not-found', text: TEXT.notFound });
    expect(r.effects.find((e) => e.type === 'screen').params).toEqual({ message: TEXT.notFound });
    st = guestReduce(st, { type: 'host-seen', now: 3000 }).state;
    const r2 = guestReduce(st, { type: 'tick', now: CONNECT_TIMEOUT_MS });
    expect(r2.state.end).toEqual({ reason: 'no-connect', text: TEXT.noConnect });
    // the hub shows the three NAT tips under the sentence (§13.4)
    expect(r2.effects.find((e) => e.type === 'screen').params).toEqual({ message: TEXT.noConnect, tips: [...TEXT.noConnectTips] });
  });

  it('a locked room refused at signaling level says "closed", never the NAT tips', () => {
    const st = guestReduce(createGuestState({ secret: SECRET }), { type: 'connect', now: 0 }).state;
    const r = guestReduce(st, { type: 'connect-failed', code: 'locked', now: 500 });
    expect(r.state.end).toEqual({ reason: 'locked', text: TEXT.closed });
    expect(r.effects.find((e) => e.type === 'screen').params.tips).toBeUndefined();
  });
});
