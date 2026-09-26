/**
 * Every friendly sentence the online session and its screens show
 * (NETWORKING.md §1 rule 7, §13). One catalogue so the tone test
 * (tests/net.tone.test.js) can check them all, and the wording stays the same
 * wherever it appears. Plain text (escape before putting it in HTML).
 *
 * OWNER: WS6 (session, lobby & screens).
 */

export const TEXT = Object.freeze({
  // §7.2 — the same wording docs/INFRA_SETUP.md troubleshooting uses
  version: 'Different game version — everyone refresh the page 🔄',
  // §13.5
  full: 'This room is full of racers 🚗',
  closed: "The host's room is closed for now 🔒",
  doorTimeout: "The host didn't open the door this time 🚪",
  notFound: "We couldn't find that room. Check the code and the secret sweets? 🔍 If it still won't work, ask everyone to refresh 🔄",
  unreachable: "Couldn't reach the matchmaker 🙈",
  noConnect: "We couldn't connect your houses 🙈",
  noConnectTips: [
    'Try again in a moment 🔁',
    'A grown-up can turn on the Sprinkle Kart relay (see the grown-up setup guide) 🛟',
    'Try another network — school computers and phone hotspots often need the relay 📶',
  ],
  // §10.9 / §13.3
  removed: 'The host said bye-bye for now 👋',
  hostGone: "The host's house went to sleep 😴 Thanks for racing!",
  hostWaiting: 'Waiting for the host… ⏳',
  snackBreak: "Snack break at the host's house 🍪",
  keepTabOpen: "Keep this tab open, you're the host! 🏁",
  // §1 rule 3 / §7.1
  askFriend: (animals) => `Ask your friend: do you see ${animals}? Let them in?`,
  showHost: (animals) => `Waiting for the host… show them ${animals}`,
  knocking: 'Knocking on the door… 🚪',
  wantsToJoin: '🏡 wants to join',
  // §10.9
  roomLocked: 'Room locked 🔒 — tap to open again',
  roomOpen: 'Room open 🔓 — friends with the invite can ask to join',
  // §10.4
  hostPicking: {
    mode: 'Host is picking a mode… 🎨',
    course: 'Host is picking a track… 🎨',
    default: 'Host is picking… 🎨',
  },
  waitingForHost: 'Waiting for host…',
  // §10.1
  inviteGate: 'Ask a grown-up to turn on online play in Settings → Grown-ups 🔒',
  joinInvite: (label) => `Join 🏡 ${label}?`,
  copied: 'Invite link copied! 📋 Send it to your friends.',
  copyFallback: 'Copy this link and send it to your friends 📋',
  // §13.5 (see also src/net/platform.js)
  hostNeedsComputer: 'Hosting needs a computer 💻 — you can still join!',
  comingSoon: 'Online play is almost ready — check back soon! ✨',
  // §13.2 (M2)
  reconnecting: 'Reconnecting… 🔌',
  tapToReconnect: 'Tap to reconnect 👆',
  // §13.2: this machine's own connection is down (not the host's fault)
  netNap: 'Your internet took a nap 📶 Reconnecting… 🔌',
  netNapEnd: 'Your internet took a nap 📶 Check the Wi-Fi, then join again!',
  // §1 rule 6 (acceptance M1-12): shown BEFORE online can be switched on
  privacy:
    'Online play sends no names, no chat, no accounts and no analytics. Like any video call, it shows your internet address '
    + "to your friends' computers, to free public matchmaking services run by other people (and public STUN servers from Google "
    + 'and Cloudflare) — or to our own Cloudflare server instead, once a grown-up sets it up.',
  privacyOk: 'Okay, turn it on',
  privacyNo: 'Not now',
  relayHint: "Hides your address from your friends' computers (the matchmaker still sees it)",
});

/**
 * The 8 preset emotes (§10.7, ids 0..7). The binding table is WS2's src/net/emotes.js;
 * this mirror (same order) is what the lobby shows until that module lands on main.
 */
export const LOBBY_EMOTES = Object.freeze([
  Object.freeze({ id: 0, emoji: '👋', text: 'Hi!' }),
  Object.freeze({ id: 1, emoji: '😄', text: 'Hee hee' }),
  Object.freeze({ id: 2, emoji: '🎉', text: 'Yay!' }),
  Object.freeze({ id: 3, emoji: '👍', text: 'Nice!' }),
  Object.freeze({ id: 4, emoji: '😮', text: 'Whoa!' }),
  Object.freeze({ id: 5, emoji: '💖', text: 'Love it' }),
  Object.freeze({ id: 6, emoji: '🍭', text: 'Sweet!' }),
  Object.freeze({ id: 7, emoji: '🐢', text: 'Wait for me!' }),
]);

/** Friendly sentence for a REJECT reason (§6.2) + optional detail. */
export function rejectText(reason, detail = null) {
  switch (reason) {
    case 'version': return TEXT.version;
    case 'full':
    case 'in-race-full': return TEXT.full;
    case 'declined': return detail === 'timeout' ? TEXT.doorTimeout : TEXT.closed;
    case 'locked': return TEXT.closed;
    case 'removed': return TEXT.removed;
    case 'host-leaving': return TEXT.hostGone;
    default: return TEXT.closed;
  }
}

/** Friendly sentence for a SignalingError code (src/net/signaling/types.js). */
export function signalingErrorText(code) {
  switch (code) {
    case 'unreachable': return TEXT.unreachable;
    case 'full': return TEXT.full;
    case 'locked': return TEXT.closed;
    case 'no-host':
    case 'timeout':
    case 'host-exists':
    default: return TEXT.notFound;
  }
}

/** Every plain string in the catalogue (functions called with sample emoji) — for tone tests. */
export function allTexts() {
  const list = [];
  const visit = (v) => {
    if (typeof v === 'string') list.push(v);
    else if (typeof v === 'function') list.push(String(v('🦊🐸')));
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(TEXT);
  for (const e of LOBBY_EMOTES) list.push(`${e.emoji} ${e.text}`);
  return list;
}
