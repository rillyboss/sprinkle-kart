# Changelog

What's new in Sprinkle Kart, newest first. Player-facing details live in the [README](README.md).

## v3.0.0 — Play with friends online 🌐 (2026-09-26)

Online play is here: race friends in other houses straight from the website, friends-only and kid-safe.
A grown-up can make it even more reliable with our own free Cloudflare helper and relay, set up once with
[docs/INFRA_SETUP.md](docs/INFRA_SETUP.md) (it works without it too).

### Online play (Free Race)
- **🌐 Online** on the title screen once a grown-up turns on *Online play with friends* in ⚙️ Grown-ups
  (behind the parent gate, after a short privacy note). Nothing online is even downloaded before that.
- **Host a game** makes a room with a code like `SPRINKLE-4821` and 6 **secret sweets**; share the
  **invite link** or its QR code. **Join a friend** with the link, or type the code and pick the sweets.
- A **match check** before anyone gets in: both screens show the same two animals, and the host says
  yes. The host can lock the room or remove a house (which locks it too).
- Every house brings 1–4 players on its own screen, up to 8 people in a room, CPU friends fill the grid.
  Each house picks its own racers (and kart paint); the host picks the track.
- Your own kart feels like playing at home; everyone else glides smoothly. Places, finishes and results
  always come from the host, so a *1st!* never turns into *2nd*.
- The host's Start is **Pause everyone 🍪**; a friend's Start opens their own menu while 🤖 **Robo
  Driver** steers. Robo Driver also helps when a controller naps or a connection drops.
- Every house keeps its own stickers, unlocks and records, and online races count as races with a friend.
- An invite link on a computer with online play off shows *Ask a grown-up to turn on online play in
  Settings → Grown-ups 🔒* and is wiped from the address bar right away.
- Say hi with 8 preset emotes (no typed chat anywhere). Grand Prix, Team Race and Bubble Battle come next.

### Online play fixes (review of the first build)
- A quiet lobby, a slow "Let them in?" or a host taking their time on the track screen no longer sends
  friends home after 8 seconds (a tiny heartbeat keeps the room open).
- **Back to the lobby** / **Start over** from the host's snack break now take every friend along.
- A Wi-Fi hiccup shows **Reconnecting… 🔌** and brings the same house back (Robo Driver drives meanwhile);
  "Your internet took a nap 📶" when it was this computer. A reloaded tab rejoins its own house. A house that
  really left no longer haunts later races.
- Closing the host's tab tells everyone within a second or two.
- Smooth karts on 120/144 Hz screens, for the host and the guests; Kid-Assist players no longer lurch at GO.
- An old tab meets "Different game version — everyone refresh the page 🔄" instead of racing a different track.
- A wrong code or wrong sweets says *We couldn't find that room*; the network tips show when it really was the
  network; a closed room says it is closed.
- On an open stretch your twirl starts right at the gumdrop you touched.
- A friend's Start says *Robo Driver has the wheel!* (no Photo mode online); the online mode screen shows only
  the online modes.
- The Grand Prix trophy ceremony shows its *Play again* / *Menu* buttons again after an unlock reveal.

### Under the hood
- Matchmaking works with **zero setup** over free public relays (WebTorrent trackers and Nostr) behind a
  pluggable signaling layer, or with our own Cloudflare Worker `sprinkle-kart-signal` (`infra/signal-worker/`,
  Durable Object `SignalRoom`) when the site is built with `VITE_SIGNAL_URL`. The worker hands out
  short-lived Cloudflare TURN relay passwords; without it, public STUN only.
- **🌐 Online → Check connection** reports the matchmaker, direct connections and the relay.
- `npm run worker:dev` / `worker:test` / `worker:deploy`; a two-browser online e2e
  (`scripts/smoke-online.mjs`) drives both matchmaker paths with no internet at all.
- `src/online/` wires the netcode and the room into the game; `runHeadlessNetSession` races a host and
  guest houses in node (with network delay and loss) through the real glue for the tests.

## v2.0.1 — Peekaberry & Friends Fix-Up (2026-09-26)

### Racers
- Pack A's shy blueberry ghost has her own original name now: **Peekaberry** 🫐. Saved unlocks,
  per-racer tallies, paint, record holders and ghosts all carry over by themselves.
- **Bruno Bananas** has a brand-new look: soft lavender fur, a waffle-cone party hat and a pink
  sprinkle scarf that flips up and boops his nose when he boosts (it used to be a necktie).

### Fixes
- **Pick your racer** with 2–4 players: all 21 racers fit on screen in two wide rows, the P1–P4
  tags are never cut off, and a scrolling grid shows a *More friends below!* hint.
- A race always ends: when every CPU friend is home and someone is still driving, they hear
  *Keep going, you can do it!* and the race wraps up 45 seconds later.
- Unlock surprises cover the trophy ceremony and results fully (no see-through podium text),
  count *Surprise 1 of 2* in a Grand Prix too, and come before the *Play again* buttons.
- *New sticker* pop-ups moved to the top-left corner, so they no longer cover the headline;
  the *Photo finish!* card is gone by the time the results show; podium names stay readable.
- Race callouts no longer pile up over the race timer or on top of the *Mini-Turbo!* flash.
- The Rainbow Star makes a kart glow brighter instead of looking muddy.
- The title show's camera no longer parks right in front of the item boxes.

### Under the hood
- The smoke test now checks the menus, results, unlock reveals and trophy ceremony for cut-off
  or overlapping pieces at two screen sizes (1280x720 and 800x450).
