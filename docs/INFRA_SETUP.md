# Sprinkle Kart — Online Play Setup Guide

This guide covers the one-time setup a grown-up does so friends can play Sprinkle Kart online.
Most of it is already automated. Only the Cloudflare part needs you.

| Piece | What it does | Who sets it up | Cost |
|---|---|---|---|
| **GitHub Pages** | Hosts the game website (`https://rillyboss.github.io/sprinkle-kart/`) | Automated (a GitHub Action deploys every push to `main`) | Free |
| **Public signaling** (default) | Lets browsers find each other using free public relays | Built in, no setup | Free |
| **Cloudflare Worker** `sprinkle-kart-signal` | Our own private matchmaker plus relay credentials. More reliable than public relays. | **You** (about 15 minutes, once) | Free plan |
| **Cloudflare TURN relay** | Lets friends on strict networks (mobile hotspots, school Chromebooks, some routers) connect | **You** (same Cloudflare account) | Free for the first 1,000 GB each month (shared with Cloudflare's SFU); family play uses a tiny part of that |

> The game works online before you do any of this: it uses public signaling plus direct connections.
> The Cloudflare steps make connecting more reliable and let nearly every home network join.
> Once the worker is set up, the host still joins the public relays too, so friends whose browser shows an
> older copy of the page can still find the room, and online keeps working if the worker is ever down.

## Status right now (v3.0.0)

Online play shipped in **v3.0.0**. Everything in the repo is done and tested; the only steps left are the
Cloudflare ones (2–7), which need your own Cloudflare account. The game already plays online without them.

| Step | Ready? | Notes |
|---|---|---|
| 1. GitHub Pages | ✅ **Done** | Pages is switched on (source: GitHub Actions) and `.github/workflows/pages.yml` deploys every push to `main`. The site already hosts the local split-screen game. |
| 2. Cloudflare account | ✅ Do it now | Nothing in the repo is needed. |
| 3. Log in with wrangler | ✅ Do it now | Needs **Node.js 22 or newer**. Run `npm run worker:login` (it installs the worker's pinned wrangler on first use). Note your **Account ID**. |
| 4. TURN key | ✅ Do it now | Copy the **Turn Token ID** and **API Token** somewhere safe (a password manager); the API token is shown only once. Also set up the usage notification (step 4.4). |
| 5–6. Deploy + worker secrets | ✅ **Ready now** | The worker code is in `infra/signal-worker/` and its tests pass (`npm run worker:test`). `npm run worker:deploy`, then `npm run worker:secret -- TURN_KEY_ID` and `npm run worker:secret -- TURN_KEY_API_TOKEN`. |
| 7. `VITE_SIGNAL_URL` variable | ✅ **Ready now** (right after step 6) | The Pages workflow already passes this variable into the build. With it set, the game uses the worker (and the free public matchmakers as a backup); without it, public matchmaking only. |
| 8. In-game check | ✅ **Ready now** | Turn on **Online play with friends** in ⚙️ Grown-ups, then **🌐 Online → Check connection** (step 8). Before step 7 it reports the public relays. |
| Online menu | ✅ **Shipped in v3.0.0** (Free Race) | **🌐 Online → Host a game / Join a friend**: invite link or room code + secret sweets, a match check before anyone gets in, lock and remove, Pause everyone. Grand Prix and more come next. |
| Optional auto-deploy | ✅ **Ready** | `.github/workflows/worker.yml` deploys worker changes on `main` once the two Cloudflare secrets exist, and skips itself until then. |

---

## 0. Before you start

- A computer with this repo checked out (`D:\dev\sprinkle-kart`).
- **Node.js 22 or newer** (24 LTS recommended). The worker tools (wrangler) do not run on Node 20. On the
  family PC, `nvm use 25.4.0` switches to a new enough Node. The `worker:*` scripts check this and tell you if
  your Node is too old.
- About 15 minutes.
- Your GitHub login (you already have it, since the `gh` CLI is logged in as `rillyboss`).

You never need to install the worker's tools by hand: the first `npm run worker:…` command installs the
worker's own package (`infra/signal-worker`, with its pinned wrangler version) automatically. If you prefer to
do it yourself: `cd infra/signal-worker` then `npm ci`.

## 1. Check GitHub Pages (2 min)

(Already switched on for you. These steps just confirm it.)

1. Open https://github.com/rillyboss/sprinkle-kart/settings/pages
2. **Build and deployment → Source** should say **GitHub Actions**. If it doesn't, pick it.
3. Open https://github.com/rillyboss/sprinkle-kart/actions and check that the latest **Deploy to GitHub Pages** run is green.
4. Visit **https://rillyboss.github.io/sprinkle-kart/**. The game should load.

## 2. Create a free Cloudflare account (3 min)

1. Go to https://dash.cloudflare.com/sign-up and sign up with your email. The free plan is all you need. You don't need a domain.
2. Verify your email.

## 3. Log in from your computer (1 min)

Open a terminal in the repo folder:

```bash
cd D:\dev\sprinkle-kart
npm run worker:login
```

A browser window opens. Click **Allow**. The terminal then says you're logged in.
Check with `node scripts/worker.mjs whoami`, which shows your account name and **Account ID**. Copy the
Account ID, because you need it for the optional auto-deploy.

## 4. Create the TURN relay key (4 min)

1. In the Cloudflare dashboard, open **Realtime → TURN Server** (older dashboards call it **Calls**).
2. Click **Create** (TURN key). Name it `sprinkle-kart`.
3. Cloudflare shows a **Turn Token ID** and an **API Token**. **Copy both now**, because the API token is only shown once.
4. Set a usage notification so nothing can surprise you: dashboard → **Notifications → Add** → pick the
   billing / usage notification for Realtime (or your account's billing alert) and send it to your email.
   Our worker also stops handing out relay passwords after 500 per day, and only gives them to friends who
   are in a room.

These stay secret. They are stored inside Cloudflare (step 6) and are **never** put in the game code or the public repo. The worker uses them to create short-lived relay passwords (30 minutes for a room, renewed automatically between races).

## 5. Deploy the worker (1 min)

```bash
cd D:\dev\sprinkle-kart
npm run worker:deploy
```

The output ends with a URL like:

```
https://sprinkle-kart-signal.<your-subdomain>.workers.dev
```

Copy it. Check that it works:

```bash
curl https://sprinkle-kart-signal.<your-subdomain>.workers.dev/health
# → {"ok":true,"turn":false,...}   ("turn" becomes true after step 6)
```

## 6. Store the secrets in the worker (2 min)

```bash
cd D:\dev\sprinkle-kart
npm run worker:secret -- TURN_KEY_ID          # paste the Turn Token ID, press Enter
npm run worker:secret -- TURN_KEY_API_TOKEN   # paste the API Token, press Enter
```

Each command updates the deployed worker straight away (no redeploy needed). Check again:

```bash
curl https://sprinkle-kart-signal.<your-subdomain>.workers.dev/health
# → {"ok":true,"turn":true,...}
```

`"turn":true` means the relay secrets are set up correctly.

## 7. Point the game at your worker (2 min)

1. Open https://github.com/rillyboss/sprinkle-kart/settings/variables/actions
2. Click **New repository variable**:
   - Name: `VITE_SIGNAL_URL`
   - Value: your worker URL from step 5 (`https://sprinkle-kart-signal.<your-subdomain>.workers.dev`)

   This is a *variable*, not a secret. It is safe to be public: the worker only helps people who already
   know a room's secret, and it limits how often anyone can ask.
3. Re-run the Pages deploy: **Actions → Deploy to GitHub Pages → Run workflow**, or push anything to `main`.
4. Ask the friends you play with to refresh the page once.

### Optional: let GitHub deploy the worker automatically

If you want worker changes to deploy themselves when code changes:

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token** → use the **Edit Cloudflare Workers** template → **Create**. Copy the token.
2. On https://github.com/rillyboss/sprinkle-kart/settings/secrets/actions, add two **secrets**:
   - `CLOUDFLARE_API_TOKEN` = that token
   - `CLOUDFLARE_ACCOUNT_ID` = your Account ID from step 3
3. The **Deploy signal worker** workflow now runs on changes under `infra/signal-worker/`. It skips itself when these secrets are missing.

## 8. Check it from the game (1 min)

1. Open https://rillyboss.github.io/sprinkle-kart/
2. Title screen → **Online** → **Check connection**.
3. You should see:
   - Matchmaker: **Sprinkle Kart server** (instead of "Public relays")
   - Direct connection: ✅ (on a network that blocks it, "Relay needed" is fine when the next row is ✅)
   - Relay (TURN): ✅

## Playing with friends

1. **A grown-up turns online play on** in **Settings → Grown-ups** (parent gate). The screen first explains
   what other computers can see (below).
2. **Host:** Title → **Online** → **Host a game**. The lobby shows a room name like `SPRINKLE-4821`, six
   **secret sweets** (like 🍩🦄🍓🍭🧁🌈), a **Copy invite link 📋** button and a QR code.
3. **Friends:** open the invite link (text it to them), or open the website → **Online** → **Join** and enter
   the room name and the six sweets with the controller or keyboard. The room name alone is not enough, so
   saying it out loud is fine; keep the sweets and the link for your friends.
4. **Let them in:** the host sees "Ask your friend: do you see 🦊🐸?". The friend's screen shows two animals.
   If they match, press Yes. (Setting "Only a grown-up can let houses in" puts that button behind the parent
   gate.)
5. Each house can have 1–4 players on split screen, up to 8 people total. The host picks the mode and track.

Online play is friends-only: there's no public matchmaking and no typed chat, just cute preset emotes. The
host can remove a house; that also locks the room ("Room locked 🔒 — tap to open again").

**What other computers can see.** No names, chat or accounts are sent. Like any video call, your internet
address is visible to your friends' computers and to the matchmaking service: the free public relays
(WebTorrent trackers and Nostr relays run by other people) and public STUN servers (Google, Cloudflare), or
your own Cloudflare worker once it is set up. With the relay set up, **"Use the relay for game traffic"** in
Settings → Grown-ups hides your address from your friends' computers.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Couldn't reach the matchmaker" | Check your internet connection. If you set `VITE_SIGNAL_URL`, check that `/health` returns ok (step 5). The game falls back to the public relays on its own. |
| "We couldn't find that room" | Check the room name **and** the six sweets (or use the invite link). Then ask everyone to refresh the page 🔄, so all of you run the same version. |
| A friend can't connect but others can | Their network needs the relay: check `"turn":true` in `/health`, and redo step 6 if needed. School Chromebooks and phone hotspots often block direct connections and need the relay. |
| `/health` shows `"turn":false` | The secrets are missing or wrong: re-run step 6. It also shows false for the rest of the day if the daily relay limit (500 relay passwords) was reached. |
| Game site shows an old version | Actions → Deploy to GitHub Pages → Run workflow, then hard-refresh (Ctrl+F5). |
| Friends see "Different game version" | Everyone should refresh the page so all of you run the same version. |
| `worker:*` says Node is too old | Install Node 24 LTS, or `nvm use 25.4.0` on the family PC. |
| Want to switch back to public relays only | Delete the `VITE_SIGNAL_URL` variable and re-run the Pages deploy. |

## Testing locally (for maintainers)

- `npm run worker:dev` runs the worker on your computer with no Cloudflare account, at
  **http://localhost:8787** (another port: `npm run worker:dev -- --port 8792`). Try
  `curl http://localhost:8787/health`; locally `"turn"` is `false` because there are no TURN secrets. It reads
  `infra/signal-worker/.dev.vars` (gitignored; created from `.dev.vars.example` on first run), which allows
  any `http://localhost:<port>` and `http://127.0.0.1:<port>` origin, so smoke tests on any port work. The
  deployed worker only uses `ALLOWED_ORIGINS` from `wrangler.toml`.
- `npm run worker:test` runs the worker's own tests inside the real Workers runtime (Node 22+, no account,
  a local stand-in for the TURN API). The pure room and limit rules are also tested by the normal `npx vitest run`.
- Testing on an iPad or another computer on your Wi-Fi: `http://192.168.x.x:5173` is not a secure page, and
  the room secret and WebRTC need one. Use the GitHub Pages site, or an https tunnel (for example
  `cloudflared tunnel --url http://localhost:5173`).
- The origin check only stops other websites from using the worker in a browser. The real protection is the
  unguessable room secret plus the per-room and per-address limits inside the worker.

## What is where (for maintainers)

| Thing | Location |
|---|---|
| Worker code | `infra/signal-worker/` (`wrangler.toml`, name `sprinkle-kart-signal`, Durable Object `SignalRoom`, migration `new_sqlite_classes`; rules in `src/room.js` and `src/guard.js`) |
| Worker limits | 1 host + 7 guests per room · 12 guest joins/min per room · 30 room joins/min and 5 `/ice`/min per address · 500 relay passwords per day · rooms deleted 2 h after everyone leaves · addresses only ever stored as salted hashes |
| Worker endpoints | `GET /health` · `GET /ice` (Check connection only; rate-limited, short-lived TURN creds) · `GET /room/:code` (WebSocket signaling; rooms get their TURN creds here) |
| Worker secrets | `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` (set with `npm run worker:secret -- <name>`) |
| Worker var | `ALLOWED_ORIGINS` (in `wrangler.toml`: `https://rillyboss.github.io,http://localhost:5173`); local dev override in the gitignored `infra/signal-worker/.dev.vars` |
| npm scripts | `worker:dev` (local, no account needed) · `worker:test` · `worker:deploy` · `worker:login` · `worker:secret` (all via `scripts/worker.mjs`, Node 22+) |
| Game config | build-time `VITE_SIGNAL_URL` (empty means public signaling only; set means worker first, public as backup) |
| GitHub workflows | `.github/workflows/pages.yml` (site) · `.github/workflows/worker.yml` (optional worker auto-deploy) |
| Design | `NETWORKING.md` |
