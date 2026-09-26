# Sprinkle Kart — Online Play Design (NETWORKING.md)

Status: **design, binding for the online-play workstreams** (v2.x → v3.0). Owner: networking architect.
Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) (module contracts; §12 points here),
[docs/INFRA_SETUP.md](docs/INFRA_SETUP.md) (the grown-up's one-time Cloudflare setup; the infra names below
are copied from it and must stay identical), [CONTRIBUTING.md](CONTRIBUTING.md) (git + test rules).

The design rests on three code audits done on `origin/main` @ 106e2ad: **A** simulation (with measurement
scripts on branch `origin/net-audit/sim-measure`: `dev/net-design/measure-sim.mjs`,
`measure-quant-reconcile.mjs`), **B** session/menus/progress, **C** technology research (sources in §20).
Numbers marked **(measured)** come from those scripts; they are the regression baseline.

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
| G8 | Online never breaks local play: with online off the game is byte-for-byte the v2 experience and every existing test passes unchanged. | full suite |

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
2. **Friends-only room codes.** Codes look like `SPRINKLE-4821`: a word from a fixed list of 32 cute words
   (`SPRINKLE`, `CUPCAKE`, `GUMDROP`, …) + 4 digits = 320 000 codes. Rooms are never listed anywhere. Codes are
   entered with the controller (word wheel + digit wheels) or keyboard.
3. **The host approves every new house** ("🏡 A new house wants to join! Let them in?") — default on;
   the host can also **lock** the room ("No more houses, please").
4. **No free text anywhere.** No typed names, no chat. Remote players are labelled with their house
   emoji + racer name ("🏡 Luna Lollicorn"). Communication = 8 **preset emotes** (§10.7). Every string in
   every network message is validated against a registry or an enum; anything else is dropped (§6.4).
5. **The host can remove a house or a single player** at any time; removed peers are blocked for the rest of
   the session (and by the Worker for that room).
6. **No personal data leaves the machine.** Peer ids are random per session; no analytics; no names.
   WebRTC does reveal a machine's internet address to the other players (like any video call) — the
   Grown-ups screen says so in one friendly sentence, and when our TURN relay is available it offers
   **"Hide our address (use the relay)"** (`iceTransportPolicy: 'relay'`).
7. **Friendly words only**, also in errors ("The host's house went to sleep 😴" rather than
   technical or scary wording). A friendly-words test (`tests/net.tone.test.js`, same word list as the existing screen/track tone checks) runs over every new string.
8. **Rate limits** on emotes (1 per 1.5 s per player), joins (Worker: per IP and per room) and message sizes.

---

## 2. Topology and rationale

**Host-authoritative star over WebRTC data channels.** The host is one player's browser. Every guest
machine connects only to the host (never to other guests).

```
            guest house B (2 players)            guest house C (1 player)
                     \   inputs 60 Hz ↑  ↓ snapshots 30 Hz + events   /
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
| **Host-authoritative star, snapshots + interpolation + prediction** | **Chosen** | Tolerates cross-browser float differences (only the host simulates the truth), hides latency for your own kart, costs nothing to run, ≤ 8 humans fits one home uplink (≈ 0.6–0.8 Mbps, §9.4). |
| Deterministic lockstep | Rejected | Sim is chaotic and not bit-reproducible across engines: ECMAScript Math.sin/cos/atan2/pow/exp are "implementation-approximated" (V8 ≠ SpiderMonkey ≠ JSC), Kart/Items/AI/TrackPath call them ~49 times; **(measured)** ±2 ms of dt jitter already changes the winner. Also adds input delay = worst RTT for everyone. |
| Rollback (GGPO-style) | Rejected | Same determinism problem, plus hidden state in CPU brains/WeakMaps and 8 karts × re-sim cost. |
| Full mesh P2P | Rejected | 28 links for 8 machines, no single truth for items/CPUs, NAT failure probability multiplies. |
| Dedicated server / SFU | Rejected (non-goal) | Costs money/ops; Cloudflare free plan cannot run a 60 Hz sim; the family wants "host this". |

Why star is fair enough for kids: with the **input lead** (§9.2) a guest's inputs reach the host *before*
the tick they belong to, so the host simulates a guest's own driving exactly on time — racing lines, drifts,
boost pads and finish times are not handicapped by latency. The only asymmetry is how early you *see*
others (§9.8).

---

## 3. Stack (binding infrastructure)

Everything here matches docs/INFRA_SETUP.md; names are exact and tested (`tests/docs.networking.test.js`).

| Layer | Choice | Notes |
|---|---|---|
| Game hosting | **GitHub Pages** `https://rillyboss.github.io/sprinkle-kart/` via `.github/workflows/pages.yml` | pages.yml passes repo variable `VITE_SIGNAL_URL` into the build. Vite `base: './'`. |
| Signaling (default, zero setup) | **Public signaling** via Trystero **0.25.4**: `@trystero-p2p/torrent` first, then `@trystero-p2p/nostr` after 6 s without a peer | Behind `SignalingTransport` (§4.2). Lazy-loaded chunk (~20–24 KB gzip each), only after the player opens Online. Tracker/relay lists live in `src/net/signaling/relays.js` (config, not code). Import from `@trystero-p2p/*` — `trystero/<strategy>` subpaths now throw. |
| Signaling (ours) | **Cloudflare Worker** `infra/signal-worker/`, `wrangler.toml` `name = "sprinkle-kart-signal"`, SQLite-backed Durable Object class **`SignalRoom`** via `[[migrations]] tag = "v1"`, `new_sqlite_classes = ["SignalRoom"]` (never mix with the `[exports]` style) | Free-plan compatible (Hibernation WebSocket API). Endpoints `GET /health` → `{ ok, turn, version }`, `GET /ice` → ICE servers incl. short-lived Cloudflare TURN creds, `GET /room/:code` → WebSocket signaling. `vars.ALLOWED_ORIGINS = "https://rillyboss.github.io,http://localhost:5173"`. |
| Selection | The game uses the Worker **iff** build-time `import.meta.env.VITE_SIGNAL_URL` is non-empty; otherwise public signaling. | `src/net/signaling/index.js chooseSignaling()`; dev override `?signal=worker&signalUrl=…` / `?signal=public&relays=…` only on localhost / dev builds (for e2e). |
| TURN | **Cloudflare Realtime TURN**; the Worker mints creds with secrets `TURN_KEY_ID` + `TURN_KEY_API_TOKEN`: `POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers`, `Authorization: Bearer {TURN_KEY_API_TOKEN}`, body `{"ttl": 14400}` | Filter out `:53` URLs; cache per isolate ≤ 5 min; `/health.turn` is true only when both secrets exist. **Secrets never in the repo.** Without the Worker: public STUN only (`stun:stun.cloudflare.com:3478`, `stun:stun.l.google.com:19302`). |
| Worker CI | Optional `.github/workflows/worker.yml` (cloudflare/wrangler-action@v4) runs only when secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` exist (job-level `if:` on an env mirror of the secret). | The Cloudflare account does **not** exist yet — nothing is deployed by any workstream. |
| npm scripts (root) | `worker:dev` (local `wrangler dev`, no account), `worker:test` (`@cloudflare/vitest-plugin` 1.2.8), `worker:deploy` | Worker has its own `infra/signal-worker/package.json` + lockfile (wrangler 4.141.x) so root `npm ci` stays light. **wrangler ≥ 4.88 needs Node 22+** (CI uses 24; locally `nvm use 25.4.0`); scripts print a friendly error on older Node. INFRA_SETUP "Node 20" is corrected by WS3. |
| Runtime deps | `three` (existing) + the two lazy Trystero packages | A documented exception to "no new runtime deps" (house style): they load only inside the online chunk. The netcode itself (codec, interpolation, prediction) is hand-written. |
| Test deps | vitest (existing), Playwright (existing), optional `node-datachannel@0.33.4` (skipped if its binary won't load) | Worker tests run under Node 22+ only (`worker:test`); the pure room logic is also tested by the main suite on any Node. |

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
transport drops and counts larger ones), ≤ `MAX_CTRL_BYTES = 16384` on `ctrl`. On `ctrl`, when
`bufferedAmount > 256 KiB` the transport queues and waits for `bufferedamountlow` (threshold 64 KiB); on
`state`, when `bufferedAmount > 64 KiB` it **drops** (a stale snapshot is worthless).

**MemoryTransport** (`src/net/transport/memory.js`): `createMemoryHub({ seed, now, schedule })` →
`hub.endpoint(peerId, role)` returns a `NetTransport`; `hub.link(a, b)`; `hub.setConditions(from, to,
{ latencyMs, jitterMs, loss, duplicate, reorder, bandwidthKbps })`. It uses an injected clock/scheduler so
vitest fake timers or a manual `hub.advance(ms)` drive it deterministically (seeded mulberry32). `state` is
lossy/reorderable/duplicable; `ctrl` is reliable-ordered: a "lost" ctrl packet is delivered after an extra
`2 × latency` (retransmit) and everything behind it waits (head-of-line blocking, like SCTP).

**WebRtcTransport** (`src/net/transport/webrtc.js`): `createWebRtcTransport({ signaling, role, selfId,
iceServers, RTCPeerConnectionImpl? })`. For every `RTCPeerConnection` the signaling yields, it creates two
**negotiated** channels on both sides (no renegotiation, works on Trystero's connection too):

| Channel | Options | Id | Carries |
|---|---|---|---|
| `sk-state` | `{ negotiated: true, id: 8, ordered: false, maxRetransmits: 0 }` | 8 | INPUT, SNAPSHOT, PING, PONG |
| `sk-ctrl` | `{ negotiated: true, id: 9, ordered: true }` | 9 | everything else |

Ids 8/9 avoid Trystero's auto-assigned id 0/1 for its own `"data"` channel (which we ignore). `binaryType =
'arraybuffer'`. A peer counts as joined when **both** channels are `open`. `stats().relayed` comes from
`getStats()` (selected candidate pair type `relay`), polled every 5 s for the debug overlay and Check
connection.

### 4.2 `SignalingTransport` — `src/net/signaling/types.js`

```js
/**
 * @typedef {object} SignalingTransport
 * @property {'public'|'worker'} kind
 * @property {(o: { code: string, role: 'host'|'guest', selfId: string, iceServers: RTCIceServer[],
 *            relayOnly?: boolean }) => Promise<void>} join     rejects with SignalingError { code: 'unreachable'|'no-host'|'host-exists'|'full'|'kicked'|'bad-origin'|'timeout' }
 * @property {(fn: (p: { peerId: string, pc: RTCPeerConnection }) => void) => () => void} onPeerConnection
 * @property {(fn: (peerId: string) => void) => () => void} onPeerLeave
 * @property {(peerId: string) => void} block      host only: never connect this peer again this session
 * @property {() => Promise<void>} leave
 */
