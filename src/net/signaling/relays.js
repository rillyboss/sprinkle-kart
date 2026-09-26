/**
 * Public matchmaking services and STUN servers (NETWORKING.md §3). This file is config, not
 * code: when a tracker or relay dies, edit the list here (and the privacy sentence in
 * NETWORKING.md §1 rule 6 if a new operator is added). `tests/net.signaling.relays.test.js`
 * pins the exact values so a change is always deliberate.
 *
 * Every service below is run by someone else and can see a player's internet address while
 * matchmaking, which is why the Grown-ups screen names them before online can be switched on.
 */

/** WebTorrent trackers used first by public signaling (probed live 2026-09-26). */
export const PUBLIC_TRACKERS = Object.freeze([
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://open.ftorrent.com',
]);

/** Nostr relays joined in addition when no host shows up on the trackers within 6 s. */
export const PUBLIC_NOSTR_RELAYS = Object.freeze([
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://purplerelay.com',
  'wss://yabu.me/v2',
  'wss://nostr.data.haus',
]);

/** How many Nostr relays Trystero talks to at once (we pass all of them explicitly). */
export const NOSTR_REDUNDANCY = 6;

/** Public STUN servers: the only ICE servers a build without our Worker ever uses. */
export const PUBLIC_STUN_URLS = Object.freeze([
  'stun:stun.cloudflare.com:3478',
  'stun:stun.l.google.com:19302',
]);

/** @returns {RTCIceServer[]} a fresh copy (callers may append TURN entries). */
export function publicIceServers() {
  return PUBLIC_STUN_URLS.map((urls) => ({ urls }));
}

/** Trystero `appId`: namespaces our rooms on shared public infrastructure. */
export const TRYSTERO_APP_ID = 'sprinkle-kart';

/** Pinned package versions (lazy chunks only; see package.json). */
export const TRYSTERO_TORRENT_MODULE = '@trystero-p2p/torrent';
export const TRYSTERO_NOSTR_MODULE = '@trystero-p2p/nostr';
export const TRYSTERO_VERSION = '0.25.4';

/**
 * Parse a dev override list (`?relays=ws://localhost:8000,ws://…`). Only ws:// and wss:// URLs
 * survive; anything else is dropped. Returns null when nothing usable is left.
 * @param {string|null|undefined} text
 * @returns {string[]|null}
 */
export function parseRelayList(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const urls = text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^wss?:\/\/[^\s/?#]+[^\s]*$/i.test(s))
    .slice(0, 8);
  return urls.length ? urls : null;
}
