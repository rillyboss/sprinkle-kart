# Sprinkle Kart — Online Play Pre-Release Checklist

A **manual** check that online play works between real homes, on the real internet, before an online release
(NETWORKING.md §15 "Manual pre-release", §17 M1-20). It is never run in CI. The automated tests cover the logic
(`npx vitest run`), the soak (`tests/net.soak.test.js`) and two browsers on one computer
(`node scripts/smoke-online.mjs`, which never touches the real public relays). This list covers what only
real networks can show: real matchmaking relays, real routers, a phone hotspot, an iPad, and time.

**Who:** two grown-ups on the phone with each other, each with a computer (one can be a phone hotspot
laptop), plus an iPad for one step. **How long:** about 1½ hours, most of it the 45-minute session.
Paste the filled-in results table (at the bottom) into the release PR.

---

## Before you start

- [ ] The release candidate is deployed to GitHub Pages: open https://rillyboss.github.io/sprinkle-kart/ and
      check the version on the title screen / in *Settings → Grown-ups* matches the release PR.
- [ ] `npx vitest run`, `npx vite build` and `node scripts/smoke-online.mjs` are green on the release commit
      (paste the smoke-online timing table into the PR too).
- [ ] Both computers have online play switched on: *Settings → Grown-ups* (parent gate) → **Online play with
      friends 🌐** → read the privacy sentence → **Okay, turn it on**.
- [ ] Note which matchmaker this build uses: **public relays only** (no `VITE_SIGNAL_URL` repo variable yet) or
      **our Worker + public relays** (the variable is set, docs/INFRA_SETUP.md step 7). Run the Worker rows
      only once the Worker exists.
- [ ] House A (the host) is a computer with a keyboard or controller. Hosting on an iPad is not supported.

## 1. Two real homes, public relays

House A and house B are in different homes (or house B is a laptop on a **phone hotspot**, which is a
different network). Use the public build (or a Worker build: public relays are always used too).

- [ ] House A: title → **Online 🌐** → **Host a game**. The lobby shows a room code like `SPRINKLE-4821`,
      6 secret sweets, a QR code and **Copy invite link 📋**.
- [ ] House A copies the invite link and sends it to house B **by text message** (a real phone message, not
      by reading it out). Check the link looks like `https://rillyboss.github.io/sprinkle-kart/#join=…`.
- [ ] House B opens the link on its computer. It shows **"Join 🏡 SPRINKLE-…?"** and, after one press,
      "Knocking…", then **"Waiting for the host… show them 🦊🐸"** (two animals).
- [ ] The address bar on house B no longer shows the `#join=…` part (it is cleared after use).
- [ ] House A sees **"Ask your friend: do you see 🦊🐸? Let them in?"** with the **same two animals** house B
      reads out over the phone. House A presses **Yes, let them in**.
- [ ] Time from house B's press to house B seeing the lobby: ______ s (write it in the table).
- [ ] House B brings **2 players** (two controllers, or keyboard + controller) on "Who's playing at your
      house?". House A's lobby shows house B with 2 players.
- [ ] Both houses send a few **emotes** (Y / Tab). They pop up on the other screen.
- [ ] House A: **Let's pick! 🎨** → Free Race. Every player picks a racer on their own screen. Race 1 lap.
- [ ] During the race: other karts move smoothly on both screens, your own kart feels like offline.
      Open the net debug overlay once (**F9**) and note RTT and "direct/relayed" for the table. It must show
      candidate *types* only, never an IP address.
- [ ] Both houses see the **same results** (same order, same times).
- [ ] **Race again** from house A: both houses go straight into the next race.
- [ ] Repeat once with house B joining by **typing the code + sweets with a controller only** (Online → Join a
      friend → word wheel, digit wheels, sweets grid), no keyboard.

## 2. Check connection on a network that blocks UDP

A network that blocks direct connections: a school Chromebook, a strict office / hotel Wi-Fi, or a phone
hotspot that blocks UDP (try a few; note which one you used).

