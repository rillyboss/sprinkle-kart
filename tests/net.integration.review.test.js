/**
 * Net review fixes in the online game glue (src/online, main.js wiring, screens):
 *   #2  the host's pause "Back to the lobby" / "Start over" ends every guest's race at once (they stay joined),
 *   #6  a guest reconnects on a fresh matchmaker + connection and its race gets its karts back,
 *   #13 closing the tab says bye (pagehide) instead of a 9 s silence,
 *   #15 a guest leaving mid-race never throws in the host's peer handler,
 *   #16 the online mode screen has no Records / Daily chips,
 *   #17 a guest's pause is a local Robo Driver overlay (no "P1 paused the race", no Photo mode),
 *   #10 the hub shows the NAT tips under "We couldn't connect your houses".
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  openHostRoom, joinGuestRoom, guestChoiceAction, setupEndsRace, sessionTicketStore, createTransportProxy, TICKET_KEY,
  ONLINE_TEXT, HOST_PAUSE_OPTIONS, GUEST_PAUSE_OPTIONS,
} from '../src/online/onlineFlow.js';
import * as online from '../src/online/index.js';
import { encodeSetup, createHostNetRace } from '../src/online/netRace.js';
import { netStack } from '../src/online/stack.js';
import { jsonEncode } from '../src/net/session/wire.js';
import { TEXT, allTexts } from '../src/net/session/texts.js';
import { createMemoryHub } from './helpers/netMemoryHub.js';
import { NET_SECRET } from './helpers/headlessSession.js';
import { netHudModel, NET_HUD_TEXT } from '../src/systems/netHud.js';
import { modeSelectEntries } from '../src/ui/screens/modeSelect.js';
import { hubTips } from '../src/ui/screens/online.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { modeCardsFor } from '../src/modes/menus.js';
import { ONLINE_MODES } from '../src/net/session/modes.js';

const PC = { userAgent: 'node', platform: 'Win32', maxTouchPoints: 0 };
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const netRaceSrc = main.slice(main.indexOf('function startNetRace('), main.indexOf('\nboot();'));

/** A host room + one guest room on the in-memory hub, approved and joined, with SESSION ticks on a fake clock. */
async function joinedRoom({ openOnline } = {}) {
  const hub = createMemoryHub({ seed: 4 });
  const hostEp = hub.endpoint('host0000host0000', 'host');
  let t = 0;
  const now = () => t;
  const host = await openHostRoom({ progress: null, pickCpus: (n) => Array.from({ length: n }, (_, i) => `cpu${i}`), deps: { transport: hostEp, now, makeSecret: () => NET_SECRET } });
  let guestEp = null;
  const deps = openOnline
    ? { openOnline: (o) => openOnline(hub, o), deriveRoomIds: async () => ({ topic: 't', password: 'p', workerRoom: 'r' }), now, platform: PC, tokenStore: null, selfId: 'guest000guest000', makePeerId: (() => { let n = 0; return () => `guest${String(++n).padStart(3, '0')}again0000`.slice(0, 16); })() }
    : { transport: (guestEp = hub.endpoint('guest000guest000', 'guest')), now, platform: PC, tokenStore: null };
  const guest = await joinGuestRoom({ secret: NET_SECRET, localPlayers: 1, deps });
  if (!openOnline) hub.link('host0000host0000', 'guest000guest000');
  const run = (ms) => {
    const end = t + ms;
    while (t < end) {
      t = Math.min(end, t + 250);
      hub.advance(t);
      host.session.dispatch({ type: 'tick' });
      guest.session.dispatch({ type: 'tick' });
    }
  };
  /** Same, letting promises (a reconnect's openOnline) settle between ticks. */
  const runAsync = async (ms) => {
    const end = t + ms;
    while (t < end) {
      await new Promise((res) => setImmediate(res));
      run(Math.min(250, end - t));
    }
  };
  run(500);
  const prompt = host.session.prompt();
  host.session.dispatch({ type: 'approve', peerId: prompt.peerId, yes: true });
  run(500);
  return { hub, host, guest, guestEp, hostEp, run, runAsync, get t() { return t; } };
}

