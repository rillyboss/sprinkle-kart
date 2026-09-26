// LobbyState reducer + LOBBY coalescing + approval queue (NETWORKING.md §1 rules 3/5, §10.3, §10.9).
import { describe, it, expect } from 'vitest';
import {
  createLobby, lobbyReduce, allPlayers, seatsLeft, humanCount, housePis, lobbyAllReady, lobbyForWire, createLobbyCoalescer,
  HOUSE_EMOJI, LOBBY_SEND_INTERVAL_MS, houseOfPi,
} from '../src/net/session/lobby.js';
import {
  approvalReduce, createApprovalQueue, drawMatch, isMatch, matchEmoji, MATCH_ANIMALS, APPROVAL_TIMEOUT_MS, currentPrompt, MAX_PENDING,
} from '../src/net/session/approval.js';
import { SECRET_SWEETS } from '../src/net/session/roomCode.js';
import { MAX_HUMANS, MAX_LOCAL_PLAYERS, PLAYER_COLORS } from '../src/config.js';
import { ONLINE_MODES } from '../src/net/session/modes.js';

const run = (lobby, actions) => actions.reduce((l, a) => lobbyReduce(l, a).lobby, lobby);
const withHost = (n = 1) => run(createLobby({ label: 'SPRINKLE-4821' }), [{ type: 'house-join', isHost: true, players: n }]);

describe('config for online rooms', () => {
  it('4 local players per machine, 8 humans per room, 8 player colours', () => {
    expect(MAX_LOCAL_PLAYERS).toBe(4);
    expect(MAX_HUMANS).toBe(8);
    expect(PLAYER_COLORS).toHaveLength(8);
    expect(new Set(PLAYER_COLORS).size).toBe(8);
  });
});

