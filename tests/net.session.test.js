// Session sims: host + guest state machines over an in-memory room (NETWORKING.md §7.1, §10.2, §10.9, §13;
// acceptance M1 #1 / M1-13 / M1-15 / M1-17).
import { describe, it, expect, vi } from 'vitest';
import { createSessionHub } from './net.session.hub.js';
import { createHostSession, createHostReducer, createHostState, HELLO_TIMEOUT_MS, createHostNetContext } from '../src/net/session/hostSession.js';
import { createGuestSession, guestReduce, createGuestState, CONNECT_TIMEOUT_MS, HOST_SILENT_MS, createGuestNetContext } from '../src/net/session/guestSession.js';
import { buildIdentity, compatible, jsonDecode, jsonEncode, isToken, EMOTE_INTERVAL_MS } from '../src/net/session/wire.js';
import { matchEmoji, APPROVAL_TIMEOUT_MS } from '../src/net/session/approval.js';
import { humanCount, housePis } from '../src/net/session/lobby.js';
import { TEXT } from '../src/net/session/texts.js';

const SECRET = { label: 'SPRINKLE-4821', sweets: [1, 2, 3, 4, 5, 6] };
const MINE = buildIdentity({ proto: 1, build: 'abc123', content: 777 });
const PHONE = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 };

/** A room with a host session on the hub, a fake clock and fake signalings. */
function makeRoom({ hostPlayers = 1, approvalGate = false } = {}) {
  const hub = createSessionHub();
  let t = 1000;
  const now = () => t;
  const signalings = [{ setLocked: vi.fn(), drop: vi.fn() }, { setLocked: vi.fn(), drop: vi.fn() }];
  let tokenN = 0;
  const hostEp = hub.host();
  const host = createHostSession({
    transport: hostEp, signalings, now, secret: SECRET, hostPlayers, mine: MINE,
    progress: { getSettings: () => ({ approvalGate }) },
    makeToken: () => (tokenN++).toString(16).padStart(32, '0'),
  });
  const hostFx = [];
  host.onEffect((e) => hostFx.push(e));
  host.dispatch({ type: 'open' });
  host.dispatch({ type: 'opened' });
  const guests = [];
  const room = {
    hub, host, hostFx, signalings, guests,
    advance(ms) { t += ms; },
    get now() { return t; },
    /** A guest machine that knocks (does not flush). */
    guest(id, { localPlayers = 1, mine = MINE, match = null, token = null } = {}) {
      const ep = hub.guest(id);
      const g = createGuestSession({ transport: ep, secret: SECRET, localPlayers, now, mine, token, platform: PHONE });
      const fx = [];
      g.onEffect((e) => fx.push(e));
      g.dispatch({ type: 'connect', match: match ?? undefined });
      hub.connect(id);
      const rec = { id, g, fx, ep, screens: () => fx.filter((e) => e.type === 'screen') };
      guests.push(rec);
      return rec;
    },
    flush() { hub.flush(); },
    /** Knock, answer the prompt and flush. */
    join(id, opts = {}) {
      const rec = room.guest(id, opts);
      room.flush();
      host.dispatch({ type: 'approve', peerId: id, yes: true });
      room.flush();
      return rec;
    },
    prompt() { return host.prompt(); },
  };
  return room;
}

const lastScreen = (rec) => rec.screens().at(-1);

