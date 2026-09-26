// The online screens + router hooks (NETWORKING.md §10.1, §10.4; acceptance M1 #2, #7, M1-17).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installDoc, allText, fakeCtx, fakeNav, ev } from './net.screens.helpers.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { menuEntries, flowOrder } from '../src/ui/screenFlow.js';
import { Menus, netWaitingFor, netRoleOf, DEFAULT_NET_ROLES } from '../src/ui/Menus.js';
import { hubAction, HUB_OPTIONS } from '../src/ui/screens/online.js';
import { waitingView } from '../src/ui/screens/netWaiting.js';
import { keyToTyping } from '../src/ui/screens/codeEntry.js';
import { lobbyScreenReduce, createLobbyScreenState, houseModalOptions, houseStatus, HOST_ACTIONS } from '../src/ui/screens/onlineLobby.js';
import { checkRowHtml, runCheck } from '../src/ui/screens/checkConnection.js';
import { createLobby, lobbyReduce } from '../src/net/session/lobby.js';
import { TEXT } from '../src/net/session/texts.js';
import { SECRET_SWEETS, sweetsText } from '../src/net/session/roomCode.js';
import { modeCardsFor, MODE_CARDS, createModeSelectState, modeSelectReduce } from '../src/modes/menus.js';
import { ONLINE_MODES } from '../src/net/session/modes.js';
import { joinReduce, createJoinState } from '../src/ui/menuState.js';
import { createFakeRtcNetwork, FAKE_IPS } from './helpers/netFakeRtc.js';

const SECRET = { label: 'SPRINKLE-4821', sweets: [0, 1, 2, 3, 4, 5] };
const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
const PC = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32', maxTouchPoints: 0 };
const run = (lobby, actions) => actions.reduce((l, a) => lobbyReduce(l, a).lobby, lobby);

let doc;
beforeEach(() => { doc = installDoc(); });
afterEach(() => { vi.unstubAllGlobals(); });

const mount = (id, ctx, params = {}, nav = fakeNav()) => ({ inst: SCREENS.get(id).mount(ctx, nav, params), nav });

describe('screen registry + title entry', () => {
  it('registers every new online screen', () => {
    for (const id of ['online-hub', 'code-entry', 'online-lobby', 'check-connection', 'net-waiting', 'invite-gate']) {
      expect(SCREENS.has(id), id).toBe(true);
    }
  });

  it('the Online title entry shows only once a grown-up turned online on; other entries unchanged', () => {
    const off = menuEntries(SCREENS, 'title', fakeCtx({ settings: { onlineEnabled: false } }));
    const on = menuEntries(SCREENS, 'title', fakeCtx({ settings: { onlineEnabled: true } }));
    expect(off.map((e) => e.id)).not.toContain('online-hub');
    expect(on.map((e) => e.id)).toContain('online-hub');
    expect(on.find((e) => e.id === 'online-hub')).toMatchObject({ label: 'Online', emoji: '🌐' });
    expect(on.filter((e) => e.id !== 'online-hub')).toEqual(off);
    expect(menuEntries(SCREENS, 'title').map((e) => e.id)).not.toContain('online-hub'); // no ctx → hidden
    // a throwing when() hides the entry instead of breaking the title screen
    const weird = new Map([['x', { id: 'x', menuEntry: { label: 'X', when: () => { throw new Error('no'); } } }], ['y', { id: 'y', menuEntry: { label: 'Y' } }]]);
    expect(menuEntries(weird, 'title', {}).map((e) => e.id)).toEqual(['y']);
  });

  it('the offline flow order is unchanged (online screens are not flow screens)', () => {
    expect(flowOrder(SCREENS, { draft: { skip: new Set() } })).toEqual(['title', 'join', 'mode-select', 'character-select', 'track-select']);
  });
});