describe('lobbyReduce', () => {
  it('starts with the §10.3 shape and never carries the secret sweets', () => {
    const l = withHost(2);
    expect(l).toMatchObject({ v: 1, label: 'SPRINKLE-4821', phase: 'lobby', locked: false, capacity: 8 });
    expect(l.hostChoice).toMatchObject({ mode: 'free', speedClass: 'zippy', laps: 3 });
    expect(l.houses).toEqual([{
      houseId: 0, emoji: '🏰', isHost: true, net: 'ok', rttMs: 0,
      players: [
        { globalPi: 0, seat: 0, characterId: null, paintId: 'original', easyDrive: false, ready: false },
        { globalPi: 1, seat: 1, characterId: null, paintId: 'original', easyDrive: false, ready: false },
      ],
    }]);
    const text = JSON.stringify(lobbyForWire(l));
    for (const s of SECRET_SWEETS.slice(0, 8)) expect(text).not.toContain(s);
    expect(text).not.toMatch(/sweets|peer|token|secret/);
  });

  it('4 houses × 2 players fill all 8 seats, then the room is full', () => {
    let l = withHost(2);
    for (let i = 0; i < 3; i++) l = run(l, [{ type: 'house-approve', players: 2 }]);
    expect(humanCount(l)).toBe(8);
    expect(seatsLeft(l)).toBe(0);
    expect(l.houses.map((h) => h.houseId)).toEqual([0, 1, 2, 3]);
    expect(l.houses.map((h) => h.emoji)).toEqual(HOUSE_EMOJI.slice(0, 4));
    expect(allPlayers(l).map((p) => p.globalPi)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(housePis(l, 2)).toEqual([4, 5]);
    const r = lobbyReduce(l, { type: 'house-approve', players: 1 });
    expect(r.lobby).toBe(l);
    expect(r.effects).toEqual([{ type: 'refused', reason: 'full' }]);
    expect(lobbyReduce(l, { type: 'seat-join', houseId: 1 }).effects).toEqual([{ type: 'refused', reason: 'full' }]);
  });

  it('refuses a house that needs more seats than are left (8-human cap)', () => {
    let l = withHost(4);
    l = run(l, [{ type: 'house-approve', players: 3 }]);
    expect(seatsLeft(l)).toBe(1);
    expect(lobbyReduce(l, { type: 'house-approve', players: 2 }).effects[0]).toEqual({ type: 'refused', reason: 'full' });
    l = run(l, [{ type: 'house-approve', players: 1 }]);
    expect(humanCount(l)).toBe(8);
  });

  it('keeps global indices for the session and reuses the lowest free one', () => {
    let l = withHost(1);
    l = run(l, [{ type: 'house-approve', players: 2 }, { type: 'house-approve', players: 1 }]); // pis 1,2 and 3
    l = run(l, [{ type: 'house-leave', houseId: 1 }]);
    expect(allPlayers(l).map((p) => p.globalPi)).toEqual([0, 3]);
    l = run(l, [{ type: 'house-approve', players: 1 }]);
    expect(houseOfPi(l, 1).houseId).toBe(1);
    expect(houseOfPi(l, 3).houseId).toBe(2); // the old house kept its index
  });

  it('seat join / leave, pick, ready and everyone-ready', () => {
    let l = withHost(1);
    l = run(l, [{ type: 'house-approve', players: 1 }]);
    l = run(l, [{ type: 'seat-join', houseId: 1, easyDrive: true }]);
    expect(housePis(l, 1)).toEqual([1, 2]);
    expect(l.houses[1].players[1]).toMatchObject({ seat: 1, easyDrive: true });
    expect(lobbyReduce(l, { type: 'ready', houseId: 1, seat: 0 }).effects[0].reason).toBe('no-racer'); // pick first
    l = run(l, [
      { type: 'pick', houseId: 0, seat: 0, characterId: 'luna', paintId: 'mint' },
      { type: 'pick', houseId: 1, seat: 0, characterId: 'rocco' },
      { type: 'pick', houseId: 1, seat: 1, characterId: 'rocco' }, // same racer is fine
      { type: 'ready', houseId: 0, seat: 0 },
      { type: 'ready', houseId: 1, seat: 0 },
    ]);
    expect(l.houses[0].players[0]).toMatchObject({ characterId: 'luna', paintId: 'mint', ready: true });
    expect(lobbyAllReady(l)).toBe(false);
    l = run(l, [{ type: 'ready', houseId: 1, seat: 1 }]);
    expect(lobbyAllReady(l)).toBe(true);
    l = run(l, [{ type: 'ready', houseId: 1, seat: 1, ready: false }]);
    expect(lobbyAllReady(l)).toBe(false);
    l = run(l, [{ type: 'seat-leave', houseId: 1, seat: 1 }]);
    expect(housePis(l, 1)).toEqual([1]);
    expect(lobbyReduce(l, { type: 'seat-leave', houseId: 1, seat: 3 }).effects[0].reason).toBe('no-seat');
    expect(lobbyReduce(l, { type: 'pick', houseId: 1, seat: 0, characterId: 42 }).effects[0].reason).toBe('bad-pick');
  });

  it('a house has at most 4 seats', () => {
    let l = withHost(1);
    l = run(l, [{ type: 'house-approve', players: 4 }]);
    expect(lobbyReduce(l, { type: 'seat-join', houseId: 1 }).effects[0].reason).toBe('full');
    expect(lobbyReduce(withHost(1), { type: 'house-approve', players: 9 }).lobby.houses[1].players).toHaveLength(4); // clamped to 4
    expect(lobbyReduce(l, { type: 'house-approve', players: 4 }).effects[0].reason).toBe('full'); // only 3 seats left
  });

  it('remove house → locked + setLocked(true) + drop(peer); remove never removes the host', () => {
    let l = withHost(1);
    l = run(l, [{ type: 'house-approve', players: 2 }]);
    const r = lobbyReduce(l, { type: 'house-remove', houseId: 1, peerId: 'peer-b' });
    expect(r.lobby.locked).toBe(true);
    expect(r.lobby.houses.map((h) => h.houseId)).toEqual([0]);
    expect(r.effects).toEqual([{ type: 'setLocked', locked: true }, { type: 'drop', peerId: 'peer-b', houseId: 1 }]);
    expect(lobbyReduce(l, { type: 'house-remove', houseId: 0 }).effects[0].reason).toBe('no-house');
    expect(lobbyReduce(l, { type: 'house-leave', houseId: 0 }).effects[0].reason).toBe('no-house');
  });

  it('lock / unlock emit setLocked once', () => {
    let l = withHost(1);
    let r = lobbyReduce(l, { type: 'lock' });
    expect(r.effects).toEqual([{ type: 'setLocked', locked: true }]);
    expect(lobbyReduce(r.lobby, { type: 'lock' }).effects).toEqual([]);
    r = lobbyReduce(r.lobby, { type: 'unlock' });
    expect(r.lobby.locked).toBe(false);
    expect(r.effects).toEqual([{ type: 'setLocked', locked: false }]);
    expect(lobbyReduce(r.lobby, { type: 'unlock' }).effects).toEqual([]);
  });

  it('host choice keeps only valid values (online modes only)', () => {
    let l = withHost(1);
    l = run(l, [{ type: 'choice', patch: { mode: 'time-trial', trackId: 'gumdrop-meadow', speedClass: 'warp', laps: 99 } }]);
    expect(l.hostChoice).toMatchObject({ mode: 'free', trackId: 'gumdrop-meadow', speedClass: 'zippy', laps: 3 });
    l = run(l, [{ type: 'choice', patch: { speedClass: 'zoomy', laps: 5, mode: ONLINE_MODES[0] } }]);
    expect(l.hostChoice).toMatchObject({ speedClass: 'zoomy', laps: 5 });
  });

  it('phases: valid names only; lobby / characters clear ready flags', () => {
    let l = withHost(1);
    l = run(l, [{ type: 'pick', houseId: 0, seat: 0, characterId: 'luna' }, { type: 'ready', houseId: 0, seat: 0 }]);
    expect(lobbyReduce(l, { type: 'phase', phase: 'warp' }).effects[0].reason).toBe('bad-phase');
    const race = run(l, [{ type: 'phase', phase: 'race' }]);
    expect(race.houses[0].players[0].ready).toBe(true);
    const back = run(race, [{ type: 'phase', phase: 'lobby' }]);
    expect(back.phase).toBe('lobby');
    expect(back.houses[0].players[0].ready).toBe(false);
  });

  it('net state (ping icons)', () => {
    let l = withHost(1);
    l = run(l, [{ type: 'house-approve', players: 1 }, { type: 'net', houseId: 1, net: 'wobbly', rttMs: 123.4 }]);
    expect(l.houses[1]).toMatchObject({ net: 'wobbly', rttMs: 123 });
    expect(lobbyReduce(l, { type: 'net', houseId: 1, net: 'nope' }).effects[0].reason).toBe('no-house');
    expect(lobbyReduce(l, { type: 'what' }).effects[0].reason).toBe('unknown');
  });
});

describe('LOBBY coalescing (≤ 4/s per guest, never mid-race)', () => {
  it('merges changes within 250 ms into one send', () => {
    const c = createLobbyCoalescer();
    let sends = 0;
    for (let t = 0; t < 1000; t += 10) { if (c.change(t)) sends++; if (c.tick(t)) sends++; }
    if (c.tick(1000)) sends++;
    expect(LOBBY_SEND_INTERVAL_MS).toBe(250);
    expect(sends).toBeLessThanOrEqual(5); // t = 0, 250, 500, 750 (+ the trailing flush at 1000)
    expect(sends).toBeGreaterThanOrEqual(4);
    expect(c.pending).toBe(false);
  });

  it('holds everything during a race and flushes once afterwards', () => {
    const c = createLobbyCoalescer();
    c.setRacing(true);
    for (let t = 0; t < 5000; t += 50) expect(c.change(t) || c.tick(t)).toBe(false);
    expect(c.pending).toBe(true);
    c.setRacing(false);
    expect(c.tick(5000)).toBe(true);
    expect(c.tick(5300)).toBe(false);
  });
});

describe('approval queue with match check', () => {
  const req = (peerId, now = 0, match = [0, 1]) => ({ type: 'request', peerId, match, localPlayers: 1, now });

  it('32 distinct animals; pairs are 2 different animals drawn with crypto', () => {
    expect(MATCH_ANIMALS).toHaveLength(32);
    expect(new Set(MATCH_ANIMALS).size).toBe(32);
    for (let i = 0; i < 500; i++) {
      const m = drawMatch();
      expect(isMatch(m)).toBe(true);
    }
    expect(drawMatch(() => 5)).toEqual([5, 6]); // b skips a
    expect(drawMatch(() => 0)).toEqual([0, 1]);
    expect(matchEmoji([0, 1])).toBe('🦊🐸');
    expect(isMatch([3, 3])).toBe(false);
    expect(isMatch([0, 32])).toBe(false);
    expect(isMatch('nope')).toBe(false);
  });

  it('the prompt shows the same two animals the guest shows, in the documented sentence', () => {
    const r = approvalReduce(createApprovalQueue(), req('a'));
    expect(r.prompt).toMatchObject({ peerId: 'a', animals: '🦊🐸', needsGate: false, text: 'Ask your friend: do you see 🦊🐸? Let them in?' });
    const y = approvalReduce(r.queue, { type: 'answer', peerId: 'a', yes: true });
    expect(y.decided).toEqual([{ peerId: 'a', result: 'approved', localPlayers: 1 }]);
    expect(y.prompt).toBe(null);
  });

  it('queues while racing (no prompt) and shows them in order afterwards; answers for hidden prompts are ignored', () => {
    let q = approvalReduce(createApprovalQueue(), { type: 'racing', on: true, now: 0 }).queue;
    let r = approvalReduce(q, req('a', 10));
    r = approvalReduce(r.queue, req('b', 20, [2, 3]));
    expect(r.prompt).toBe(null);
    expect(approvalReduce(r.queue, { type: 'answer', peerId: 'a', yes: true }).decided).toEqual([]);
    r = approvalReduce(r.queue, { type: 'racing', on: false, now: 1000 });
    expect(r.prompt.peerId).toBe('a');
    expect(r.prompt.waiting).toBe(1);
    expect(approvalReduce(r.queue, { type: 'answer', peerId: 'b', yes: true }).decided).toEqual([]); // not on screen yet
    r = approvalReduce(r.queue, { type: 'answer', peerId: 'a', yes: false });
    expect(r.decided[0]).toMatchObject({ peerId: 'a', result: 'declined' });
    expect(r.prompt.animals).toBe(`${MATCH_ANIMALS[2]}${MATCH_ANIMALS[3]}`);
  });

  it('times out after 120 s of visibility (the clock pauses during races)', () => {
    let r = approvalReduce(createApprovalQueue(), req('a', 0));
    r = approvalReduce(r.queue, { type: 'tick', now: APPROVAL_TIMEOUT_MS - 1 });
    expect(r.decided).toEqual([]);
    r = approvalReduce(r.queue, { type: 'racing', on: true, now: 60_000 });
    r = approvalReduce(r.queue, { type: 'tick', now: 500_000 });
    expect(r.decided).toEqual([]); // nobody can answer mid-race
    r = approvalReduce(r.queue, { type: 'racing', on: false, now: 500_000 });
    r = approvalReduce(r.queue, { type: 'tick', now: 500_000 + APPROVAL_TIMEOUT_MS });
    expect(r.decided).toEqual([{ peerId: 'a', result: 'timeout', localPlayers: 1 }]);
    expect(r.prompt).toBe(null);
  });

  it('approvalGate puts Yes behind the parent gate (prompt.needsGate); cancel and duplicates; bad requests declined', () => {
    let q = createApprovalQueue({ approvalGate: true });
    expect(approvalReduce(q, req('a')).prompt.needsGate).toBe(true);
    q = approvalReduce(q, { type: 'gate', on: false }).queue;
    let r = approvalReduce(q, req('a'));
    expect(r.prompt.needsGate).toBe(false);
    expect(approvalReduce(r.queue, req('a')).queue.items).toHaveLength(1);
    r = approvalReduce(r.queue, { type: 'cancel', peerId: 'a' });
    expect(r.decided[0].result).toBe('cancelled');
    expect(approvalReduce(r.queue, { type: 'request', peerId: 'z', match: [1, 1], localPlayers: 1 }).decided[0].result).toBe('declined');
    let full = createApprovalQueue();
    for (let i = 0; i < MAX_PENDING; i++) full = approvalReduce(full, req(`p${i}`)).queue;
    expect(approvalReduce(full, req('late')).decided[0]).toMatchObject({ peerId: 'late', result: 'declined' });
    expect(currentPrompt(createApprovalQueue())).toBe(null);
  });
});