export async function fetchIceServers(): Promise<{ iceServers: RTCIceServer[], turn: boolean }>  // worker: GET /ice; public: STUN defaults
```

**WorkerSignaling** (`src/net/signaling/worker.js`, `createWorkerSignaling({ baseUrl, WebSocketImpl,
fetchImpl, RTCPeerConnectionImpl })`): opens `wss://…/room/<code>?role=host|guest&peer=<selfId>&proto=1`.
**The guest is always the offerer** to the host (so no glare / perfect-negotiation needed); trickle ICE; one
ICE restart on `failed` before giving up. Worker ⇄ client JSON protocol (≤ 16 KiB per message, ≤ 50 msgs/s per
socket):

| Direction | Message | Meaning |
|---|---|---|
| C→W | `{ t: 'signal', to, data }` | SDP / ICE for one peer. Guests may only address the host. |
| C→W | `{ t: 'kick', peer }` | host only: close that socket, block its peer id for the room |
| C→W | `{ t: 'lock', locked }` | host only: refuse new guests |
| C→W | `"ping"` | auto-response `"pong"` (DO stays hibernated) |
| W→C | `{ t: 'joined', you, host, peers: [] }` | after upgrade; `host` = host peer id |
| W→C | `{ t: 'peer-join', peer }` / `{ t: 'peer-leave', peer }` | to the host (guests only learn about the host) |
| W→C | `{ t: 'signal', from, data }` | relayed SDP / ICE |
| W→C | `{ t: 'error', code }` then close | `full` (8 sockets) · `no-host` · `host-exists` · `kicked` · `locked` · `rate` · `bad-origin` · `proto` |

**PublicSignaling** (`src/net/signaling/public.js`, `createPublicSignaling({ trackers, nostrRelays,
fallbackAfterMs = 6000, importer = (m) => import(m) })`): `joinRoom({ appId: 'sprinkle-kart', password:
<normalised code>, relayConfig: { urls: trackers }, rtcConfig: { iceServers } }, roomId)` with
`roomId = 'sk-' + hex(SHA-256('sprinkle-kart-room:' + code)).slice(0, 20)`; the password makes Trystero encrypt
SDP (strangers who guess the room id still cannot read offers). Trystero is a mesh, so each side sends a tiny
`sk-role` action on join; connections where neither side is the host are closed immediately and never
surfaced. If no host peer appears within `fallbackAfterMs`, the same room is additionally joined over Nostr
(redundancy 6). `block(peerId)` closes and ignores that Trystero peer id.

**Room lifecycle on the Worker** (`SignalRoom`, one DO per code): the host socket creates the room; a second host
gets `host-exists`; guests before a host get `no-host`; ≤ 1 host + 7 guest sockets; blocked peer ids kept in
DO SQLite for 6 h; an alarm deletes the room 2 h after the last socket leaves. Origin is checked **by the
Worker** on `/room/:code` (browsers do not apply CORS to WebSocket upgrades); CORS headers only on `/health`
and `/ice`. Per-IP join rate limit: 20 per minute (in-memory per isolate + DO counter). Pure room logic lives
in `infra/signal-worker/src/room.js` (`roomReduce(state, event) → { state, sends: [...], close?: [...] }`) and
is tested by the **main** vitest suite too.

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
| timers (boost/spin/shield/star, roulette) | u8 × 32 | 0–7.97 s, 31 ms | |
| hopTime, hopY | u8 × 256 s / u8 × 128 m | 1 s / 2 m | |
| steer, pitch, roll, steerSmoothed | i8 over ±1 / ±0.5 rad | 1/127 | |
| accel, brake | 4 bits each | 1/15 | triggers are analog but kids are not |
| race times sent in events | u32 milliseconds | 49 days | |

**Reconciling from quantised state costs 1.2 cm p50 / 2.1 cm p99 and does not grow over 6–12 ticks
(measured).** So the owner's own kart is corrected from exactly the same quantised numbers everyone else sees,
plus the owner-only block of discrete physics fields (§6.2).

---

## 6. Message catalogue

Byte 0 of every message is its type. `state` types are `0x01–0x1F`, `ctrl` types `0x20–0x3F`. Unknown types,
short reads (`reader.ok === false`), wrong-channel types and oversize messages are **dropped and counted**
(never thrown). Cold-path ctrl messages marked *JSON* are `type byte + UTF-8 JSON`, parsed then validated by
`src/net/schema.js` (whitelisted keys, enums, registry ids, numeric ranges); unknown keys are stripped.

### 6.1 `state` channel (unreliable, unordered)

**0x01 INPUT** guest → host, every sim tick (60 Hz), redundant.