describe('#2 host pause → lobby / start over ends every guest race at once', () => {
  it('guestChoiceAction: mid-race the choice ends the race, on the results it closes them', () => {
    expect(guestChoiceAction('lobby', false)).toEqual({ end: 'lobby', resolve: null });
    expect(guestChoiceAction('restart', false)).toEqual({ end: 'again', resolve: null });
    expect(guestChoiceAction('again', false)).toEqual({ end: 'again', resolve: null });
    expect(guestChoiceAction('next-track', false)).toEqual({ end: 'next-track', resolve: null });
    expect(guestChoiceAction('lobby', true)).toEqual({ end: null, resolve: 'host:lobby' });
    expect(guestChoiceAction('again', true)).toEqual({ end: null, resolve: 'host:again' });
  });

  it('a SETUP for another race ends the running one; the same race never does', () => {
    expect(setupEndsRace({ raceId: 3 }, { raceId: 4 })).toBe(true);
    expect(setupEndsRace({ raceId: 3 }, { raceId: 3 })).toBe(false);
    expect(setupEndsRace(null, { raceId: 3 })).toBe(false);
  });

  it('host pause "Back to the lobby": the guest gets the CHOICE mid-race, leaves the race and is still joined 20 s later', async () => {
    const r = await joinedRoom();
    r.host.session.dispatch({ type: 'phase', phase: 'loading' });
    r.host.session.dispatch({ type: 'phase', phase: 'race' });
    r.run(500);
    const choices = [];
    r.guest.session.onEffect((e) => { if (e.type === 'choice') choices.push(guestChoiceAction(e.choice, false)); });
    // exactly what main.js broadcasts from the host's pause
    r.hostEp.broadcast('ctrl', jsonEncode({ type: 'CHOICE', screen: 'results', choice: 'lobby' }));
    r.run(250);
    expect(choices).toEqual([{ end: 'lobby', resolve: null }]);
    r.host.session.dispatch({ type: 'phase', phase: 'lobby' });
    r.run(20_000);
    expect(r.guest.session.state.phase).toBe('joined');
    expect(r.guest.session.state.hostPhase).toBe('lobby');
    expect(r.host.session.lobby().houses).toHaveLength(2);
  });

  it('host pause "Start over": the guest ends the race on the CHOICE (or the new SETUP) and races the new one', async () => {
    const r = await joinedRoom();
    r.host.session.dispatch({ type: 'phase', phase: 'race' });
    const setups = [];
    r.guest.router.on('setup', (rc) => setups.push(rc.setup.raceId));
    const choices = [];
    r.guest.session.onEffect((e) => { if (e.type === 'choice') choices.push(e.choice); });
    r.hostEp.broadcast('ctrl', jsonEncode({ type: 'CHOICE', screen: 'results', choice: 'restart' }));
    r.hostEp.broadcast('ctrl', encodeSetup(netStack, { raceId: 2, participants: [] }));
    r.run(15_000);
    expect(choices).toEqual(['restart']);
    expect(guestChoiceAction(choices[0], false).end).toBe('again');
    expect(setups).toEqual([2]);
    expect(setupEndsRace({ raceId: 1 }, { raceId: setups[0] })).toBe(true);
    expect(r.guest.session.state.phase).toBe('joined');
  });

  it('main.js: the host broadcasts both pause choices; a guest race listens for choices and new setups', () => {
    expect(HOST_PAUSE_OPTIONS.map((o) => o[0])).toEqual(['resume', 'restart', 'lobby']);
    expect(netRaceSrc).toMatch(/choice === 'restart'\) \{ broadcastChoice\('restart'\); end\('restart'\); \}/);
    expect(netRaceSrc).toMatch(/broadcastChoice\('lobby'\); end\('lobby'\)/);
    expect(netRaceSrc).toMatch(/mod\.guestChoiceAction\(c, resultsShown\)/);
    expect(netRaceSrc).toMatch(/newSetup\(s\) \{ if \(mod\.setupEndsRace\(setup, s\)\) end\('again'\); \}/);
    expect(main).toMatch(/o\.raceHooks\?\.newSetup\?\.\(rc\.setup\)/);
  });
});