describe('handshake + mandatory approval with the match check', () => {
  it('the guest shows "show them 🦊🐸" and the host prompt asks about the SAME two animals', () => {
    const room = makeRoom({ hostPlayers: 2 });
    const b = room.guest('guest-b', { localPlayers: 2, match: [0, 1] });
    room.flush();
    expect(b.g.state.phase).toBe('waiting-approval');
    const wait = lastScreen(b);
    expect(wait).toMatchObject({ id: 'net-waiting', params: { mode: 'approval', animals: '🦊🐸' } });
    expect(wait.params.text).toBe('Waiting for the host… show them 🦊🐸');
    const prompt = room.prompt();
    expect(prompt.animals).toBe(wait.params.animals);
    expect(prompt.text).toBe('Ask your friend: do you see 🦊🐸? Let them in?');
    expect(room.hostFx.some((e) => e.type === 'prompt' && e.prompt?.peerId === 'guest-b')).toBe(true);
    expect(humanCount(room.host.lobby())).toBe(2); // not in the lobby before Yes

    room.host.dispatch({ type: 'approve', peerId: 'guest-b', yes: true });
    room.flush();
    expect(b.g.state.phase).toBe('joined');
    expect(b.g.state.houseId).toBe(1);
    expect(b.g.state.emoji).toBe('🏡');
    expect(isToken(b.g.state.token)).toBe(true);
    expect(b.fx.some((e) => e.type === 'token')).toBe(true);
    expect(lastScreen(b)).toMatchObject({ id: 'online-lobby', params: { role: 'guest' } });
    expect(humanCount(b.g.lobby())).toBe(4);
    expect(housePis(b.g.lobby(), 1)).toEqual([2, 3]);
    expect(room.prompt()).toBe(null);
  });

  it('a fresh match pair is drawn for every attempt (crypto), 2 different animals', () => {
    const pairs = new Set();
    for (let i = 0; i < 30; i++) {
      const r = guestReduce(createGuestState({ secret: SECRET }), { type: 'connect', now: 0 });
      expect(r.state.match[0]).not.toBe(r.state.match[1]);
      pairs.add(r.state.match.join());
    }
    expect(pairs.size).toBeGreaterThan(15);
  });

  it('"Not now" → the guest sees the closed-room sentence and goes back to the Online hub', () => {
    const room = makeRoom();
    const b = room.guest('guest-b');
    room.flush();
    room.host.dispatch({ type: 'approve', peerId: 'guest-b', yes: false });
    room.flush();
    expect(b.g.state.phase).toBe('ended');
    expect(b.g.state.end).toEqual({ reason: 'declined', text: TEXT.closed });
    expect(lastScreen(b)).toEqual({ type: 'screen', id: 'online-hub', params: { message: TEXT.closed } });
    expect(b.fx.some((e) => e.type === 'leave-signaling')).toBe(true);
  });

  it('an unanswered prompt times out after 120 s → "The host didn\'t open the door this time 🚪"', () => {
    const room = makeRoom();
    const b = room.guest('guest-b');
    room.flush();
    room.advance(APPROVAL_TIMEOUT_MS - 10);
    room.host.dispatch({ type: 'tick' });
    room.flush();
    expect(b.g.state.phase).toBe('waiting-approval');
    room.advance(20);
    room.host.dispatch({ type: 'tick' });
    room.flush();
    expect(b.g.state.end).toEqual({ reason: 'declined', text: "The host didn't open the door this time 🚪" });
    expect(room.prompt()).toBe(null);
  });

  it('with "Only a grown-up can let houses in" the prompt asks for the parent gate', () => {
    const room = makeRoom({ approvalGate: true });
    room.guest('guest-b');
    room.flush();
    expect(room.prompt().needsGate).toBe(true);
    room.host.dispatch({ type: 'settings', approvalGate: false });
    expect(room.prompt().needsGate).toBe(false);
  });
});

describe('8-human cap and 4 houses × 2 players', () => {
  it('4 houses × 2 players join; the 5th house is told the room is full (no prompt)', () => {
    const room = makeRoom({ hostPlayers: 2 });
    const guests = ['b', 'c', 'd'].map((id) => room.join(`guest-${id}`, { localPlayers: 2 }));
    for (const g of guests) expect(g.g.state.phase).toBe('joined');
    room.advance(1000);
    room.host.dispatch({ type: 'tick' });
    room.flush();
    expect(humanCount(room.host.lobby())).toBe(8);
    for (const g of guests) expect(humanCount(g.g.lobby())).toBe(8); // LOBBY reached everyone
    expect(room.host.lobby().houses.map((h) => h.players.length)).toEqual([2, 2, 2, 2]);
    const e = room.guest('guest-e', { localPlayers: 1 });
    room.flush();
    expect(room.prompt()).toBe(null);
    expect(e.g.state.end).toEqual({ reason: 'full', text: 'This room is full of racers 🚗' });
  });

  it('a house asking for more seats than are left is refused before any prompt', () => {
    const room = makeRoom({ hostPlayers: 4 });
    room.join('guest-b', { localPlayers: 3 });
    const c = room.guest('guest-c', { localPlayers: 2 });
    room.flush();
    expect(room.prompt()).toBe(null);
    expect(c.g.state.end.reason).toBe('full');
    const d = room.join('guest-d', { localPlayers: 1 });
    expect(d.g.state.phase).toBe('joined');
    expect(humanCount(room.host.lobby())).toBe(8);
  });
});

