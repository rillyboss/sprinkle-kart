/**
 * Host approval with a match check (NETWORKING.md §1 rule 3, §7.1, §10.4).
 *
 * The host approves every new house — always (not a setting). The joining
 * machine draws 2 random animals (MATCH_ANIMALS, different from the secret
 * sweets so nobody mixes them up) with crypto.getRandomValues, shows them on its
 * "Waiting for the host…" screen and sends them in HELLO.match; the host's
 * prompt says "Ask your friend: do you see 🦊🐸? Let them in?". Prompts never
 * pop up mid-race: they queue while the host's players race and appear at
 * results or in the lobby. With the Grown-ups setting "Only a grown-up can let
 * houses in" the Yes button goes through the parent gate first (prompt.needsGate).
 * An unanswered request is declined after APPROVAL_TIMEOUT_MS.
 *
 * approvalReduce(queue, ev) → { queue, prompt, decided }
 *   ev: { type: 'request', peerId, match, localPlayers, now }
 *       { type: 'answer', peerId, yes }            (host pressed Yes / Not now)
 *       { type: 'cancel', peerId }                 (that guest left)
 *       { type: 'racing', on, now }                (host's players race → queue silently; the
 *                                                  timeout clock pauses and restarts at `now`)
 *       { type: 'gate', on }                       (approvalGate setting)
 *       { type: 'tick', now }                      (timeouts)
 *   decided: [{ peerId, result: 'approved'|'declined'|'timeout'|'cancelled', localPlayers }]
 *
 * OWNER: WS6 (session, lobby & screens).
 */
import { cryptoRandomInt } from './roomCode.js';
import { TEXT } from './texts.js';

/** 32 animals for the match check (never reorder: indices travel in HELLO). */
export const MATCH_ANIMALS = Object.freeze([
  '🦊', '🐸', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷',
  '🐵', '🐧', '🐤', '🦉', '🐙', '🐳', '🐬', '🦋',
  '🐝', '🐞', '🐢', '🦕', '🦒', '🦓', '🐘', '🦔',
  '🐰', '🐹', '🐱', '🐶', '🦜', '🦩', '🐭', '🐌',
]);

export const APPROVAL_TIMEOUT_MS = 120_000;
/** Max houses waiting at once (8 houses max per room; extra knocks are declined). */
export const MAX_PENDING = 7;

/**
 * Draw a fresh match pair: 2 different indices into MATCH_ANIMALS.
 * @param {(n: number) => number} [randomInt] default crypto.getRandomValues (never Math.random)
 * @returns {[number, number]}
 */
export function drawMatch(randomInt = cryptoRandomInt) {
  const n = MATCH_ANIMALS.length;
  const a = randomInt(n);
  let b = randomInt(n - 1);
  if (b >= a) b += 1;
  return [a, b];
}

/** A valid HELLO.match: 2 different integers 0..31. */
export function isMatch(m) {
  return Array.isArray(m) && m.length === 2
    && m.every((i) => Number.isInteger(i) && i >= 0 && i < MATCH_ANIMALS.length)
    && m[0] !== m[1];
}

/** [0, 1] → '🦊🐸'. */
export function matchEmoji(match) {
  return isMatch(match) ? `${MATCH_ANIMALS[match[0]]}${MATCH_ANIMALS[match[1]]}` : '';
}

export function createApprovalQueue({ approvalGate = false } = {}) {
  return { items: [], racing: false, approvalGate: !!approvalGate };
}

/** The prompt the host sees for the first queued request (null while racing or empty). */
export function currentPrompt(queue) {
  if (queue.racing || !queue.items.length) return null;
  const it = queue.items[0];
  const animals = matchEmoji(it.match);
  return {
    peerId: it.peerId,
    match: [...it.match],
    animals,
    localPlayers: it.localPlayers,
    text: TEXT.askFriend(animals),
    needsGate: queue.approvalGate,
    waiting: queue.items.length - 1,
  };
}

/** Number of requests waiting (for the "🏡 wants to join" badge on results). */
export const pendingCount = (queue) => queue.items.length;

const result = (queue, decided = []) => ({ queue, prompt: currentPrompt(queue), decided });

export function approvalReduce(queue, ev) {
  switch (ev?.type) {
    case 'request': {
      if (!isMatch(ev.match) || typeof ev.peerId !== 'string') return result(queue, [{ peerId: ev?.peerId, result: 'declined', localPlayers: 0 }]);
      if (queue.items.some((i) => i.peerId === ev.peerId)) return result(queue);
      if (queue.items.length >= MAX_PENDING) return result(queue, [{ peerId: ev.peerId, result: 'declined', localPlayers: ev.localPlayers }]);
      const item = { peerId: ev.peerId, match: [...ev.match], localPlayers: ev.localPlayers | 0, since: Number(ev.now) || 0 };
      return result({ ...queue, items: [...queue.items, item] });
    }
    case 'answer': {
      const it = queue.items.find((i) => i.peerId === ev.peerId);
      if (!it) return result(queue);
      // Answers only count for the prompt on screen (never for one hidden by a race).
      if (queue.racing || queue.items[0].peerId !== ev.peerId) return result(queue);
      const items = queue.items.filter((i) => i !== it);
      return result({ ...queue, items }, [{ peerId: it.peerId, result: ev.yes ? 'approved' : 'declined', localPlayers: it.localPlayers }]);
    }
    case 'cancel': {
      const it = queue.items.find((i) => i.peerId === ev.peerId);
      if (!it) return result(queue);
      return result({ ...queue, items: queue.items.filter((i) => i !== it) }, [{ peerId: it.peerId, result: 'cancelled', localPlayers: it.localPlayers }]);
    }
    case 'racing': {
      const on = !!ev.on;
      if (on === queue.racing) return result(queue);
      // The 120 s clock only runs while the prompt can be seen: after a race every
      // waiting house gets a fresh window at results / in the lobby.
      const now = Number(ev.now);
      const items = !on && Number.isFinite(now) ? queue.items.map((i) => ({ ...i, since: Math.max(i.since, now) })) : queue.items;
      return result({ ...queue, racing: on, items });
    }
    case 'gate':
      return result({ ...queue, approvalGate: !!ev.on });
    case 'tick': {
      if (queue.racing) return result(queue); // nobody can answer mid-race: never time out then
      const now = Number(ev.now) || 0;
      const late = queue.items.filter((i) => now - i.since >= APPROVAL_TIMEOUT_MS);
      if (!late.length) return result(queue);
      return result(
        { ...queue, items: queue.items.filter((i) => !late.includes(i)) },
        late.map((i) => ({ peerId: i.peerId, result: 'timeout', localPlayers: i.localPlayers })),
      );
    }
    default:
      return result(queue);
  }
}
