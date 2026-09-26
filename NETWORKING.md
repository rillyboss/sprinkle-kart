# Sprinkle Kart — Online Play Design (NETWORKING.md)

Status: **design, binding for the online-play workstreams** (v2.x → v3.0). Owner: networking architect.
Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (module contracts; §12 points here),
[docs/INFRA_SETUP.md](docs/INFRA_SETUP.md) (the grown-up's one-time Cloudflare setup; the infra names below
are copied from it and must stay identical), [CONTRIBUTING.md](CONTRIBUTING.md) (git + test rules).

The design rests on three code audits done on `origin/main` @ 106e2ad: **A** simulation (with measurement
scripts on branch `origin/net-audit/sim-measure`: `dev/net-design/measure-sim.mjs`,
`measure-quant-reconcile.mjs`), **B** session/menus/progress, **C** technology research (sources in §20).
Numbers marked **(measured)** come from those scripts; they are the regression baseline.

**Revision 2** (design review): adds the per-display timeline table (§9.1), a re-anchorable host timebase
(TIMEBASE, §7.3/§9.9), wire-byte bandwidth maths (§9.4), burst-loss input redundancy and a drift press counter
(§6.1/§9.2), tight state-channel backpressure and ctrl fragmentation (§4.1), fair grid slots (§8.6), wider timer
fields (§5), unguessable rooms with invite links + "secret sweets" (§4.2), a match check on the approval prompt
and lock-on-remove (§1, §10.9), TURN credentials only for rooms (§4.2), dual matchmaker with fallback (§3),
an honest privacy sentence (§1), dev origins (§4.2), and a milestone **ship ladder** M1 → M3 (§16.2, §17).