- [ ] On that network: **Online 🌐 → Check connection**. Write down the three rows.
- [ ] **Direct connection** says **❌ Relay needed 🛟** (if it says ✅, this network does not block UDP: try another).
- [ ] Public-only build: **Relay** says it is not set up yet and suggests a grown-up can add it.
- [ ] Worker build: **Relay (TURN)** says **✅ Relay ready** (TURN over TLS on port 443).
- [ ] Worker build: host from a normal network, join from the blocked one: it connects and the debug overlay
      (F9) says **relayed**. Race 1 lap.
- [ ] No row and no "For grown-ups" line shows an IP address.

## 3. A 45-minute relayed session (Worker builds only)

TURN credentials last 30 minutes and are renewed **between races** (NETWORKING.md §4.2), so a long evening
must keep working.

- [ ] House B on the UDP-blocking network (or with *Settings → Grown-ups → Use the relay for game traffic*
      switched on), so the connection is **relayed** (F9 says so).
- [ ] Play races back to back for **45 minutes** (a Grand Prix + Free Races once those exist; Free Races are
      fine for M1). Start time: ______ End time: ______.
- [ ] After minute 30, the next race still starts and plays normally (the renewal happened between races).
      Nothing froze mid-race.
- [ ] One "Pause everyone 🍪" snack break from the host for about a minute: both sides resume together.
- [ ] Nobody got dropped. If someone did, note when and what the screen said.

## 4. An iPad joins (never hosts)

- [ ] On an iPad (Safari), open the invite link: it joins as a guest like a computer does.
- [ ] On the iPad: **Online → Host a game** says **"Hosting needs a computer 💻 — you can still join!"**.
- [ ] Lock the iPad screen for 10 seconds during a lobby, unlock: it shows **"Tap to reconnect 👆"** (M2) or,
      in M1, the Robo Driver takes over and the iPad can rejoin (with approval) in the lobby. Note what happened.

## 5. Version mismatch after a deploy

- [ ] House B keeps an old tab open. Deploy a new build (or merge any change to `main` and wait for Pages).
- [ ] House A reloads (new build) and hosts. House B (old tab) tries to join.
- [ ] If the protocol or content changed, house B sees **"Different game version — everyone refresh the page 🔄"**.
      If only the build changed (same content), it simply connects. Note which one you saw.
- [ ] Everyone refreshes: joining works again.
- [ ] Wrong code on purpose: house B sees **"We couldn't find that room… ask everyone to refresh 🔄"**.

## 6. Kid-safety spot checks

- [ ] Remove house B from the lobby (house card → **Remove this house 👋**). House B sees **"The host said
      bye-bye for now 👋"**. House A's lobby says **Room locked 🔒**.
- [ ] House B reloads the invite link: it cannot get back in while the room is locked.
- [ ] House A taps **Room locked** to open it again: house B can ask again, and the approval prompt (with a
      fresh animal pair) appears.
- [ ] Nowhere in the online screens can anyone type a name or a message.

---

## Results (paste into the release PR)

```
Online pre-release checklist — build <commit / version> — <date>
Matchmaker: public only | Worker + public          Testers: <initials>

| # | Check                                  | Networks (A / B)            | Result | Notes (times, RTT, direct/relayed) |
|---|----------------------------------------|-----------------------------|--------|------------------------------------|
| 1 | Invite link by text, approve, race     | home Wi-Fi / phone hotspot  | ✅ ❌  | knock → lobby __ s, RTT __ ms      |
| 1 | Controller-only code entry             |                             |        |                                    |
| 1 | Same results on both screens + rematch |                             |        |                                    |
| 2 | Check connection, UDP blocked          | <which network>             |        | rows: __ / __ / __                 |
| 2 | Relayed race (Worker)                  |                             |        | overlay says relayed?              |
| 3 | 45-min relayed session (Worker)        |                             |        | start __ end __, drops: __         |
| 4 | iPad joins, cannot host                | iPad on __                  |        |                                    |
| 5 | Version mismatch → refresh             |                             |        | saw: mismatch text / connected     |
| 6 | Remove → locked → reload refused       |                             |        |                                    |

Automated on the same commit: vitest __ passed · build ok · smoke-online (paste its timing table)
```