describe('Menus router hooks (all no-ops when ctx.net is null)', () => {
  const makeMenus = () => new Menus(doc.createElement('div'), { screens: SCREENS, progress: fakeCtx().progress });

  it('net roles: host-only screens → net-waiting on guests only', () => {
    expect(netRoleOf(SCREENS.get('mode-select'))).toBe('host');
    expect(netRoleOf(SCREENS.get('character-select'))).toBe('all');
    expect(netRoleOf(SCREENS.get('online-lobby'))).toBe('all');
    expect(netRoleOf({ id: 'x' })).toBe('local');
    expect(netRoleOf({ id: 'x', net: { role: 'host' } })).toBe('host');
    expect(DEFAULT_NET_ROLES['track-select']).toBe('host');
    const m = makeMenus();
    expect(netWaitingFor(m, SCREENS.get('mode-select'))).toBe(null); // offline
    m.net = { role: 'host' };
    expect(netWaitingFor(m, SCREENS.get('mode-select'))).toBe(null);
    m.net = { role: 'guest' };
    expect(netWaitingFor(m, SCREENS.get('mode-select'))).toBe(SCREENS.get('net-waiting'));
    expect(netWaitingFor(m, SCREENS.get('character-select'))).toBe(null);
  });

  it('goto on a guest mounts net-waiting with forId + waitingParams; offline mounts the real screen', () => {
    const hostScreen = { id: 'track-select', net: { role: 'host' }, mount: () => ({ node: doc.createElement('div'), handle() {} }) };
    const screens = new Map([...SCREENS, ['track-select', hostScreen]]);
    const m = new Menus(doc.createElement('div'), { screens, progress: fakeCtx().progress });
    m.goto('track-select');
    expect(m.screenId).toBe('track-select');
    m.net = { role: 'guest', waitingParams: (id) => ({ sub: `waiting for ${id}` }) };
    m.goto('track-select');
    expect(m.screenId).toBe('net-waiting');
    expect(allText(m.el)).toContain(TEXT.hostPicking.course);
    expect(allText(m.el)).toContain('waiting for track-select');
    m.net = { role: 'host' };
    m.goto('track-select');
    expect(m.screenId).toBe('track-select');
    m.dispose();
  });

  it('_finish passes the setup through ctx.net.composeSetup on the host (and untouched offline)', async () => {
    const m = makeMenus();
    const p1 = new Promise((r) => { m._resolveRun = r; });
    m._finish({ trackId: 'a' });
    expect(await p1).toEqual({ trackId: 'a' });
    m.net = { role: 'host', composeSetup: vi.fn((s) => ({ ...s, net: true })) };
    const p2 = new Promise((r) => { m._resolveRun = r; });
    m._finish({ trackId: 'b' });
    expect(await p2).toEqual({ trackId: 'b', net: true });
    m.net = { role: 'host', composeSetup: () => { throw new Error('oops'); } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p3 = new Promise((r) => { m._resolveRun = r; });
    m._finish({ trackId: 'c' });
    expect(await p3).toEqual({ trackId: 'c' });
    warn.mockRestore();
    m.dispose();
  });

  it('resolveCurrent closes whatever one-off screen is open (a host CHOICE on a guest)', async () => {
    const m = makeMenus();
    const p = m.open('invite-gate', {});
    expect(m.screenId).toBe('invite-gate');
    m.resolveCurrent('next-track');
    expect(await p).toBe('next-track');
    expect(m.screen).toBe(null);
    m.dispose();
  });
});

describe('online hub', () => {
  it('shows Host / Join / Check connection and routes them', () => {
    const online = { host: vi.fn(), join: vi.fn() };
    const { inst, nav } = mount('online-hub', fakeCtx({ settings: { onlineEnabled: true }, online }), { returnTo: 'title', platform: PC });
    const text = allText(inst.node);
    for (const t of ['Host a game', 'Join a friend', 'Check connection', 'Play with friends']) expect(text).toContain(t);
    inst.handle(ev('confirm'));
    expect(online.host).toHaveBeenCalledTimes(1);
    inst.handle(ev('right'));
    inst.handle(ev('confirm'));
    expect(nav.goto).toHaveBeenLastCalledWith('code-entry', { returnTo: 'online-hub' });
    inst.handle(ev('right'));
    inst.handle(ev('confirm'));
    expect(nav.goto).toHaveBeenLastCalledWith('check-connection', { returnTo: 'online-hub' });
    inst.handle(ev('back'));
    expect(nav.goto).toHaveBeenLastCalledWith('title');
  });

  it('an iPad cannot host (friendly sentence), but can still join', () => {
    const online = { host: vi.fn(), join: vi.fn() };
    const { inst } = mount('online-hub', fakeCtx({ settings: { onlineEnabled: true }, online }), { platform: IPAD });
    inst.handle(ev('confirm'));
    expect(online.host).not.toHaveBeenCalled();
    expect(allText(inst.node)).toContain('Hosting needs a computer 💻 — you can still join!');
    expect(hubAction('join', { platform: IPAD }).go).toBe('code-entry');
  });

  it('from an invite: "Join 🏡 SPRINKLE-4821?" with one press to confirm', () => {
    const online = { host: vi.fn(), join: vi.fn() };
    const { inst } = mount('online-hub', fakeCtx({ settings: { onlineEnabled: true }, online }), { invite: SECRET, platform: PC });
    expect(allText(inst.node)).toContain('Join 🏡 SPRINKLE-4821?');
    inst.handle(ev('confirm'));
    expect(online.join).toHaveBeenCalledWith(SECRET);
  });

  it('with online OFF it shows the "ask a grown-up" screen and never the hub (the gate is respected)', () => {
    const online = { host: vi.fn(), join: vi.fn() };
    const { inst, nav } = mount('online-hub', fakeCtx({ settings: { onlineEnabled: false }, online }), { invite: SECRET });
    const text = allText(inst.node);
    expect(text).toContain('Ask a grown-up to turn on online play in Settings → Grown-ups 🔒');
    expect(text).not.toContain('Host a game');
    inst.handle(ev('confirm'));
    expect(online.join).not.toHaveBeenCalled();
    expect(nav.goto).toHaveBeenCalledWith('title');
  });

  it('hubAction without the online flow wired says it is almost ready', () => {
    expect(hubAction('host', { platform: PC, hasOnline: false })).toEqual({ message: TEXT.comingSoon });
    expect(hubAction('join-invite', { invite: SECRET, hasOnline: false }).go).toBe('code-entry');
    expect(HUB_OPTIONS).toEqual(['host', 'join', 'check']);
  });
});

describe('invite gate + net-waiting', () => {
  it('invite gate: one button back to the title', () => {
    const { inst, nav } = mount('invite-gate', fakeCtx(), {});
    expect(allText(inst.node)).toContain(TEXT.inviteGate);
    inst.handle(ev('left'));
    expect(nav.goto).not.toHaveBeenCalled();
    inst.handle(ev('confirm'));
    expect(nav.goto).toHaveBeenCalledWith('title');
  });

  it('net-waiting shows the match check big while waiting for approval, and "Host is picking" for host screens', () => {
    const a = mount('net-waiting', fakeCtx(), { mode: 'approval', animals: '🦊🐸' }).inst;
    expect(allText(a.node)).toContain('🦊🐸');
    expect(allText(a.node)).toContain('Waiting for the host… show them 🦊🐸');
    expect(waitingView({ forId: 'mode-select' }).text).toBe('Host is picking a mode… 🎨');
    expect(waitingView({ forId: 'track-select' }).text).toBe('Host is picking a track… 🎨');
    expect(waitingView({ mode: 'connecting', label: 'SPRINKLE-4821' })).toMatchObject({ text: TEXT.knocking, sub: 'Room SPRINKLE-4821' });
    expect(waitingView({}).text).toBe(TEXT.hostWaiting);
    expect(waitingView({ mode: 'reconnecting' }).text).toBe(TEXT.reconnecting);
  });

  it('B on net-waiting leaves the room through the online flow', () => {
    const online = { leave: vi.fn() };
    const { inst } = mount('net-waiting', fakeCtx({ online }), { mode: 'connecting' });
    inst.handle(ev('confirm'));
    expect(online.leave).not.toHaveBeenCalled();
    inst.handle(ev('back'));
    expect(online.leave).toHaveBeenCalled();
    const net = { dispatch: vi.fn() };
    const w = mount('net-waiting', fakeCtx({ net }), {}).inst;
    w.handle(ev('back'));
    expect(net.dispatch).toHaveBeenCalledWith({ type: 'leave' });
    const { inst: bare, nav } = mount('net-waiting', fakeCtx(), {});
    bare.handle(ev('back'));
    expect(nav.goto).toHaveBeenCalledWith('online-hub');
  });
});

describe('code entry', () => {
  it('controller only: wheels, 6 sweets, Join → ctx.online.join(secret)', () => {
    const online = { join: vi.fn() };
    const { inst } = mount('code-entry', fakeCtx({ online }), {});
    // word wheel: SPRINKLE (index 0) is already there; digits 4 8 2 1
    inst.handle(ev('right')); // digit 1
    for (let i = 0; i < 4; i++) inst.handle(ev('up'));
    inst.handle(ev('right'));
    for (let i = 0; i < 8; i++) inst.handle(ev('up'));
    inst.handle(ev('right'));
    for (let i = 0; i < 2; i++) inst.handle(ev('up'));
    inst.handle(ev('right'));
    inst.handle(ev('up'));
    inst.handle(ev('confirm')); // → sweets grid
    for (let k = 0; k < 6; k++) { inst.handle(ev('confirm')); inst.handle(ev('right')); }
    expect(allText(inst.node)).toContain('Knock on SPRINKLE-4821!');
    inst.handle(ev('confirm'));
    expect(online.join).toHaveBeenCalledWith({ label: 'SPRINKLE-4821', sweets: [0, 1, 2, 3, 4, 5] });
  });

  it('keyboard typing + paste; keyboard menu events right after a typed key are ignored', () => {
    const online = { join: vi.fn() };
    const ctx = fakeCtx({ online });
    const { inst } = mount('code-entry', ctx, {});
    for (const key of ['c', 'u', 'p', '0', '0', '4', '2']) doc.fire('keydown', { key });
    expect(allText(inst.node)).toContain('CUPCAKE');
    inst.handle({ deviceId: 'kb1', action: 'back' }); // e.g. the Backspace / WASD menu echo of typing
    expect(allText(inst.node)).toContain('CUPCAKE');
    doc.fire('paste', { clipboardData: { getData: () => '#join=SPRINKLE-4821~ABCDEF' } });
    inst.handle({ deviceId: 'pad0', action: 'confirm' });
    expect(online.join).toHaveBeenCalledWith({ label: 'SPRINKLE-4821', sweets: [0, 1, 2, 3, 4, 5] });
    expect(keyToTyping({ key: 'Backspace' })).toEqual({ action: 'erase' });
    expect(keyToTyping({ key: 'x', ctrlKey: true })).toBe(null);
    expect(keyToTyping({ key: 'Enter' })).toBe(null);
    const before = doc.listenerCount();
    inst.destroy();
    expect(doc.listenerCount()).toBe(before - 2);
  });

  it('B on the wheels goes back to the hub; without the online flow Join explains it is almost ready', () => {
    const { inst, nav } = mount('code-entry', fakeCtx(), { prefill: SECRET });
    inst.handle(ev('confirm')); // label → next wheel
    inst.handle(ev('start')); // → go
    inst.handle(ev('confirm'));
    expect(allText(inst.node)).toContain(TEXT.comingSoon);
    for (let i = 0; i < 12; i++) inst.handle(ev('back'));
    expect(nav.goto).toHaveBeenCalledWith('online-hub');
  });
});

describe('check connection', () => {
  it('renders the three rows from describeCheck and never an IP address', async () => {
    const result = {
      rows: [
        { id: 'matchmaker', icon: '✅', title: 'Matchmaker', text: 'Public relays 🌐', grownUps: 'For grown-ups: public trackers 3/3 reachable (120 ms)' },
        { id: 'direct', icon: '❌', title: 'Direct connection', text: 'Relay needed 🛟', grownUps: `For grown-ups: candidate types host · leaked ${FAKE_IPS[0]} and 2001:db8::1` },
        { id: 'relay', icon: '⚠️', title: 'Relay', text: 'Not set up yet', grownUps: 'For grown-ups: no worker' },
      ],
      hint: 'A grown-up can set up the relay 🛟',
    };
    const { inst } = mount('check-connection', fakeCtx(), { result });
    await Promise.resolve();
    const text = allText(inst.node);
    for (const t of ['Matchmaker', 'Public relays 🌐', 'Relay needed 🛟', 'A grown-up can set up the relay 🛟']) expect(text).toContain(t);
    for (const ip of FAKE_IPS) expect(text).not.toContain(ip);
    expect(text).not.toContain('2001:db8');
    expect(checkRowHtml({ icon: '⏳', title: 'x', text: 'y', grownUps: '' })).toContain('skn-spin');
  });

  it('runs WS4\'s real diagnostics through the lazy import (UDP blocked → "Relay needed")', async () => {
    const net = createFakeRtcNetwork({ udpBlocked: true });
    const desc = await runCheck({
      signalUrl: null,
      importer: async () => {
        const m = await import('../src/net/diagnose.js');
        return {
          describeCheck: m.describeCheck,
          runConnectionCheck: (o) => m.runConnectionCheck({
            ...o, RTCPeerConnectionImpl: net.RTCPeerConnection, WebSocketImpl: class { constructor() { queueMicrotask(() => this.onopen?.({})); } close() {} }, gatherTimeoutMs: 50,
          }),
        };
      },
    });
    expect(desc.rows.find((r) => r.id === 'direct').text).toMatch(/Relay needed/);
    for (const ip of FAKE_IPS) expect(JSON.stringify(desc)).not.toContain(ip);
  });
});

describe('online lobby', () => {
  function roomLobby() {
    let l = createLobby({ label: 'SPRINKLE-4821' });
    l = run(l, [{ type: 'house-join', isHost: true, players: 1 }, { type: 'house-approve', players: 2 }]);
    l = run(l, [{ type: 'pick', houseId: 0, seat: 0, characterId: 'luna' }, { type: 'ready', houseId: 0, seat: 0 }]);
    return l;
  }

  it('host: label, secret sweets, invite link, houses with racers and ping icons', () => {
    const net = { role: 'host', lobby: () => roomLobby(), prompt: () => null, secret: SECRET, houseId: 0, dispatch: vi.fn() };
    const { inst } = mount('online-lobby', fakeCtx({ net }), { inviteLink: 'https://rillyboss.github.io/sprinkle-kart/#join=SPRINKLE-4821~ABCDEF' });
    const text = allText(inst.node);
    expect(text).toContain('SPRINKLE-4821');
    expect(text).toContain(sweetsText(SECRET.sweets));
    expect(text).toContain('#join=SPRINKLE-4821~ABCDEF');
    expect(text).toContain('Luna Lollicorn');
    expect(text).toContain('Picking a racer');
    expect(text).toContain('👑 host');
    expect(text).toContain("Let's pick!");
    expect(text).toContain('Copy invite link');
  });

  it('guest: the room without the secret sweets or invite, and a Leave button', () => {
    const net = { role: 'guest', lobby: () => roomLobby(), houseId: 1, dispatch: vi.fn() };
    const { inst } = mount('online-lobby', fakeCtx({ net }), {});
    const text = allText(inst.node);
    expect(text).toContain('SPRINKLE-4821');
    expect(text).not.toContain(sweetsText(SECRET.sweets));
    for (const s of SECRET_SWEETS.slice(0, 6)) expect(text.includes(`skn-sweets">${s}`)).toBe(false);
    expect(text).not.toContain('Copy invite link');
    expect(text).toContain('Leave the room');
    inst.handle(ev('back')); // B on Leave = leave
    expect(net.dispatch).toHaveBeenCalledWith({ type: 'leave' });
  });

  it('the approval prompt pops up with the match check and Yes approves', () => {
    let prompt = { peerId: 'p1', animals: '🦊🐸', text: TEXT.askFriend('🦊🐸'), needsGate: false, match: [0, 1] };
    const net = { role: 'host', lobby: () => roomLobby(), prompt: () => prompt, secret: SECRET, houseId: 0, dispatch: vi.fn() };
    const { inst } = mount('online-lobby', fakeCtx({ net }), {});
    const text = allText(inst.node);
    expect(text).toContain('🦊🐸');
    expect(text).toContain('Ask your friend: do you see 🦊🐸? Let them in?');
    inst.handle(ev('confirm'));
    expect(net.dispatch).toHaveBeenCalledWith({ type: 'approve', peerId: 'p1', yes: true });
    prompt = null;
    inst.update(0.1);
    expect(allText(inst.node)).not.toContain('Let them in?');
  });

  it('with approvalGate, Yes goes through the parent gate first', () => {
    const prompt = { peerId: 'p1', animals: '🦊🐸', text: TEXT.askFriend('🦊🐸'), needsGate: true, match: [0, 1] };
    let s = createLobbyScreenState({ role: 'host' });
    const live = { lobby: roomLobby(), prompt, selectable: [] };
    s = lobbyScreenReduce(s, ev('confirm'), live).state; // opens the prompt
    expect(s.modal).toBe('prompt');
    let r = lobbyScreenReduce(s, ev('confirm'), live);
    expect(r.state.modal).toBe('gate');
    expect(r.effects).toEqual([]);
    const answer = r.state.gate.a + r.state.gate.b;
    let st = r.state;
    for (let i = 0; i < answer; i++) st = lobbyScreenReduce(st, ev('up'), live).state;
    r = lobbyScreenReduce(st, ev('confirm'), live);
    expect(r.effects).toEqual([{ type: 'approve', peerId: 'p1', yes: true }]);
    // B in the prompt only points at "Not now"; a second press declines
    let q = lobbyScreenReduce(createLobbyScreenState({ role: 'host' }), ev('left'), live).state;
    q = lobbyScreenReduce(q, ev('back'), live).state;
    expect(q.modalIndex).toBe(1);
    expect(lobbyScreenReduce(q, ev('confirm'), live).effects).toEqual([{ type: 'approve', peerId: 'p1', yes: false }]);
  });

  it('host removes a house (→ remove-house) or a single seat; lock toggles; start / copy / leave', () => {
    const lobby = roomLobby();
    const guests = lobby.houses.filter((h) => !h.isHost);
    const live = { lobby, prompt: null, selectable: guests };
    let s = createLobbyScreenState({ role: 'host' });
    s = lobbyScreenReduce(s, ev('up'), live).state;
    expect(s.focus).toBe('houses');
    let r = lobbyScreenReduce(s, ev('confirm'), live);
    expect(r.state.modal).toBe('house');
    expect(r.state.houseOptions.map((o) => o.kind)).toEqual(['remove-house', 'remove-seat', 'remove-seat', 'cancel']);
    r = lobbyScreenReduce(r.state, ev('confirm'), live);
    expect(r.effects).toEqual([{ type: 'remove-house', houseId: 1 }]);
    r = lobbyScreenReduce(lobbyScreenReduce(s, ev('confirm'), live).state, ev('select', { index: 2 }), live);
    expect(r.effects).toEqual([{ type: 'remove-seat', houseId: 1, seat: 1 }]);
    expect(houseModalOptions({ houseId: 3, players: [{ seat: 0 }] }).map((o) => o.kind)).toEqual(['remove-house', 'cancel']);
    const a = createLobbyScreenState({ role: 'host' });
    expect(HOST_ACTIONS).toEqual(['start', 'lock', 'copy', 'leave']);
    expect(lobbyScreenReduce(a, ev('confirm'), live).effects).toEqual([{ type: 'start' }]);
    expect(lobbyScreenReduce({ ...a, action: 1 }, ev('confirm'), live).effects).toEqual([{ type: 'lock' }]);
    expect(lobbyScreenReduce({ ...a, action: 1 }, ev('confirm'), { ...live, lobby: { ...lobby, locked: true } }).effects).toEqual([{ type: 'unlock' }]);
    expect(lobbyScreenReduce({ ...a, action: 2 }, ev('confirm'), live).effects).toEqual([{ type: 'copy' }]);
    const b1 = lobbyScreenReduce(a, ev('back'), live);
    expect(b1.effects).toEqual([]); // first B only moves to Leave
    expect(lobbyScreenReduce(b1.state, ev('back'), live).effects).toEqual([{ type: 'leave' }]);
  });

  it('emotes: Y opens the row, A sends; the screen dispatches for this house\'s first player', () => {
    const net = { role: 'guest', lobby: () => roomLobby(), houseId: 1, dispatch: vi.fn() };
    const { inst } = mount('online-lobby', fakeCtx({ net }), {});
    inst.handle(ev('toggle'));
    inst.handle(ev('right'));
    inst.handle(ev('confirm'));
    expect(net.dispatch).toHaveBeenCalledWith({ type: 'emote', globalPi: 1, emote: 1 });
    expect(allText(inst.node)).toContain('😄');
  });

  it('locked room line, house status words', () => {
    const l = { ...roomLobby(), locked: true };
    const net = { role: 'host', lobby: () => l, prompt: () => null, secret: SECRET, houseId: 0, dispatch: vi.fn() };
    const { inst } = mount('online-lobby', fakeCtx({ net }), {});
    expect(allText(inst.node)).toContain('Room locked 🔒 — tap to open again');
    expect(houseStatus({ isHost: false, net: 'wobbly' })).toBe('📶 a bit wobbly');
    expect(houseStatus({ isHost: false, net: 'asleep' })).toBe('😴 napping');
    expect(houseStatus({ isHost: false, net: 'ok', rttMs: 42 })).toBe('🟢 42 ms');
  });
});

describe('online mode filter + join capacity', () => {
  it('the Online menu shows only ONLINE_MODES (M1: Free Race); offline shows every card', () => {
    expect(modeCardsFor(null)).toBe(MODE_CARDS);
    expect(modeCardsFor({ role: 'host' }).map((m) => m.id)).toEqual(ONLINE_MODES);
    expect(ONLINE_MODES).toEqual(['free']);
    const cards = modeCardsFor({ role: 'host' });
    let s = createModeSelectState({ mode: 'grand-prix', cards });
    expect(s.index).toBe(0);
    s = modeSelectReduce(s, ev('right')).state;
    expect(modeSelectReduce(s, ev('confirm'))).toMatchObject({ go: 'mode', mode: 'free' });
    // offline reducer behaviour is unchanged
    const off = createModeSelectState({ mode: 'battle' });
    expect(off).not.toHaveProperty('cardIds');
    expect(modeSelectReduce(off, ev('confirm')).mode).toBe('battle');
  });

  it('joinReduce stops at the seats left in the room (capacity); offline cap is still 4', () => {
    let st = createJoinState();
    for (const d of ['a', 'b', 'c']) st = joinReduce(st, { deviceId: d, action: 'confirm' }, { capacity: 2 }).state;
    expect(st.players.map((p) => p.deviceId)).toEqual(['a', 'b']);
    let off = createJoinState();
    for (const d of ['a', 'b', 'c', 'd', 'e']) off = joinReduce(off, { deviceId: d, action: 'confirm' }).state;
    expect(off.players).toHaveLength(4);
    expect(joinReduce(createJoinState(), { deviceId: 'a', action: 'confirm' }, { capacity: 0 }).state.players).toHaveLength(0);
    expect(joinReduce(createJoinState(), { deviceId: 'a', action: 'confirm' }, { capacity: 99 }).state.players).toHaveLength(1);
  });
});