describe('approvals that arrive during a race are queued until results', () => {
  it('no prompt mid-race; it appears at results with the match check; LOBBY waits too', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    room.host.dispatch({ type: 'phase', phase: 'race' });
    room.flush();
    expect(b.fx.some((e) => e.type === 'phase' && e.phase === 'race')).toBe(true);
    const mark = room.hostFx.length;
    const c = room.guest('guest-c', { match: [4, 9] });
    room.flush();
    expect(c.g.state.phase).toBe('waiting-approval');
    expect(room.prompt()).toBe(null);
    expect(room.hostFx.slice(mark).filter((e) => e.type === 'prompt' && e.prompt)).toHaveLength(0);
    // guests' lobby changes mid-race are not sent
    room.host.dispatch({ type: 'intent', peerId: 'guest-b', intent: { kind: 'seat-join', seat: 1 } });
    room.advance(2000);
    room.host.dispatch({ type: 'tick' });
    const lobbyMsgs = () => room.hostFx.filter((e) => e.type === 'send' && e.peerId === 'guest-b' && e.msg.type === 'LOBBY').length;
    const during = lobbyMsgs();
    room.advance(600_000); // a long race: the queued request must not time out
    room.host.dispatch({ type: 'tick' });
    room.flush();
    expect(c.g.state.phase).toBe('waiting-approval');
    expect(lobbyMsgs()).toBe(during);
    room.host.dispatch({ type: 'phase', phase: 'results' });
    room.flush();
    expect(lobbyMsgs()).toBe(during + 1); // one coalesced LOBBY at results
    const p = room.prompt();
    expect(p.animals).toBe(matchEmoji([4, 9]));
    room.host.dispatch({ type: 'approve', peerId: 'guest-c', yes: true });
    room.flush();
    expect(c.g.state.phase).toBe('joined');
  });
});

describe('lock / unlock, remove seat, remove house', () => {
  it('a locked room refuses new houses with no prompt; unlocking lets them ask again', () => {
    const room = makeRoom();
    room.host.dispatch({ type: 'lock' });
    expect(room.signalings[0].setLocked).toHaveBeenLastCalledWith(true);
    expect(room.signalings[1].setLocked).toHaveBeenLastCalledWith(true);
    const b = room.guest('guest-b');
    room.flush();
    expect(room.prompt()).toBe(null);
    expect(b.g.state.end).toEqual({ reason: 'locked', text: "The host's room is closed for now 🔒" });
    room.host.dispatch({ type: 'unlock' });
    expect(room.signalings[0].setLocked).toHaveBeenLastCalledWith(false);
    const c = room.guest('guest-c');
    room.flush();
    expect(room.prompt().peerId).toBe('guest-c');
    expect(c.g.state.phase).toBe('waiting-approval');
  });

  it('removing a single seat kicks only that seat and does not lock', () => {
    const room = makeRoom();
    const b = room.join('guest-b', { localPlayers: 2 });
    room.host.dispatch({ type: 'remove-seat', houseId: 1, seat: 1 });
    room.flush();
    expect(b.fx).toContainEqual({ type: 'seat-removed', seat: 1 });
    expect(b.g.state.phase).toBe('joined');
    expect(room.host.lobby().locked).toBe(false);
    expect(housePis(room.host.lobby(), 1)).toEqual([1]);
    // removing the last seat of a guest house removes the house (and locks)
    room.host.dispatch({ type: 'remove-seat', houseId: 1, seat: 0 });
    room.flush();
    expect(b.g.state.end.reason).toBe('removed');
    expect(room.host.lobby().locked).toBe(true);
  });

  it('remove house → KICK + locked + setLocked(true) + drop(peer); a reload (new peer id) is refused until unlock + approve', () => {
    const room = makeRoom();
    const b = room.join('guest-b', { localPlayers: 2 });
    room.host.dispatch({ type: 'remove-house', houseId: 1 });
    room.flush();
    expect(b.g.state.end).toEqual({ reason: 'removed', text: 'The host said bye-bye for now 👋' });
    expect(lastScreen(b)).toMatchObject({ id: 'online-hub', params: { message: TEXT.removed } });
    expect(room.host.lobby().locked).toBe(true);
    expect(room.host.lobby().houses).toHaveLength(1);
    for (const s of room.signalings) {
      expect(s.setLocked).toHaveBeenLastCalledWith(true);
      expect(s.drop).toHaveBeenCalledWith('guest-b');
    }
    // the removed house reloads: a new random peer id, same secret, no token (sessionStorage gone)
    const reload = room.guest('guest-b-reloaded', { localPlayers: 2 });
    room.flush();
    expect(room.prompt()).toBe(null);
    expect(reload.g.state.end.reason).toBe('locked');
    // even the OLD token does not help: removal forgets the house's tokens
    const withToken = room.guest('guest-b-token', { localPlayers: 2, token: b.g.state.token });
    room.flush();
    expect(withToken.g.state.end.reason).toBe('locked');
    // the host re-opens the room: the approval prompt (fresh match check) is the barrier again
    room.host.dispatch({ type: 'unlock' });
    const again = room.guest('guest-b-again', { localPlayers: 2, match: [7, 8] });
    room.flush();
    expect(again.g.state.phase).toBe('waiting-approval');
    expect(room.prompt().animals).toBe(matchEmoji([7, 8]));
    room.host.dispatch({ type: 'approve', peerId: 'guest-b-again', yes: true });
    room.flush();
    expect(again.g.state.phase).toBe('joined');
  });

  it('a valid reconnect token re-attaches its house without approval, even while locked (M2 hook)', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    const token = b.g.state.token;
    room.host.dispatch({ type: 'phase', phase: 'race' });
    room.flush();
    room.hub.cut('guest-b'); // Wi-Fi hiccup mid-race: the house stays (Robo Driver), marked asleep
    expect(room.host.lobby().houses[1].net).toBe('asleep');
    room.host.dispatch({ type: 'lock' });
    const back = room.guest('guest-b2', { token });
    room.flush();
    expect(room.prompt()).toBe(null);
    expect(back.g.state.phase).toBe('joined');
    expect(back.g.state.houseId).toBe(1);
    expect(back.g.state.token).not.toBe(token); // a fresh ticket each time
    expect(back.fx.some((e) => e.type === 'phase' && e.phase === 'race')).toBe(true);
    expect(room.host.lobby().houses[1].net).toBe('ok');
  });
});

