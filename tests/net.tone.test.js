// Friendly words only (NETWORKING.md §1 rule 7): every sentence the online session and screens show.
// Same banned list as the existing screen / character / track tone checks, plus the scary network words.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installDoc, allText, fakeCtx, fakeNav, ev } from './net.screens.helpers.js';
import { TEXT, allTexts, rejectText, signalingErrorText, LOBBY_EMOTES } from '../src/net/session/texts.js';
import { REJECT_REASONS } from '../src/net/session/wire.js';
import { SIGNALING_ERROR_CODES } from '../src/net/signaling/types.js';
import { SCREENS } from '../src/ui/screens/index.js';
import { ROWS } from '../src/ui/screens/settings.js';
import { waitingView } from '../src/ui/screens/netWaiting.js';
import { houseStatus } from '../src/ui/screens/onlineLobby.js';
import { HOST_NEEDS_COMPUTER_TEXT } from '../src/net/platform.js';
import { createLobby, lobbyReduce } from '../src/net/session/lobby.js';
import { ROOM_WORDS } from '../src/net/session/roomCode.js';
import { netDebugText } from '../src/net/debugOverlay.js';

const BANNED = /\b(hit|hits|kill|killed|crash|crashed|destroy|destroyed|die|dies|dead|blood|weapon|shoot|attack|hate|stupid|loser|lose|fail|failed|failure|error|errors|broken|blocked|scary|hurt|banned|kick|kicked|reject|rejected|denied|forbidden|invalid|illegal|abort)\b/i;
const borrowed = /\b(mario|luigi|bowser|yoshi|nintendo|wario)\b/i;

const check = (text, where) => {
  expect(text, where).not.toMatch(BANNED);
  expect(text, where).not.toMatch(borrowed);
};

describe('text catalogue', () => {
  it('every catalogue sentence, reject reason and signaling message is friendly', () => {
    const all = allTexts();
    expect(all.length).toBeGreaterThan(30);
    for (const t of all) check(t, t);
    for (const r of REJECT_REASONS) check(rejectText(r), r);
    check(rejectText('declined', 'timeout'), 'timeout');
    for (const c of SIGNALING_ERROR_CODES) check(signalingErrorText(c), c);
    for (const k of Object.keys(ROWS)) check(ROWS[k].join(' '), k);
    for (const e of LOBBY_EMOTES) check(e.text, e.emoji);
    for (const w of ROOM_WORDS) check(w, w);
    check(HOST_NEEDS_COMPUTER_TEXT, 'platform');
    for (const m of ['connecting', 'approval', 'picking', 'waiting', 'reconnecting']) check(JSON.stringify(waitingView({ mode: m, animals: '🦊🐸' })), m);
    for (const n of ['ok', 'wobbly', 'asleep']) check(houseStatus({ net: n, rttMs: 20 }), n);
    check(netDebugText({ role: 'guest', peers: [{}] }), 'debug overlay');
  });

  it('keeps the exact documented wording', () => {
    expect(TEXT.version).toBe('Different game version — everyone refresh the page 🔄');
    expect(TEXT.doorTimeout).toBe("The host didn't open the door this time 🚪");
    expect(TEXT.inviteGate).toBe('Ask a grown-up to turn on online play in Settings → Grown-ups 🔒');
    expect(TEXT.askFriend('🦊🐸')).toBe('Ask your friend: do you see 🦊🐸? Let them in?');
    expect(TEXT.removed).toBe('The host said bye-bye for now 👋');
    expect(TEXT.hostGone).toBe("The host's house went to sleep 😴 Thanks for racing!");
    expect(TEXT.roomLocked).toBe('Room locked 🔒 — tap to open again');
    expect(TEXT.full).toBe('This room is full of racers 🚗');
    expect(TEXT.noConnect).toBe("We couldn't connect your houses 🙈");
  });
});

describe('rendered online screens', () => {
  let doc;
  beforeEach(() => { doc = installDoc(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  function lobby(locked = false) {
    let l = createLobby({ label: 'SPRINKLE-4821' });
    for (const a of [{ type: 'house-join', isHost: true, players: 2 }, { type: 'house-approve', players: 1 }, { type: 'net', houseId: 1, net: 'wobbly', rttMs: 90 }]) l = lobbyReduce(l, a).lobby;
    return locked ? { ...l, locked: true } : l;
  }

  it('every new screen, in each of its states, uses friendly words only', () => {
    void doc;
    const secret = { label: 'SPRINKLE-4821', sweets: [0, 1, 2, 3, 4, 5] };
    const prompt = { peerId: 'p', animals: '🦊🐸', text: TEXT.askFriend('🦊🐸'), needsGate: false, match: [0, 1] };
    const cases = [
      ['online-hub', fakeCtx({ settings: { onlineEnabled: true } }), {}],
      ['online-hub', fakeCtx({ settings: { onlineEnabled: true } }), { invite: secret, message: TEXT.notFound }],
      ['online-hub', fakeCtx({ settings: { onlineEnabled: false } }), {}],
      ['invite-gate', fakeCtx(), {}],
      ['code-entry', fakeCtx(), {}],
      ['code-entry', fakeCtx(), { prefill: secret }],
      ['net-waiting', fakeCtx(), { mode: 'approval', animals: '🦊🐸' }],
      ['net-waiting', fakeCtx(), { forId: 'mode-select' }],
      ['net-waiting', fakeCtx(), { mode: 'connecting', label: 'SPRINKLE-4821' }],
      ['check-connection', fakeCtx(), { result: { rows: [], hint: '' } }],
      ['online-lobby', fakeCtx({ net: { role: 'host', lobby: () => lobby(), prompt: () => prompt, secret, houseId: 0, dispatch() {} } }), {}],
      ['online-lobby', fakeCtx({ net: { role: 'host', lobby: () => lobby(true), prompt: () => null, secret, houseId: 0, dispatch() {} } }), {}],
      ['online-lobby', fakeCtx({ net: { role: 'guest', lobby: () => lobby(true), houseId: 1, dispatch() {} } }), {}],
      ['settings', fakeCtx(), { relayAvailable: true }],
    ];
    for (const [id, ctx, params] of cases) {
      const inst = SCREENS.get(id).mount(ctx, fakeNav(), params);
      check(allText(inst.node), `${id} ${JSON.stringify(params).slice(0, 60)}`);
      // poke a few buttons so modals / messages render too
      for (const a of ['right', 'confirm', 'down', 'confirm']) { try { inst.handle(ev(a)); } catch { /* DOM-less modal internals */ } }
      check(allText(inst.node), `${id} after input`);
      inst.destroy?.();
    }
  });
});