| Field | Type | Notes |
|---|---|---|
| type | u8 | 0x01 |
| seq | u16 | packet counter (loss stats) |
| newestTick | u32 | host-tick number of the newest input in this packet |
| n | u8 | ticks carried, 1..12 (newest first): every tick after the last tick the host acked, + 2 extra, min 3 |
| p | u8 | local players on this machine, 1..4 (seat order) |
| lastSnapTick | u32 | newest snapshot tick received (for the host's per-house stats) |
| inputs | n × p × 3 B | per player-tick: `steer i8`, `pedals u8` (accel high nibble, brake low nibble, 0..15), `flags u8`: bit0 drift held · bit1 lookBack · bits2–4 **useItem press counter mod 8** · bit5 robo (player paused / pad asleep → host CPU drives) · bit6 assisted (Kid-Assist already applied) |

Size = 13 + 3·n·p B: 1 player steady (n≈8) ≈ 37 B; 4 players worst (n = 12) = 157 B.
The press counter makes redundancy safe: repeating a packet never doubles a press, and a lost packet never
loses one (the next packet's counter still differs).

**0x02 SNAPSHOT** host → each guest, every 2nd tick (30 Hz). Built from a shared body + a small per-house tail.

| Part | Field | Type | Notes |
|---|---|---|---|
| header | type, tick | u8, u32 | state **after** simulating `tick` |
| | flags | u8 | bit0 racing · bit1 finished · bit2 battle block · bit3 globally paused · bit4 teleport (snap, no smoothing) |
| | countdown | u8 × 64 | seconds left |
| | lastInputTick | u32 | per house: newest input tick the host has consumed for this house (the ack) |
| | inputSlack | i8 | per house: how many ticks early the input for `tick` arrived (−128 = missing, repeated) |
| | kartCount, boxCount | u8, u8 | |
| karts | per kart, in `race.karts` order | 36 B | layout below |
| boxes | active bitmask | ⌈boxCount/8⌉ B | respawn timers are host-only |
| gumdrops | count u8 + per gumdrop `id u16, x i16, z i16, y i16` | 8 B | colour comes with the spawn event |
| rockets | count u8 + per rocket `id u16, x, z, y i16, heading u16, target u8, flags u8` | 12 B | |
| battle (flag) | `timeLeft u16 × 10`, per kart `bubbles u4 \| out u1` | 2 + kartCount B | |
| owner tail | count u8 + per local kart of this house: `kart u8` + 19 B | 20 B | below |

Kart block (36 B): `x i16, z i16, y i16, heading u16, vx i16, vz i16, speed i16, distance i32` (18) ·
`flags u16`: boosting, spinning, shielded, drifting, offRoad, wrongWay, finished, finishEstimated, battleOut,
braking, reversing, star, driftDir (2 bits), roboDriven · `boostTime, spinTime, shieldTime, starPower u8×32`
(4) · `hopTime u8, hopY u8, spinAngle u8, driftCharge u8` (4) · `steerSmoothed i8, slide u8, pitch i8, roll i8,
throttle u8` (5) · `itemByte` = item 3b \| charges 2b \| driftLevel 2b \| hasPending 1b · `lapByte` = lap 4b \|
finishPlace 4b · `itemRoulette u8 × 255` (3).

Owner tail (19 B + kart id per own kart; needed to predict hop/drift/pad edges exactly): `driftHeld, prevAccel,
driftWindow>0` bit flags u8 · `driftWindow u8 × 256` · `hopLen u8 × 256` · `onPad i8` · `wallCooldown u8 × 256` ·
`accelPressedAt i8 × 32 (−128 = null)` · `slideDir i8` · `wrongWayTime u8 × 32` · `lastLapStart u32 ms` ·
`driftTime u16 × 256` · `groundY i16 × 64` · `pendingItem u8` · `rouletteTime u8 × 32` · `aiSpeedMult u8 × 128`.

Sizes (14 B header, 8 karts × 36 B, 32 boxes): **typical ≈ 330 B** (1 own kart, no items) · 8 gumdrops + 2 rockets
**≈ 420 B** · **cap-case ≈ 690 B** (24 gumdrops, 8 rockets, 4 own karts, battle). All < 1150 B = one SCTP packet (Chrome dcSCTP
packets ≤ 1191 B; a fragmented unreliable message is lost if any fragment is). Caps are enforced by the sim
(`MAX_GUMDROPS = 24` oldest-first eviction, `MAX_ROCKETS = 8`) and asserted by a codec test.

**Every snapshot is self-contained** (a full "keyframe" of hot state). No delta encoding in v1: measured full
snapshots are ~275–420 B, far inside the budget, and self-contained packets make loss/reorder trivial. The
`flags` byte reserves bit7 for a future delta-vs-acked-baseline format if the budget is ever exceeded (it isn't
at 8 karts). Cold state that rarely changes (lap times, finish times, entity colours) travels as reliable
events and in **RESYNC** (0x2D) instead.

**0x03 PING / 0x04 PONG** both directions, 4 Hz in lobby, 2 Hz in race (snapshots also carry time).
`PING = type u8, id u16, t0 f64` (11 B). `PONG = type u8, id u16, t0 f64, t1 f64, t2 f64` (27 B), times are
`performance.timeOrigin + performance.now()` ms of each side.

### 6.2 `ctrl` channel (reliable, ordered)

| Code | Name | Dir | Enc | Fields | Size |
|---|---|---|---|---|---|
| 0x20 | HELLO | G→H | JSON | `{ proto: 1, build: string≤40, content: u32, house: { localPlayers 1..4 }, canHost: bool, token?: hex32 }` (token = reconnect ticket) | < 200 B |
| 0x21 | WELCOME | H→G | JSON | `{ houseId 0..7, emoji, token: hex32, hostBuild, tickHz: 60, lobby: LobbyState }` | < 3 KB |
| 0x22 | REJECT | H→G | JSON | `{ reason: 'version'\|'full'\|'declined'\|'locked'\|'in-race-full'\|'removed'\|'host-leaving', detail? }` then disconnect | < 100 B |
| 0x23 | BYE | both | u8 | `reason u8` (0 leaving, 1 host ending, 2 removed) | 2 B |
| 0x24 | LOBBY | H→G | JSON | full `LobbyState` (§10.3), sent whole on every change, ≤ 10/s | 0.5–3 KB |
| 0x25 | INTENT | G→H | JSON | `{ kind: 'seat-join'\|'seat-leave'\|'pick'\|'ready'\|'unready', seat 0..3, characterId?, paintId?, easyDrive? }` | < 150 B |
| 0x26 | EMOTE | both | bin | `globalPi u8, emote u8` (host validates + relays with a tick) | 3 B |
| 0x27 | KICK | H→G | bin | `scope u8 (0 house, 1 seat), seat u8` | 3 B |
| 0x28 | PHASE | H→G | JSON | `{ phase, screen, params }` — which screen every machine shows (§10.4) | < 2 KB |
| 0x29 | SETUP | H→G | JSON | `NetRaceSetup` (§10.5) | < 3 KB |
| 0x2A | LOADED | G→H | bin | `raceId u32` | 5 B |
| 0x2B | START | H→G | bin | `raceId u32, startTick u32, hostMsAtTick0 f64` | 17 B |
| 0x2C | EVENTS | H→G | bin | batch (§6.3) | 10 + ~4/event B |
| 0x2D | RESYNC | H→G | JSON | cold full state for (re)joining mid-race: `{ raceId, tick, karts: [{ lapTimes, finishTime, finishPlace, finishEstimated, roboDriven }], gumdrops: [{ id, color }], rockets: [{ id, owner }], lastEventSeq, battle?, modeInfo }` | < 4 KB |
| 0x2E | RESULT | H→G | JSON | `{ raceId, summary: HostRaceSummary, options: [[id,label,emoji]] }` (§12) | < 6 KB |
| 0x2F | GP | H→G | JSON | `{ gp: GrandPrixResult (host view), final: bool, nextTrackId }` | < 8 KB |
| 0x30 | PAUSE | H→G | bin | `paused u8, reason u8` (0 host snack break, 1 host tab hidden) | 3 B |
| 0x31 | CHOICE | H→G | JSON | `{ screen, choice }` resolves the guest's copy of a host-owned screen | < 100 B |
| 0x32 | FOCUS | H→G | JSON | `{ screen, focusId }` optional 2 Hz preview of what the host is pointing at | < 100 B |
| 0x33 | NETSTAT | H→G | bin | 1 Hz: per house `houseId u8, rttMs u16, lossPct u8, state u8 (ok/wobbly/asleep)` | ≤ 42 B |

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
guest                                         host
  | ── signaling: find host, WebRTC up ──────▶ |
  | ── HELLO {proto, build, content, n, token?} ▶ |  compatible()? room full? locked? blocked?
  |                                            |  new house → approval prompt on the host ("Let them in?") (≤ 60 s)
  | ◀─ WELCOME {houseId, emoji, token, lobby} ─ |  or REJECT {reason} + disconnect
  | ── PING/PONG ×8 (clock sync warm-up) ─────▶ |
  | ◀─ LOBBY … ────────────────────────────────  |
```

A HELLO carrying a valid reconnect `token` skips approval and re-attaches to its old house (§13.2).

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

### 7.3 Clock sync — `src/net/clock.js`

NTP-style 4-timestamp PING/PONG: `rtt = (t3 − t0) − (t2 − t1)`, `offset = ((t1 − t0) + (t2 − t3)) / 2`.
Keep the last 16 samples; take samples within 1 σ of the median RTT, weight by `1 / rtt`, average their
offsets. `jitterMs` = EWMA (α = 1/8) of |rtt − rttPrev|. The estimate is `ready` after 5 samples.
`hostNow() = localNow + offset`; `hostTickAt(ms) = startTick + (ms + offset − hostMsAtTick0) × 60 / 1000`.
Offsets are slewed (≤ 2 ms per second) once ready, so the timeline never jumps; a > 50 ms disagreement over 8
samples triggers a hard re-sync (rare: sleep/resume).

### 7.4 Heartbeat and liveness

PING at 4 Hz (lobby) / 2 Hz (race); any packet counts as a heartbeat. Per peer: **> 3 s** silent → `wobbly`
(lobby icon 📶, HUD "🏡 is a bit wobbly…"); **> 8 s** silent or channel/pc `closed`/`failed` → `asleep`
(disconnected, §13.1). A guest that sees no host packet for 8 s treats the host as gone (§13.3).

---

## 8. Simulation changes

These land first (wave 1, WS1) and also fix a real offline bug: today race outcomes depend on the monitor's
refresh rate (**measured**: 30/75/120/144 fps and ±2 ms jitter each change the winner vs 60 fps).

### 8.1 Fixed 60 Hz tick + render interpolation (all modes, online and offline)

- `src/race/fixedStep.js`: `TICK_HZ = 60`, `TICK_DT = 1/60`, `MAX_TICKS_PER_FRAME = 6` (same 0.1 s spike cap
  as today). `createFixedStepper() → { advance(frameDt) → { ticks, alpha }, reset() }`.
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

### 8.5 Prediction step — `src/race/predict.js`

```js
/** One 1/60 s step of a single kart, mirroring Race.tick order for that kart only. */
export function predictTick(kart, input, ctx);   // ctx = { path, boostPads, gameplay, rules, raceState, countdown, emit }
```
Order: countdown / rocket-start logic (from `Race._updateCountdown`) → self item use for **boost, triple
boost, star, shield** (deterministic self-effects, no rng) → `stepKart` × 2 at 1/120 → lap counting (updates
`kart.lap` / `distance` only; no `lap` event — the authoritative one comes from the host). It never
reads other karts, items or boxes. **(measured)** `stepKart`-only replay matches the host bit-exactly in
94–98 % of 100–200 ms windows; windows with contact/bonks/items reach up to 1.4 m error — reconciliation
smoothing absorbs that (§9.5).

### 8.6 Other sim touches

- `Race._inputFor`: if `raw.assisted`, skip `applyEasyDrive` (the owning machine already applied it); if
  `raw.robo`, use `_brainFor(kart)` (Robo Driver).
- Race events carry `kart` objects offline; the host's event log maps them to ids (`e.kart.id`, `e.other.id`,
  `e.by.id`). New fields: `item-box.boxIndex`, gumdrop spawn/despawn events with id/position/colour, rocket
  despawn, `box-respawn`.
- `Race({ participants })` order is authoritative: humans by global player index, then CPUs in `cpuIds`
  order — every machine builds the same `race.karts` order, so kart id = index everywhere.
- `buildKartModel(charDef, participant)`: paint comes from `participant.paintId` (not this machine's
  localStorage), so every house sees the same colours and two players on the same racer can differ.

---

## 9. Netcode

### 9.1 Timeline

```
host tick T ─────────────────────────────▶ (authoritative present)
guest's own kart  : predicted at  T + lead           (lead ≈ RTT/2 + 2 ticks, adaptive)
remote karts/items: rendered at   T_est − interpDelay (≈ 100 ms behind the host, adaptive 70–150 ms)
```

### 9.2 Inputs, redundancy and the input lead

- The guest samples local inputs **once per predicted tick** (after Kid-Assist for assisted players) and
  stores them in a ring (`InputHistory`, 128 ticks) keyed by tick.
- Each tick it sends INPUT with every tick newer than `lastInputTick` (from the latest snapshot) + 2 older ones,
  min 3, max 12 ticks (200 ms). At 3 % loss the chance of a tick's input never arriving is < 10⁻¹².
- **Lead control** (`src/net/guest/leadController.js`): the host reports `inputSlack` (how many ticks early
  input for tick T arrived). Target slack = 2 ticks (1 when jitter < 5 ms). The guest runs its predicted clock
  up to **±3 % faster/slower** (time dilation, invisible to kids) to hold slack in [1, 3]; slack < 0 for 3
  snapshots in a row → jump lead by +2 ticks at once.

### 9.3 Host input buffer and missing-input policy — `src/net/host/inputBuffer.js`

`createInputBuffer({ size: 64 }) → { push(tick, perPlayer[]), take(tick) → { inputs, status: 'on-time' |
'repeated' | 'robo' }, slack(tick), lastConsumed }` per house.

| Situation | Host uses for tick T |
|---|---|
| input for T present | it (status on-time) |
| missing, last input ≤ 250 ms old | last input **with its press counter unchanged** (no new press), steer/pedals/drift held (status repeated) |
| input for T arrives after T was simulated | dropped, **except** press-counter deltas, which are applied on the next tick (a late press is late, never lost) |
| missing > 250 ms | steer eases to 0 over 0.25 s, accel held (kart coasts on its line, never stops dead) |
| missing > 1.5 s, or `robo` bit set | **Robo Driver** (`_brainFor(kart)`) drives; `robo` event → "🤖 Robo Driver has the wheel!" |
| inputs resume | control returns on the next tick; `robo` event (off) |

The host's own local players bypass the buffer (their input is sampled directly for each tick).

### 9.4 Snapshots and bandwidth budget

- Host broadcasts a SNAPSHOT after every 2nd tick (30 Hz), shared body encoded **once**, per-house tail
  (ack, slack, owner block) appended per guest.
- **Budget (acceptance):** snapshot ≤ 1150 B always (cap-case ≈ 690 B); guest download ≤ 120 kbps p50 / 160 kbps
  p99 incl. DTLS/SCTP/UDP overhead (typical ≈ 90 kbps); guest upload ≤ 30 kbps for 1 local player, ≤ 80 kbps for
  4; host upload ≤ 1.2 Mbps with 7 guests (typical ≈ 0.65 Mbps); ctrl traffic < 2 kbps average in race.
- If a guest's `bufferedAmount` on `state` stays high (> 64 KiB) the host halves that guest's snapshot rate to
  15 Hz until it drains (interpolation delay adapts automatically).

### 9.5 Remote-kart interpolation — `src/net/guest/interpolation.js`

- `createSnapshotBuffer({ capacity: 32 })` stores decoded snapshots by tick (reordered/duplicate packets are
  inserted or ignored by tick; older than the render time are discarded).
- Render time `renderTick = hostTickEst − interpDelay × 60`. Per remote kart: cubic **Hermite** between the two
  bracketing snapshots using position + velocity (smooth at 30 Hz); heading via shortest-arc slerp; other
  fields (timers, flags, drift level) step at the older snapshot.
- **Adaptive delay:** `interpDelay = clamp(2 × 33.3 ms + 2 × jitterMs + lossAllowance, 70, 150)` where
  `lossAllowance = 33 ms` when measured loss > 2 %. It moves ≤ 1 ms per 100 ms so time never visibly jumps.
  Start at 100 ms.
- Starved (no snapshot beyond renderTick): **extrapolate** with velocity up to 250 ms, then freeze and blend
  back when data resumes.
- CPUs, gumdrops and rockets use the same buffer. Boxes and battle bubbles switch at the older snapshot.

### 9.6 Local-kart prediction and reconciliation — `src/net/guest/reconcile.js`

- The guest's own karts are simulated by `predictTick` every predicted tick with the local input → **no input
  delay**, exactly like offline.
- On each snapshot (tick S) with the owner tail: set the kart to the snapshot state (quantised hot fields +
  owner phys), then **replay** stored inputs for ticks S+1 … current (≤ 12 ticks typical). The difference
  between the old predicted pose and the new one becomes a **visual error offset** that decays exponentially
  (τ = 100 ms; heading τ = 80 ms). Snap (no smoothing) when error > 4 m, heading error > 0.6 rad, or the
  snapshot `teleport` flag is set. **Replayed ticks never emit events** (`ctx.emit` is a no-op during replay):
  a predicted hop/drift/boost event fires once, the first time its tick is predicted.
- What is predicted vs host-only:

| Thing | Local prediction | Host truth arrives via |
|---|---|---|
| steering, throttle, walls (`constrainToTrack`, path only) | ✅ exact | snapshot |
| drift start/levels/mini-turbo release, hops, landing | ✅ exact (needs owner tail) | snapshot |
| boost pads, rocket start | ✅ exact | snapshot + events (dropped for own kart) |
| using sprinkle boost / triple / star / shield | ✅ applied on press (sfx + FX instantly) | snapshot confirms; if the host disagrees (e.g. item was actually gone) the next reconcile corrects and the slot shows the truth |
| dropping a gumdrop / launching a rocket | slot empties + whoosh sfx instantly (cosmetic); the entity appears when the host spawns it (≈ RTT/2 + interpDelay later, behind you) | events + snapshot |
| bumps with other karts, bonks, spins, item-box pickups, roulette result | ❌ host only | events + snapshot (smoothed) |
| laps / finish / place | ❌ host only (local hint for the lap banner is allowed) | events |

- Events for the own kart whose type is locally predicted (hop, land, drift-*, pad/start boost, wall bump,
  self item-use) are **dropped** when they arrive from the host; all others fire on arrival (they are about the
  player's present).
- Remote players' sounds are never played as "your" sounds: `session.isHuman(kart)` keeps meaning *a player on
  this screen* (§10.8).

### 9.7 Replicated events: idempotence and ordering vs snapshots — `src/net/guest/eventPlayer.js`

- The host's `EventLog` (`src/net/host/eventLog.js`) stamps each race event with `seq` (u32, monotonic per
  race) and `tick`, keeps the last 512, and batches them into EVENTS after each snapshot.
- The guest applies each seq **at most once** (`lastAppliedSeq`; duplicates after a reconnect/RESYNC are
  ignored; a gap cannot happen on the reliable channel — if detected, request RESYNC).
- **Events are presentation only.** Game state comes only from snapshots (+ RESYNC for cold fields). Events
  ride the ordered `ctrl` channel, snapshots the unordered `state` channel, so an event can arrive before or
  after the snapshot of its tick; the player therefore releases **world/remote events when `renderTick ≥
  event.tick`** (sfx/FX line up with the interpolated picture: the box pops when the remote kart visibly
  touches it) and own-kart events immediately. Events older than 1 s are released immediately (never stuck).
- Released events are re-emitted through the normal `onEvent → bus.emit('race:<type>', e, session)` path with
  kart ids mapped back to the replica's kart objects, so **every existing system, the HUD and progress run
  unchanged**.
- `race-complete` only marks the tick; the guest waits for RESULT (0x2E) before the results screen.

### 9.8 Host-advantage mitigation

The host's own players see everyone at the true present, guests see others ~100 ms + RTT/2 in the past.
Mitigations, in order of impact:
1. **Input lead** (§9.2): a guest's own driving is simulated on the exact tick they pressed — no lateness in
   lines, drifts, pads, finish times.
2. **Late presses are never lost** (press counter): item use by a guest lands on the next host tick.
3. **Gentle interaction by design:** bumps are soft pushes, bonks are twirls, rockets home in — none needs
   frame-perfect aim. Gumdrop hits against *remote* humans use the normal radius (no extra rewind in v1).
4. **Rocket and gumdrop warnings** use host-time events (the "Rocket coming!" warning fires on the guest when
   the rocket launches, not when it becomes visible).
5. Optional **"Fair host"** toggle (host lobby, default off): delays the host's own local inputs by
   `min(50 ms, median guest RTT/2)`.
Results record `net.hostAdvantageMs` (median guest one-way latency) in the debug overlay so the family can see
it is small.

### 9.9 Host tick pump and hidden tabs

A hidden tab throttles main-thread timers to 1 Hz and stops rAF (Chrome timer-throttling). The host's
authoritative loop is therefore driven by `src/net/tickPump.js`: a dedicated Web Worker (`new Worker(blob)`)
posting a message every 16.67 ms (drift-corrected against `performance.now()`), and the main thread runs
`hostDriver.tick()` for every tick due (≤ 6 per message). Rendering stays on rAF (stops when hidden, fine).
On `visibilitychange → hidden` the host also shows **"Keep this tab open, you're the host! 🏁"** on return,
and if the pump is ever starved > 1 s the host sends PAUSE `reason 1` so guests see "Waiting for the host… ⏳"
instead of a frozen race.

---

## 10. Session, lobby state machine and screens

### 10.1 Entry, gates and screens

- **Settings → Grown-ups** (parent gate): "Online play with friends 🌐" (`settings.onlineEnabled`, default
  false, schema + `mergeProgress` clamp) and, when a relay exists, "Hide our address (use the relay)".
- Title: `menuEntry: { label: 'Online', emoji: '🌐', when: (ctx) => ctx.progress.getSettings().onlineEnabled }`
  (new optional `menuEntry.when(ctx)` in `screenFlow.menuEntries`).
- New screens (`src/ui/screens/`): `online-hub` (Host a game · Join · Check connection) · `code-entry`
  (word wheel + 4 digit wheels, keyboard digits/letters work; pure `codeEntryReduce`) · `online-lobby` (houses,
  seats, racers, ping icons, emotes, host: approve / remove / lock / "Let's pick!") · `check-connection` ·
  `net-waiting` (generic "Host is picking… 🎨" with optional preview from FOCUS).
- Router hooks in `Menus.js` (all no-ops when `ctx.net === null`, so offline paths are unchanged):
  `ScreenDef.net = { role: 'host' | 'local' | 'all' }`; `goto()` shows `net-waiting` on guests for `host`
  screens; `_finish()` calls `ctx.net.composeSetup(localSetup)` on the host; public `menus.resolveCurrent(v)`.

### 10.2 State machines

Host (`src/net/session/hostSession.js`):
```
idle → opening (signaling join, code shown) → lobby ⇄ approving
lobby → mode-select → character-select → course-select (track | cup | arena | my-cup) → loading
loading → countdown/race → results → (again | next-track) → loading
                                    → gp-standings → loading (next cup race) | ceremony → lobby
results/ceremony → lobby ("Back to the lobby") → … → closing (host ends / leaves) → idle
```
Guest (`src/net/session/guestSession.js`):
```
idle → code-entry → connecting (signaling, ICE ≤ 15 s) → handshake → waiting-approval → joined
joined: follows PHASE (lobby | net-waiting | character-select | loading | race | results | gp-standings |
        ceremony) → removed | host-gone | version-mismatch | left → online-hub
```
Both are pure reducers `(state, event) → { state, effects[] }` (effects = send, show screen, start race…),
tested without a browser.

### 10.3 LobbyState (host-owned, sent whole in LOBBY)

```js
{ v: 1, code: 'SPRINKLE-4821', phase: 'lobby'|'mode'|'characters'|'course'|'loading'|'race'|'results'|'standings'|'ceremony',
  locked: false, capacity: 8,
  houses: [{ houseId: 0, emoji: '🏰', isHost: true, net: 'ok'|'wobbly'|'asleep', rttMs: 0,
             players: [{ globalPi: 0, seat: 0, characterId: 'luna'|null, paintId: 'original', easyDrive: false, ready: false }] }],
  hostChoice: { mode: 'free', trackId, cupId, arenaId, speedClass: 'zippy', laps: 3, customTrackIds? },
  pending: [{ houseId, emoji }] /* waiting for approval (host screen only) */ }
```
Global player index 0..7 is assigned by the host in join order and kept for the whole session; a house's local
split-screen slots map to its global indices. `MAX_LOCAL_PLAYERS = 4`, `MAX_HUMANS = 8`,
`PLAYER_COLORS` grows to 8 entries; `joinReduce` gets a `capacity` (seats left).

### 10.4 Screen-by-screen sync

| Screen | Who drives | Others see |
|---|---|---|
| join ("Who's playing at your house?") | each machine for its own pads, capped by seats left; sends `seat-join/leave` | lobby updates |
| online-lobby | host (approve, remove, lock, Let's pick) ; everyone emotes | same screen |
| mode-select (online list: Free Race, Grand Prix, Team Race, Bubble Battle) | host | net-waiting "Host is picking a mode…" |
| character-select | **every machine at once** for its own players, gated by **its own unlocks**, with its own paint choice; remote picks shown read-only with house emoji | everyone-ready computed on the host |
| track / cup / arena / my-cup select | host, gated by the host's unlocks | net-waiting with FOCUS preview (track card) |
| loading | every machine builds scene, reports LOADED | "Waiting for 🏡…" list |
| countdown + race | START at the same host tick everywhere | – |
| pause | guest Start = local overlay (Keep racing / Leave room), Robo Driver drives meanwhile; host Start = "Pause everyone 🍪" / Start over / Back to lobby | PAUSE: "Snack break at the host's house 🍪" |
| results / team-results / battle-results | host picks the option | same screen with "Waiting for host…" + **their own** unlock celebrations |
| gp-standings, ceremony (podium) | host continues | same data (GP), own unlocks |

### 10.5 NetRaceSetup (SETUP, host → all)

```js
{ raceId: u32, seed: u32, mode, trackId | arenaId, cupId?, customTrackIds?, speedClass, laps,
  participants: [ { kartId, playerIndex /* global or null for CPU */, houseId|null, seat|null,
                    characterId, easyDrive, paintId } ],   // authoritative order = race.karts order
  cpuIds: [...], rules: <resolved rules object>, gp?: { raceIndex, raceCount }, teamSeries?, protocol: 1 }
```
Each machine maps its own seats to local devices (`deviceId` is filled locally, never sent). The host picks
`cpuIds` from **its** unlocked racers and CPU paints `original`.

### 10.6 Ready and countdown sync

Host sends SETUP → each machine builds the race (`Race` on the host, `ReplicaRace` on guests) and replies
LOADED. When all are loaded (or 20 s passed — stragglers' karts start with Robo Driver and they join via
RESYNC), host sends START with `startTick = hostTickNow + 90` (1.5 s). Everyone's countdown (sim state) starts
at that tick, so "3-2-1-Go!" plays within one frame + clock error (≤ 20 ms target) on every machine.

### 10.7 Emotes

8 presets (`src/net/emotes.js`, ids 0..7): 👋 Hi! · 😄 Hee hee · 🎉 Yay! · 👍 Nice! · 😮 Whoa! · 💖 Love it ·
🍭 Sweet! · 🐢 Wait for me! Picked with a d-pad wheel (lobby: Y button; race: hold Look-back + d-pad, off by
default in race for players under Kid-Assist). Shown as a bubble over the kart / lobby card with a soft chime.
Rate 1 per 1.5 s per player; the host can mute emotes for everyone.

### 10.8 Session helpers and labels

In an online race `session.humans` / `isHuman(kart)` = **local** humans (all ~20 presentation systems then
work unchanged); new `session.allHumans`, `isAnyHuman(kart)`, `isLocal(kart)` for rules and scoring. One
`playerLabel(pi)` replaces the ~10 hard-coded `` `P${pi+1}` `` labels: local players "P1…P4", remote players
"🏡 Luna Lollicorn". Rumble, flashes and voice lines only for local karts.

### 10.9 Removing players

Host lobby → a house card → "Remove this house 👋" or a single player. KICK → guest shows "The host said
bye-bye for now 👋" and returns to the Online hub; the host calls `signaling.block(peerId)` (Worker: `kick`),
and a removed house cannot rejoin this session. Mid-race removal hands their karts to Robo Driver until the
race ends.

---

## 11. Mode matrix

| Mode | Online? | Host-only logic | Every machine | Notes |
|---|---|---|---|---|
| Free Race 🏁 | ✅ | race sim, CPUs, items, completion | results screen, own records (local players' best times only) | again / next-track / lobby |
| Grand Prix 🏆 (incl. My Cup) | ✅ | `createGrandPrix`, `gpRecordRace`, cpu picks fixed for the cup | standings, ceremony podium, `gp-race-end`/`gp-end` **localized** | My Cup tracks must be unlocked on the host |
| Team Race 🤝 | ✅ | team series + scoring | badges, team-results | all humans are Team Sprinkle |
| Bubble Battle 🫧 | ✅ | `battleSim` (pops, bonus, ranking, end) | `battleView` from snapshot battle block + battle events | arenas unlocked on host |
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

### 13.2 Reconnect window (60 s)

WELCOME gives each house a random 128-bit `token` (sessionStorage). A guest whose link drops retries
signaling automatically (1 s, 2 s, 4 s … ≤ 60 s total, "Reconnecting… 🔌"); HELLO with the token re-attaches the
same house and global indices without approval; mid-race the host sends RESYNC (cold state + `lastEventSeq`),
snapshots resume, control returns on the next tick. iOS/iPadOS (WebRTC suspended when locked or backgrounded):
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
| wrong code / no host | "We couldn't find that room. Check the code? 🔍" | – |
| matchmaker unreachable | "Couldn't reach the matchmaker" (+ auto fallback torrent → nostr) | same |
| host tab hidden / starved | "Waiting for the host… ⏳" | banner on return |
| iPad tries to host | "Hosting needs a computer 💻 — you can still join!" | – |
| too many seats requested | join screen stops at seats left | – |

### 13.6 Check connection screen (`check-connection`, pure `diagnose()` in `src/net/diagnose.js`)

| Row | Probe | ✅ / ⚠️ / ❌ |
|---|---|---|
| Matchmaker | Worker: `GET /health` ok → **"Sprinkle Kart server"**; else public: a tracker WebSocket opens → **"Public relays"** | reachable / slow / unreachable |
| Direct connection | gather ICE with STUN only: a `srflx` candidate appears | yes / only local network / no |
| Relay (TURN) | Worker `/ice` returns TURN + a `relay` candidate gathers | ready / not set up (no worker) / blocked |

Result rows are kid-friendly with a "For grown-ups" detail line (candidate types, RTT to STUN). This matches
INFRA_SETUP.md step 8.

---

## 14. Net debug overlay

`?netdebug=1`, or F9 while online, or Settings → Effects "Show network info" (`src/net/debugOverlay.js`, a HUD
widget without an anchor in the top-left, plus `window.__game.net`):

per peer: role · transport (`public-torrent` / `public-nostr` / `worker`) · direct/relayed · RTT, jitter, loss %
(from INPUT/SNAPSHOT seq gaps) · snapshot Hz in / kbps in/out · interp delay (ms) · input lead + slack (ticks) ·
extrapolating? · reconcile error p50/p99 (cm, last 10 s) · snaps count · events/s · lastEventSeq · ctrl
bufferedAmount · clock offset ± · build/proto/content of both sides · host tick vs local estimate. A tiny
sparkline of RTT and error. `window.__game.net` exposes the same numbers for smoke/e2e assertions.

---

## 15. Testing

All new logic follows the house rule: **covered by tests, full `npx vitest run` + `npx vite build` green before
moving on.** New test files are named `tests/net.*.test.js`, `tests/race.fixedstep*.test.js`, etc.

| Layer | What | Where |
|---|---|---|
| Unit | codec round-trips + saturation, every message encode/decode, size caps (cap-case snapshot ≤ 1150 B), schema validation, fuzz (never throws), clock filter (offset within 2 ms under 50 ms jitter), heartbeat state machine, inputBuffer policy table, lead controller convergence, Hermite/extrapolation, reconciler (replay + smoothing + snap), eventPlayer (dedupe, release at renderTick, own-kart drop rules), lobby / host / guest reducers, roomCode (format, 320k space, parse forgiving of spaces/case), localizeSummary/localizeGp, composeSetup, playerLabel, contentHash stability, diagnose() | `tests/net.*.test.js` |
| Sim | fixed-tick golden (30/60/75/144 Hz + jitter identical), rng state round-trip, captureSimState/applySimState bit-identical continuation, entity ids unique, events carry ids, predictTick = host in contact-free windows (bit-exact) and ≤ 1.5 m in disturbed windows, `Math.random` absent from sim path, all existing race/fairness/QA tests unchanged | `tests/race.*.test.js` |
| Node multi-peer sims | `tests/helpers/netHarness.js`: `runNetRace({ track, houses: [[2],[1],[1]], cpus, laps, conditions, seed })` runs a real host Race + N guest ReplicaRaces over MemoryTransport with fake clock; scripted or CPU-brain inputs for "human" seats | `tests/net.sim.test.js` |
| | Matrix: RTT 0 / 50 / 150 / 250 ms × loss 0 / 1 / 5 % × jitter 0 / 20 ms × reorder 0 / 10 % (+ 1 % duplication) | |
| | Asserts: every guest's final standings, finish places, lap times (ms) and RESULT are **identical** to the host's; localized summaries correct; each guest applied the exact host event seq list once (no gaps, no dups); final replica kart states within quantisation (≤ 4 cm) of host; own-kart reconcile error p99 ≤ 0.5 m outside contact windows at ≤ 150 ms; remote render pose continuity (no frame-to-frame jump > 1.5 m at ≤ 5 % loss); no unhandled errors | |
| Session sims | join/approve/remove/lock, 8-human cap, reconnect with token mid-race (RESYNC, control returns), guest drop → Robo Driver, host leave → graceful end, version mismatch reject, GP 4 races + ceremony sync, rematch, emote rate limit | `tests/net.session.test.js` |
| Real WebRTC in node | optional `node-datachannel/polyfill` RTCPeerConnection: two WebRtcTransports over an in-process signaling pair, negotiated channels 8/9 open, unreliable channel drops don't block ctrl; skipped with a clear message if the binary won't load | `tests/net.webrtc.node.test.js` |
| Worker | pure `roomReduce` in the main suite (any Node); full Worker via `@cloudflare/vitest-plugin` (Node 22+, `npm run worker:test`): Origin check, CORS on /health + /ice only, `/ice` with mocked TURN API (`TURN_API_BASE` var → local mock), `:53` filtered, caching, `/health.turn` true iff both secrets, room caps/kick/lock/rate/alarm | `infra/signal-worker/test/` |
| Browser e2e | `scripts/smoke-online.mjs` (Playwright, system Chrome, two contexts in one headless browser, `--disable-features=WebRtcHideLocalIpsWithMdns` + the swiftshader args): (a) public-signaling path against `scripts/dev/localTracker.mjs` (minimal WebTorrent-tracker WebSocket relay; never real public relays); (b) Worker path against `npm run worker:dev`. Scenario: enable online (test param bypasses the gate on localhost only), host + guest (2 players) join by code, pick racers, Free Race 1 lap with autodrive, both reach results with identical standings, rematch, remove guest. Screenshots of every online screen. | `SMOKE_PORT=<p> node scripts/smoke-online.mjs` |
| Soak | node: 3 houses × 2–3 players + CPUs, a full 4-race GP + 10 Free Races at 150 ms / 3 % loss / 20 ms jitter (fake time ≈ 40 min): memory buffers bounded, no drift in clock offset, zero divergence; browser: 10-minute two-context run, heap growth < 30 MB, no errors | `tests/net.soak.test.js` (`SOAK=1` long mode) |
| Regression | `dev/net-design/measure-*.mjs` baselines (snapshot size, event rate, prediction error) re-run in CI as a test with thresholds | `tests/net.baseline.test.js` |

CI: the main suite (incl. MemoryTransport sims) stays in `test-and-build`. Worker tests run in a separate job
on Node 24 only when `infra/signal-worker/**` changes. The online e2e runs locally before every online PR and
nightly in CI (never block on it, same as the smoke job).

---

## 16. Parallel workstreams (waves, ownership, interfaces)

Rule from ARCHITECTURE.md §3 applies: create files freely in your area, edit only what you own; tiny additive
touches elsewhere are called out in the PR and covered by a test. Branch names `net/<ws>` from `main` (or from
the previous wave's merge). **All interfaces below are binding; change them only via a NETWORKING.md PR.**

### Wave 1 — sim refactor + pure new foundations (4 parallel streams, no dependencies between them)

**WS1 — Sim core** (`net/sim-core`). Owns: `src/race/{Race,Kart,AI,Items,ItemBoxes,KartFx}.js`,
new `src/race/{fixedStep,simState,predict,itemSim,itemView,boxSim,boxView}.js`, `src/input/InputLatch.js`,
the tick-loop part of `src/main.js` (stepper + `race.present`; nothing else), `src/game/events.js` (+ `race-tick`
event only), `tests/race.fixedstep*.test.js`, `tests/race.simstate*.test.js`, `tests/race.predict*.test.js`,
`tests/race.entities*.test.js`. Delivers §8 completely: `race.tick / present / tickCount`, `makeRng` state,
`captureSimState / applySimState / captureKart / applyKart`, `predictTick`, `ItemView` / `BoxView`, entity ids
+ id-carrying events (`boxIndex`, gumdrop/rocket spawn/despawn, `box-respawn`), Kid-Assist state on the kart,
`assisted` / `robo` input flags, `buildKartModel(charDef, participant)` paint hook, `Math.random` removal.
Must keep: every existing test green, goldens unchanged, fairness test unchanged.

**WS2 — Wire foundations** (`net/wire`). Owns (all new): `src/net/{codec,messages,enums,schema,version,clock,
heartbeat,emotes}.js`, `src/net/transport/{types,memory}.js`, `src/net/conditioner.js`, `tests/net.codec*.test.js`,
`tests/net.messages*.test.js`, `tests/net.schema*.test.js`, `tests/net.clock*.test.js`, `tests/net.memory*.test.js`,
plus the Vite `define` for `__SK_BUILD__` (one additive line in `vite.config.js`). Codes the snapshot codec
against the `SimState` shape in §8.4 (uses a hand-built fixture, not WS1 code). Exports:
`encodeSnapshot(simState, { houseTail }) / decodeSnapshot(bytes)`, `encodeInput / decodeInput`,
`encodeEvents(events) / decodeEvents`, `encodeCtrl(type, obj) / decodeCtrl(bytes)`, `MSG`, `EV`, `validate`,
`createMemoryHub`, `createClockSync`, `createHeartbeat({ wobblyMs: 3000, asleepMs: 8000 })`, `contentHash`,
`compatible`, `PROTOCOL_VERSION`.

**WS3 — Signal Worker** (`net/signal-worker`). Owns: `infra/signal-worker/**` (`wrangler.toml` name
`sprinkle-kart-signal`, `[[migrations]] tag="v1" new_sqlite_classes=["SignalRoom"]`, `[vars] ALLOWED_ORIGINS`,
`src/index.js`, `src/SignalRoom.js`, `src/room.js` (pure), `src/turn.js`, `test/**`, own `package.json` +
lockfile + `vitest.config.js` + `.nvmrc` 24), `.github/workflows/worker.yml`, root `package.json` scripts
`worker:dev` / `worker:test` / `worker:deploy` (additive), `tests/net.room*.test.js` (pure room logic in main
suite), `docs/INFRA_SETUP.md` (Node 22+ fix, Realtime → TURN Server naming, Chromebook note, flip steps 5–6 to
ready). Implements §4.2 protocol exactly. Never deploys.

**WS4 — WebRTC + signaling adapters** (`net/webrtc`). Owns (new): `src/net/transport/webrtc.js`,
`src/net/signaling/{types,index,public,worker,relays,ice}.js`, `src/net/diagnose.js`,
`scripts/dev/localTracker.mjs`, `tests/net.webrtc*.test.js` (fake RTCPeerConnection + optional
node-datachannel), `tests/net.signaling*.test.js`, `tests/net.diagnose*.test.js`; adds deps
`@trystero-p2p/torrent`, `@trystero-p2p/nostr` (0.25.4, lazy) and optional devDep `node-datachannel`. Talks to
the Worker protocol in §4.2 (tests use a fake WebSocket server implementing it, not WS3 code). Exports
`createWebRtcTransport`, `createPublicSignaling`, `createWorkerSignaling`, `chooseSignaling(env)`,
`fetchIceServers`, `runConnectionCheck`, `describeCheck`.

### Wave 2 — netcode + session (2 parallel streams; need wave 1 merged)

**WS5 — Netcode engine** (`net/netcode`). Owns (new): `src/net/host/{hostDriver,inputBuffer,snapshotter,
eventLog}.js`, `src/net/guest/{replicaRace,replicaItems,interpolation,reconcile,inputSender,leadController,
eventPlayer,inputHistory}.js`, `src/net/tickPump.js`, `tests/helpers/netHarness.js`, `tests/net.host*.test.js`,
`tests/net.guest*.test.js`, `tests/net.sim*.test.js`, `tests/net.baseline.test.js`. Interfaces:
```js
createHostDriver({ race, transport, houses /* houseId → { peerId, karts: kartId[] } */, localInputs: (tick) => DriveInput[],
                   onEvent /* host-side presentation */, snapshotEvery: 2 }) → { tick(), onMessage(peerId, ch, bytes),
                   setHouseRobo(houseId, on), stats(), dispose() }   // wraps race.onEvent to feed EventLog