describe('version check', () => {
  it('proto or content mismatch → REJECT version with the friendly text', () => {
    const room = makeRoom();
    const b = room.guest('guest-b', { mine: buildIdentity({ proto: 1, build: 'abc123', content: 778 }) });
    room.flush();
    expect(b.g.state.end).toEqual({ reason: 'version', text: 'Different game version — everyone refresh the page 🔄' });
    expect(room.prompt()).toBe(null);
    const c = room.guest('guest-c', { mine: buildIdentity({ proto: 2, build: 'abc123', content: 777 }) });
    room.flush();
    expect(c.g.state.end.reason).toBe('version');
  });

  it('a different build with equal proto + content connects', () => {
    const room = makeRoom();
    const b = room.join('guest-b', { mine: buildIdentity({ proto: 1, build: 'zzz999', content: 777 }) });
    expect(b.g.state.phase).toBe('joined');
    expect(compatible(MINE, { proto: 1, content: 777, build: 'other' }).ok).toBe(true);
    expect(compatible(MINE, null).ok).toBe(false);
  });
});

describe('lobby traffic, intents, emotes, leaving', () => {
  it('guest intents change the host lobby; LOBBY sends are coalesced to ≤ 4/s per guest', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    const lobbyTo = (peer) => room.hostFx.filter((e) => e.type === 'send' && e.peerId === peer && e.msg.type === 'LOBBY').length;
    const start = lobbyTo('guest-b');
    // 40 changes within one second
    for (let i = 0; i < 40; i++) {
      room.host.dispatch({ type: 'host-intent', intent: { kind: i % 2 ? 'unready' : 'pick', seat: 0, characterId: i % 2 ? undefined : 'luna' } });
      room.advance(25);
      room.host.dispatch({ type: 'tick' });
    }
    room.flush();
    expect(lobbyTo('guest-b') - start).toBeLessThanOrEqual(4);
    expect(lobbyTo('guest-b') - start).toBeGreaterThanOrEqual(3);
    b.g.dispatch({ type: 'intent', intent: { kind: 'pick', seat: 0, characterId: 'rocco' } });
    b.g.dispatch({ type: 'intent', intent: { kind: 'ready', seat: 0 } });
    room.flush();
    expect(room.host.lobby().houses[1].players[0]).toMatchObject({ characterId: 'rocco', ready: true });
    // a guest can't touch another house's seats: its intents always map to its own house
    b.g.dispatch({ type: 'intent', intent: { kind: 'seat-leave', seat: 3 } });
    room.flush();
    expect(room.host.lobby().houses[0].players).toHaveLength(1);
  });

  it('emotes: relayed to everyone, 1 per 1.5 s per player, only for your own players', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    const c = room.join('guest-c');
    room.advance(1000);
    room.host.dispatch({ type: 'tick' });
    room.flush();
    b.g.dispatch({ type: 'emote', globalPi: 1, emote: 2 });
    b.g.dispatch({ type: 'emote', globalPi: 1, emote: 3 }); // too soon
    b.g.dispatch({ type: 'emote', globalPi: 2, emote: 3 }); // not b's player
    room.flush();
    const got = c.fx.filter((e) => e.type === 'emote');
    expect(got).toEqual([{ type: 'emote', globalPi: 1, emote: 2 }]);
    room.advance(EMOTE_INTERVAL_MS);
    room.host.dispatch({ type: 'emote', globalPi: 0, emote: 7 });
    room.host.dispatch({ type: 'emote', globalPi: 0, emote: 8 }); // no such emote
    room.flush();
    expect(c.fx.filter((e) => e.type === 'emote').at(-1)).toEqual({ type: 'emote', globalPi: 0, emote: 7 });
    expect(room.hostFx.filter((e) => e.type === 'emote')).toHaveLength(2);
  });

  it('a guest leaving (BYE) frees its seats; the host ending sends everyone home with the friendly text', () => {
    const room = makeRoom();
    const b = room.join('guest-b');
    const c = room.join('guest-c');
    b.g.dispatch({ type: 'leave' });
    room.flush();
    expect(b.g.state.end.reason).toBe('left');
    expect(humanCount(room.host.lobby())).toBe(2);
    room.host.dispatch({ type: 'close' });
    room.flush();
    expect(c.g.state.end).toEqual({ reason: 'host-gone', text: "The host's house went to sleep 😴 Thanks for racing!" });
    expect(room.host.state.phase).toBe('idle');
    expect(room.hostFx.some((e) => e.type === 'leave-signaling')).toBe(true);
  });

  it('host silence for 8 s → host-gone; a connection that never comes → "We couldn\'t connect your houses"', () => {
    let st = guestReduce(createGuestState({ secret: SECRET }), { type: 'connect', now: 0 }).state;
    st = guestReduce(st, { type: 'tick', now: CONNECT_TIMEOUT_MS - 1 }).state;
    expect(st.phase).toBe('connecting');
    const r = guestReduce(guestReduce(st, { type: 'host-seen', now: 50 }).state, { type: 'tick', now: CONNECT_TIMEOUT_MS });
    expect(r.state.end).toEqual({ reason: 'no-connect', text: TEXT.noConnect }); // (no host at all: not-found, net.session.liveness)
    let j = guestReduce(createGuestState({ secret: SECRET }), { type: 'connect', now: 0 }).state;
    j = guestReduce(j, { type: 'connected', peerId: 'h', now: 10 }).state;
    j = guestReduce(j, { type: 'heard', now: 5000 }).state;
    expect(guestReduce(j, { type: 'tick', now: 5000 + HOST_SILENT_MS - 1 }).state.phase).toBe('waiting-approval');
    expect(guestReduce(j, { type: 'tick', now: 5000 + HOST_SILENT_MS }).state.end.reason).toBe('host-gone');
  });

  it('signaling failures map to friendly sentences', () => {
    const base = guestReduce(createGuestState({ secret: SECRET }), { type: 'connect', now: 0 }).state;
    expect(guestReduce(base, { type: 'connect-failed', code: 'no-host' }).state.end.text).toBe(TEXT.notFound);
    expect(TEXT.notFound).toMatch(/ask everyone to refresh 🔄/);
    expect(guestReduce(base, { type: 'connect-failed', code: 'unreachable' }).state.end.text).toBe(TEXT.unreachable);
    expect(guestReduce(base, { type: 'connect-failed', code: 'ice' }).state.end.text).toBe(TEXT.noConnect);
  });

  it('a peer that never says HELLO is let go; a second HELLO on one connection is ignored', () => {
    const reduce = createHostReducer({ makeToken: () => '0'.repeat(32) });
    let st = createHostState({ secret: SECRET, mine: MINE });
    st = reduce(st, { type: 'open', now: 0 }).state;
    st = reduce(st, { type: 'opened', now: 0 }).state;
    st = reduce(st, { type: 'peer-join', peerId: 'x', now: 0 }).state;
    const r = reduce(st, { type: 'tick', now: HELLO_TIMEOUT_MS });
    expect(r.effects).toContainEqual({ type: 'disconnect', peerId: 'x' });
    const hello = { proto: 1, content: 777, build: 'b', house: { localPlayers: 1 }, match: [1, 2] };
    st = reduce(st, { type: 'hello', peerId: 'x', hello, now: 1 }).state;
    const again = reduce(st, { type: 'hello', peerId: 'x', hello: { ...hello, match: [3, 4] }, now: 2 });
    expect(again.state.approval.items).toHaveLength(1);
    // malformed HELLOs are declined (no free text, strict shapes)
    const bad = reduce(st, { type: 'hello', peerId: 'y', hello: { ...hello, house: { localPlayers: 9 } }, now: 3 });
    expect(bad.effects.find((e) => e.type === 'send').msg).toEqual({ type: 'REJECT', reason: 'declined' });
  });

  it('the stand-in codec round-trips session messages and drops junk', () => {
    const msg = { type: 'HELLO', proto: 1, build: 'x', content: 1, house: { localPlayers: 2 }, canHost: true, match: [0, 1] };
    expect(jsonDecode(jsonEncode(msg))).toEqual(msg);
    expect(jsonDecode(new Uint8Array([1, 2, 3]))).toBe(null);
    expect(jsonDecode(jsonEncode({ type: 'NOPE' }))).toBe(null);
  });
});

