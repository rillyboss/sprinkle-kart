# Sprinkle Kart — Online Play Setup Guide

This guide covers the one-time setup a grown-up does so friends can play Sprinkle Kart online.
Most of it is already automated. Only the Cloudflare part needs you.

| Piece | What it does | Who sets it up | Cost |
|---|---|---|---|
| **GitHub Pages** | Hosts the game website (`https://rillyboss.github.io/sprinkle-kart/`) | Automated (a GitHub Action deploys every push to `main`) | Free |
| **Public signaling** (default) | Lets browsers find each other using free public relays | Built in, no setup | Free |
| **Cloudflare Worker** `sprinkle-kart-signal` | Our own private matchmaker plus relay credentials. More reliable than public relays. | **You** (about 15 minutes, once) | Free tier |
| **Cloudflare TURN relay** | Lets friends on strict networks (mobile hotspots, some routers) connect | **You** (same Cloudflare account) | Generous free tier |

> The game works online before you do any of this: it uses public signaling plus direct connections.
> The Cloudflare steps make connecting more reliable and let nearly every home network join.

## Status right now (v2.0.0)

Online play is still being built, so not every step works yet. What you can do today:

| Step | Ready? | Notes |
|---|---|---|
| 1. GitHub Pages | ✅ **Done** | Pages is switched on (source: GitHub Actions) and `.github/workflows/pages.yml` deploys every push to `main`. The site already hosts the local split-screen game. |
| 2. Cloudflare account | ✅ Do it now | Nothing in the repo is needed. |
| 3. `wrangler login` | ✅ Do it now | `npx wrangler login` downloads wrangler on the fly. Note your **Account ID**. |
| 4. TURN key | ✅ Do it now | Copy the **Turn Token ID** and **API Token** somewhere safe (a password manager); the API token is shown only once. |
| 5–6. Worker secrets + deploy | ⏳ Waits for the online-play code | Needs `infra/signal-worker/` and the `worker:*` npm scripts, which land with online play. |
| 7. `VITE_SIGNAL_URL` variable | ⏳ After step 6 | The Pages workflow already passes this variable into the build. |
| 8. In-game check | ⏳ Waits for the **Online** menu | |
| Optional auto-deploy | ⏳ Waits for `.github/workflows/worker.yml` | You can already create the Cloudflare API token and add the two secrets. |

---

## 0. Before you start

- A computer with this repo checked out (`D:\dev\sprinkle-kart`) and Node.js 20 or newer.
- About 15 minutes.
- Your GitHub login (you already have it, since the `gh` CLI is logged in as `rillyboss`).

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
npx wrangler login
```

A browser window opens. Click **Allow**. The terminal then says you're logged in.
Check with `npx wrangler whoami`, which shows your account name and **Account ID**. Copy the Account ID, because you need it in step 7.

## 4. Create the TURN relay key (3 min)

1. In the Cloudflare dashboard, open **Realtime** (it may be listed as **Calls** or **Realtime → TURN Server**).
2. Click **Create** (TURN key). Name it `sprinkle-kart`.
3. Cloudflare shows a **Turn Token ID** and an **API Token**. **Copy both now**, because the API token is only shown once.

These stay secret. They are stored inside Cloudflare (next step) and are **never** put in the game code or the public repo. The worker uses them to create short-lived relay passwords that expire after a few hours.

## 5. Store the secrets in the worker (2 min)

```bash
cd D:\dev\sprinkle-kart\infra\signal-worker
npx wrangler secret put TURN_KEY_ID          # paste the Turn Token ID, press Enter
npx wrangler secret put TURN_KEY_API_TOKEN   # paste the API Token, press Enter
```

(If wrangler asks to create the worker first, say **yes**.)

## 6. Deploy the worker (1 min)

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
# → {"ok":true,"turn":true,...}
```

`"turn":true` means the relay secrets are set up correctly.

## 7. Point the game at your worker (2 min)

1. Open https://github.com/rillyboss/sprinkle-kart/settings/variables/actions
2. Click **New repository variable**:
   - Name: `VITE_SIGNAL_URL`
   - Value: your worker URL from step 6 (`https://sprinkle-kart-signal.<your-subdomain>.workers.dev`)

   This is a *variable*, not a secret. It is safe to be public.
3. Re-run the Pages deploy: **Actions → Deploy to GitHub Pages → Run workflow**, or push anything to `main`.

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
   - Direct connection: ✅
   - Relay (TURN): ✅

## Playing with friends

1. **Host:** Title → **Online** → **Host a game**. The screen shows a room code like `SPRINKLE-4821`.
2. **Friends:** open the same website → **Online** → **Join** → enter the code with the controller or keyboard.
3. Each house can have 1–4 players on split screen, up to 8 people total. The host picks the mode and track.

Online play is friends-only: there's no public matchmaking and no typed chat, just cute preset emotes. The host can remove players.
A grown-up turns online play on in **Settings → Grown-ups** (parent gate).

## Troubleshooting

| Problem | Fix |
|---|---|
| "Couldn't reach the matchmaker" | Check your internet connection. If you set `VITE_SIGNAL_URL`, check that `/health` returns ok (step 6). |
| A friend can't connect but others can | Their network needs the relay: check `"turn":true` in `/health`, and redo step 5 if needed. |
| `/health` shows `"turn":false` | The secrets are missing or wrong. Re-run step 5, then `npm run worker:deploy`. |
| Game site shows an old version | Actions → Deploy to GitHub Pages → Run workflow, then hard-refresh (Ctrl+F5). |
| Friends see "Different game version" | Everyone should refresh the page so all of you run the same version. |
| Want to switch back to public relays | Delete the `VITE_SIGNAL_URL` variable and re-run the Pages deploy. |

## What is where (for maintainers)

| Thing | Location |
|---|---|
| Worker code | `infra/signal-worker/` (`wrangler.toml`, name `sprinkle-kart-signal`, Durable Object `SignalRoom`) |
| Worker endpoints | `GET /health` · `GET /ice` (ICE servers incl. short-lived TURN creds, CORS-limited) · `GET /room/:code` (WebSocket signaling) |
| Worker secrets | `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` (set with `wrangler secret put`) |
| Worker var | `ALLOWED_ORIGINS` (in `wrangler.toml`: `https://rillyboss.github.io,http://localhost:5173`) |
| npm scripts | `worker:dev` (local, no account needed) · `worker:test` · `worker:deploy` |
| Game config | build-time `VITE_SIGNAL_URL` (empty means public signaling) |
| GitHub workflows | `.github/workflows/pages.yml` (site) · `.github/workflows/worker.yml` (optional worker auto-deploy) |
| Design | `NETWORKING.md` |