- New end-to-end tests for the whole item pipeline (pick up, hold, use, hit) and for the race
  clock; fairness tests are split per cup. The full test run is about twice as fast, and the
  coverage bar went up.
- A test checks that every racer and track name is our very own original name.

## v2.0.0 — The Big Sprinkle Update (2026-09-26)

### New ways to play
- **Grand Prix 🏆**: race a cup of 4 tracks for points (15 / 12 / 10 / 8 / 6 / 4 / 2 / 1), with
  standings between races and a trophy ceremony where the top three dance on a 3D podium.
- **Time Trial ⏱️**: a solo run with 3 sprinkle boosts against a sparkly **ghost** of your best run,
  with ahead/behind splits.
- **Team Race 🤝**: Team Sprinkle (the family + CPU buddies) against CPU Team Sparkle, with team points
  that carry over to rematches.
- **Bubble Battle 🫧**: pop everyone's 3 bubbles in two new arenas, Bubble Bath Bowl and Gumball Garden.
- **Daily Sprinkle ☀️**: one fun challenge a day, with a 🔥 streak.
- **My Cup ✨**: build your own 4-track cup, name it and give it a badge.
- **How to Play 🎓**: a coached practice race that teaches one trick at a time.
- **Race timers & Records 🏆**: race clock, lap times and splits, best laps and saved records per track.

### 12 new racers (21 in all)
- **Pack A:** Bruno Bananas, Shelly Macaroon, Peekaberry, Twiggy Licorice, Captain Crumbs, Baby Bonbon.
- **Pack B:** Luna Lollicorn, Bleep Bloop, Puff the Sprinkle Dragon, Prince Ribbit, Marina Seashell, Lulu Lamb.

### 16 new tracks in 4 new cups (20 in all)
- **🫧 Bubble Cup:** Bubblegum Bay, Mermaid Lagoon, Teddy Toyland, Honeycomb Hive.
- **☕ Cozy Cup:** Pumpkin Pie Patch, Teacup Garden, Peppermint Village, Pillow Fort Dreamland.
- **🌋 Adventure Cup:** Jellybean Jungle, Cocoa Canyon, Lemonade Volcano, Donut Downtown.
- **🌟 Superstar Cup:** Cupcake Carnival, Aurora Ice Palace, Moonbounce Base, Ribbon Sky Rally.
- Every new track has its own songs, scenery and gentle weather.

### Unlocks and collecting
- Every new racer and track unlocks by playing (finish, win on a track, drift, use items, play with a
  friend, try a Time Trial, win a cup). Unlock parties on the results screen and a *Next sticker* hint.
- **Sticker Book 📒** with every racer and track, trophies, best places and family totals.
- **Fun Goals 🏅**: 29 achievement stickers with progress bars.
- **Paint Shop 🎨**: repaint any racer's kart (10 paints or Original), used everywhere.

### For grown-ups
- **Grown-ups corner ⚙️**: music and sound volume, Kid-Assist for new players, and a **parent gate**
  in front of *Unlock everything* and *Start a fresh Sticker Book*.
- **Effects & comfort ✨**: Gentle motion (follows the device's reduced-motion setting), screen wobble,
  racer chatter, weather and title show switches, and **colour-friendly player shapes** (♥ ★ ◆ ●).

### Feel and polish
- **Kid-Assist 🧸** now always presses the gas (even for the Rocket Start) and steers along the best
  line and away from fences, while still letting kids pick a lane, brake and drift.
- Gentler drift entry with blue → pink → rainbow turbos; CPUs keep up with it.
- Much clearer items: spinning item slot with name and button, a **Rocket coming!** warning with
  arrow and beeps, shield/star timers, "Bonked by…" callouts, and a picture **Item Guide**.
- Driving sounds (putt-putt engines, drift squeal, turbo chimes, boings), drift sparks, pastel skid
  marks and speed lines.
- **Showtime:** a TV-style title show behind the logo, track intro cards, racer chatter bubbles,
  a finish-line confetti crane shot, photo finishes, **Photo mode 📸** in the pause menu, and music
  that follows the screen (calm menus, countdown heartbeat, final-lap drums, a cosy *Good try!* tune).

### Under the hood
- One module per racer and per track, a screen router, an event bus with auto-installed systems, and
  a binding content lineup (see `ARCHITECTURE.md`).
- About 2,300 unit tests with a coverage gate, and an end-to-end browser smoke test of every track and
  mode. CI runs the tests and build on every change (short browser smoke on PRs, full smoke on `main`
  and nightly).

## v1.0.0 — First race day (2026-09-25)

- A 3D split-screen kart racer for **1–4 players** on one screen, with CPU friends filling an 8-kart grid.
- **9 racers:** Rocco Ravioli, Lenny Linguine, Stella Starbloom, Princess Peachy Pie, Gumbo Gummybear,
  Muffin Button, Doodle Dino, Bizzy Bumble, and **Cotton Candy Girl** (win a race to unlock her).
- **4 tracks** (the Sprinkle Cup): Cotton Candy Castle, Gumdrop Meadow, Starlight Galaxy, Sundae Slopes.
- Items from rainbow **?** boxes (Sprinkle Boost, Triple Sprinkle, Gumdrop, Bubble Shield, Cupcake
  Rocket, Rainbow Star), drifting with Mini-Turbos, Rocket Starts and friendly *bonks* instead of crashes.
- Controllers (Xbox, PlayStation, Switch Pro) and two shared-keyboard layouts, plus mouse menus.
- Three speeds (Cozy 🐢 / Zippy 🐇 / Zoomy 🚀), cheerful music and sounds made live in the browser,
  and everything built from code (no model or audio files).