describe('ctx.net for the menus (glue for the online flow)', () => {
  it('host: composeSetup turns the local flow result into a NetRaceSetup for the whole room', () => {
    const room = makeRoom({ hostPlayers: 2 });
    room.join('guest-b', { localPlayers: 1 });
    room.host.dispatch({ type: 'host-intent', intent: { kind: 'pick', seat: 0, characterId: 'luna' } });
    const pickCpus = vi.fn((n) => ['rocco', 'lenny', 'stella', 'peachy', 'gumbo', 'muffin', 'dino'].slice(0, n));
    const net = createHostNetContext(room.host, { makeSeed: () => 42, pickCpus });
    expect(net.role).toBe('host');
    expect(net.secret).toEqual(SECRET);
    expect(net.seatsLeft()).toBe(4); // 2 own seats + 5 free, capped at 4
    const setup = net.composeSetup({ players: [], trackId: 'gumdrop-meadow', speedClass: 'zoomy', laps: 2, mode: 'free' });
    expect(pickCpus).toHaveBeenCalledWith(5);
    expect(setup).toMatchObject({ raceId: 1, seed: 42, trackId: 'gumdrop-meadow', speedClass: 'zoomy', laps: 2, mode: 'free' });
    expect(setup.participants).toHaveLength(8);
    expect(setup.participants.filter((p) => p.playerIndex !== null).map((p) => p.playerIndex)).toEqual([0, 1, 2]);
    expect(room.host.lobby().hostChoice).toMatchObject({ trackId: 'gumdrop-meadow', speedClass: 'zoomy', laps: 2 });
    expect(net.composeSetup({ trackId: 'gumdrop-meadow' }).raceId).toBe(2);
  });

  it('guest: role guest, its own house and seats, no composeSetup', () => {
    const room = makeRoom({ hostPlayers: 1 });
    const b = room.join('guest-b', { localPlayers: 2 });
    const net = createGuestNetContext(b.g);
    expect(net.role).toBe('guest');
    expect(net.houseId).toBe(1);
    expect(net.composeSetup).toBeUndefined();
    expect(net.prompt()).toBe(null);
    expect(net.seatsLeft()).toBe(4);
    expect(net.lobby().label).toBe('SPRINKLE-4821');
    net.dispatch({ type: 'intent', intent: { kind: 'seat-leave', seat: 1 } });
    room.flush();
    expect(room.host.lobby().houses[1].players).toHaveLength(1);
  });
});