describe('#6 reconnect: a fresh connection, the same house, the race hands the karts back', () => {
  it('joinGuestRoom opens a NEW matchmaker + selfId per attempt; HELLO with the ticket re-attaches without approval', async () => {
    const opened = [];
    const r = await joinedRoom({
      openOnline: async (hub, o) => {
        opened.push(o.selfId);
        const ep = hub.endpoint(o.selfId, 'guest');
        hub.link('host0000host0000', o.selfId);
        return { transport: ep, signaling: { kind: 'public', leave: vi.fn() } };
      },
    });
    expect(r.guest.session.state.phase).toBe('joined');
    const houseId = r.guest.session.state.houseId;
    r.host.session.dispatch({ type: 'phase', phase: 'race' });
    const reattached = [];
    r.host.session.onEffect((e) => { if (e.type === 'reattach') reattached.push(e); });
    // Wi-Fi hiccup: everything from the host stops
    r.hub.setPath('host0000host0000', opened[0], { loss: 1 });
    await r.runAsync(9000);
    expect(r.guest.session.state.phase).not.toBe('ended');
    await r.runAsync(3000);
    expect(opened.length).toBeGreaterThanOrEqual(2);
    expect(new Set(opened).size).toBe(opened.length); // never the old, dying id
    expect(r.guest.session.state.phase).toBe('joined');
    expect(r.guest.session.state.houseId).toBe(houseId);
    expect(r.host.session.prompt()).toBe(null);
    expect(reattached.map((e) => e.houseId)).toEqual([houseId]);
    expect(r.guest.hostId()).toBe('host0000host0000');
  });

  it('createHostNetRace.reattach: snapshots and inputs follow the new peer, Robo Driver hands back, START + TIMEBASE resent', () => {
    const sent = [];
    const transport = { send: (p, ch, b) => { sent.push([p, ch, b[0]]); return true; }, broadcast: () => {}, stats: () => ({}) };
    const race = { karts: [{ id: 0, playerIndex: 0 }, { id: 1, playerIndex: 1 }], onEvent: null, update() {} };
    let t = 0;
    const link = createHostNetRace({
      stack: { ...netStack, capture: () => ({ tick: 0, karts: [] }), tickRace: () => {} }, race, transport, setup: { raceId: 5 },
      houses: new Map([[1, { peerId: 'old', karts: [1] }]]), localInputs: () => [], now: () => t,
    });
    link.loaded('old');
    link.frame(0);
    expect(link.driver.housePeer(1)).toBe('old');
    link.setHouseRobo(1, true);
    sent.length = 0;
    expect(link.reattach(1, 'new')).toBe(true);
    expect(link.driver.housePeer(1)).toBe('new');
    const M = netStack.wire.MSG;
    expect(sent.filter((s) => s[0] === 'new').map((s) => s[2])).toEqual([M.START, M.TIMEBASE]);
    expect(link.reattach(9, 'x')).toBe(false);
    link.dispose();
  });

  it('the ticket lives in sessionStorage for this room only (and survives a broken storage)', () => {
    const mem = new Map();
    const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
    const store = sessionTicketStore(storage);
    store.save(NET_SECRET, 'f'.repeat(32));
    expect(JSON.parse(mem.get(TICKET_KEY)).token).toBe('f'.repeat(32));
    expect(store.load(NET_SECRET)).toBe('f'.repeat(32));
    expect(store.load({ label: 'SPRINKLE-1111', sweets: [1, 2, 3, 4, 5, 6] })).toBe(null);
    store.clear({ label: 'OTHER-0000', sweets: [] });
    expect(store.load(NET_SECRET)).toBe('f'.repeat(32));
    store.clear(NET_SECRET);
    expect(store.load(NET_SECRET)).toBe(null);
    const broken = sessionTicketStore({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
    expect(() => broken.save(NET_SECRET, 'a'.repeat(32))).not.toThrow();
    expect(broken.load(NET_SECRET)).toBe(null);
    expect(sessionTicketStore(null).load(NET_SECRET)).toBe(null);
  });

  it('the transport proxy forwards to whichever transport is current and forgets the old one', () => {
    const mk = (id) => {
      const fns = { msg: new Set(), peer: new Set() };
      return {
        selfId: id, sent: [], peers: () => ['h'], send(p, ch, b) { this.sent.push(b); return true; },
        onMessage: (f) => { fns.msg.add(f); return () => fns.msg.delete(f); }, onPeer: (f) => { fns.peer.add(f); return () => fns.peer.delete(f); },
        deliver: (b) => fns.msg.forEach((f) => f('h', 'ctrl', b)), leave: () => fns.peer.forEach((f) => f({ type: 'leave', peerId: 'h' })),
      };
    };
    const a = mk('a');
    const b = mk('b');
    const p = createTransportProxy();
    const got = [];
    const peers = [];
    p.onMessage((peer, ch, bytes) => got.push(bytes));
    p.onPeer((ev) => peers.push(ev.type));
    expect(p.send('h', 'ctrl', 1)).toBe(false);
    p.setTarget(a);
    a.deliver(1);
    expect(p.send('h', 'ctrl', 2)).toBe(true);
    p.setTarget(b);
    a.deliver(3); // the old transport is not heard any more
    a.leave();
    b.deliver(4);
    expect(got).toEqual([1, 4]);
    expect(peers).toEqual([]);
    expect(a.sent).toEqual([2]);
    expect(p.selfId).toBe('b');
    expect(p.peers()).toEqual(['h']);
  });

  it('main.js: robo while reconnecting, the HUD banner, and flags cleared when the race ends', () => {
    expect(netRaceSrc).toMatch(/robo: pauseOpen \|\| unplugged\.has\(p\.playerIndex\) \|\| away/);
    expect(netRaceSrc).toMatch(/session\.net\.wobbly = false;\n\s+session\.net\.reconnecting = false;/);
    expect(netHudModel({ kart: { id: 0 }, race: {}, net: { role: 'guest', reconnecting: true, reconnectText: TEXT.netNap } }).banner).toBe(TEXT.netNap);
    expect(netHudModel({ kart: { id: 0 }, race: {}, net: { role: 'guest', reconnecting: true } }).banner).toBe(NET_HUD_TEXT.reconnecting);
    expect(netHudModel({ kart: { id: 0 }, race: {}, net: { role: 'guest', paused: true } }).banner).toBe(NET_HUD_TEXT.snackGuest);
  });
});

describe('#13 / #15 / #1 main.js wiring', () => {
  it('closing the tab says bye right away (pagehide → session close / leave + transport close)', () => {
    expect(main).toMatch(/window\.addEventListener\('pagehide', sayByeOnPageHide\)/);
    const fn = main.slice(main.indexOf('function sayByeOnPageHide'), main.indexOf('function installOnlineActions'));
    expect(fn).toMatch(/o\.role === 'host' \? \{ type: 'close' \} : \{ type: 'leave' \}/);
    expect(fn).toMatch(/transport\?\.close\?\.\(\)/);
  });

  it('the host peer-leave handler never touches an undefined variable (no `void h`)', () => {
    expect(netRaceSrc).not.toMatch(/void h;/);
    expect(netRaceSrc).toMatch(/for \(const hid of mod\.driverHouses\(setup, 0, \(\) => null\)\.keys\(\)\) if \(room\.peerOf\(hid\) === null\) link\.setHouseRobo\(hid, true\);/);
    // and what it relies on works: a gone house is found and handed to Robo Driver
    const houses = online.driverHouses({ participants: [{ houseId: 0, playerIndex: 0, seat: 0 }, { houseId: 1, playerIndex: 1, seat: 0 }] }, 0, () => null);
    expect([...houses.keys()]).toEqual([1]);
  });

  it('session housekeeping runs on a timer (not rAF) and stops with the room', () => {
    expect(main).toMatch(/state\.sessionTimer = setInterval\(/);
    expect(main).toMatch(/clearInterval\(o\.sessionTimer\)/);
    const tick = main.slice(main.indexOf('function onlineTick('), main.indexOf('function netInfo('));
    expect(tick).not.toMatch(/dispatch\(\{ type: 'tick' \}\)/);
  });
});

describe('#16 online mode screen: only the online cards, no chips', () => {
  it('Records / Daily Sprinkle chips are gone in a room and back offline', () => {
    const offline = modeSelectEntries(SCREENS, null).map((e) => e.id);
    expect(offline.length).toBeGreaterThan(0);
    expect(modeSelectEntries(SCREENS, { role: 'host' })).toEqual([]);
    expect(modeCardsFor({ role: 'host' }).map((m) => m.id)).toEqual(ONLINE_MODES.filter((m) => modeCardsFor(null).some((c) => c.id === m)));
  });
});

describe('#17 a guest pause is a local Robo Driver overlay', () => {
  it('its own title and line, no "paused the race", no Photo mode; the host pause has no Photo mode either', () => {
    expect(ONLINE_TEXT.guestPauseTitle).toMatch(/Robo Driver/);
    expect(ONLINE_TEXT.guestPauseLine).toMatch(/[!.?]$/); // a full sentence: pauseLeadText shows it as-is
    expect(ONLINE_TEXT.guestPauseLine).toMatch(/friends keep racing/i);
    expect(GUEST_PAUSE_OPTIONS.map((o) => o[0])).toEqual(['resume', 'leave']);
    expect(netRaceSrc).toMatch(/title: mod\.ONLINE_TEXT\.guestPauseTitle, emoji: '🤖', noPhoto: true/);
    expect(netRaceSrc).toMatch(/options: mod\.HOST_PAUSE_OPTIONS, noPhoto: true/);
    expect(netRaceSrc).toMatch(/helpers\.flash\(k, mod\.ONLINE_TEXT\.robo\)/);
    expect(netRaceSrc).not.toMatch(/showPause\(`P\$\{/);
  });

  it('photo mode leaves an online pause alone', async () => {
    const { default: photoMode } = await import('../src/systems/photoMode.js');
    const { installSystems } = await import('../src/systems/index.js');
    const { createFakeApp } = await import('./helpers/headlessSession.js');
    const THREE = await import('three');
    const calls = [];
    const menus = { showPause: (label, extra) => { calls.push(extra); return Promise.resolve('resume'); }, open: () => Promise.resolve('back') };
    const session = { scene: new THREE.Scene(), humans: [{ playerIndex: 0 }], race: { getPlayerKart: () => null }, net: { role: 'guest' } };
    const app = createFakeApp({ menus, renderer: { render() {} }, game: { state: 'race', errors: [], session } });
    const off = installSystems(app.bus, app, [photoMode]);
    await menus.showPause('x', { options: GUEST_PAUSE_OPTIONS });
    expect(calls[0].options.map((o) => o[0])).toEqual(['resume', 'leave']);
    session.net = null;
    await menus.showPause('x', { options: GUEST_PAUSE_OPTIONS, noPhoto: true });
    expect(calls[1].options.map((o) => o[0])).toEqual(['resume', 'leave']);
    await menus.showPause('x', { options: GUEST_PAUSE_OPTIONS });
    expect(calls[2].options.map((o) => o[0])).toContain('photo');
    off();
  });

  it('the pause screen takes a title and emoji (escaped)', () => {
    const src = readFileSync(new URL('../src/ui/screens/pause.js', import.meta.url), 'utf8');
    expect(src).toMatch(/title = 'Snack break!', emoji = '🍪'/);
    expect(src).toMatch(/escapeHtml\(title\)/);
  });
});

describe('#10 the hub shows the NAT tips', () => {
  it('hubTips keeps up to 3 plain strings; main.js passes them only for no-connect', () => {
    expect(hubTips({ tips: TEXT.noConnectTips })).toEqual([...TEXT.noConnectTips]);
    expect(hubTips({ tips: ['a', 2, '', 'b', 'c', 'd'] })).toEqual(['a', 'b', 'c']);
    expect(hubTips({})).toEqual([]);
    expect(main).toMatch(/tips: e\.reason === 'no-connect' \? \[\.\.\.mod\.TEXT\.noConnectTips\] : null/);
    expect(main).toMatch(/after\.tips\?\.length \? \{ tips: after\.tips \}/);
  });
});

describe('friendly words in the new strings', () => {
  it('pass the tone check', () => {
    const BANNED = /\b(hit|kill|crash|destroy|die|dead|fail|failed|error|broken|kick|kicked|reject|rejected|denied|invalid)\b/i;
    for (const t of [...allTexts(), ONLINE_TEXT.guestPauseTitle, ONLINE_TEXT.guestPauseLine, NET_HUD_TEXT.reconnecting]) expect(t, t).not.toMatch(BANNED);
  });
});