Contents:
[1 Goals](#1-goals-non-goals-and-kid-safety) · [2 Topology](#2-topology-and-rationale) ·
[3 Stack](#3-stack-binding-infrastructure) · [4 Transport](#4-transport-nettransport-signaling-channels) ·
[5 Codec](#5-binary-codec-and-quantisation) · [6 Messages](#6-message-catalogue) ·
[7 Handshake](#7-handshake-versioning-clock-sync-heartbeat) · [8 Sim changes](#8-simulation-changes) ·
[9 Netcode](#9-netcode) · [10 Session](#10-session-lobby-state-machine-and-screens) ·
[11 Modes](#11-mode-matrix) · [12 Progress](#12-per-machine-progression) ·
[13 Failures](#13-failure-handling) · [14 Debug overlay](#14-net-debug-overlay) ·
[15 Testing](#15-testing) · [16 Workstreams](#16-parallel-workstreams-waves-ownership-interfaces) ·
[17 Acceptance](#17-acceptance-criteria-measurable) · [18 Risks](#18-risks-and-open-questions) ·
[19 Constants](#19-constants-one-table) · [20 Sources](#20-sources)

---

## 1. Goals, non-goals and kid safety

**Goal (from the family):** "high quality, low latency peer-to-peer networking… host this and play with
friends… sync everything." Concretely:

| # | Goal | Measured by (§17) |
|---|---|---|
| G1 | Friends in different houses race together from the GitHub Pages site, no install, no accounts. | e2e two-browser test |
| G2 | **Hybrid couch + online**: every machine brings 1–4 local split-screen players; ≤ 8 humans per room, CPUs fill to 8 karts. | lobby tests, e2e 2+2 |
| G3 | Your own kart feels exactly like offline at ≤ 150 ms RTT (predicted, no input delay). | prediction error, input-to-photon = offline |
| G4 | Everyone else's kart moves smoothly (interpolated) even with 5 % loss and jitter. | render-jitter test |
| G5 | **Everything syncs**: karts, items, boxes, battle bubbles, countdown, laps, finish order, results, GP points, ceremony, sounds/FX/voice lines. | convergence + identical-results tests |
| G6 | Every machine keeps its **own** progress (unlocks, stickers, records) and is never credited for someone else's win. | localize tests |
| G7 | Works with zero setup (public signaling) and gets more reliable when the grown-up deploys our Cloudflare Worker + TURN. | check-connection tests |
| G8 | Online never breaks local play: with online off, gameplay at 60 Hz is identical to v2 (goldens and every existing test unchanged); on 30/75/120/144 Hz displays races now match 60 Hz behaviour (a deliberate fix, §8.1). Rendering interpolates between ticks, which adds ≤ 16.7 ms display delay on high-refresh monitors. | full suite + `tests/race.fixedstep.latency.test.js` |

**Non-goals (v1 of online):** public matchmaking / lobbies list · strangers · accounts, names, avatars,
chat · dedicated servers or an SFU · host migration (host leaves → the race ends gracefully) · lockstep or
rollback netcode (rejected, §2) · spectators beyond the 8 humans · online Time Trial, Daily Sprinkle,
How-to-Play (local only, §11) · cheat-proofing against a modified client (friends-only rooms; the host is
authoritative, which already stops casual desync "cheats") · mobile-browser hosting (iPad/iPhone may join,
never host, §13).

### Kid-safety rules (binding, tested)

1. **Off by default, behind the parent gate.** `settings.onlineEnabled` (default `false`) lives in
   *Settings → Grown-ups* behind the existing parent gate. Until it is on, the title screen shows no Online
   entry and no network code is even downloaded (lazy `import()`).
2. **Friends-only, unguessable rooms.** A room has a friendly **label** like `SPRINKLE-4821` (a word from a
   fixed list of 32 cute words + 4 digits) **and** a secret of 6 **"secret sweets"** (6 picks from a fixed
   64-treat palette, e.g. 🍩🦄🍓🍭🧁🌈 = 36 bits). Label + sweets together (54 bits) are stretched with a slow
   key-derivation function into the room key (§4.2); the matchmaker only ever sees ids derived from that key.
   Rooms are never listed anywhere. Friends join with the **invite link** (`#join=` fragment, "Copy invite
   link 📋" / QR code on the host's lobby, §10.1) or by entering label + sweets with the controller (word
   wheel, digit wheels, sweets grid) or keyboard. The label alone is **not** enough to find a room.
3. **The host approves every new house — always** (not a setting). The prompt shows a **match check**: the
   joining machine draws 2 random animal emoji (e.g. 🦊🐸), shows them on its own "Waiting for the host…"
   screen, and the host's prompt says "Ask your friend: do you see 🦊🐸? Let them in?" so the grown-ups can
   confirm over the phone. Prompts never pop up mid-race: they queue and appear at results or in the lobby.
   The optional Grown-ups setting **"Only a grown-up can let houses in"** puts the Yes button behind the
   parent gate. The host can also **lock** the room ("No more houses, please").
4. **No free text anywhere.** No typed names, no chat. Remote players are labelled with their house
   emoji + racer name ("🏡 Luna Lollicorn"). Communication = 8 **preset emotes** (§10.7). Every string in
   every network message is validated against a registry or an enum; anything else is dropped (§6.4).
5. **The host can remove a house or a single player** at any time. Removing a house **locks the room**
   ("Room locked 🔒 — tap to open again"), so a removed house that reloads (and so gets a new random peer id)
   is refused by the room state, not by its old id. Re-opening the room brings back the approval prompt with
   a fresh match check. We never promise that a removal survives the host re-opening the room.
6. **Honest privacy.** No names, chat, accounts or analytics are sent; peer ids are random per session.
   Like any video call, WebRTC shows your **internet address** to: your friends' computers, the free
   public matchmaking services (WebTorrent trackers and Nostr relays run by other people, §3) and public STUN
   servers (Google, Cloudflare) — or our own Cloudflare server instead, once a grown-up sets it up. The
   Grown-ups screen shows this sentence **before** online can be switched on (acceptance M1-12). When our
   TURN relay exists it offers **"Use the relay for game traffic"** (`iceTransportPolicy: 'relay'`), which
   hides your address from your friends' computers only (the matchmaker still sees it). Debug overlay and
   "For grown-ups" rows show candidate **types** (host/srflx/relay), never raw IP addresses.
7. **Friendly words only**, also in errors ("The host's house went to sleep 😴" rather than
   technical or scary wording). A friendly-words test (`tests/net.tone.test.js`, same word list as the existing screen/track tone checks) runs over every new string.
8. **Rate limits** on emotes (1 per 1.5 s per player), joins (Worker: per room in the room's Durable Object,
   and per IP in a global guard object, §4.2), `/ice`, and message sizes.

---

## 2. Topology and rationale

**Host-authoritative star over WebRTC data channels.** The host is one player's browser. Every guest
machine connects only to the host (never to other guests).

```
            guest house B (2 players)            guest house C (1 player)
                     \   inputs 30 Hz ↑  ↓ snapshots 30 Hz + events   /
                      \                                              /
                       +-------------- HOST house A ---------------+
                       |  authoritative Race @ fixed 60 Hz          |
                       |  CPUs, items, boxes, battle, scoring       |
                       |  its own 1–4 local players (zero latency)  |
                       +--------------------------------------------+
                                   ↑ signaling only (WebSocket / public relays)
                   sprinkle-kart-signal Worker  ─or─  public trackers/relays
```

| Option | Verdict | Why |
|---|---|---|
| **Host-authoritative star, snapshots + interpolation + prediction** | **Chosen** | Tolerates cross-browser float differences (only the host simulates the truth), hides latency for your own kart, costs nothing to run, ≤ 8 humans fits one home uplink (≈ 0.85 Mbps typical, ≤ 1.6 Mbps worst case incl. packet overhead, §9.4). |
| Deterministic lockstep | Rejected | Sim is chaotic and not bit-reproducible across engines: ECMAScript Math.sin/cos/atan2/pow/exp are "implementation-approximated" (V8 ≠ SpiderMonkey ≠ JSC), Kart/Items/AI/TrackPath call them ~49 times; **(measured)** ±2 ms of dt jitter already changes the winner. Also adds input delay = worst RTT for everyone. |
| Rollback (GGPO-style) | Rejected | Same determinism problem, plus hidden state in CPU brains/WeakMaps and 8 karts × re-sim cost. |
| Full mesh P2P | Rejected | 28 links for 8 machines, no single truth for items/CPUs, NAT failure probability multiplies. |
| Dedicated server / SFU | Rejected (non-goal) | Costs money/ops; Cloudflare free plan cannot run a 60 Hz sim; the family wants "host this". |

Why star is fair enough for kids: with the **input lead** (§9.2) a guest's inputs reach the host *before*
the tick they belong to, so the host simulates a guest's own driving exactly on time — racing lines, drifts,
boost pads and finish times are not handicapped by latency. The remaining asymmetries are how early you *see*
others (§9.8) and grid position, which is drawn fairly per race (§8.6).

---

## 3. Stack (binding infrastructure)

Everything here matches docs/INFRA_SETUP.md; names are exact and tested (`tests/docs.networking.test.js`).

| Layer | Choice | Notes |
|---|---|---|
| Game hosting | **GitHub Pages** `https://rillyboss.github.io/sprinkle-kart/` via `.github/workflows/pages.yml` | pages.yml passes repo variable `VITE_SIGNAL_URL` into the build. Vite `base: './'`. |
| Signaling (default, zero setup) | **Public signaling** via Trystero **0.25.4**: `@trystero-p2p/torrent` first, then `@trystero-p2p/nostr` after 6 s without a peer | Behind `SignalingTransport` (§4.2). Lazy-loaded chunk (~20–24 KB gzip each), only after the player opens Online. **Third-party services used (named in the privacy sentence, §1 rule 6):** WebTorrent trackers `wss://tracker.openwebtorrent.com`, `wss://tracker.webtorrent.dev`, `wss://open.ftorrent.com`; Nostr relays `wss://nos.lol`, `wss://relay.damus.io`, `wss://purplerelay.com`, `wss://yabu.me/v2`, `wss://nostr.data.haus` (Nostr relays may store the short-lived, encrypted signaling events); STUN `stun.cloudflare.com`, `stun.l.google.com`. Lists live in `src/net/signaling/relays.js` (config, not code). Import from `@trystero-p2p/*` — `trystero/<strategy>` subpaths now throw. |
| Signaling (ours) | **Cloudflare Worker** `infra/signal-worker/`, `wrangler.toml` `name = "sprinkle-kart-signal"`, SQLite-backed Durable Object class **`SignalRoom`** via `[[migrations]] tag = "v1"`, `new_sqlite_classes = ["SignalRoom"]` (never mix with the `[exports]` style) | Free-plan compatible (Hibernation WebSocket API). Endpoints `GET /health` → `{ ok, turn, version }`, `GET /ice` → ICE servers incl. short-lived Cloudflare TURN creds (**only for Check connection**: rate-limited 5/min per IP, ttl 900 s), `GET /room/:code` → WebSocket signaling, where `:code` is the key-derived room id (§4.2), never the spoken label; rooms receive their TURN creds inside the WebSocket. `vars.ALLOWED_ORIGINS = "https://rillyboss.github.io,http://localhost:5173"` (production; `wrangler dev` overrides it via the gitignored `infra/signal-worker/.dev.vars`, §4.2). The same `SignalRoom` class also runs one reserved instance named `guard` (global per-IP limits + daily TURN cap), so the binding migration never changes. |
| Selection | **Dual matchmaker.** A build with `import.meta.env.VITE_SIGNAL_URL` set makes the **host join both** the Worker and public signaling for the same room; guests try the Worker first and add public signaling after 4 s (or at once when `/health` fails). A build without it uses public signaling only. So host-on-new-build + guest-on-cached-old-build still meet (on public), and a Worker that is down or over its free quota degrades to public instead of breaking online. | `src/net/signaling/index.js chooseSignaling({ signalUrl, health })` → ordered list of transports; dev override `?signal=worker&signalUrl=…` / `?signal=public&relays=…` only on localhost / dev builds (for e2e). The "couldn't find that room" message adds "Ask everyone to refresh 🔄". |
| TURN | **Cloudflare Realtime TURN**; the Worker mints creds with secrets `TURN_KEY_ID` + `TURN_KEY_API_TOKEN`: `POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers`, `Authorization: Bearer {TURN_KEY_API_TOKEN}`, body `{"ttl": 1800}` (room sockets; refreshed on ICE restart via `{ t: 'ice' }`) or `{"ttl": 900}` (`/ice`) | Filter out `:53` URLs; cached **per room** in its Durable Object for ≤ 5 min (never shared across rooms); a **daily mint cap** (`TURN_DAILY_MINTS = 500`) in the guard instance, after which `/health.turn` reports false and rooms get STUN only; `/health.turn` is true only when both secrets exist and the cap is not reached. **Secrets never in the repo.** Without the Worker: public STUN only (`stun:stun.cloudflare.com:3478`, `stun:stun.l.google.com:19302`). |
| Worker CI | Optional `.github/workflows/worker.yml` (cloudflare/wrangler-action@v4) runs only when secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` exist (job-level `if:` on an env mirror of the secret). | The Cloudflare account does **not** exist yet — nothing is deployed by any workstream. |
| npm scripts (root) | `worker:dev` (local `wrangler dev`, no account), `worker:test` (`@cloudflare/vitest-plugin` 1.2.8), `worker:deploy`, plus `worker:login` and `worker:secret` (for INFRA_SETUP) | All are thin wrappers over `node scripts/worker.mjs <cmd>` (landed with this design, P0): it checks **Node 22+** with a friendly message, runs `npm ci --prefix infra/signal-worker` on first use, then runs the **pinned** `infra/signal-worker/node_modules/.bin/wrangler` (never an unpinned `npx wrangler`). The Worker has its own `infra/signal-worker/package.json` + lockfile (wrangler 4.141.x) so root `npm ci` stays light. **wrangler ≥ 4.88 needs Node 22+** (CI uses 24; locally `nvm use 25.4.0`). |
| Runtime deps | `three` (existing) + the two lazy Trystero packages + a tiny zero-dependency QR encoder (chosen and pinned by WS6) | A documented exception to "no new runtime deps" (house style): they load only inside the online chunk. The netcode itself (codec, interpolation, prediction) is hand-written. |
| Test deps | vitest (existing), Playwright (existing), optional `node-datachannel@0.33.4` (loaded with a dynamic `import()` inside the test and skipped if missing or its binary won't load; never in `package.json`, so `npm ci` can't break) | Worker tests run under Node 22+ only (`worker:test`); the pure room logic is also tested by the main suite on any Node. |

---

## 4. Transport: NetTransport, signaling, channels

Three layers, each swappable and tested alone:

```
 netcode / session  ──uses──▶  NetTransport          (peer messaging: send bytes on 'state' | 'ctrl')
                                 ├─ MemoryTransport  (tests: in-memory hub + network conditioner)
                                 └─ WebRtcTransport  ──uses──▶ SignalingTransport (finds peers, yields RTCPeerConnections)
                                                                ├─ PublicSignaling  (Trystero torrent → nostr)
                                                                └─ WorkerSignaling  (our /room/:code WebSocket)
```

### 4.1 `NetTransport` (the only thing netcode/session code sees) — `src/net/transport/types.js`

```js
/**
 * @typedef {'state'|'ctrl'} Channel   // state = unreliable+unordered, ctrl = reliable+ordered
 * @typedef {object} NetTransport
 * @property {string} selfId                         random per session (16 hex chars)
 * @property {'host'|'guest'} role
 * @property {() => string[]} peers                  connected peer ids (a guest sees only the host)
 * @property {(peerId: string, ch: Channel, bytes: Uint8Array) => boolean} send   false = dropped (closed / backpressure on 'state')
 * @property {(ch: Channel, bytes: Uint8Array, except?: string) => void} broadcast
 * @property {(fn: (peerId: string, ch: Channel, bytes: Uint8Array) => void) => () => void} onMessage
 * @property {(fn: (ev: { type: 'join'|'leave', peerId: string, reason?: string }) => void) => () => void} onPeer
 * @property {(peerId: string) => PeerStats} stats   { rttMs|null, bufferedCtrl, bufferedState, relayed: boolean|null, bytesIn, bytesOut, packetsIn, packetsOut }
 * @property {(peerId: string, reason?: string) => void} disconnect
 * @property {() => void} close
 */
```

Rules: `send` never throws; messages ≤ `MAX_STATE_BYTES = 1150` on `state` (encoder-enforced; the
transport drops and counts larger ones), ≤ `MAX_CTRL_BYTES = 16384` on `ctrl` (logical message; see fragments).

**Backpressure on `state` (latency first).** A `maxRetransmits: 0` message only queues when the SCTP congestion
window is full, so anything queued beyond ~2 messages is pure added latency. `send(peer, 'state', bytes)`
returns `false` (skipped, counted as `stateSkips`) when `bufferedAmount > STATE_BUFFER_LIMIT = max(1024,
2 × lastStateMessageBytes)`. The host's snapshotter halves that guest's snapshot rate to 15 Hz when skips
happened in more than 10 of the last 30 snapshot intervals, and restores 30 Hz after 60 clean intervals; the
guest's input sender does the same (it never needs to: inputs are small). Interpolation delay adapts to the
lower rate automatically (§9.5).

**Ctrl pacing and fragments (no head-of-line stalls).** There is no RFC 8260 message interleaving, so one big
ctrl message delays every snapshot behind it on the association. Therefore: (1) while a race is running, any ctrl
message larger than `CTRL_FRAGMENT_BYTES = 1024` is split into **FRAG** (0x3F) pieces and the host sends at
most one fragment per tick to a peer, and only when that peer's `state` `bufferedAmount` is 0 (RESYNC ≈ 4 KB
→ 4 ticks); (2) the big end-of-race messages (RESULT, GP) and SETUP are sent only when no race is running; (3)
on `ctrl`, when `bufferedAmount > 64 KiB` the transport queues and waits for `bufferedamountlow` (threshold
16 KiB). Reassembly limits: ≤ 16 fragments, ≤ 16 KiB, 10 s timeout, one message in flight per peer.

**Wire bytes.** Every `stats()` counter comes in two forms: payload bytes and **wire bytes** = payload +
`WIRE_OVERHEAD_BYTES = 93` per packet (IPv4 20 + UDP 8 + DTLS record header 13 + AES-GCM nonce/tag 24 + SCTP
common header 12 + DATA chunk header 16), or `WIRE_OVERHEAD_TURN_BYTES = 97` over TURN/UDP (ChannelData +4) and
`WIRE_OVERHEAD_TURN_TLS_BYTES = 150` over TURN/TLS. All budgets in §9.4 and §17 are wire bytes, and include
SCTP SACK packets (`SACK_BYTES = 93`; a SACK bundled into an outgoing DATA packet costs 16 B).

**MemoryTransport** (`src/net/transport/memory.js`): `createMemoryHub({ seed, now, schedule })` →
`hub.endpoint(peerId, role)` returns a `NetTransport`; `hub.link(a, b)`; `hub.setConditions(from, to,
{ latencyMs, jitterMs, loss, burstLen, duplicate, reorder, bandwidthKbps, overhead })`. It uses an injected
clock/scheduler so vitest fake timers or a manual `hub.advance(ms)` drive it deterministically (seeded
mulberry32). Loss is **bursty** when `burstLen > 1`: a two-state Gilbert–Elliott model whose mean burst is
`burstLen` packets and whose long-run loss rate is `loss`. `state` is lossy/reorderable/duplicable. `ctrl` is
reliable-ordered with a **realistic retransmit model**: a lost ctrl packet is re-delivered after
`max(RTT + 3 × snapshot interval, RTO_MIN_MS = 300)` (fast retransmit needs 3 later packets to report the gap;
otherwise the timer fires), doubling the wait on each repeated loss of the same packet (exponential backoff,
cap 3 s), and **everything behind it on ctrl waits** (head-of-line blocking, like SCTP). The hub counts wire
bytes with `overhead` (default `WIRE_OVERHEAD_BYTES`) and models SACKs (one per 2 received DATA packets,
bundled when the receiver sends within 200 ms).

**WebRtcTransport** (`src/net/transport/webrtc.js`): `createWebRtcTransport({ signaling, role, selfId,
iceServers, RTCPeerConnectionImpl? })`. For every `RTCPeerConnection` the signaling yields, it creates two
**negotiated** channels on both sides (no renegotiation, works on Trystero's connection too):

| Channel | Options | Id | Carries |
|---|---|---|---|
| `sk-state` | `{ negotiated: true, id: 8, ordered: false, maxRetransmits: 0 }` | 8 | INPUT, SNAPSHOT, PING, PONG |
| `sk-ctrl` | `{ negotiated: true, id: 9, ordered: true }` | 9 | everything else (incl. FRAG pieces) |

Ids 8/9 avoid Trystero's auto-assigned id 0/1 for its own `"data"` channel (which we ignore). `binaryType =
'arraybuffer'`. A peer counts as joined when **both** channels are `open`. `stats().relayed` comes from
`getStats()` (selected candidate pair type `relay`), polled every 5 s for the debug overlay and Check
connection.

### 4.2 `SignalingTransport` — `src/net/signaling/types.js`

```js
/**
 * @typedef {object} RoomSecret      // from src/net/session/roomKey.js
 * @property {string} label          'SPRINKLE-4821' (display + spoken; NOT secret)
 * @property {number[]} sweets       6 indices 0..63 into SECRET_SWEETS (the secret)
 * @typedef {object} RoomIds         // deriveRoomIds(secret) — async, crypto.subtle, ~150 ms
 * @property {string} topic          public path: Trystero room id 'sk-' + 20 hex
 * @property {string} password       public path: Trystero password (base64url, 32 B)
 * @property {string} workerRoom     Worker path: the `:code` of GET /room/:code ('r' + 24 hex)
 *
 * @typedef {object} SignalingTransport
 * @property {'public'|'worker'} kind
 * @property {(o: { ids: RoomIds, role: 'host'|'guest', selfId: string, iceServers: RTCIceServer[],
 *            relayOnly: boolean }) => Promise<{ iceServers: RTCIceServer[] }>} join
 *            // relayOnly is a PARAMETER (the session reads settings; signaling never does).
 *            // rejects with SignalingError { code: 'unreachable'|'no-host'|'host-exists'|'full'|'locked'|'rate'|'bad-origin'|'timeout' }
 * @property {(fn: (p: { peerId: string, pc: RTCPeerConnection }) => void) => () => void} onPeerConnection
 * @property {(fn: (peerId: string) => void) => () => void} onPeerLeave
 * @property {(peerId: string) => void} drop       host only: close this peer's signaling + pc (used by remove)
 * @property {(locked: boolean) => void} setLocked host only: refuse (true) / accept (false) new guests
 * @property {() => Promise<RTCIceServer[]>} refreshIce   worker: fresh TURN creds for an ICE restart; public: STUN
 * @property {() => Promise<void>} leave
 */
export async function fetchIceServers({ signalUrl }): Promise<{ iceServers: RTCIceServer[], turn: boolean }>  // Check connection only
```

**Room key (why a stranger can't find a room).** The first draft (room id = SHA-256 of the 320 000-value code,
password = code) was reversible: anyone watching public relays could precompute every id in under a second and
then also knew the password. Now `deriveRoomIds({ label, sweets })` computes
`K = PBKDF2-SHA256(password = label + '|' + sweets.join('.'), salt = 'sprinkle-kart-room-v1',
iterations = ROOM_KDF_ITERATIONS = 150 000, 32 bytes)` and then `topic = 'sk-' + hex(HMAC(K, 'topic'))[0..20]`,
`password = b64url(HMAC(K, 'pw'))`, `workerRoom = 'r' + hex(HMAC(K, 'room'))[0..24]`. The secret space is
32 × 10⁴ × 64⁶ ≈ 2⁵⁴; with 150 000 PBKDF2 rounds per guess, precomputing or brute-forcing ids is out of reach,
and the label alone (shown on screen, maybe said out loud) gives nothing. The key is **never** sent to any
server; the invite link carries the secret in the URL **fragment** (`#join=SPRINKLE-4821~<6 base64url chars>`),
which browsers never send to GitHub Pages, trackers or the Worker. What this does and does not protect:

| Threat | Barrier |
|---|---|
| Stranger watching public trackers/relays | Sees only random-looking topics; cannot map them back to a label or read the encrypted offers (Trystero password). |
| Stranger enumerating Worker rooms | Needs the 2⁵⁴ secret; the guard object limits room joins to 30/min per IP globally. |
| Someone who **has** the link (forwarded screenshot, a friend of a friend) | **Host approval with match check** (§1 rule 3) is the real, final barrier; then lock and remove. |
| A removed house reloading | The room is locked by the remove (§1 rule 5). |

**WorkerSignaling** (`src/net/signaling/worker.js`, `createWorkerSignaling({ baseUrl, WebSocketImpl,
fetchImpl, RTCPeerConnectionImpl })`): opens `wss://…/room/<workerRoom>?role=host|guest&peer=<selfId>&proto=1`.
**The guest is always the offerer** to the host (so no glare / perfect-negotiation needed); trickle ICE; one
ICE restart on `failed` (with `refreshIce()` first) before giving up. Worker ⇄ client JSON protocol (≤ 16 KiB
per message, ≤ 50 msgs/s per socket):

| Direction | Message | Meaning |
|---|---|---|
| C→W | `{ t: 'signal', to, data }` | SDP / ICE for one peer. Guests may only address the host. |
| C→W | `{ t: 'drop', peer }` | host only: close that guest socket and remember its salted IP hash until unlock (used by remove; the host locks the room in the same step) |
| C→W | `{ t: 'lock', locked }` | host only: refuse (true) / accept again (false) new guests; unlock clears the room's IP blocks |
| C→W | `{ t: 'ice' }` | ask for fresh TURN creds (ICE restart); ≤ 1 per 30 s per socket |
| C→W | `"ping"` | auto-response `"pong"` (DO stays hibernated) |
| W→C | `{ t: 'joined', you, host, peers: [], iceServers, turn }` | after upgrade; `host` = host peer id; `iceServers` = STUN + this room's TURN creds (ttl 1800 s) when TURN is set up and under the daily cap |
| W→C | `{ t: 'ice', iceServers }` | answer to `ice` |
| W→C | `{ t: 'peer-join', peer }` / `{ t: 'peer-leave', peer }` | to the host (guests only learn about the host) |
| W→C | `{ t: 'signal', from, data }` | relayed SDP / ICE |
| W→C | `{ t: 'error', code }` then close | `full` (8 sockets) · `no-host` · `host-exists` · `locked` · `rate` · `bad-origin` · `proto` |

TURN credentials therefore reach only sockets that know an existing room's key-derived id, and only guests of
a room that has a host. **Renewal:** a relayed allocation may stop refreshing once its credentials expire, so
every machine whose selected candidate pair is `relay` fetches fresh creds (`refreshIce()`) 20 min after the
last mint and applies them with `pc.setConfiguration` + an ICE restart **only between races** (lobby, results,
standings), never mid-race (a race is < 10 min). The manual checklist (§15) verifies a 45-minute relayed session. `GET /ice` exists only for the Check connection screen: 5 requests/min per IP (guard
object), ttl 900 s, no caching across callers.

**PublicSignaling** (`src/net/signaling/public.js`, `createPublicSignaling({ trackers, nostrRelays,
fallbackAfterMs = 6000, importer = (m) => import(m) })`): `joinRoom({ appId: 'sprinkle-kart', password:
ids.password, relayConfig: { urls: trackers }, rtcConfig: { iceServers } }, ids.topic)`. Trystero is a mesh, so
each side sends a tiny `sk-role` action on join; connections where neither side is the host are closed
immediately and never surfaced. If no host peer appears within `fallbackAfterMs`, the same room is additionally
joined over Nostr (redundancy 6). `setLocked(true)` makes the host ignore new Trystero peers; `drop(peerId)`
closes one.

**Dual matchmaker plumbing** (`src/net/signaling/index.js`): `chooseSignaling({ signalUrl, health })` returns
`['worker', 'public']` for a Worker build (the host joins both at once; a guest starts public 4 s after the
Worker, or immediately if `/health` failed) and `['public']` otherwise. A guest uses one `selfId` on both; the
first path whose `RTCPeerConnection` opens both channels wins and the guest leaves the other matchmaker. The
host accepts one connection per `selfId` (a second one for the same id is closed).

**Room lifecycle on the Worker** (`SignalRoom`, one DO per `workerRoom`): the host socket creates the room; a
second host gets `host-exists`; guests before a host get `no-host`; ≤ 1 host + 7 guest sockets; an alarm
deletes the room 2 h after the last socket leaves. **Abuse limits live in Durable Objects, not isolate memory**
(multiple isolates and colos bypass in-memory limits): per room, ≤ 12 guest joins per minute and, after a
`drop`, the dropped socket's **salted IP hash** (`SHA-256(roomSalt + ip)`, salt random per room, raw IPs never
stored) is refused until the host unlocks; globally, the reserved `guard` instance of `SignalRoom` counts room
joins (30/min) and `/ice` calls (5/min) per salted IP hash, plus the daily TURN mint cap. (Cloudflare's free
Rate Limiting binding may be added later as a first line; it does not replace the DO counters.) Pure logic
lives in `infra/signal-worker/src/room.js` (`roomReduce(state, event) → { state, sends: [...], close?: [...] }`)
and `infra/signal-worker/src/guard.js` (`guardReduce`), both tested by the **main** vitest suite too.

**What the Origin check is (and isn't).** The Worker checks `Origin` itself on `/room/:code` (browsers do not
apply CORS to WebSocket upgrades) and sends CORS headers only on `/health` and `/ice`. This only stops **other
websites** from using our Worker through a visitor's browser. It is **not** abuse protection: `Origin` is per
host (so `https://rillyboss.github.io` covers every rillyboss Pages project) and any non-browser client can
forge it. Abuse protection = unguessable room ids + the DO counters above (a test proves a forged Origin still
hits the join cap).

**Dev and test origins.** The production `ALLOWED_ORIGINS` stays exactly
`https://rillyboss.github.io,http://localhost:5173`. `npm run worker:dev` reads the gitignored
`infra/signal-worker/.dev.vars` (template `infra/signal-worker/.dev.vars.example`, committed):
`ALLOWED_ORIGINS=http://localhost:*,http://127.0.0.1:*`. The origin matcher accepts a `:*` port wildcard
**only** for the hosts `localhost` and `127.0.0.1`; any other wildcard is ignored, so the production value is
unaffected. `.dev.vars` is in the root `.gitignore` (added with this design, P0). Smoke/e2e pass their port
through (`SMOKE_PORT`, visual checks on `SMOKE_PORT + 1`, `vite preview` on 4173 all match). **LAN / iPad
testing:** `crypto.subtle` (room key) and WebRTC need a secure context, so `http://192.168.x.x:5173` fails;
use the GitHub Pages build, or an https tunnel (e.g. `cloudflared tunnel --url http://localhost:5173`) with
`?signal=public`.

---

## 5. Binary codec and quantisation

`src/net/codec.js` — a hand-written `DataView` codec (no JSON on the hot path, little-endian):

```js
export class ByteWriter { constructor(capacity = 1200); u8(v); i8(v); u16(v); i16(v); u32(v); i32(v); f32(v); f64(v);
  bytes(u8arr); qi16(v, scale); qu8(v, scale); angle16(rad); finish() → Uint8Array; get length }   // throws RangeError past capacity (encoder bug → test failure)
export class ByteReader { constructor(u8arr); …same getters…; get ok } // never throws: reading past the end sets ok=false and returns 0
export const q = { pos: 1/32, y: 1/64, vel: 1/256, time: 1/32, frac: 1/255 };   // metres, m/s, seconds
export function clampI16(v), clampU8(v);                                         // saturate, never wrap
```

Quantisation (all saturating; round-to-nearest):

| Quantity | Encoding | Range / precision | Why it's enough |
|---|---|---|---|
| x, z | i16 × 32 | ±1024 m, 3.1 cm | largest track extent ±409.6 m **(measured)** |
| y | i16 × 64 | ±512 m, 1.6 cm | elevation range ≤ 16 m |
| heading, spinAngle | u16 / u8 over 2π | 0.0055° / 1.4° | |
| vx, vz, speed | i16 × 256 | ±128 m/s, 4 mm/s | top speed incl. boosts < 70 m/s |
| distance | i32, cm | ±21 000 km | `s = path.wrap(distance)` is exact **(measured, max error 0)** so `s` is never sent |
| item/effect timers `boostTime, spinTime, shieldTime, starPower` | **u16 milliseconds** | 0–65.5 s, 1 ms | `shieldDuration` is 18 s and `starDuration` 7 s in `TUNING`; the first draft's u8 × 32 (≤ 7.97 s) saturated the shield for its first 10 s |
| short timers `rouletteTime`, `wrongWayTime`, `itemRoulette` | u8 × 32 | 0–7.97 s, 31 ms | `rouletteDuration` 1.2 s |
| hopTime, hopY | u8 × 256 s / u8 × 128 m | 1 s / 2 m | `hopDuration` 0.3 s |
| steer, pitch, roll, steerSmoothed | i8 over ±1 / ±0.5 rad | 1/127 | |
| accel, brake | 4 bits each | 1/15 | triggers are analog but kids are not |
| race times sent in events | u32 milliseconds | 49 days | |

**Timer ranges are tested against tuning.** `tests/net.codec.timers.test.js` walks every key of `TUNING` whose
name ends in `Duration`, `Window` or `Time`, maps it to its wire field (`TIMER_FIELDS` table in
`src/net/codec.js`, or the explicit `NOT_ON_WIRE` list for keys like `startBoostWindow`; a key in neither fails
the test) and asserts `2 × value` fits the field's range without
saturating, so a future tuning change cannot silently break the wire.

**Reconciling from quantised state costs 1.2 cm p50 / 2.1 cm p99 and does not grow over 6–12 ticks
(measured).** So the owner's own kart is corrected from exactly the same quantised numbers everyone else sees,
plus the owner-only block of discrete physics fields (§6.2). WS2 re-runs that measurement with the rev-2 timer
fields (`tests/net.baseline.test.js`) and adds a case with an active shield and star.

---

## 6. Message catalogue

Byte 0 of every message is its type. `state` types are `0x01–0x1F`, `ctrl` types `0x20–0x3F`. Unknown types,
short reads (`reader.ok === false`), wrong-channel types and oversize messages are **dropped and counted**
(never thrown). Cold-path ctrl messages marked *JSON* are `type byte + UTF-8 JSON`, parsed then validated by
`src/net/schema.js` (whitelisted keys, enums, registry ids, numeric ranges); unknown keys are stripped.

### 6.1 `state` channel (unreliable, unordered)

**0x01 INPUT** guest → host, **30 Hz**: sent right after the guest predicts every 2nd tick, so each packet
carries ≥ 2 new ticks plus redundant copies of older ones (§9.2).

| Field | Type | Notes |
|---|---|---|
| type | u8 | 0x01 |
| seq | u16 | packet counter (loss + burst stats) |
| newestTick | u32 | host-tick number of the newest input in this packet |
| n | u8 | ticks carried, newest first: `n = clamp(slackTarget + 4, 4, 8)` (only copies that can still arrive before the host simulates their tick are worth sending, §9.2) |
| p | u8 | local players on this machine, 1..4 (seat order) |
| lastSnapTick | u32 | newest snapshot tick received (for the host's per-house stats) |
| inputs | n × p × 4 B | per player-tick: `steer i8` · `pedals u8` (accel high nibble, brake low nibble, 0..15) · `flags u8`: bit0 drift held · bit1 lookBack · bit2 robo (player paused / pad asleep → host CPU drives) · bit3 assisted (Kid-Assist already applied) · `presses u8`: bits0–2 **useItem press counter mod 8** · bits3–5 **hop/drift press counter mod 8** (counts drift-button press edges) · bits6–7 spare |

Size = 13 + 4·n·p B: 1 player steady (n = 6) = 37 B; 4 players steady = 109 B; 4 players worst (n = 8) = 141 B.
The two press counters make redundancy safe: repeating a packet never doubles a press, and a lost packet never
loses one (the next packet's counter still differs). The host's rules for counter deltas (late presses,
several presses in one tick, baselines after Robo Driver / reconnect) are in §9.3.

**0x02 SNAPSHOT** host → each guest, every 2nd tick (30 Hz). Built from a shared body + a small per-house tail.

| Part | Field | Type | Notes |
|---|---|---|---|
| header | type, tick | u8, u32 | state **after** simulating `tick` |
| | flags | u8 | bit0 racing · bit1 finished · bit2 battle block · bit3 globally paused · bit4 teleport (snap, no smoothing) |
| | epoch | u8 | timebase epoch (§7.3); a guest ignores snapshots of an older epoch for clock filtering |
| | countdown | u8 × 64 | seconds left |
| | lastInputTick | u32 | per house: newest input tick the host has consumed for this house (the ack) |
| | inputSlack | i8 | per house: how many ticks early the input for `tick` arrived (−128 = missing, repeated) |
| | kartCount, boxCount | u8, u8 | |
| karts | per kart, in `race.karts` order | 41 B | layout below |
| boxes | active bitmask | ⌈boxCount/8⌉ B | respawn timers are host-only |
| gumdrops | count u8 + per gumdrop `id u16, x i16, z i16, y i16` | 8 B | colour comes with the spawn event |
| rockets | count u8 + per rocket `id u16, x, z, y i16, heading u16, target u8, flags u8` | 12 B | |
| battle (flag) | `timeLeft u16 × 10`, per kart `bubbles u4 \| out u1` | 2 + kartCount B | |
| owner tail | count u8 + per local kart of this house: `kart u8` + 19 B | 20 B | below |

Kart block (41 B): `x i16, z i16, y i16, heading u16, vx i16, vz i16, speed i16, distance i32` (18) ·
`flags u16`: boosting, spinning, shielded, drifting, offRoad, wrongWay, finished, finishEstimated, battleOut,
braking, reversing, star, driftDir (2 bits), roboDriven (2) · `boostTime, spinTime, shieldTime, starPower u16 ms`
(8) · `hopTime u8, hopY u8, spinAngle u8, driftCharge u8` (4) · `steerSmoothed i8, slide u8, pitch i8, roll i8,
throttle u8` (5) · `itemByte` = item 3b \| charges 2b \| driftLevel 2b \| hasPending 1b · `lapByte` = lap 4b \|
**live place 4b** (host standings at this tick; the guest HUD's place comes only from here, §9.1) ·
`finishByte` = finishPlace 4b \| spare 4b · `itemRoulette u8 × 255` (4).

Owner tail (19 B + kart id per own kart; needed to predict hop/drift/pad edges exactly): `driftHeld, prevAccel,
driftWindow>0` bit flags u8 · `driftWindow u8 × 256` · `hopLen u8 × 256` · `onPad i8` · `wallCooldown u8 × 256` ·
`accelPressedAt i8 × 32 (−128 = null)` · `slideDir i8` · `wrongWayTime u8 × 32` · `lastLapStart u32 ms` ·
`driftTime u16 × 256` · `groundY i16 × 64` · `pendingItem u8` · `rouletteTime u8 × 32` · `aiSpeedMult u8 × 128`.

Sizes (15 B header, 8 karts × 41 B, 32 boxes): **typical ≈ 370 B** (1 own kart, no items) · 8 gumdrops + 2 rockets
**≈ 460 B** · **cap-case ≈ 730 B** (24 gumdrops, 8 rockets, 4 own karts, battle). All < 1150 B = one SCTP packet (Chrome dcSCTP
packets ≤ 1191 B; a fragmented unreliable message is lost if any fragment is). Caps are enforced by the sim
(`MAX_GUMDROPS = 24` oldest-first eviction, `MAX_ROCKETS = 8`) and asserted by a codec test.

**Every snapshot is self-contained** (a full "keyframe" of hot state). No delta encoding in v1: measured full
snapshots are ~275–420 B (first-draft layout; ~370–460 B with the rev-2 fields), far inside the budget, and self-contained packets make loss/reorder trivial. The
`flags` byte reserves bit7 for a future delta-vs-acked-baseline format if the budget is ever exceeded (it isn't
at 8 karts). Cold state that rarely changes (lap times, finish times, entity colours) travels as reliable
events and in **RESYNC** (0x2D) instead.

**0x03 PING / 0x04 PONG** both directions, 4 Hz in lobby, 2 Hz in race (snapshots also carry time).
`PING = type u8, id u16, t0 f64` (11 B). `PONG = type u8, id u16, t0 f64, t1 f64, t2 f64` (27 B), times are
`performance.timeOrigin + performance.now()` ms of each side.

### 6.2 `ctrl` channel (reliable, ordered)

| Code | Name | Dir | Enc | Fields | Size |
|---|---|---|---|---|---|
| 0x20 | HELLO | G→H | JSON | `{ proto: 1, build: string≤40, content: u32, house: { localPlayers 1..4 }, canHost: bool, match: [u8, u8], token?: hex32 }` (match = the 2 match-check animal indices this guest shows, §1 rule 3; token = reconnect ticket) | < 200 B |
| 0x21 | WELCOME | H→G | JSON | `{ houseId 0..7, emoji, token: hex32, hostBuild, tickHz: 60, lobby: LobbyState }` | < 3 KB |
| 0x22 | REJECT | H→G | JSON | `{ reason: 'version'\|'full'\|'declined'\|'locked'\|'in-race-full'\|'removed'\|'host-leaving', detail? }` then disconnect | < 100 B |
| 0x23 | BYE | both | u8 | `reason u8` (0 leaving, 1 host ending, 2 removed) | 2 B |
| 0x24 | LOBBY | H→G | JSON | full `LobbyState` (§10.3), **coalesced**: at most 4/s per guest (changes within 250 ms merge into one send), never during a race (in-race lobby changes wait for results) | 0.5–3 KB |
| 0x25 | INTENT | G→H | JSON | `{ kind: 'seat-join'\|'seat-leave'\|'pick'\|'ready'\|'unready', seat 0..3, characterId?, paintId?, easyDrive? }` | < 150 B |
| 0x26 | EMOTE | both | bin | `globalPi u8, emote u8` (host validates + relays with a tick) | 3 B |
| 0x27 | KICK | H→G | bin | `scope u8 (0 house, 1 seat), seat u8` | 3 B |
| 0x28 | PHASE | H→G | JSON | `{ phase, screen, params }` — which screen every machine shows (§10.4) | < 2 KB |
| 0x29 | SETUP | H→G | JSON | `NetRaceSetup` (§10.5) | < 3 KB |
| 0x2A | LOADED | G→H | bin | `raceId u32` | 5 B |
| 0x2B | START | H→G | bin | `raceId u32, startTick u32, goTick u32, epoch u8` (followed at once by TIMEBASE) | 14 B |
| 0x2C | EVENTS | H→G | bin | batch (§6.3) | 10 + ~4/event B |
| 0x2D | RESYNC | H→G | JSON | cold full state for (re)joining mid-race: `{ raceId, tick, karts: [{ lapTimes, finishTime, finishPlace, finishEstimated, roboDriven }], gumdrops: [{ id, color }], rockets: [{ id, owner }], lastEventSeq, battle?, modeInfo }` | < 4 KB |
| 0x2E | RESULT | H→G | JSON | `{ raceId, summary: HostRaceSummary, options: [[id,label,emoji]] }` (§12) | < 6 KB |
| 0x2F | GP | H→G | JSON | `{ gp: GrandPrixResult (host view), final: bool, nextTrackId }` | < 8 KB |
| 0x30 | PAUSE | H→G | bin | `paused u8, reason u8, tick u32, epoch u8`: on pause `tick` = pauseTick (last simulated tick), on resume `tick` = resumeTick (next tick to simulate); reason 0 host snack break, 1 host starved/hidden, 2 host catch-up skip | 8 B |
| 0x31 | CHOICE | H→G | JSON | `{ screen, choice }` resolves the guest's copy of a host-owned screen | < 100 B |
| 0x32 | FOCUS | H→G | JSON | `{ screen, focusId }` optional 2 Hz preview of what the host is pointing at | < 100 B |
| 0x33 | NETSTAT | H→G | bin | 1 Hz: per house `houseId u8, rttMs u16, lossPct u8, state u8 (ok/wobbly/asleep)` | ≤ 42 B |
| 0x34 | TIMEBASE | H→G | bin | `epoch u8, tick u32, hostMs f64, reason u8` (0 periodic 1 Hz, 1 start, 2 pause, 3 resume, 4 catch-up skip): host tick `tick` began at host time `hostMs` | 15 B |
| 0x3F | FRAG | both | bin | `msgId u16, index u8, count u8, bytes` — one piece of a ctrl message > `CTRL_FRAGMENT_BYTES` sent during a race (§4.1) | ≤ 1029 B |

### 6.3 EVENTS batch (0x2C) and the replicated event catalogue

Batch = `type u8, firstSeq u32, baseTick u32, count u8`, then per event `dTick u8` (tick − baseTick),
`ev u8`, `kart u8` (race kart id 0..7, 255 = none), payload. Sent once per snapshot interval when non-empty.
**(measured) ≈ 5.3 events/s for 8 karts** → ~0.2 kbps.

| ev | Race event | Payload (B) | Local-predicted for own kart? |
|---|---|---|---|
| 1 | `countdown` | `n u8` (1) | – |
| 2 | `go` | – | – |
| 3 | `boost` | `source u8` (0 start, 1 pad, 2 item, 3 other) (1) | start + pad: yes |
| 4 | `hop` / 5 `land` | – | yes |
| 6 | `drift-start` | `dir i8` (1) | yes |
| 7 | `drift-level` / 8 `drift-boost` | `level u8` (1) | yes |
| 9 | `bump` | `other u8 (255 = wall), strength u8` (2) | wall: yes; kart-kart: no |
| 10 | `item-box` | `boxIndex u8, rolling u8` (2) | – |
| 11 | `item-get` | `item u8` (1) | – |
| 12 | `item-use` | `item u8, chargesLeft u8` (2) | self-effect items: yes (§9.6) |
| 13 | `rocket-launch` | `rocketId u16, target u8` (3) | – |
| 14 | `bonked` | `cause u8, by u8` (2) | – |
| 15 | `shield-pop` | `cause u8, by u8, expired u8` (3) | – |
| 16 | `item-dodged` | `item u8, by u8` (2) | – |
| 17 | `item-end` | `item u8` (1) | – |
| 18 | `lap` | `lap u8, lapTimeMs u32` (5) | – |
| 19 | `final-lap` | – | – |
| 20 | `finish` | `place u8, finishTimeMs u32, estimated u8` (6) | – |
| 21 | `race-complete` | – (the standings travel in RESULT) | – |
| 22 | `gumdrop-spawn` | `id u16, x, y, z i16, color u8` (9) | – |
| 23 | `gumdrop-despawn` | `id u16, why u8` (popped/bonked/rocketed/evicted) (3) | – |
| 24 | `rocket-despawn` | `id u16, why u8` (3) | – |
| 25 | `box-respawn` | `boxIndex u8` (1) | – |
| 26 | `battle-pop` | `by u8, bubblesLeft u8` (2) | – |
| 27 | `battle-out` / 28 `battle-bonus` | – | – |
| 29 | `robo` | `on u8` (Robo Driver took/gave back the wheel) (1) | – |

Enums (`cause`, `item`, `why`, `source`) map to fixed tables in `src/net/enums.js`; adding a value appends
at the end (never renumber) and bumps `PROTOCOL_VERSION`.

### 6.4 Validation (kid safety + robustness)

`src/net/schema.js` exports `validate(type, obj) → obj | null`. Rules: characterId ∈ `CHARACTERS`, trackId ∈
`TRACKS`, arenaId ∈ arenas, cupId ∈ `CUPS` or `MY_CUP_ID`, paintId ∈ `PAINTS`, emote ∈ `EMOTES`, emoji ∈
`HOUSE_EMOJI`, mode ∈ online modes, numbers finite and in range, arrays capped (≤ 8 players, ≤ 32 karts
entries), strings only where the schema says (build id `[\w.-]{1,40}`, token `[0-9a-f]{32}`). **There is no
field anywhere that can carry text a person typed.** Fuzz test: 10 000 random byte strings and mutated valid
messages per type decode to a valid message or `null`, never throw.

---

## 7. Handshake, versioning, clock sync, heartbeat

### 7.1 Handshake

```
guest                                            host
  | ── signaling: find host (room ids from key), WebRTC up ─▶ |
  | ── HELLO {proto, build, content, n, match, token?} ─────▶ |  compatible()? full? locked?
  |    guest screen: "Waiting for the host… show them 🦊🐸"   |  new house → approval prompt with the match check
  |                                                          |  ("Ask your friend: do you see 🦊🐸? Let them in?")
  |                                                          |  queued while the host is racing; ≤ 120 s, then REJECT declined
  | ◀─ WELCOME {houseId, emoji, token, lobby} ────────────── |  or REJECT {reason} + disconnect
  | ── PING/PONG ×8 (clock sync warm-up) ──────────────────▶ |
  | ◀─ LOBBY … (coalesced, ≤ 4/s) ─────────────────────────── |
```

A HELLO carrying a valid reconnect `token` skips approval and re-attaches to its old house (§13.2), even while
the room is locked (the house was never removed). A HELLO without a token while the room is locked gets REJECT
`locked` without any prompt. The match-check pair is drawn with `crypto.getRandomValues` from a fixed 32-animal
list (`MATCH_ANIMALS` in `src/net/session/approval.js`, different from the secret sweets so nobody mixes them
up) and is never reused for another attempt.

### 7.2 Versioning — `src/net/version.js`

- `PROTOCOL_VERSION = 1` — bumped by any wire change (message layout, enum append, snapshot layout).
- `BUILD_ID` — injected by Vite `define: { __SK_BUILD__: JSON.stringify(process.env.GITHUB_SHA?.slice(0,12) ?? gitShortSha() ?? 'dev') }`.
- `contentHash()` — FNV-1a 32 over: sorted racer ids + stats, sorted track ids + lap counts + item-box slot
  counts + boost-pad counts, arena ids, `TUNING` values, `SPEED_CLASSES`, `RACERS_PER_RACE`, the item table and
  `PROTOCOL_VERSION`. Pure, deterministic, tested (changing a tuning constant changes it).
- `compatible(mine, theirs) → { ok, reason }`: **ok iff `proto` and `content` are equal.** A different
  `build` with equal proto+content is allowed (docs-only or cosmetic deploys) and shown in the debug overlay.
  Otherwise REJECT `version` → guest sees **"Different game version — everyone refresh the page 🔄"** (the
  wording INFRA_SETUP.md troubleshooting uses).

### 7.3 Clock sync and the host timebase — `src/net/clock.js`, `src/net/guest/hostTimeline.js`

Two separate things are estimated: the **clock offset** (host wall time vs mine) and the **host timebase**
(which host tick is being simulated at a given host wall time). Host ticks do **not** follow wall time
forever: "Pause everyone", a starved host and catch-up skips all break the link, so the timebase is explicit
and re-anchored instead of being extrapolated from START alone (the first draft's bug).

**Offset.** NTP-style 4-timestamp PING/PONG: `rtt = (t3 − t0) − (t2 − t1)`, `offset = ((t1 − t0) + (t2 − t3)) / 2`.
Keep the last 16 samples; take samples within 1 σ of the median RTT, weight by `1 / rtt`, average their
offsets. `jitterMs` = EWMA (α = 1/8) of |rtt − rttPrev|. The estimate is `ready` after 5 samples.
`hostNow() = localNow + offset`, slewed ≤ 2 ms per second once ready; a > 50 ms disagreement over 8 samples
triggers a hard re-sync (rare: sleep/resume).

**Timebase.** The host keeps `{ epoch, anchorTick, anchorMs }` with the promise: *within an epoch, host tick
`k` begins at host time `anchorMs + (k − anchorTick) × 1000/60`, ± 1 tick* (§9.9 explains how the host keeps
it). Whenever the promise would break, the host starts a new epoch. It sends **TIMEBASE** (0x34, reliable)
right after START, after every pause and resume, after any catch-up skip, and at 1 Hz. PAUSE carries
`pauseTick` / `resumeTick` (§6.2).

The guest's `createHostTimeline({ clock })`:
- `onTimebase(tb)`: a newer epoch (or a same-epoch anchor that differs by > 1 tick) **hard-resyncs** the
  anchor. `onPause(pauseTick)` freezes `tickAt()` at `pauseTick`; `onResume(resumeTick)` + its TIMEBASE unfreeze.
- `onSnapshot(tick, epoch, localRecvMs)`: filters (tick, arrival) pairs, so a lost or late TIMEBASE is
  harmless. Residual `r = tickAt(localRecvMs) − tick − oneWayTicks`; the median residual over the last 10
  snapshots of this epoch slews the anchor by ≤ 0.25 tick per snapshot; |median| > 3 ticks for 5 snapshots in a
  row hard-resyncs to the snapshot-based estimate. A snapshot tick newer than `tickAt()` (impossible if the
  estimate were right) pulls the estimate forward at once.
- `tickAt(localMs) → number` (fractional host tick, frozen while paused), `paused`, `epoch`.

Tests (`tests/net.timeline.test.js`, harness-driven): after a **30 s host pause**, a **400 ms host stall**
and a **3 s hidden-host starvation**, the guest's estimate is within ±1 tick of the true host tick within 1 s
of resume, the input lead never exceeds `target + 2` ticks, and no guest input for a tick after `resumeTick`
is dropped as late.

### 7.4 Heartbeat and liveness

PING at 4 Hz (lobby) / 2 Hz (race); any packet counts as a heartbeat. Per peer: **> 3 s** silent → `wobbly`
(lobby icon 📶, HUD "🏡 is a bit wobbly…"); **> 8 s** silent or channel/pc `closed`/`failed` → `asleep`
(disconnected, §13.1). A guest that sees no host packet for 8 s treats the host as gone (§13.3).

---

## 8. Simulation changes

These land first (wave 1, WS1) and also fix a real offline bug: today race outcomes depend on the monitor's
refresh rate (**measured**: 30/75/120/144 fps and ±2 ms jitter each change the winner vs 60 fps).

### 8.1 Fixed 60 Hz tick + render interpolation (all modes, online and offline)

- `src/race/fixedStep.js`: `TICK_HZ = 60`, `TICK_DT = 1/60`, `MAX_TICKS_PER_FRAME = 6`.
  `createFixedStepper({ mode = 'local' }) → { advance(frameDt) → { ticks, alpha }, reset() }`. **Offline
  (`mode: 'local'`)** keeps today's 0.1 s spike cap: a stall longer than 6 ticks is simply dropped (fine when
  nobody else shares the clock). The **online host** uses the authoritative clock of §9.9 instead (never drops
  ticks silently; it catches up or re-anchors with TIMEBASE).
- `race.tick(inputs)` = exactly one sim step of 1/60 s = today's `update(1/60)` path (2 sub-steps of 1/120 —
  **identical to the tuned 60 fps behaviour**, so no re-tuning) **without** visuals. `race.tickCount` counts
  ticks since construction.
- `race.present(alpha, frameDt)` = the visuals pass: kart models/KartFx/items/boxes animate from a pose
  interpolated between the previous and current tick (`position, heading, spinAngle, pitch, roll, hopY`).
  Cameras and HUD read `kart.render` (the interpolated pose), physics reads `kart.position`.
- `race.update(dt, inputs)` stays for back-compat (existing tests, harness): it is `tick`-equivalent for
  `dt = 1/60` and keeps today's variable-dt behaviour otherwise.
- main.js `tick(dt)`: `const { ticks, alpha } = stepper.advance(dt); for (i < ticks) race.tick(inputsFor(i));
  race.present(alpha, dt)`. Per-tick work moves inside the loop: controller `update(TICK_DT)`, `trial.update`,
  ghost recording, `race-tick` bus event (new, declared in `EVENTS`). `built.update` (scenery) stays per frame.
  `?simspeed=n` runs `n×` ticks per frame (offline only).
- **Edge latching** (`src/input/InputLatch.js`): `useItem` and the drift press become a per-device press
  counter latched until a tick consumes it, so a 0-tick frame never drops a press and a 2-tick frame never
  uses it twice. `DriveInput.useItem` stays a boolean per tick (derived from the counter).
- Golden test: the same seed gives **identical standings and final kart states** at simulated render rates
  30/60/75/144 Hz and with ±4 ms frame jitter.
- Latency test (`tests/race.fixedstep.latency.test.js`): at a simulated 144 Hz render rate, an input sampled
  in a frame reaches a sim tick within ≤ 1 tick (16.7 ms) and shows in `kart.render` within ≤ 2 frames; at
  60 Hz the path is unchanged from v2 (same frame). This is the honest cost of the fix (G8).

### 8.2 Seeded RNG with serialisable state

`makeRng(seed)` returns `rng()` with `rng.getState() → u32` and `rng.setState(u32)`. `Race` **requires** a seed
in online setups (the host draws it with `crypto.getRandomValues`); offline main.js also passes an explicit
seed (it logs it in `window.__game.seed` for bug reports). All default-`Math.random` parameters in the sim path
(Items.js 49/235, AI.js 91/279, battle.js 216, setup.js 74/93) must be given the race rng; a test greps the sim
folders for `Math.random` outside allowed cosmetic files. CPU picks online come from the host (`setup.cpuIds`).

### 8.3 State vs presentation split

| Piece | Sim (host only online) | Presentation (every machine) |
|---|---|---|
| Kart physics `stepKart`, `constrainToTrack` | ✅ pure already | model pose from `kart.render` |
| Race: countdown, laps, standings, completion, bumps | `Race.tick` | – |
| CPU brains, `aiDriveInput`, rubber-banding | ✅ host | – |
| Kid-Assist (`applyEasyDrive`) | **owning machine** (state moves from the AI.js `_assist` WeakMap to `kart.phys.assist = { lane, stuck, backUp }`) | – |
| Items (`ItemSystem`) | `ItemSim`: gumdrops/rockets with **u16 entity ids**, `_starOn` / `_itemBoost` keyed by kart id, rocket-vs-gumdrop collision from sim positions (not `mesh.position`) | `ItemView`: meshes, wobble, reticles, bursts — driven by sim state (host) or snapshots + events (guest) |
| Item boxes | `BoxSim`: `active[]`, `respawn[]`, emits `item-box {boxIndex}` / `box-respawn` | `BoxView`: meshes, shimmer, pop FX |
| Burst FX (`bursts.emit`) | never called from sim code; sim emits events (`gumdrop-despawn`, `item-box`, …) | a FX mapper turns events into bursts |
| Battle (`battleSession.js`) | `battleSim.js`: `createBattle`, pops, `battleTick`, item roller, rocket target, `completeWith` | `battleView.js`: bubble meshes, HUD, sfx from `modeInfo.battle` + battle events |
| Team (`teamSession.js`) | series scoring (host) | badges (deterministic from participants, every machine) |
| Timing HUD, records, ghosts | – | local (records only for local players) |

`ItemView` interface (host feeds it from `ItemSim`, guests from `ReplicaItems`):
```js
{ spawnGumdrop({ id, x, y, z, color }), moveGumdrop(id, x, y, z), removeGumdrop(id, why),
  spawnRocket({ id, owner, target }), moveRocket(id, x, y, z, heading), removeRocket(id, why),
  update(dt, clock), dispose() }
```
`BoxView`: `{ setActive(index, on), pop(index), update(dt, clock), dispose() }`.

### 8.4 Serialise / apply — `src/race/simState.js`

```js
/** @returns {SimState} exact floats, plain data, structuredClone-able */
export function captureSimState(race);
export function applySimState(race, state, { karts = 'all' | Set<kartId>, world = true } = {});
export function captureKart(kart) → KartSim;  export function applyKart(kart, ks);
/** SimState = { tick, state, countdown, countdownShown, time, clock, finishCount, firstFinishTime,
 *   firstHumanFinishTime, rng: u32, nextEntityId: u16, bumpTimes: [[key, t]],
 *   karts: KartSim[], boxes: { active: bool[], respawn: number[] },
 *   gumdrops: [{ id, x, y, z, s, lateral, owner, grace, age, color, near: kartId[], dodged: kartId[] }],
 *   rockets: [{ id, owner, target, chased, distance, s, lateral, y, travelled, life, age }],
 *   starOn: kartId[], itemBoost: [[kartId, itemId]], battle?: BattleSim, modeInfo }
 * KartSim = all KartState hot fields (§6.2 kart block, unquantised) + phys (every field of kart.phys except
 *   bumpCooldowns, which is unused and removed) + cold { lapTimes, finishTime, finishPlace, finishEstimated } */
```

Round-trip test: `applySimState(fresh, captureSimState(race))` then N identical ticks → bit-identical states.
The snapshot codec (§6.1) quantises a `SimState`; the owner tail comes from `KartSim.phys`.

**One shared shape, merged first.** The `SimState` / `KartSim` / `BattleSim` typedefs, a
`SIM_STATE_SHAPE` field list and a canonical fixture `makeSimStateFixture({ karts, gumdrops, rockets, battle })`
live in **`src/race/simState.types.js`**, which lands with this design (P0, §16.0) before WS1 and WS2 fork.
WS2 codes the snapshot codec against that fixture; WS1's `captureSimState` must pass the contract test
`checkSimStateShape(state) → string[]` (empty = ok), which WS1 adds to its own tests. A field change is a
change to that file (and this section) in the same PR, never a private edit.

### 8.5 Prediction step — `src/race/predict.js`

```js
/** One 1/60 s step of this machine's LOCAL karts together, mirroring Race.tick order for those karts only. */
export function predictTick(localKarts, inputs, ctx);  // ctx = { path, boostPads, gameplay, rules, tick, startTick, goTick, emit }
export function collideKarts(karts, { emit, bumpTimes, time });   // extracted from Race._collideKarts (Race uses it too)
```
Order per tick: countdown / rocket-start logic (from `Race._updateCountdown`, with `countdown` derived from
`ctx.tick` and `goTick`, §9.1) → self item use for **boost, triple boost, star, shield** (deterministic
self-effects, no rng) → for each of the 2 sub-steps at 1/120: `collideKarts(localKarts)` (only this machine's
karts, in the same order as `Race.js` sub-steps) then `stepKart` → lap counting (updates `kart.lap` /
`distance` only; no `lap` event — the authoritative one comes from the host). So **couch siblings on one guest
machine bump each other locally**, including in replay. It never reads remote karts, items or boxes. **(measured)** `stepKart`-only replay matches the host bit-exactly in
94–98 % of 100–200 ms windows; windows with contact/bonks/items reach up to 1.4 m error — reconciliation
smoothing absorbs that (§9.5).

### 8.6 Other sim touches

- `Race._inputFor`: if `raw.assisted`, skip `applyEasyDrive` (the owning machine already applied it); if
  `raw.robo`, use `_brainFor(kart)` (Robo Driver).
- Race events carry `kart` objects offline; the host's event log maps them to ids (`e.kart.id`, `e.other.id`,
  `e.by.id`). New fields: `item-box.boxIndex`, gumdrop spawn/despawn events with id/position/colour, rocket
  despawn, `box-respawn`.
- `Race({ participants })` order is authoritative and the same on every machine, so kart id = index
  everywhere: CPUs in `cpuIds` order, then humans by global player index ascending (the wire order). **Grid
  position is separate:** every participant carries a `gridSlot`, and `Race` places kart `i` at
  `gridS = -7 - gridSlot * GRID_SPACING` (falling back to `i` when absent, so offline setups are unchanged —
  offline `buildParticipants` already puts CPUs in front and humans at the back). Online,
  `composeOnlineSetup` assigns: CPUs keep the front slots `0..C-1` in `cpuIds` order (GP: `gpCpuGrid`); the
  humans fill `C..C+H-1` by a **seeded shuffle** from the race seed (Free Race, Team, Battle and GP race 1),
  and in GP races 2+ by human GP points, leader last (the same "leader starts behind" spirit as `gpCpuGrid`).
  Test (`tests/net.gridslot.test.js`): over 400 seeded races with houses `[[2],[1],[1]]`, each house's mean
  human grid slot is equal within ± 0.15 slots, and no house starts in front of all others in more than its
  fair share + 5 %. (The first draft ordered humans by join order, which put the host's kids on the best human
  slot every race.)
- `buildKartModel(charDef, participant)`: paint comes from `participant.paintId` (not this machine's
  localStorage), so every house sees the same colours and two players on the same racer can differ.

---

## 9. Netcode

### 9.1 Timelines (and which one every display uses)

```
host tick T ───────────────────────────────▶ (authoritative present, host machine)
guest prediction timeline P = T_est + lead    own karts, own inputs   (lead ≈ RTT/2 + slack + 1 tick, adaptive)
guest remote timeline     R = T_est − interp  remote karts, CPUs, items, boxes, battle bubbles (interp ≈ 100 ms, 70–150 adaptive)
```

`T_est` comes from the host timeline estimate (§7.3). Every guest display is assigned to exactly one timeline:

| Display / logic on a guest | Timeline | Why |
|---|---|---|
| Countdown numbers 3-2-1, "GO!", countdown sfx | **P** (from the predicted tick: `countdownAt(P) = (goTick − P) / 60`) | Own inputs are stamped with P ticks, so what you see is what the host simulates. |
| Rocket-start window (`T.startBoostWindow`) and `accelPressedAt` | **P** (inside `predictTick`) | A press exactly on the visible GO lands on host tick `goTick` and earns the boost. |
| Own kart pose, speed, drift/hop/boost FX and sfx, own item slot | **P** | Zero input delay (G3). |
| Race timer (HUD clock), lap timer, "final lap" banner hint | **P** (`(P − goTick)/60`), corrected by the host `lap` / `finish` events | Matches your own driving. |
| Remote karts, CPUs, gumdrops, rockets, boxes, battle bubbles | **R** | Smooth interpolation (G4). |
| World/remote events (box pops, bonks, remote boosts) | **R** (released at `R ≥ event.tick`, §9.7) | Sound lines up with the picture. |
| **Live place** ("2nd") and minimap order | **host standings at the newest snapshot tick** (`lapByte.place`, §6.1) | Never computed from mixed-timeline distances: own distance at P vs remote at R would show the guest ~6 m ahead of the truth at 150 ms RTT / 30 m/s. |
| Finish celebration, finish place, "You finished 1st!" | **host `finish` event** (held until it arrives) | The kid never sees "1st" turn into "2nd". Until the event arrives the HUD shows a neutral "Finish! ✨" and the camera keeps rolling. |
| Results, standings, points, unlock celebrations | host RESULT / GP (§12) | Authoritative. |

Honest consequences, stated in the debug overlay help and tested: **(a)** GO appears on a guest's screen
`lead` ticks **earlier** in wall time than on the host (about RTT/2 + 33 ms): both are "on time" for their
own driving. **(b)** Remote karts start rolling a further `interp` after your own kart does, because you see
them in the past. **(c)** In a very close finish, the order you *saw* can differ from the real order by up to
`RTT/2 + interp` (≈ 175 ms at 150 ms RTT); that is why the place and celebration wait for the host's `finish`
event. Harness test `tests/net.timeline.go.test.js`: a scripted guest press on the tick where its visible
countdown shows GO earns the start boost on the host at RTT 0/50/150/250 ms; a press one frame before the
window does not.

### 9.2 Inputs, redundancy and the input lead

- The guest samples local inputs **once per predicted tick** (after Kid-Assist for assisted players) and
  stores them in a ring (`InputHistory`, 128 ticks) keyed by tick.
- Every 2nd predicted tick it sends INPUT (30 Hz) with the newest `n = clamp(slackTarget + 4, 4, 8)` ticks.
- **What redundancy really buys.** The host consumes tick T when it simulates T, so only copies that arrive
  before that count. A copy sent `k` packets after the first one arrives `2k` ticks later, so the number of
  **useful** copies is `1 + floor(slack / 2)`: 2 copies at slack 2–3, 3 copies at slack 4. Loss is often
  bursty (Wi-Fi), and a burst of ≥ `useful copies` packets (≈ 67 ms at slack 2) loses a tick's input. That is
  handled, not wished away: analog inputs are held from the previous tick (tiny correction later), and **both
  button actions are press counters** (item use, and hop/drift), so a press inside a burst fires one or a few
  ticks late on the host instead of vanishing (§9.3). When measured loss > 2 % or a burst of ≥ 2 packets was
  seen in the last 10 s, the lead controller raises the target slack from 2 to 4 (+33 ms lead, invisible to
  the player; it only lengthens the replay window).
- **Lead control** (`src/net/guest/leadController.js`): the host reports `inputSlack` (how many ticks early
  input for tick T arrived). Target slack = 2 ticks (4 under loss, see above; never 1, because inputs travel in
  pairs at 30 Hz). The guest runs its predicted clock up to **±3 % faster/slower** (time dilation, invisible to
  kids) to hold slack in [target − 1, target + 1]; slack < 0 for 3 snapshots in a row → jump the lead by +2
  ticks at once; slack > target + 4 for 10 snapshots → drop the lead by 2 ticks at once (the other direction,
  e.g. after a network hiccup cleared). While the host is paused (§7.3), the lead controller is frozen.
- Tests (burst model, §4.1 `burstLen`): matrix rows #6/#7 add **5 % loss in 3-packet bursts**; asserts: every
  press is applied exactly once (≤ 6 ticks late), own-kart reconcile error p99 ≤ 0.75 m outside contact, and a
  drift tap (1–2 ticks) lost in a burst still produces the hop on the host.

### 9.3 Host input buffer and missing-input policy — `src/net/host/inputBuffer.js`

`createInputBuffer({ size: 64 }) → { push(tick, perPlayer[]), take(tick) → { inputs, status: 'on-time' |
'repeated' | 'robo', presses }, slack(tick), lastConsumed, rebaseline(counters?) }` per house.

| Situation | Host uses for tick T |
|---|---|
| input for T present | it (status on-time) |
| missing, last input ≤ 250 ms old | last input **with its press counters unchanged** (no new press), steer/pedals/drift-held held (status repeated) |
| input for T arrives after T was simulated | analog part dropped; **press-counter deltas are queued** and applied on the next ticks (a late press is late, never lost) |
| counter delta of 2+ (double tap, or several late presses) | queued; **at most one press per counter per tick** (exactly like offline, where `items.use` sees one edge per tick); queued presses older than 250 ms are dropped (a very late press would surprise more than it helps) |
| counter wrapped (mod 8) | deltas are computed mod 8 against the last *seen* value, so ≤ 7 presses between packets are exact; more is impossible at 30 Hz × 8 ticks |
| missing > 250 ms | steer eases to 0 over 0.25 s, accel held (kart coasts on its line, never stops dead) |
| missing > 1.5 s, or `robo` bit set | **Robo Driver** (`_brainFor(kart)`) drives; kart flag `roboDriven` set; `robo` event → "🤖 Robo Driver has the wheel!" |
| inputs resume after Robo Driver / reconnect, or after HELLO / RESYNC | `rebaseline()`: the first received counters become the baseline **with no press**, the pending queue is cleared, then control returns on the next tick; `robo` event (off) |

The host's own local players bypass the buffer (their input is sampled directly for each tick, §9.9).
`tests/net.inputbuffer.test.js` has one case per table row, incl. double-tap triple boost (2 presses → 2
consecutive ticks), wrap, stale presses after Robo Driver (no phantom press) and the 250 ms drop.

### 9.4 Snapshots and bandwidth budget (wire bytes)

- Host broadcasts a SNAPSHOT after every 2nd tick (30 Hz), shared body encoded **once**, per-house tail
  (ack, slack, owner block) appended per guest.
- **All numbers are wire bytes** (§4.1: payload + `WIRE_OVERHEAD_BYTES = 93` per packet, plus SACKs; a SACK
  bundled into an outgoing packet costs 16 B, a stand-alone SACK 93 B). Arithmetic:

| Flow | Packets/s | Bytes per packet (wire) | kbps | Budget (acceptance) |
|---|---|---|---|---|
| Guest up, 1 player: INPUT n = 6 | 30 | 37 + 93 + 16 (bundled SACK) = 146 | 35 | |
| + PING 2 Hz, stray SACKs (~5/s) | 7 | ~100 | 6 | **≤ 45 kbps** (≈ 41) |
| Guest up, 4 players: INPUT n = 6 / worst n = 8 | 30 | 109 / 141 + 109 | 52 / 60 | **≤ 90 kbps** (≈ 58 steady, ≈ 66 worst) |
| Guest down: SNAPSHOT typical 370 B | 30 | 370 + 93 + 16 = 479 | 115 | |
| + EVENTS (≤ 6/s), NETSTAT, TIMEBASE, PONG | ~10 | ~120 | 10 | **≤ 140 kbps typical** (≈ 125) |
| Guest down: 8 gumdrops + 2 rockets (460 B) | 30 | 569 | 137 + 10 | ≈ 147 |
| Guest down: cap-case 730 B | 30 | 839 | 201 + 10 | **≤ 220 kbps cap-case** (≈ 211) |
| Host up, 7 guests | 7 × 30 | as guest down | 7 × 125 / 7 × 211 | **≤ 1.0 Mbps typical** (≈ 0.88), **≤ 1.6 Mbps cap-case** (≈ 1.48) |
| ctrl traffic in race | | | < 3 | average |
| Lobby: LOBBY ≤ 3 KB (3 packets), ≤ 4/s coalesced | ≤ 12 | ~1100 | ≤ 105 per guest peak, ≤ 0.74 Mbps host peak | only while people are clicking; average < 10 kbps |

  Over TURN/UDP add 4 B per packet (+1 %); over TURN/TLS (`WIRE_OVERHEAD_TURN_TLS_BYTES = 150`) the cap-case
  guest download is ≈ 225 kbps and still passes for typical play (≈ 140 kbps). IPv6 adds 20 B per packet
  (≈ +5 %). The netHarness counts **wire bytes with these constants** (never payload only), so acceptance
  M1-5 measures the same thing as this table.
- Backpressure (§4.1): a snapshot is skipped rather than queued when the state channel holds more than
  ~2 messages; sustained skips halve the rate to 15 Hz for that guest.

### 9.5 Remote interpolation — `src/net/guest/interpolation.js`

- `createSnapshotBuffer({ capacity: 32 })` stores decoded snapshots by tick (reordered/duplicate packets are
  inserted or ignored by tick; older than the render time are discarded).
- Render time `R = T_est − interpDelay × 60`. Per remote kart: cubic **Hermite** between the two
  bracketing snapshots using position + velocity (smooth at 30 Hz); heading via shortest-arc slerp; other
  fields (timers, flags, drift level) step at the older snapshot.
- **Adaptive delay:** `interpDelay = clamp(2 × snapshotIntervalMs + 2 × jitterMs + lossAllowance, 70, 150)`
  where `lossAllowance = 33 ms` when measured loss > 2 % (the interval is 33 ms, or 67 ms while halved). It moves
  ≤ 1 ms per 100 ms so time never visibly jumps. Start at 100 ms.
- Starved (no snapshot beyond R): **extrapolate** with velocity up to 250 ms, then freeze and blend back when
  data resumes. While the host is paused, R is frozen too.
- CPUs, gumdrops and rockets use the same buffer. Boxes and battle bubbles switch at the older snapshot.

### 9.6 Local-kart prediction and reconciliation — `src/net/guest/reconcile.js`

- The guest's own karts are simulated **together** by `predictTick(localKarts, inputs, ctx)` every predicted
  tick with the local inputs → **no input delay**, exactly like offline, and couch siblings on the same machine
  bump each other locally (§8.5).
- On each snapshot (tick S) with the owner tail: set the local karts to the snapshot state (quantised hot
  fields + owner phys), then **replay** stored inputs for ticks S+1 … P for all local karts jointly (≤ 14 ticks
  typical). The difference between the old predicted pose and the new one becomes a **visual error offset**
  that decays exponentially (τ = 100 ms; heading τ = 80 ms). Snap (no smoothing) when error > 4 m, heading
  error > 0.6 rad, or the snapshot `teleport` flag is set. **Replayed ticks never emit events** (`ctx.emit` is
  a no-op during replay): a predicted hop/drift/boost event fires once, the first time its tick is predicted.
- **Robo Driver on my own kart.** When a snapshot shows `roboDriven` for one of my karts (my player paused,
  their pad fell asleep, or the host decided after an outage), the guest **stops predicting that kart and
  renders it from interpolation (timeline R)** like a remote kart; the other local karts keep predicting (and
  no longer collide with it locally). When `roboDriven` clears, prediction **re-seeds from the newest
  snapshot**, `InputHistory` entries before that snapshot's tick are cleared, the input buffer baseline resets
  (§9.3), and the kart **snaps** (no smoothing) to avoid a slide from a stale pose. Test in
  `tests/net.reconcile.test.js`.
- What is predicted vs host-only:

| Thing | Local prediction | Host truth arrives via |
|---|---|---|
| steering, throttle, walls (`constrainToTrack`, path only) | ✅ exact | snapshot |
| drift start/levels/mini-turbo release, hops, landing | ✅ exact (needs owner tail + hop/drift press counter) | snapshot |
| boost pads, rocket start | ✅ exact | snapshot + events (dropped for own kart) |
| bumps between **my own** local karts | ✅ (joint `collideKarts`) | snapshot |
| using sprinkle boost / triple / star / shield | ✅ applied on press (sfx + FX instantly) | snapshot confirms; if the host disagrees (e.g. item was actually gone) the next reconcile corrects and the slot shows the truth |
| dropping a gumdrop / launching a rocket | slot empties + whoosh sfx instantly (cosmetic); the entity appears when the host spawns it (≈ RTT/2 + interpDelay later, behind you) | events + snapshot |
| bumps with remote karts, bonks, spins, item-box pickups, roulette result | ❌ host only | events + snapshot (smoothed) |
| laps / finish / live place | ❌ host only (lap banner hint from P allowed; place from snapshot; finish from event, §9.1) | events + snapshot |

- Events for the own kart whose type is locally predicted (hop, land, drift-*, pad/start boost, wall bump,
  own-kart bumps, self item-use) are **dropped** when they arrive from the host; all others fire on arrival.
- **Predicted events are presentation only.** Every locally predicted event is emitted with
  `predicted: true`. Presentation systems (sfx, FX, callouts, reactions) use them as normal. **Progress and
  goal systems never count predicted events**: in an online session `funGoals`, stickers, `drivingReactions`
  stat counters and every other counter take their numbers only from host-confirmed data — the per-player
  stats in RESULT's `HostRaceSummary` (§12). So a mini-turbo that the host cancelled (e.g. a bump the guest
  could not predict) never counts. Test: `tests/net.localize.test.js` has a predicted `drift-boost` that the
  host contradicts; the goal counter does not increment, and the localized summary's stats equal the host's.
- Remote players' sounds are never played as "your" sounds: `session.isHuman(kart)` keeps meaning *a player on
  this screen* (§10.8).

### 9.7 Replicated events: idempotence and ordering vs snapshots — `src/net/guest/eventPlayer.js`

- The host's `EventLog` (`src/net/host/eventLog.js`) stamps each race event with `seq` (u32, monotonic per
  race) and `tick`, keeps the last 512, and batches them into EVENTS after each snapshot.
- The guest applies each seq **at most once** (`lastAppliedSeq`; duplicates after a reconnect/RESYNC are
  ignored; a gap cannot happen on the reliable channel — if detected, request RESYNC).
- **Events are presentation only.** Game state comes only from snapshots (+ RESYNC for cold fields). Events
  ride the ordered `ctrl` channel, snapshots the unordered `state` channel, so an event can arrive before or
  after the snapshot of its tick; the player therefore releases **world/remote events when `R ≥ event.tick`**
  (sfx/FX line up with the interpolated picture: the box pops when the remote kart visibly touches it) and
  own-kart events immediately. Events whose tick is older than `R − 1 s` are released immediately, in seq order
  (never stuck behind a ctrl retransmit, whose realistic cost is modelled in §4.1: `max(RTT + 100 ms, 300 ms)`
  with backoff). Test: under that model at 250 ms RTT / 5 % loss, release order always equals seq order and
  no event is released more than 1.1 s after its tick.
- Released events are re-emitted through the normal `onEvent → bus.emit('race:<type>', e, session)` path with
  kart ids mapped back to the replica's kart objects, so **every existing system and the HUD run unchanged**
  (progress counters obey the rule in §9.6).
- `race-complete` only marks the tick; the guest waits for RESULT (0x2E) before the results screen.

### 9.8 Host-advantage mitigation

The host's own players see everyone at the true present, guests see others ~100 ms + RTT/2 in the past.
Mitigations, in order of impact:
1. **Fair grid** (§8.6): human grid slots are shuffled per race from the seed, never by join order.
2. **Input lead** (§9.2): a guest's own driving is simulated on the exact tick they pressed — no lateness in
   lines, drifts, pads, rocket starts, finish times.
3. **Late presses are never lost** (press counters): item use and hops by a guest land at most a few ticks
   late on the host.
4. **Gentle interaction by design:** bumps are soft pushes, bonks are twirls, rockets home in — none needs
   frame-perfect aim. Gumdrop hits against *remote* humans use the normal radius (no extra rewind in v1).
5. **Rocket and gumdrop warnings** use host-time events (the "Rocket coming!" warning fires on the guest when
   the rocket launches, not when it becomes visible).
6. Optional **"Fair host"** toggle (host lobby, default off, milestone M3): delays the host's own local inputs
   by `min(50 ms, median guest RTT/2)`.
Results record `net.hostAdvantageMs` (median guest one-way latency) in the debug overlay so the family can see
it is small.

### 9.9 Host tick source: one accumulator, two drivers — `src/net/host/hostClock.js`, `src/net/tickPump.js`

The host has exactly **one** authoritative accumulator; two things may *drive* it, never both at once:

- **Visible tab → rAF drives, exactly like offline.** Each rAF frame calls `hostClock.advance(now)`, which
  runs every due tick (`due = anchorTick + floor((hostNow − anchorMs) × 60 / 1000) − lastTick`) and returns
  `alpha ∈ [0, 1)` from the **same** accumulator for `race.present(alpha)`. The host's own local players'
  inputs are sampled per tick from the rAF frame's input snapshot (InputLatch keeps presses), so the "zero
  latency" reference players get the same input path as offline.
- **Hidden tab, or rAF starved for > 50 ms → the pump drives.** `tickPump.js` is a dedicated Web Worker
  (`new Worker(blob)`) posting a message every 16.67 ms (drift-corrected against `performance.now()`); on each
  message the main thread calls the same `hostClock.advance(now)` (no rendering). The pump is started on
  `visibilitychange → hidden` or when the last rAF is > 50 ms old, and ignored again after 2 consecutive
  on-time rAF frames. Because both call the same function with the same `due` formula, **each tick runs
  exactly once** whichever driver calls.
- **Catch-up instead of silent drops.** If a stall (GC, slow machine, tab switch) leaves `due > 6`, the host
  runs at most 6 ticks per call and keeps the rest as backlog, catching up over the next calls while staying
  on its timebase (guests see nothing but a few bunched snapshots). If the backlog exceeds
  `MAX_BACKLOG_TICKS = 30` (500 ms), the host **skips** instead: it re-anchors (`anchorTick = lastTick + 1`,
  `anchorMs = hostNow`, `epoch + 1`) and broadcasts TIMEBASE reason 4.
- **Pause everyone / starvation.** "Pause everyone" freezes the accumulator (PAUSE with `pauseTick`); resume
  re-anchors at `resumeTick` with a new epoch (PAUSE resume + TIMEBASE). If the pump itself is starved for
  > 1 s, the host sends PAUSE reason 1 (guests see "Waiting for the host… ⏳") and resumes with a new epoch.
- On return to a visible tab after being hidden, the host shows **"Keep this tab open, you're the host! 🏁"**.
- Test (`tests/net.hostclock.test.js`): a fake rAF (60/144 Hz, with gaps) and a fake pump interleaved randomly
  over 10 000 ticks: every tick number runs exactly once, in order; `alpha` stays in `[0, 1)`; hidden periods
  of 3 s keep ticking at 60 Hz; a 400 ms stall is caught up without an epoch change; a 2 s stall produces
  exactly one skip + TIMEBASE.

---

## 10. Session, lobby state machine and screens

### 10.1 Entry, gates, invite links and screens

- **Settings → Grown-ups** (parent gate) gets three rows (`src/progress/schema.js` defaults + `mergeProgress`
  clamp): "Online play with friends 🌐" (`settings.onlineEnabled`, default false) · "Only a grown-up can let
  houses in" (`settings.approvalGate`, default false) · when a relay exists, "Use the relay for game traffic"
  (`settings.relayOnly`, default false). Switching online **on** first shows the privacy sentence of §1 rule 6
  and needs a second press ("Okay, turn it on"); the sentence is tone-tested.
- Title: `menuEntry: { label: 'Online', emoji: '🌐', when: (ctx) => ctx.progress.getSettings().onlineEnabled }`
  (new optional `menuEntry.when(ctx)` in `screenFlow.menuEntries`).
- **Invite link.** The host lobby shows the label, the secret sweets, a **"Copy invite link 📋"** button
  (Clipboard API; falls back to showing the link) and a **QR code** of the link. Format:
  `https://rillyboss.github.io/sprinkle-kart/#join=SPRINKLE-4821~<6 base64url chars>` (one char per sweet).
  It is a `#` fragment, never a query string, so it is not sent to GitHub Pages, trackers, relays or the
  Worker. `src/net/session/inviteLink.js`: `makeInviteLink(secret, baseUrl) → string`,
  `parseInviteFragment(hash) → RoomSecret | null` (forgiving of case/spaces, strict on the alphabet).
  On start-up `main.js` reads `location.hash` **once**, clears it with `history.replaceState` (so a reload or a
  screenshot of the address bar does not keep it) and hands the parsed secret to the Online flow:
  - online enabled → the Online hub opens straight into "Join 🏡 SPRINKLE-4821?" (one press to confirm);
  - online **off** → a friendly screen "Ask a grown-up to turn on online play in Settings → Grown-ups 🔒" with
    one button back to the title. It never bypasses the parent gate, and the parsed secret is kept only in
    memory for this page load (after the grown-up enables online, "Join" offers it once).
- New screens (`src/ui/screens/`): `online-hub` (Host a game · Join · Check connection) · `code-entry`
  (word wheel + 4 digit wheels + an 8 × 8 **sweets grid** for 6 picks; keyboard digits/letters work; pure
  `codeEntryReduce`) · `online-lobby` (houses, seats, racers, ping icons, emotes, the label + sweets + invite +
  QR, host: approve (with match check) / remove / lock / "Let's pick!") · `check-connection` · `net-waiting`
  (generic "Host is picking… 🎨" with optional preview from FOCUS, milestone M3) · `invite-gate` (the
  "ask a grown-up" screen above).
- Router hooks in `Menus.js` (all no-ops when `ctx.net === null`, so offline paths are unchanged):
  `ScreenDef.net = { role: 'host' | 'local' | 'all' }`; `goto()` shows `net-waiting` on guests for `host`
  screens; `_finish()` calls `ctx.net.composeSetup(localSetup)` on the host; public `menus.resolveCurrent(v)`.
- **Which modes the Online menu shows** comes from one list, `ONLINE_MODES` in `src/net/session/modes.js`,
  which each milestone extends (M1: `['free']`; M2: + `'grand-prix'`; M3: + `'team'`, `'battle'`). The §11
  matrix lists the final state; the menu never shows a mode whose milestone is not done.

### 10.2 State machines

Host (`src/net/session/hostSession.js`):
```
idle → opening (signaling join on every matchmaker, label + sweets shown) → lobby ⇄ approving
lobby → mode-select → character-select → course-select (track | cup | arena | my-cup) → loading
loading → countdown/race → results → (again | next-track) → loading
                                    → gp-standings → loading (next cup race) | ceremony → lobby
results/ceremony → lobby ("Back to the lobby") → … → closing (host ends / leaves) → idle
```
Guest (`src/net/session/guestSession.js`):
```
idle → code-entry | invite → connecting (signaling, ICE ≤ 15 s) → handshake → waiting-approval (shows match check) → joined
joined: follows PHASE (lobby | net-waiting | character-select | loading | race | results | gp-standings |
        ceremony) → removed | host-gone | version-mismatch | left → online-hub
```
Both are pure reducers `(state, event) → { state, effects[] }` (effects = send, show screen, start race…),
tested without a browser.

### 10.3 LobbyState (host-owned, sent in LOBBY, coalesced ≤ 4/s)

```js
{ v: 1, label: 'SPRINKLE-4821', phase: 'lobby'|'mode'|'characters'|'course'|'loading'|'race'|'results'|'standings'|'ceremony',
  locked: false, capacity: 8,
  houses: [{ houseId: 0, emoji: '🏰', isHost: true, net: 'ok'|'wobbly'|'asleep', rttMs: 0,
             players: [{ globalPi: 0, seat: 0, characterId: 'luna'|null, paintId: 'original', easyDrive: false, ready: false }] }],
  hostChoice: { mode: 'free', trackId, cupId, arenaId, speedClass: 'zippy', laps: 3, customTrackIds? } }
```
The secret sweets are **never** in LobbyState (guests already know them; the host screen reads them locally).
The pending-approval queue `[{ peerId, emoji, match: [a, b], since }]` is host-local state, never sent.
Global player index 0..7 is assigned by the host in join order and kept for the whole session; it decides
nothing about the grid (§8.6). A house's local split-screen slots map to its global indices.
`MAX_LOCAL_PLAYERS = 4`, `MAX_HUMANS = 8`, `PLAYER_COLORS` grows to 8 entries; `joinReduce` gets a `capacity`
(seats left).

### 10.4 Screen-by-screen sync

| Screen | Who drives | Others see |
|---|---|---|
| join ("Who's playing at your house?") | each machine for its own pads, capped by seats left; sends `seat-join/leave` | lobby updates |
| online-lobby | host (approve, remove, lock, Let's pick) ; everyone emotes | same screen |
| approval prompt | host; **queued while the host's players are racing** and shown at results or in the lobby (a small "🏡 wants to join" badge on the results screen only); with `approvalGate` on, Yes opens the parent gate first | the joining guest sees "Waiting for the host… show them 🦊🐸" |
| mode-select (online list = `ONLINE_MODES`) | host | net-waiting "Host is picking a mode…" |
| character-select | **every machine at once** for its own players, gated by **its own unlocks**, with its own paint choice; remote picks shown read-only with house emoji | everyone-ready computed on the host |
| track / cup / arena / my-cup select | host, gated by the host's unlocks | net-waiting (FOCUS preview of the track card in M3) |
| loading | every machine builds scene, reports LOADED | "Waiting for 🏡…" list |
| countdown + race | START names `startTick` and `goTick`; each machine's countdown runs on its own prediction timeline (§9.1) | – |
| pause | guest Start = local overlay (Keep racing / Leave room), Robo Driver drives meanwhile; host Start = "Pause everyone 🍪" / Start over / Back to lobby | PAUSE: "Snack break at the host's house 🍪" |
| results / team-results / battle-results | host picks the option | same screen with "Waiting for host…" + **their own** unlock celebrations |
| gp-standings, ceremony (podium) | host continues | same data (GP), own unlocks |

### 10.5 NetRaceSetup (SETUP, host → all)

```js
{ raceId: u32, seed: u32, mode, trackId | arenaId, cupId?, customTrackIds?, speedClass, laps,
  participants: [ { kartId, gridSlot, playerIndex /* global or null for CPU */, houseId|null, seat|null,
                    characterId, easyDrive, paintId } ],   // authoritative order = race.karts order (§8.6)
  cpuIds: [...], rules: <resolved rules object>, gp?: { raceIndex, raceCount }, teamSeries?, protocol: 1 }
```
Each machine maps its own seats to local devices (`deviceId` is filled locally, never sent). The host picks
`cpuIds` from **its** unlocked racers and CPU paints `original`; `gridSlot` comes from §8.6.

### 10.6 Ready and countdown sync

Host sends SETUP → each machine builds the race (`Race` on the host, `ReplicaRace` on guests) and replies
LOADED. When all are loaded (or 20 s passed — stragglers' karts start with Robo Driver and they join via
RESYNC), host sends START with `startTick = hostTickNow + 90` (1.5 s) and `goTick = startTick + 3 × 60`, then
TIMEBASE. The countdown is sim state derived from the tick: on the host from `T`, on each guest from its own
prediction timeline P (§9.1), so every player's GO lines up with **host tick `goTick`** for their own inputs
(± 1 tick, acceptance M1-9). START's 1.5 s lead is checked against the realistic ctrl retransmit model of
§4.1: at 250 ms RTT with 5 % loss START still arrives before `startTick` in ≥ 99.9 % of 10 000 harness trials,
and a guest whose START arrives late simply joins the countdown already running (its P timeline jumps to
the right tick before GO; nothing is lost).

### 10.7 Emotes

8 presets (`src/net/emotes.js`, ids 0..7): 👋 Hi! · 😄 Hee hee · 🎉 Yay! · 👍 Nice! · 😮 Whoa! · 💖 Love it ·
🍭 Sweet! · 🐢 Wait for me! Picked with a d-pad wheel (lobby: Y button). **In-race emotes are milestone M3**
(hold Look-back + d-pad, off by default for players under Kid-Assist). Shown as a bubble over the kart / lobby
card with a soft chime. Rate 1 per 1.5 s per player; the host can mute emotes for everyone.

### 10.8 Session helpers and labels

In an online race `session.humans` / `isHuman(kart)` = **local** humans (all ~20 presentation systems then
work unchanged); new `session.allHumans`, `isAnyHuman(kart)`, `isLocal(kart)` for rules and scoring. One
`playerLabel(pi)` replaces the ~10 hard-coded `` `P${pi+1}` `` labels: local players "P1…P4", remote players
"🏡 Luna Lollicorn". Rumble, flashes and voice lines only for local karts.

### 10.9 Removing players

Host lobby → a house card → "Remove this house 👋" or a single player. KICK → guest shows "The host said
bye-bye for now 👋" and returns to the Online hub. Removing a **house** also **locks the room** in the same
step (`signaling.setLocked(true)` on every matchmaker + Worker `drop`, which remembers the dropped socket's
salted IP hash until unlock) and the lobby shows "Room locked 🔒 — tap to open again". A reload of the removed
house gets a new peer id but meets a locked room (REJECT `locked`). If the host re-opens the room, anyone with
the invite can ask again, and the approval prompt (with a fresh match check) is the barrier; we do not promise
more. Removing a single seat does not lock. Mid-race removal hands their karts to Robo Driver until the race
ends. Acceptance M1-17 tests exactly this.

---

## 11. Mode matrix

The *Notes* column names the milestone (§16.2) that turns the mode on in `ONLINE_MODES`.

| Mode | Online? | Host-only logic | Every machine | Notes |
|---|---|---|---|---|
| Free Race 🏁 | ✅ | race sim, CPUs, items, completion | results screen, own records (local players' best times only) | **M1**; again / next-track / lobby |
| Grand Prix 🏆 (incl. My Cup) | ✅ | `createGrandPrix`, `gpRecordRace`, cpu picks fixed for the cup | standings, ceremony podium, `gp-race-end`/`gp-end` **localized** | **M2**; My Cup tracks must be unlocked on the host |
| Team Race 🤝 | ✅ | team series + scoring | badges, team-results | **M3**; all humans are Team Sprinkle |
| Bubble Battle 🫧 | ✅ | `battleSim` (pops, bonus, ranking, end) | `battleView` from snapshot battle block + battle events | **M3**; arenas unlocked on host; convergence rows need WS1's battle split |
| Time Trial ⏱️ | ❌ local | – | – | solo + ghost |
| Daily Sprinkle ☀️ | ❌ local (later: host sends `setup.daily`) | – | – | date/time-zone based |
| How to Play 🎓 | ❌ local | – | – | solo coached |

---

## 12. Per-machine progression

- Nothing is ever written to another machine's save. The host's RESULT carries a `HostRaceSummary` (the normal
  `RaceSummary` with **every** human, keyed by global player index, + `online: true`).
- Each machine runs pure `localizeSummary(hostSummary, localPis)` (`src/net/session/localize.js`): `humans` =
  local rows only (with their stats), `winner` = a **local** human 1st or null, `totals` from local humans,
  `humanCount` = all humans (so *multiplayerRaces* counts), `online: true` — then emits `race-end` locally.
  progressUnlocks, funGoals, timingRecords/recordHolders and the Sticker Book work unchanged.
- **One source of truth for counters.** Online, every progress/goal/sticker counter comes from the host's
  per-player stats in `HostRaceSummary` (the host's `createRaceStats` tally), never from events the guest
  predicted locally (those carry `predicted: true` and feed presentation only, §9.6). `localizeSummary`'s
  stats and the goal counters therefore always agree.
- GP: `localizeGp(gp, localPis)` recomputes `humanWinner` and `bestHumanPlace` for local humans (today
  `cups.js` treats *any* human as a winner — without this a guest would get *cupsWon* for the host's win).
- Unlock gating: each machine gates its own racer picks; tracks/cups/arenas/My Cup/CPU fill use the host's.
  A parent's "unlock everything" widens only that machine's choices.
- A disconnected player who is not back by RESULT gets nothing recorded for that race.

---

## 13. Failure handling

### 13.1 Guest disconnects

`wobbly` at 3 s (icon + gentle HUD line), `asleep` at 8 s: their karts get **Robo Driver** ("🤖"), their seats
stay reserved. In the lobby an asleep house is greyed and removed after the reconnect window.

### 13.2 Reconnect window (60 s) — milestone M2

WELCOME gives each house a random 128-bit `token` (sessionStorage). A guest whose link drops retries
signaling automatically (1 s, 2 s, 4 s … ≤ 60 s total, "Reconnecting… 🔌"); HELLO with the token re-attaches the
same house and global indices without approval (also while the room is locked, since that house was never
removed); mid-race the host sends RESYNC (cold state + `lastEventSeq`, as FRAG pieces paced per §4.1),
snapshots resume, the input baseline resets (§9.3) and control returns on the next tick. In M1 a dropped
guest simply stays with Robo Driver until the race ends and can rejoin (with approval) in the lobby. iOS/iPadOS (WebRTC suspended when locked or backgrounded):
on `visibilitychange → visible` the guest shows "Tap to reconnect 👆" (audio also needs the gesture).

### 13.3 Host leaves

Host BYE (ending) or 8 s of silence → guests show "The host's house went to sleep 😴 Thanks for racing!" and
return to the Online hub; the unfinished race is not recorded. No host migration in v1 (future: SimState +
rng state make it possible).

### 13.4 NAT / connection failure UX

ICE timeout 15 s (one ICE restart included) → "We couldn't connect your houses 🙈" with three friendly tips:
try again · a grown-up can turn on the Sprinkle Kart relay (docs/INFRA_SETUP.md) · try another network (school
Chromebooks and phone hotspots often need the relay). The message says which part failed (from Check
connection's categories).

### 13.5 Other failures

| Case | Guest sees | Host sees |
|---|---|---|
| version mismatch | "Different game version — everyone refresh the page 🔄" | – (logged in overlay) |
| room full (8 racers) | "This room is full of racers 🚗" | – |
| declined / locked | "The host's room is closed for now 🔒" | – |
| wrong code / sweets, or no host | "We couldn't find that room. Check the code and the secret sweets? 🔍 If it still won't work, ask everyone to refresh 🔄" | – |
| matchmaker unreachable | "Couldn't reach the matchmaker" (+ auto fallback torrent → nostr) | same |
| host tab hidden / starved | "Waiting for the host… ⏳" | banner on return |
| iPad / iPhone tries to host | "Hosting needs a computer 💻 — you can still join!" | – |
| approval not answered in 120 s | "The host didn't open the door this time 🚪" | prompt disappears |
| too many seats requested | join screen stops at seats left | – |

**iPad / iPhone detection** (`src/net/platform.js`, pure `canHost({ userAgent, platform, maxTouchPoints })`):
iPadOS Safari reports a desktop Mac user agent by default, so a user-agent test alone lets iPads host. Rule:
`isAppleMobile = /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)`
(real Macs report `maxTouchPoints = 0`); hosting needs `!isAppleMobile`. Unit tests use fixtures for iPadOS
17/18 desktop-mode UA + `maxTouchPoints 5`, iPhone, a real Mac, Windows, ChromeOS and Android. As a second
guard a host that sees its tab go hidden for > 10 s with the pump failing to tick (any platform) shows the
"Keep this tab open" banner and pauses (§9.9).

### 13.6 Check connection screen (`check-connection`, pure `diagnose()` in `src/net/diagnose.js`)

| Row | Probe | ✅ / ⚠️ / ❌ |
|---|---|---|
| Matchmaker | Worker build: `GET /health` ok → **"Sprinkle Kart server"** (and public relays as backup); `/health` failing → "Server napping, using public relays"; public build: a tracker WebSocket opens → **"Public relays"** | reachable / slow / unreachable |
| Direct connection | gather ICE with STUN only: a `srflx` candidate appears | yes / only local network / no → "Relay needed" |
| Relay (TURN) | Worker `GET /ice` (rate-limited, ttl 900 s) returns TURN + a `relay` candidate gathers | ready / not set up (no worker) / blocked |

A network that blocks UDP (school Chromebook policy, some hotspots) must come out as Direct ❌ "Relay needed"
and, with the Worker, Relay ✅ via TURN/TLS 443: `tests/net.diagnose.test.js` simulates it with the fake ICE
gatherer (no `srflx`, only `relay` over tcp/tls).

Result rows are kid-friendly with a "For grown-ups" detail line (candidate **types** and RTT to STUN; never raw
IP addresses, since screens get shared). This matches
INFRA_SETUP.md step 8.

---

## 14. Net debug overlay

`?netdebug=1`, or F9 while online, or Settings → Effects "Show network info" (`src/net/debugOverlay.js`, a HUD
widget without an anchor in the top-left, plus `window.__game.net`):

per peer: role · transport (`public-torrent` / `public-nostr` / `worker`) · direct/relayed · RTT, jitter, loss %
and burst length (from INPUT/SNAPSHOT seq gaps) · snapshot Hz in / **wire** kbps in/out · state skips · interp delay (ms) · input lead + slack (ticks) ·
extrapolating? · reconcile error p50/p99 (cm, last 10 s) · snaps count · events/s · lastEventSeq · ctrl
bufferedAmount · clock offset ± · timebase epoch · build/proto/content of both sides · host tick vs local
estimate · matchmaker(s) in use. Candidate **types** only (host / srflx / relay, udp / tcp / tls) — **never
raw IP addresses or ports**, because screens are shared and streamed (a test renders the overlay with a fake
stats report containing IPs and asserts none appear). A tiny sparkline of RTT and error. `window.__game.net` exposes the same numbers for smoke/e2e assertions.

---

## 15. Testing

All new logic follows the house rule: **covered by tests, full `npx vitest run` + `npx vite build` green before
moving on.** New test files are named `tests/net.*.test.js`, `tests/race.fixedstep*.test.js`, etc.

| Layer | What | Where |
|---|---|---|
| Unit | codec round-trips + saturation, **timer fields vs every `TUNING` duration**, every message encode/decode (incl. TIMEBASE, FRAG), size caps (cap-case snapshot ≤ 1150 B), schema validation, fuzz (never throws), clock filter (offset within 2 ms under 50 ms jitter), **host timeline** (TIMEBASE resync, pause freeze, snapshot-arrival filter), **host clock** (rAF + pump, each tick once, alpha in [0,1), catch-up vs skip), heartbeat state machine, inputBuffer policy table (every row of §9.3), lead controller convergence (both directions), Hermite/extrapolation, reconciler (joint replay + smoothing + snap + Robo Driver hand-over), eventPlayer (dedupe, release at R, own-kart drop rules, `predicted` flag), lobby / host / guest reducers, approval queue + match check + lock-on-remove, **roomKey** (KDF vectors; label alone never yields the ids), **inviteLink** (parse, reject junk, fragment cleared, gate respected), roomCode, `canHost` platform fixtures, grid slots fairness, localizeSummary/localizeGp (predicted events never counted), composeSetup, playerLabel, contentHash stability, diagnose() incl. UDP blocked → "Relay needed", debug overlay never prints IPs, `scripts/worker.mjs` command planning | `tests/net.*.test.js` |
| Sim | fixed-tick golden (30/60/75/144 Hz + jitter identical), 144 Hz input-to-render latency ≤ 1 tick, rng state round-trip, captureSimState/applySimState bit-identical continuation, `checkSimStateShape` contract, entity ids unique, events carry ids, gridSlot placement, joint local `collideKarts`, predictTick = host in contact-free windows (bit-exact) and ≤ 1.5 m in disturbed windows, `Math.random` absent from sim path, battleSim/battleView and team split parity with v2 (same results for the same seed), all existing race/fairness/QA tests unchanged | `tests/race.*.test.js`, `tests/modes.*.test.js` |
| Node multi-peer sims | `tests/helpers/netHarness.js`: `runNetRace({ track, mode, houses: [[2],[1],[1]], cpus, laps, conditions, seed })` runs a real host Race + N guest ReplicaRaces over MemoryTransport with fake clock; scripted or CPU-brain inputs for "human" seats; it reports **wire bytes** (§4.1) | `tests/net.sim.test.js` |
| | Matrix: RTT 0 / 50 / 150 / 250 ms × loss 0 / 1 / 5 % (random) and **5 % in 3-packet bursts** × jitter 0 / 20 ms × reorder 0 / 10 % (+ 1 % duplication); modes Free Race (M1), GP (M2), Team + Battle (M3) | |
| | Asserts: every guest's final standings, finish places, lap times (ms) and RESULT are **identical** to the host's; localized summaries correct; each guest applied the exact host event seq list once (no gaps, no dups); final replica kart states within quantisation (≤ 4 cm) of host; own-kart reconcile error p99 ≤ 0.5 m outside contact windows at ≤ 150 ms (≤ 0.75 m under bursts); couch siblings `[[2]]` colliding locally: reconcile error ≤ 0.5 m; a press on the guest's visible GO earns the start boost; every press applied exactly once; remote render pose continuity (no frame-to-frame jump > 1.5 m at ≤ 5 % loss); timeline recovers within 1 s after pause / stall / starvation; wire-byte budgets of §9.4; no unhandled errors | |
| Session sims | join/approve (match check)/remove (→ locked, reload refused)/lock/unlock, approvals queued during a race, 8-human cap, dual matchmaker (host = worker + public / guest = public only; Worker down → public on both sides), reconnect with token mid-race (M2: RESYNC, control returns), guest drop → Robo Driver, host leave → graceful end, version mismatch reject, GP 4 races + ceremony sync (M2), rematch, emote rate limit, START under the realistic ctrl model | `tests/net.session.test.js` |
| Real WebRTC in node | optional `node-datachannel/polyfill` RTCPeerConnection (dynamic import; skipped with a clear message if missing or the binary won't load): two WebRtcTransports over an in-process signaling pair, negotiated channels 8/9 open, unreliable channel drops don't block ctrl, state backpressure skip with a real `bufferedAmount` | `tests/net.webrtc.node.test.js` |
| Worker | pure `roomReduce` + `guardReduce` in the main suite (any Node); full Worker via `@cloudflare/vitest-plugin` (Node 22+, `npm run worker:test`): Origin check (+ dev wildcard only for localhost/127.0.0.1), CORS on /health + /ice only, TURN in `joined` only for a room with a host, `/ice` rate limit 5/min + ttl 900, room creds never reused across rooms, ttl ≤ 1800, daily mint cap flips `/health.turn`, `:53` filtered, room caps/drop/lock/IP-hash block until unlock, forged Origin still hits the join cap, alarm GC | `infra/signal-worker/test/` |
| Browser e2e | `scripts/smoke-online.mjs` (Playwright, system Chrome, two contexts in one headless browser, `--disable-features=WebRtcHideLocalIpsWithMdns` + the swiftshader args): (a) public-signaling path against `scripts/dev/localTracker.mjs` (minimal WebTorrent-tracker WebSocket relay; never real public relays); (b) Worker path against `npm run worker:dev` on the port the script passes through. Scenario: enable online (test param bypasses the gate on localhost only), host + guest (2 players) join **by invite link** and once **by code + sweets using only controller events**, approve with match check, pick racers, Free Race 1 lap with autodrive, both reach results with identical standings, emotes in the lobby, rematch, remove guest (room locks). Measures **time from code entry to lobby**. Screenshots of every online screen. | `SMOKE_PORT=<p> node scripts/smoke-online.mjs` |
| Manual pre-release | `docs/ONLINE_CHECKLIST.md` (WS8): two real homes (or one home + phone hotspot) against the **real** public relays and, once it exists, the real Worker; invite link by text message; check connection on a UDP-blocking network; not run in CI | checklist, results pasted into the release PR |
| Soak | node: 3 houses × 2–3 players + CPUs, a full 4-race GP + 10 Free Races at 150 ms / 3 % loss / 20 ms jitter (fake time ≈ 40 min) with two 30 s snack breaks: memory buffers bounded, no drift in clock offset, zero divergence; browser: 10-minute two-context run, heap growth < 30 MB, no errors | `tests/net.soak.test.js` (`SOAK=1` long mode) |
| Regression | `dev/net-design/measure-*.mjs` baselines (snapshot size, event rate, prediction error) re-run in CI as a test with thresholds | `tests/net.baseline.test.js` |

CI: the main suite (incl. MemoryTransport sims) stays in `test-and-build`. Worker tests run in a separate job
on Node 24 only when `infra/signal-worker/**` changes. The online e2e runs locally before every online PR and
nightly in CI (never block on it, same as the smoke job).

---

## 16. Parallel workstreams (waves, ownership, interfaces)

Rule from ARCHITECTURE.md §3 applies: create files freely in your area, edit only what you own; tiny additive
touches elsewhere are called out in the PR and covered by a test. Branch names `net/<ws>` from the **latest
`origin/main`** (which by then contains this design and P0, plus the parallel v2.0.1 fixes: e.g. the racer
Boo Berry is now **Peekaberry**; never hard-code racer names in net tests, read them from the registry).
**All interfaces below are binding; change them only via a NETWORKING.md PR.**

### 16.0 P0 — shared contracts, landed with this design (before any wave forks)

Already in this PR, so no wave-1 stream has to wait for or guess another's shapes:
- `src/race/simState.types.js`: `SimState` / `KartSim` / `BattleSim` / `GumdropSim` / `RocketSim` JSDoc
  typedefs, `SIM_STATE_SHAPE` (field lists), `makeSimStateFixture(opts)` (canonical deterministic fixture:
  8 karts, boxes, optional gumdrops/rockets/battle) and `checkSimStateShape(state) → string[]`
  (`tests/race.simstate.types.test.js`).
- `scripts/worker.mjs` + root `package.json` scripts `worker:dev`, `worker:test`, `worker:deploy`,
  `worker:login`, `worker:secret` (Node 22+ check, first-use `npm ci` in `infra/signal-worker`, pinned
  wrangler, friendly "not built yet" until WS3 lands; `tests/scripts.worker.test.js`). So WS3 never edits the
  root `package.json`.
- `.gitignore`: `.dev.vars`.

### 16.1 Hotspot rules (merge conflicts are designed out)

| Hotspot | Rule |
|---|---|
| `package.json` / `package-lock.json` | **one owner per wave**: wave 1 WS4 (Trystero deps only; `node-datachannel` is never a dependency), wave 2 WS6 (QR encoder), wave 3 nobody. Scripts already landed in P0. |
| `src/main.js` | **one owner per wave**: wave 1 WS1 (tick loop + `buildKartModel(charDef, participant)` call + explicit seed; nothing else), wave 3 WS7 (online branches, `#join=` handling). Waves 2 streams never touch it. |
| `src/race/Race.js` and `src/modes/{battleSession,battle,teamSession,team}.js` | WS1 only (wave 1). |
| Settings schema (`onlineEnabled`, `approvalGate`, `relayOnly`) | WS6 owns `src/progress/schema.js` + the settings screen. WS4 receives `relayOnly` as a **parameter** of `join()` and never reads settings. |
| `SimState` shape | `src/race/simState.types.js` (P0). WS1 implements it, WS2 encodes it; changes go through this doc. |
| `src/net/constants.js` | WS2 creates it with every §19 net constant; later streams import, never redefine. Additive new constants are allowed with a test. |
| `src/game/events.js` `EVENTS` | WS1 adds `race-tick` and the new race event names in wave 1; nobody else edits it until wave 3 (WS7 may add online bus events). |
| `docs/INFRA_SETUP.md` | WS3 (wave 1). WS7 may only flip status rows in wave 3. |

### Wave 1 — sim refactor + pure new foundations (4 parallel streams)

**WS1 — Sim core** (`net/sim-core`). Owns: `src/race/{Race,Kart,AI,Items,ItemBoxes,KartFx}.js`,
new `src/race/{fixedStep,simState,predict,collide,itemSim,itemView,boxSim,boxView}.js`,
`src/input/InputLatch.js`, `src/modes/{battleSession,battle,teamSession,team}.js` and new
`src/modes/{battleSim,battleView}.js`, `src/game/setup.js` (rng params only), the tick-loop part of
`src/main.js`, `src/game/events.js` (new event names only), `tests/race.fixedstep*.test.js`,
`tests/race.simstate*.test.js`, `tests/race.predict*.test.js`, `tests/race.entities*.test.js`,
`tests/race.gridslot*.test.js`, `tests/modes.battlesplit*.test.js`. Delivers §8 completely, in this order,
one PR each: **(a, M1)** `race.tick / present / tickCount`, local fixed stepper + latency test, InputLatch
(item + hop/drift press counters), `makeRng` state + `Math.random` removal, `captureSimState / applySimState /
captureKart / applyKart` passing `checkSimStateShape`, `predictTick(localKarts, …)` + extracted
`collideKarts`, `ItemView` / `BoxView` split with entity ids + id-carrying events (`boxIndex`,
gumdrop/rocket spawn/despawn, `box-respawn`), Kid-Assist state on the kart, `assisted` / `robo` input flags,
`gridSlot` placement, `buildKartModel(charDef, participant)` paint hook, `MAX_GUMDROPS` / `MAX_ROCKETS`;
**(b, needed for M3 but merged in wave 1–2)** `battleSim` / `battleView` split (`battleSession.js` becomes a
thin wrapper; `captureSimState` fills `battle`) and the team host/all split. Must keep: every existing test
green, goldens unchanged, fairness test unchanged.

**WS2 — Wire foundations** (`net/wire`). Owns (all new): `src/net/{codec,messages,enums,schema,version,clock,
heartbeat,emotes,constants,frag,roomKey}.js`, `src/net/transport/{types,memory}.js`, `src/net/conditioner.js`,
`tests/net.codec*.test.js`, `tests/net.messages*.test.js`, `tests/net.schema*.test.js`, `tests/net.clock*.test.js`,
`tests/net.memory*.test.js`, `tests/net.frag*.test.js`, `tests/net.roomkey*.test.js`, plus the Vite `define`
for `__SK_BUILD__` (one additive line in `vite.config.js`). Codes the snapshot codec against
`makeSimStateFixture` (P0). Exports: `encodeSnapshot(simState, { houseTail, epoch }) / decodeSnapshot(bytes)`,
`encodeInput / decodeInput`, `encodeEvents(events) / decodeEvents`, `encodeCtrl(type, obj) / decodeCtrl(bytes)`
(incl. TIMEBASE, PAUSE with ticks, FRAG), `createFragmenter / createReassembler`, `MSG`, `EV`, `TIMER_FIELDS`,
`validate`, `createMemoryHub` (burst loss, realistic ctrl retransmit, wire bytes + SACKs), `createClockSync`,
`createHeartbeat({ wobblyMs: 3000, asleepMs: 8000 })`, `deriveRoomIds`, `SECRET_SWEETS`, `contentHash`,
`compatible`, `PROTOCOL_VERSION`, all constants.

**WS3 — Signal Worker** (`net/signal-worker`). Owns: `infra/signal-worker/**` (`wrangler.toml` name
`sprinkle-kart-signal`, `[[migrations]] tag="v1" new_sqlite_classes=["SignalRoom"]`, `[vars] ALLOWED_ORIGINS`,
`src/index.js`, `src/SignalRoom.js`, `src/room.js` (pure), `src/guard.js` (pure), `src/turn.js`,
`src/origin.js`, `.dev.vars.example`, `test/**`, own `package.json` + lockfile + `vitest.config.js` + `.nvmrc`
24), `scripts/worker.mjs` (after P0), `.github/workflows/worker.yml`, `tests/net.room*.test.js`,
`tests/net.guard*.test.js`, `docs/INFRA_SETUP.md`. Implements §4.2 exactly. Never deploys.

**WS4 — WebRTC + signaling adapters** (`net/webrtc`). Owns (new): `src/net/transport/webrtc.js`,
`src/net/signaling/{types,index,public,worker,relays,ice}.js`, `src/net/diagnose.js`,
`scripts/dev/localTracker.mjs`, `tests/net.webrtc*.test.js` (fake RTCPeerConnection + optional
node-datachannel), `tests/net.signaling*.test.js`, `tests/net.diagnose*.test.js`; root `package.json` +
`package-lock.json` for `@trystero-p2p/torrent`, `@trystero-p2p/nostr` (0.25.4, lazy). Talks to the Worker
protocol in §4.2 through a fake WebSocket server implementing it (not WS3 code), and to `deriveRoomIds`
through its §4.2 signature (a local stub until WS2 merges). Exports `createWebRtcTransport`,
`createPublicSignaling`, `createWorkerSignaling`, `chooseSignaling`, `fetchIceServers`, `runConnectionCheck`,
`describeCheck`.

### Wave 2 — netcode + session (2 parallel streams; need wave 1 merged)

**WS5 — Netcode engine** (`net/netcode`). Owns (new): `src/net/host/{hostDriver,hostClock,inputBuffer,
snapshotter,eventLog}.js`, `src/net/guest/{replicaRace,replicaItems,interpolation,reconcile,inputSender,
leadController,eventPlayer,inputHistory,hostTimeline}.js`, `src/net/tickPump.js`,
`tests/helpers/netHarness.js`, `tests/net.host*.test.js`, `tests/net.guest*.test.js`, `tests/net.sim*.test.js`,
`tests/net.timeline*.test.js`, `tests/net.hostclock*.test.js`, `tests/net.inputbuffer*.test.js`,
`tests/net.reconcile*.test.js`, `tests/net.baseline.test.js`. Interfaces:
```js
createHostClock({ now, tickHz: 60, maxPerCall: 6, maxBacklog: 30, onTimebase }) → { advance(nowMs) → { ticks, alpha },
                   pause(), resume(), usePump(on), state() }            // one accumulator, rAF or pump drives it (§9.9)
createHostDriver({ race, transport, houses /* houseId → { peerId, karts: kartId[] } */, localInputs: (tick) => DriveInput[],
                   clock /* hostClock */, onEvent /* host-side presentation */, snapshotEvery: 2 }) → { frame(nowMs) → { alpha },
                   onMessage(peerId, ch, bytes), pauseAll(on), setHouseRobo(houseId, on), stats(), dispose() }
class ReplicaRace { constructor({ scene, trackDef, path, builtTrack, setup /* NetRaceSetup */, localKartIds,
                   buildKartModel, onEvent }); // Race read API: karts, getPlayerKart, getStandings (host places), state,
                   // countdown (P timeline), time, clock, lapsTotal, path, racingLine, rules, modeInfo, gameplay, lastDt,
                   // items.bursts, rng: null
                   onSnapshot(snap), onEvents(batch), onResync(r), frame(frameDt, localInputs), present(alpha, frameDt), dispose() }
createHostTimeline({ clock }) → { onTimebase(tb), onPause(tick), onResume(tick), onSnapshot(tick, epoch, recvMs), tickAt(ms), paused, epoch }
createGuestDriver({ replica, transport, clock, timeline, localSeats }) → { frame(dt), onMessage(peerId, ch, bytes), stats(), dispose() }
runNetRace(opts) → { host, guests[], results, events, metrics /* incl. wire kbps per flow */ }   // tests/helpers/netHarness.js
```

**WS6 — Session, lobby & screens** (`net/session`). Owns: new `src/net/session/{hostSession,guestSession,lobby,
roomCode,inviteLink,localize,composeSetup,playerLabel,approval,modes}.js`, `src/net/platform.js`, new screens
`src/ui/screens/{online,codeEntry,onlineLobby,checkConnection,netWaiting,inviteGate}.js` + their CSS files,
`src/net/debugOverlay.js`; additive edits to `src/ui/Menus.js` (net role, `resolveCurrent`, `_finish` hook),
`src/ui/screenFlow.js` (`menuEntry.when`), `src/ui/menuState.js` (`joinReduce` capacity), `src/config.js`
(`MAX_LOCAL_PLAYERS`, `MAX_HUMANS`, 8 `PLAYER_COLORS`), `src/progress/schema.js` + `src/ui/screens/settings.js`
(`onlineEnabled`, `approvalGate`, `relayOnly`, privacy sentence), `src/modes/menus.js` (online mode filter),
label call sites → `playerLabel`; root `package.json` + lockfile for the QR encoder; tests
`tests/net.session*.test.js`, `tests/net.lobby*.test.js`, `tests/net.localize*.test.js`,
`tests/net.screens*.test.js`, `tests/net.invite*.test.js`, `tests/net.platform*.test.js`,
`tests/net.gridslot*.test.js` (composeSetup side), `tests/net.tone.test.js`. Interfaces:
```js
createHostSession({ transport, signalings, progress, rng, now, secret }) → { state, dispatch(ev), onEffect(fn), lobby() }
createGuestSession({ transport, signalings, secret, localPlayers, now }) → same shape
lobbyReduce(lobby, action) → lobby     // actions: house-join/leave/approve/remove(→ lock), seat-join/leave, pick, ready, lock, unlock, choice, phase
approvalReduce(queue, ev) → { queue, prompt|null }   // queues while racing; match-check pair per request
localizeSummary(hostSummary, localPis) → RaceSummary ;  localizeGp(gp, localPis) → GrandPrixResult
composeOnlineSetup(lobby, hostChoice, { seed, raceId, cpuIds, rules, gp? }) → NetRaceSetup   // incl. gridSlot (§8.6)
makeRoomSecret(rng) → RoomSecret ; parseRoomCode(text) → label|null ; codeEntryReduce(state, ev)
makeInviteLink(secret, baseUrl) → string ; parseInviteFragment(hash) → RoomSecret|null
canHost({ userAgent, platform, maxTouchPoints }) → boolean
playerLabel(pi, { localPis, lobby, characters }) → string
```

### Wave 3 — integration + quality (2 parallel streams)

**WS7 — Online game integration** (`net/integration`). Owns: `src/main.js` online branches (`runOnlineHost`,
`runOnlineGuest`, `startRace({ net })`, host clock wiring, results/GP/ceremony broadcast, online pause,
`#join=` read-and-clear at start-up, ignore `?simspeed` / `?autodrive` / quick-start online),
`src/game/session.js` (`allHumans`, `isAnyHuman`, `isLocal`), progress wiring so goal counters use host stats
(§9.6), `src/systems/netEmotes.js`, `src/systems/netHud.js` (wobbly/robo flashes, "Finish! ✨" hold),
README "Online play" section (replaces "Coming soon") + CHANGELOG, `tests/net.integration*.test.js`,
`tests/helpers/headlessSession.js` (additive: `runHeadlessNetSession`). Glue only: all logic comes from WS5/WS6.

**WS8 — E2E, soak & CI** (`net/qa`). Owns: `scripts/smoke-online.mjs`, `scripts/smoke-online-plan.mjs`,
`tests/net.soak.test.js`, `tests/net.e2eplan.test.js`, `.github/workflows/ci.yml` (additive: optional worker
test job + nightly online e2e), `CONTRIBUTING.md` online testing section, `docs/ONLINE_CHECKLIST.md`. Starts in
wave 3 against the WS5/WS6 harnesses and WS4's localTracker, finishes after WS7.

Dependency summary:

| Wave | Streams | Needs |
|---|---|---|
| (P0) | shared contracts in this design PR | – |
| 1 | WS1 sim core · WS2 wire · WS3 worker · WS4 webrtc | P0 only (interfaces in this doc) |
| 2 | WS5 netcode · WS6 session/screens | WS1(a) + WS2 (WS5); WS2 + WS4 (WS6); WS1(b) only for WS5's M3 matrix rows |
| 3 | WS7 integration · WS8 e2e/soak | everything |

### 16.2 Ship ladder (the family can play before everything is done)

Every stream delivers its **M1 scope first** as its main PR; M2 and M3 items are follow-up PRs from the same
stream (`net/<ws>-m2`, `net/<ws>-m3`) after M1 is merged. The Online menu shows only `ONLINE_MODES`, so an
unfinished mode is simply not offered.

| Milestone | What the family gets | Scope | Acceptance |
|---|---|---|---|
| **M1 — "Play with friends"** | Free Race online, each house 1–4 players, invite link / code + sweets, approval with match check, lock and remove, Check connection, Worker and public paths with fallback, Pause everyone, Robo Driver on drop-out | WS1(a), WS2, WS3, WS4, WS5 (Free Race), WS6 (no FOCUS), WS7 (Free Race), WS8 (M1 e2e) | §17 M1-1 … M1-20 |
| **M2 — "Cups together"** | Grand Prix + My Cup online with standings and podium ceremony; reconnect within 60 s (token + RESYNC) | WS5 RESYNC, WS6 GP screens + tokens, WS7 GP/ceremony broadcast, WS8 GP e2e | §17 M2-1 … M2-5 |
| **M3 — "Everything"** | Team Race, Bubble Battle, Fair host toggle, FOCUS preview, in-race emotes | WS1(b), WS5 battle/team rows + Fair host, WS6 FOCUS + in-race emotes UI, WS7 wiring, WS8 soak | §17 M3-1 … M3-5 |

---

## 17. Acceptance criteria (measurable)

Each milestone (§16.2) is done when **all** of its items hold (each has a test or a scripted measurement).
All bandwidth numbers are wire bytes (§4.1).

### M1 — Play with friends (Free Race)

1. **M1-1** Full `npx vitest run`, `npm run test:coverage`, `npx vite build`, `node scripts/smoke.mjs` green;
   offline gameplay at 60 Hz unchanged (goldens + fairness + QA registry tests untouched).
2. **M1-2** Fixed tick: identical race results for the same seed at 30/60/75/144 Hz render rates and ±4 ms
   jitter; at 144 Hz input reaches a tick within ≤ 1 tick (`tests/race.fixedstep.latency.test.js`).
3. **M1-3** `captureSimState → applySimState` continuation bit-identical over 600 ticks on 5 tracks, and the
   output passes `checkSimStateShape`.
4. **M1-4** Snapshot ≤ 1150 B at the cap-case (≈ 730 B); typical 8-kart snapshot ≤ 460 B; INPUT ≤ 160 B worst
   case (141 B); every `TUNING` timer fits its wire field (`tests/net.codec.timers.test.js`).
5. **M1-5** Bandwidth (netHarness, 7 guests, 8 karts, wire bytes incl. SACKs): guest upload ≤ 45 kbps with 1
   local player and ≤ 90 kbps with 4; guest download ≤ 140 kbps typical and ≤ 220 kbps at the cap-case; host
   upload ≤ 1.0 Mbps typical and ≤ 1.6 Mbps at the cap-case; ctrl < 3 kbps average in race; LOBBY ≤ 4 sends/s
   per guest.
6. **M1-6** Convergence matrix (§15) for Free Race: 0/50/150/250 ms × 0/1/5 % random loss and 5 % in 3-packet
   bursts × jitter × reorder — every guest's RESULT, finish order and lap times (ms) identical to the host;
   event seq applied exactly once; no errors.
7. **M1-7** Prediction: own-kart reconcile error p99 ≤ 0.5 m outside contact windows (≤ 0.75 m under bursts)
   and ≤ 2 m inside, at ≤ 150 ms RTT; two local karts on one guest machine colliding: error ≤ 0.5 m; zero added
   input delay (input sampled and applied in the same frame as offline).
8. **M1-8** Interpolation: remote karts show no frame-to-frame jump > 1.5 m at 5 % loss + 20 ms jitter; interp
   delay settles within 70–150 ms and at 100 ± 15 ms for 50 ms RTT / 5 ms jitter.
9. **M1-9** Clock and start: host-tick estimate within ±1 tick after 2 s at 150 ms RTT / 20 ms jitter; GO on
   each machine's prediction timeline lands on host tick `goTick` ± 1; a press exactly on a guest's visible GO
   earns the rocket start on the host (`tests/net.timeline.go.test.js`, RTT 0–250 ms); the finish place and
   celebration appear only after the host's `finish` event.
10. **M1-10** Timebase: after a 30 s "Pause everyone", a 400 ms host stall and a 3 s host starvation, every
    guest's estimate is within ±1 tick of the host within 1 s; input lead ≤ target + 2 ticks; the host runs
    every tick exactly once with `alpha ∈ [0, 1)` under interleaved rAF + pump (`tests/net.hostclock.test.js`).
11. **M1-11** Missing input: 1.5 s outage → Robo Driver within 1.6 s, control back within 1 tick of resume;
    10 000 presses (item + hop/drift) under 5 % bursty loss are each applied exactly once, ≤ 6 ticks late; a
    double tap gives 2 presses on consecutive ticks; no phantom press after Robo Driver or reconnect.
12. **M1-12** Privacy: the §1 rule-6 sentence (friends, public matchmaking services or our server can see your
    internet address; no names, chat or accounts) is shown before online can be switched on; NETWORKING.md §3
    names the public services; the tone test covers the sentence; the debug overlay and "For grown-ups" rows
    never show an IP address (test with a fake stats report containing IPs).
13. **M1-13** Session: 8-human cap; 4 houses × 2 players join; approval shows the matching 2-emoji check on
    both screens; approvals that arrive during a race are queued until results; lock/unlock; remove seat and
    remove house.
14. **M1-14** Progress: guests never record the host's wins (localize tests); `multiplayerRaces` counts online
    races; each machine's unlock gates respected; a predicted event the host contradicted never increments a
    goal counter.
15. **M1-15** Version: proto or content mismatch → REJECT `version` with the friendly text; different build same
    content connects.
16. **M1-16** Worker: `worker:test` green on Node 24 — Origin rejection (+ dev wildcard only for localhost /
    127.0.0.1), CORS scope, `/health` shape `{ ok, turn, version }`, TURN only inside a hosted room's `joined`,
    `/ice` rate-limited (5/min per IP) with ttl ≤ 900 s, room credentials never reused across rooms, ttl ≤ 1800 s,
    daily mint cap, `:53` filtering, caps 1+7, drop, lock, per-room join cap reached even with a forged Origin;
    the main suite covers `roomReduce` and `guardReduce`.
17. **M1-17** Kid safety: online hidden until the parent-gate toggle; an invite link on a machine with online
    off shows the "ask a grown-up" screen and never bypasses the gate; the fragment is cleared from the URL
    after use; no free-text field in any schema (test enumerates schemas); tone test over all new strings;
    emote rate limit; the room ids cannot be computed from the label alone (`tests/net.roomkey.test.js`); a
    stranger who watches the public relays sees no room label and cannot read offers, and cannot join without
    host approval; after a remove the room is locked, and a reload of the removed house cannot rejoin until the
    host re-opens **and** approves.
18. **M1-18** Matchmaker fallback: host on a Worker build + guest on a public-only build meet; Worker `/health`
    down → both sides use public signaling; "couldn't find that room" offers "ask everyone to refresh".
19. **M1-19** E2E: `smoke-online.mjs` passes both paths (local tracker, local `worker:dev`): join by invite link
    and once with controller events only (code + sweets entry, approval, lobby emotes); two contexts race one
    lap and show identical standings; **code entry → lobby ≤ 10 s p90 on the Worker path and ≤ 20 s p90 on the
    public path** (10 runs each, local harness); Check connection with UDP blocked (fake ICE) reports "Relay
    needed"; screenshots of hub, code entry, lobby, approval, check connection, race (both viewports), results
    reviewed.
20. **M1-20** Docs: NETWORKING.md + INFRA_SETUP.md + README "Online play" + CHANGELOG match the code
    (`tests/docs.networking.test.js`, `tests/docs.readme.test.js`); the manual real-relay checklist
    (`docs/ONLINE_CHECKLIST.md`) is filled in once before the M1 release; node soak (10 Free Races, 150 ms / 3 %
    loss, two 30 s snack breaks) with zero divergence and bounded buffers.

### M2 — Cups together

21. **M2-1** Convergence matrix rows for Grand Prix (4 races + ceremony): standings, points and podium identical
    on every machine.
22. **M2-2** `localizeGp`: a guest is never credited `cupsWon` for another house's win; its own win is credited.
23. **M2-3** Reconnect with token mid-race within 60 s restores seats and control (RESYNC as paced FRAG pieces,
    input baseline reset, no phantom presses) — also while the room is locked.
24. **M2-4** Host leave → all guests on the hub within 9 s with the friendly text.
25. **M2-5** Soak: 40 simulated minutes (full GP + 10 Free Races) at 150 ms / 3 % loss with zero divergence,
    bounded buffers.

### M3 — Everything

26. **M3-1** Convergence matrix rows for Team Race and Bubble Battle pass (battle block, pops, ranking, end).
27. **M3-2** Offline parity of the battle/team splits: same seed → same results as v2.
28. **M3-3** Fair host: the host's local inputs are delayed by `min(50 ms, median guest RTT/2)` ± 1 tick when on;
    off by default.
29. **M3-4** FOCUS preview ≤ 2 Hz, ids only; in-race emotes rate-limited and off by default under Kid-Assist.
30. **M3-5** Browser soak: 10-minute two-context run, heap growth < 30 MB, no errors.

---

## 18. Risks and open questions

| Risk | Mitigation |
|---|---|
| Public signaling is flaky this month (Trystero #196; appId-seeded Nostr relays all broken in one report; 2 of 5 default trackers down) | torrent first with 3 pinned live trackers, Nostr fallback after 6 s, lists in config, Check connection says which failed; with a Worker build the host is on both matchmakers; the Worker is the reliable path (recommend the grown-up does INFRA_SETUP) |
| Symmetric NAT / school Chromebooks (UDP blocked by policy) / hotspots | TURN over TCP/TLS 443 via the Worker; Check connection reports "Relay needed"; friendly NAT-failure screen |
| Hidden or stalled host tab | one host clock, rAF when visible + Worker pump when hidden; catch-up, then skip + TIMEBASE; PAUSE reason 1 + banner |
| iOS suspends WebRTC in background | iPads/iPhones join only, never host (`canHost` with the iPadOS desktop-UA rule); tap-to-reconnect + 60 s window (M2) |
| Trystero mesh opens guest↔guest links | closed immediately after `sk-role`; Worker path is a pure star |
| Unreliable message > ~1191 B is fragmented and fragile | caps + codec test ≤ 1150 B |
| One big ctrl message stalls snapshots (no RFC 8260 interleaving) | FRAG ≤ 1 KB pieces paced one per tick during races; big results only between races |
| Bursty Wi-Fi loss eats all useful input copies | press counters (never lost, only late), slack target 4 under loss, burst rows in the matrix |
| Prediction error in contact windows (≤ 1.4 m measured) | smoothing τ 100 ms, snap > 4 m; contact is 0–1.4 % of ticks; local siblings collide in prediction |
| Presentation systems assume "human = on this screen" | keep `humans/isHuman` local; `allHumans` for rules |
| GP/summary code credits any human | `localizeSummary` / `localizeGp` mandatory before any online `race-end` / `gp-end`; counters only from host stats |
| wrangler needs Node 22+, local default Node 20 | worker has its own package + `.nvmrc`; `scripts/worker.mjs` checks the Node version and uses the pinned wrangler |
| Someone with the invite link who is not a friend | approval is mandatory, shows the match check, can require a grown-up; removal locks the room. We state plainly that approval — not the code — is the final barrier. |
| TURN quota abuse via a leaked Worker URL | TURN only for hosted rooms (unguessable ids), `/ice` rate-limited with short ttl, daily mint cap, Cloudflare usage notification (INFRA_SETUP) |
| Worker down / over free quota / cached old builds | dual matchmaker + fallback (§3), "ask everyone to refresh" |
| Scope too large for one release | ship ladder M1 → M3 (§16.2); `ONLINE_MODES` hides unfinished modes |
| Open: emotes during races for small kids | M3, default off under Kid-Assist; revisit after family playtest |
| Open: "Fair host" default | M3, off; revisit with measured `hostAdvantageMs` |
| Open: 6 secret sweets typed on a controller | invite link is the main path; if families find 6 picks too slow, raise `ROOM_KDF_ITERATIONS` and drop to 5 sweets (still ≈ 2⁴⁸) — a constants change, measured with the e2e time-to-lobby |

---

## 19. Constants (one table)

| Name | Value | Home |
|---|---|---|
| `TICK_HZ` / `TICK_DT` / `MAX_TICKS_PER_FRAME` | 60 / 1/60 / 6 | `src/race/fixedStep.js` |
| host `maxPerCall` / `MAX_BACKLOG_TICKS` / pump takeover | 6 / 30 ticks (500 ms) / rAF gap > 50 ms | `src/net/host/hostClock.js` |
| physics sub-step | 1/120 (2 per tick, unchanged) | `src/race/tuning.js` |
| `SNAPSHOT_EVERY` | 2 ticks (30 Hz), 15 Hz under sustained backpressure | `src/net/host/snapshotter.js` |
| `INPUT_EVERY` / ticks per INPUT | 2 ticks (30 Hz) / `clamp(slackTarget + 4, 4, 8)` | `src/net/guest/inputSender.js` |
| `INTERP_DELAY` | start 100 ms, clamp 70–150 ms, slew 1 ms / 100 ms | `src/net/guest/interpolation.js` |
| `MAX_EXTRAPOLATION` | 250 ms | same |
| `RECONCILE_TAU` / heading τ / snap | 100 ms / 80 ms / 4 m or 0.6 rad | `src/net/guest/reconcile.js` |
| `LEAD_TARGET_SLACK` / under loss / dilation | 2 ticks / 4 ticks (loss > 2 % or bursts) / ±3 % | `src/net/guest/leadController.js` |
| input hold / coast / Robo Driver / stale press drop | 250 ms / → 1.5 s / after 1.5 s / 250 ms | `src/net/host/inputBuffer.js` |
| timebase | TIMEBASE at start, pause, resume, skip and 1 Hz; resync if > 1 tick off or median residual > 3 ticks × 5 | `src/net/guest/hostTimeline.js` |
| heartbeat | ping 4 Hz lobby, 2 Hz race; wobbly 3 s; asleep 8 s | `src/net/heartbeat.js` |
| reconnect window | 60 s (M2) | `src/net/session/*` |
| approval timeout | 120 s | `src/net/session/approval.js` |
| ICE connect timeout | 15 s (1 ICE restart) | `src/net/transport/webrtc.js` |
| public fallback / guest dual start | torrent → + nostr after 6 s / public 4 s after Worker | `src/net/signaling/` |
| `MAX_STATE_BYTES` / `MAX_CTRL_BYTES` / `CTRL_FRAGMENT_BYTES` | 1150 / 16384 / 1024 | `src/net/constants.js` |
| `STATE_BUFFER_LIMIT` | max(1024, 2 × last state message) | `src/net/transport/webrtc.js` |
| `WIRE_OVERHEAD_BYTES` / TURN UDP / TURN TLS / `SACK_BYTES` | 93 / 97 / 150 / 93 (16 bundled) | `src/net/constants.js` |
| memory ctrl retransmit | max(RTT + 3 snapshot intervals, `RTO_MIN_MS` 300), ×2 per repeat, cap 3 s | `src/net/transport/memory.js` |
| channel ids | state 8 (unordered, 0 retransmits), ctrl 9 (reliable) | `src/net/transport/webrtc.js` |
| `MAX_LOCAL_PLAYERS` / `MAX_HUMANS` / karts | 4 / 8 / 8 | `src/config.js` |
| `MAX_GUMDROPS` / `MAX_ROCKETS` | 24 / 8 | `src/race/itemSim.js` |
| room label | 32 words × 4 digits (`SPRINKLE-4821`) | `src/net/session/roomCode.js` |
| secret sweets / `ROOM_KDF_ITERATIONS` | 6 of 64 (36 bits; 54 with the label) / 150 000 (PBKDF2-SHA256) | `src/net/roomKey.js` |
| match check | 2 of 32 animals, fresh per request | `src/net/session/approval.js` |
| emote rate | 1 / 1.5 s / player | `src/net/emotes.js` |
| TURN ttl (room / `/ice`) / cache / daily cap | 1800 s / 900 s / ≤ 5 min per room / `TURN_DAILY_MINTS` 500 | `infra/signal-worker/src/turn.js` |
| Worker caps | 1 host + 7 guests per room, 16 KiB msgs, 50 msg/s/socket, 12 joins/min/room, 30 joins/min/IP, `/ice` 5/min/IP, room GC 2 h | `infra/signal-worker/src/{room,guard}.js` |
| `PROTOCOL_VERSION` | 1 | `src/net/version.js` |

---

## 20. Sources

Research accessed 2026-09-26 (audit C): MDN `RTCPeerConnection.createDataChannel` and "Using data channels";
J. Fisher, "WebRTC DataChannel reliability" (2017); Cloudflare Realtime DataChannels docs; discuss-webrtc "Max
size of unreliable DataChannel packages (MTU)"; webrtc/dcsctp; Trystero repo, docs (signaling strategies) and
issue #196; Langoyo/inazuma-showdown PR #24; npm registry (trystero 0.25.4, wrangler 4.141.0,
@cloudflare/vitest-plugin 1.2.8, node-datachannel 0.33.4, werift 0.24.4); peerjs.com/server/cloud; Cloudflare
Workers limits, Durable Objects pricing / WebSocket best practices / migrations (updated 2026-09-22) / vitest
integration; Cloudflare Realtime TURN (generate-credentials, pricing); actions/deploy-pages; Valve "Source
Multiplayer Networking" (mirror); Gaffer on Games "Snapshot Interpolation" and "Deterministic Lockstep";
macwright.com "Math keeps changing" (2020); scrapfly "Browser math OS fingerprint"; "Game networking 2: time,
tick, clock synchronisation"; Chrome "Timer throttling in Chrome 88"; Apple Developer Forums 774239 / 799259;
webrtcHacks Safari guide; murat-dogan/node-datachannel. Local measurements: branch `net-audit/sim-measure`.

Design review (revision 2) additionally relies on standard references: RFC 4960 / RFC 9260 (SCTP: SACK,
fast retransmit after 3 gap reports, RTO), RFC 3758 (PR-SCTP, `maxRetransmits: 0`), RFC 8260 (message
interleaving, not assumed), RFC 8831 (WebRTC data channels), RFC 8018 (PBKDF2), the Gilbert–Elliott burst-loss
model, and the WebKit iPadOS "desktop-class browsing" user agent (`MacIntel` + `maxTouchPoints > 1`).