class ReplicaRace { constructor({ scene, trackDef, path, builtTrack, setup /* NetRaceSetup */, localKartIds,
                   buildKartModel, onEvent }); // Race read API: karts, getPlayerKart, getStandings, state, countdown,
                   // time, clock, lapsTotal, path, racingLine, rules, modeInfo, gameplay, lastDt, items.bursts, rng: null
                   onSnapshot(snap), onEvents(batch), onResync(r), frame(frameDt, localInputs), present(alpha, frameDt), dispose() }
createGuestDriver({ replica, transport, clock, localSeats }) → { frame(dt), onMessage(peerId, ch, bytes), stats(), dispose() }
runNetRace(opts) → { host, guests[], results, events, metrics }   // tests/helpers/netHarness.js
```

**WS6 — Session, lobby & screens** (`net/session`). Owns: new `src/net/session/{hostSession,guestSession,lobby,
roomCode,localize,composeSetup,playerLabel,approval}.js`, new screens `src/ui/screens/{online,codeEntry,
onlineLobby,checkConnection,netWaiting}.js` + their CSS files, `src/net/debugOverlay.js`; additive edits to
`src/ui/Menus.js` (net role, `resolveCurrent`, `_finish` hook), `src/ui/screenFlow.js` (`menuEntry.when`),
`src/ui/menuState.js` (`joinReduce` capacity), `src/config.js` (`MAX_LOCAL_PLAYERS`, `MAX_HUMANS`, 8
`PLAYER_COLORS`), `src/progress/schema.js` + `src/ui/screens/settings.js` (`onlineEnabled`, `relayOnly`),
`src/modes/menus.js` (online mode filter), label call sites → `playerLabel`; tests `tests/net.session*.test.js`,
`tests/net.lobby*.test.js`, `tests/net.localize*.test.js`, `tests/net.screens*.test.js`. Interfaces:
```js
createHostSession({ transport, signaling, progress, rng, now }) → { state, dispatch(ev), onEffect(fn), lobby() }
createGuestSession({ transport, signaling, code, localPlayers, now }) → same shape
lobbyReduce(lobby, action) → lobby     // actions: house-join/leave/approve/remove, seat-join/leave, pick, ready, lock, choice, phase
localizeSummary(hostSummary, localPis) → RaceSummary ;  localizeGp(gp, localPis) → GrandPrixResult
composeOnlineSetup(lobby, hostChoice, { seed, raceId, cpuIds, rules }) → NetRaceSetup
makeRoomCode(rng) → 'SPRINKLE-4821' ; parseRoomCode(text) → code|null ; codeEntryReduce(state, ev)
playerLabel(pi, { localPis, lobby, characters }) → string
```

### Wave 3 — integration + quality (2 parallel streams)

**WS7 — Online game integration** (`net/integration`). Owns: `src/main.js` online branches (`runOnlineHost`,
`runOnlineGuest`, `startRace({ net })`, results/GP/ceremony broadcast, online pause, ignore `?simspeed` /
`?autodrive` / quick-start online), `src/game/session.js` (`allHumans`, `isAnyHuman`, `isLocal`),
`src/modes/{battleSim,battleView}.js` (split of `battleSession.js`, which becomes a thin wrapper),
`src/modes/teamSession.js` host/all split, `src/systems/netEmotes.js`, `src/systems/netHud.js` (wobbly/robo
flashes), README "Online play" section (replaces "Coming soon") + CHANGELOG, `tests/net.integration*.test.js`,
`tests/helpers/headlessSession.js` (additive: `runHeadlessNetSession`). Glue only: all logic comes from WS5/WS6.

**WS8 — E2E, soak & CI** (`net/qa`). Owns: `scripts/smoke-online.mjs`, `scripts/smoke-online-plan.mjs`,
`tests/net.soak.test.js`, `tests/net.e2eplan.test.js`, `.github/workflows/ci.yml` (additive: optional worker
test job + nightly online e2e), `CONTRIBUTING.md` online testing section. Starts in wave 3 against the
WS5/WS6 harnesses and WS4's localTracker, finishes after WS7.

Dependency summary:

| Wave | Streams | Needs |
|---|---|---|
| 1 | WS1 sim core · WS2 wire · WS3 worker · WS4 webrtc | nothing (interfaces in this doc) |
| 2 | WS5 netcode · WS6 session/screens | WS1 + WS2 (WS5); WS2 + WS4 (WS6) |
| 3 | WS7 integration · WS8 e2e/soak | everything |

---

## 17. Acceptance criteria (measurable)

Online v1 is done when **all** hold (each has a test or a scripted measurement):

1. Full `npx vitest run`, `npm run test:coverage`, `npx vite build`, `node scripts/smoke.mjs` green; offline
   gameplay unchanged (goldens + fairness + QA registry tests untouched).
2. Fixed tick: identical race results for the same seed at 30/60/75/144 Hz render rates and ±4 ms jitter.
3. `captureSimState → applySimState` continuation bit-identical over 600 ticks on 5 tracks.
4. Snapshot ≤ 1150 B at the cap-case; typical 8-kart snapshot ≤ 450 B; INPUT ≤ 160 B worst case.
5. Bandwidth (node harness, 7 guests, 8 karts): host upload ≤ 1.2 Mbps, guest download ≤ 160 kbps p99, guest
   upload ≤ 80 kbps with 4 local players.
6. Convergence matrix (§15): 0/50/150/250 ms × 0/1/5 % loss × jitter × reorder — every guest's RESULT, finish
   order and lap times (ms) identical to the host; event seq applied exactly once; no errors.
7. Prediction: own-kart reconcile error p99 ≤ 0.5 m outside contact windows and ≤ 2 m inside, at ≤ 150 ms RTT
   / 1 % loss; zero added input delay (input sampled and applied in the same frame as offline).
8. Interpolation: remote karts show no frame-to-frame jump > 1.5 m at 5 % loss + 20 ms jitter; interp delay
   settles within 70–150 ms and at 100 ± 15 ms for 50 ms RTT / 5 ms jitter.
9. Clock: tick estimate within ±1 tick of the host after 2 s at 150 ms RTT / 20 ms jitter; countdown "GO"
   within 25 ms across machines (harness).
10. Missing input: 1.5 s outage → Robo Driver within 1.6 s, control back within 1 tick of resume; a press
    sent during 5 % loss is never lost or doubled (10 000-press test).
11. Session: 8-human cap; 4 houses × 2 players joins; approval, lock, remove (house and seat); reconnect with
    token mid-race within 60 s restores seats and control; host leave → all guests on the hub within 9 s.
12. Progress: guests never record the host's wins (localize tests over every mode); `multiplayerRaces`
    counts online races; each machine's unlock gates respected.
13. Version: proto or content mismatch → REJECT `version` with the friendly text; different build same content
    connects.
14. Worker: `worker:test` green on Node 24 (Origin rejection, CORS scope, `/health` shape `{ ok, turn,
    version }`, `/ice` with mocked TURN incl. `:53` filtering, caps 1+7, kick, lock, rate limit); main suite
    covers `roomReduce`.
15. E2E: `smoke-online.mjs` passes both paths (local tracker, local `worker:dev`): two contexts race one lap
    and show identical standings; screenshots of hub, code entry, lobby, check connection, race (both
    viewports), results reviewed.
16. Soak: 40 simulated minutes at 150 ms / 3 % loss with zero divergence, bounded buffers; 10-minute browser
    soak heap growth < 30 MB.
17. Kid safety: online hidden until the parent gate toggle; no free-text field in any schema (test enumerates
    schemas); tone test over all new strings; emote rate limit; removed peers cannot rejoin.
18. Docs: NETWORKING.md + INFRA_SETUP.md + README "Online play" + CHANGELOG match the code
    (`tests/docs.networking.test.js`, `tests/docs.readme.test.js`).

---

## 18. Risks and open questions

| Risk | Mitigation |
|---|---|
| Public signaling is flaky this month (Trystero #196; appId-seeded Nostr relays all broken in one report; 2 of 5 default trackers down) | torrent first with 3 pinned live trackers, Nostr fallback after 6 s, lists in config, Check connection says which failed; the Worker is the reliable path (recommend the grown-up does INFRA_SETUP) |
| Symmetric NAT / school Chromebooks (UDP blocked by policy) / hotspots | TURN over TCP/TLS 443 via the Worker; friendly NAT-failure screen |
| Hidden host tab stalls the room | Worker tick pump + banner + PAUSE reason 1 |
| iOS suspends WebRTC in background | iPads join only, never host; tap-to-reconnect + 60 s window |
| Trystero mesh opens guest↔guest links | closed immediately after `sk-role`; Worker path is a pure star |
| Unreliable message > ~1191 B is fragmented and fragile | caps + codec test ≤ 1150 B |
| Prediction error in contact windows (≤ 1.4 m measured) | smoothing τ 100 ms, snap > 4 m; contact is 0–1.4 % of ticks |
| Presentation systems assume "human = on this screen" | keep `humans/isHuman` local; `allHumans` for rules |
| GP/summary code credits any human | `localizeSummary` / `localizeGp` mandatory before any online `race-end` / `gp-end` |
| wrangler needs Node 22+, local default Node 20 | worker has its own package + `.nvmrc`; scripts check Node version |
| 320 k codes still guessable over public signaling | Trystero password encryption, host approval prompt, Worker rate limits, lock button |
| Open: emotes during races for small kids | default off under Kid-Assist; revisit after family playtest |
| Open: "Fair host" default | off in v1; revisit with measured `hostAdvantageMs` |

---

## 19. Constants (one table)

| Name | Value | Home |
|---|---|---|
| `TICK_HZ` / `TICK_DT` / `MAX_TICKS_PER_FRAME` | 60 / 1/60 / 6 | `src/race/fixedStep.js` |
| physics sub-step | 1/120 (2 per tick, unchanged) | `src/race/tuning.js` |
| `SNAPSHOT_EVERY` | 2 ticks (30 Hz) | `src/net/host/snapshotter.js` |
| `INPUT_REDUNDANCY` | min 3, +2 extra, max 12 ticks | `src/net/guest/inputSender.js` |
| `INTERP_DELAY` | start 100 ms, clamp 70–150 ms, slew 1 ms / 100 ms | `src/net/guest/interpolation.js` |
| `MAX_EXTRAPOLATION` | 250 ms | same |
| `RECONCILE_TAU` / heading τ / snap | 100 ms / 80 ms / 4 m or 0.6 rad | `src/net/guest/reconcile.js` |
| `LEAD_TARGET_SLACK` / dilation | 2 ticks / ±3 % | `src/net/guest/leadController.js` |
| input hold / coast / Robo Driver | 250 ms / → 1.5 s / after 1.5 s | `src/net/host/inputBuffer.js` |
| heartbeat | ping 4 Hz lobby, 2 Hz race; wobbly 3 s; asleep 8 s | `src/net/heartbeat.js` |
| reconnect window | 60 s | `src/net/session/*` |
| ICE connect timeout | 15 s (1 ICE restart) | `src/net/transport/webrtc.js` |
| public fallback | torrent → + nostr after 6 s | `src/net/signaling/public.js` |
| `MAX_STATE_BYTES` / `MAX_CTRL_BYTES` | 1150 / 16384 | `src/net/codec.js` |
| channel ids | state 8 (unordered, 0 retransmits), ctrl 9 (reliable) | `src/net/transport/webrtc.js` |
| `MAX_LOCAL_PLAYERS` / `MAX_HUMANS` / karts | 4 / 8 / 8 | `src/config.js` |
| `MAX_GUMDROPS` / `MAX_ROCKETS` | 24 / 8 | `src/race/itemSim.js` |
| room code | 32 words × 4 digits (`SPRINKLE-4821`) | `src/net/session/roomCode.js` |
| emote rate | 1 / 1.5 s / player | `src/net/emotes.js` |
| TURN ttl / cache | 14 400 s / ≤ 5 min | `infra/signal-worker/src/turn.js` |
| Worker caps | 1 host + 7 guests per room, 16 KiB msgs, 50 msg/s/socket, 20 joins/min/IP, room GC 2 h | `infra/signal-worker/src/room.js` |
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
