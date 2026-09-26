# Changelog

What's new in Sprinkle Kart, newest first. Player-facing details live in the [README](README.md).

## Unreleased

### Racers
- Pack A's shy blueberry ghost has her own original name now: **Peekaberry** 🫐. Saved unlocks,
  per-racer tallies, paint, record holders and ghosts all carry over by themselves.

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
