# Sprinkle Kart 🍭🏎️

A cute, silly 3D kart racer for the whole family, made with (and for) **Sophia**.
Up to **4 players** race together on one screen with game controllers or the keyboard,
and CPU friends fill the rest of the 8-kart grid. Nobody gets hurt: karts just get
*bonked* into a happy twirl.

**21 racers · 20 tracks in 5 cups · 2 battle arenas · 8 ways to play.** Everything is
original: every racer, track, tune and sound was made just for this game.

**Contents:** [Starting the game](#how-to-start-the-game-for-grown-ups) ·
[Playing](#playing) · [Game modes](#game-modes) · [Controls](#controls) ·
[Kid-Assist](#kid-assist-) · [Items & drifting](#drifting-and-turbos) ·
[Unlocks & Sticker Book](#unlocks-the-sticker-book-and-fun-goals-) ·
[Paint Shop](#paint-shop-) · [Grown-ups corner](#the-grown-ups-corner-and-parent-gate-) ·
[Effects & comfort](#effects--comfort-) · [Racers](#the-racers) · [Tracks](#the-tracks) ·
[Online play (coming soon)](#coming-soon-online-play-) · [What's new](CHANGELOG.md) ·
[For developers](#for-developers)

---

## How to start the game (for grown-ups)

**The easy way (Windows):** double-click **`start-game.bat`**.
The first time, it installs what the game needs, which takes a minute and needs internet.
After that, the game opens in your web browser by itself.

**The terminal way:**

```bash
npm install      # only the first time
npm run dev      # opens the game in your browser
```

You need [Node.js](https://nodejs.org) 18 or newer. Chrome or Edge works best.

> **Sound tip:** browsers stay quiet until someone clicks the page or presses a key,
> even if you're only using controllers. Give the screen one click and the music starts. 🎵

**Controllers:** plug them in (USB or Bluetooth) at any time, even while the menus are open.
If the game doesn't see a controller, press any button on it once.
Xbox, PlayStation and Switch Pro controllers all work.

**Is it OK for little ones?** Yes. There are no ads, no purchases, no accounts and no chat, and
nothing is sent over the internet: the game and its saves live in your browser. Karts never
crash or get hurt, they *bonk* and twirl, and every finish (even 8th) gets a cheer.

---

## Playing

1. **Title:** press **A** (or **Enter**). Whoever presses first is **P1**.
2. **Who's playing?:** every other player presses **A** on their controller (or their keyboard's confirm key) to join.
   Press **Y** to switch on **Kid-Assist 🧸** for that player. **B** leaves. When everyone's in, P1 presses **A**.
3. **How do you want to play?** P1 picks a mode (see *Game modes* below).
4. **Pick your racer:** each player moves their own coloured cursor and presses **A**. Friends can pick the same racer!
5. **Choose a track** (or a **cup** in a Grand Prix, or an **arena** in Bubble Battle): P1 picks it, the speed
   (Cozy 🐢 / Zippy 🐇 / Zoomy 🚀) and how many laps.
6. **Race!** Press the gas when the countdown says **GO**. Tip: press the gas just before GO for a sparkly
   *Rocket Start*!

## Game modes

The five big cards on the *How do you want to play?* screen:

| Mode | What happens |
|---|---|
| **Free Race 🏁** | Pick any unlocked track and race with friends and CPU pals (the classic mode). |
| **Grand Prix 🏆** | Pick a cup and race its 4 tracks with the same racers. Every race gives points (15 / 12 / 10 / 8 / 6 / 4 / 2 / 1), the standings count up between races, and the top three get gold, silver and bronze cups at the trophy ceremony. A cup opens once all 4 of its tracks are unlocked (locked cups show which track to unlock next). |
| **Time Trial ⏱️** | A solo run for P1 (friends cheer!): no CPUs, no item boxes, but you start with **3 sprinkle boosts**. Your best run is saved as a sparkly **ghost** that races you next time, and the timer shows how far ahead (green) or behind you are. |
| **Team Race 🤝** | The family (plus CPU buddies) is **Team Sprinkle** against CPU **Team Sparkle**. Every place gives points, the team with the most points wins, and the score carries over to rematches. |
| **Bubble Battle 🫧** | No laps: everyone floats 3 bubbles in an arena (**Bubble Bath Bowl** or **Gumball Garden**), surprises pop them, and the last one still bobbing wins. |

And three more:

- **Daily Sprinkle ☀️** (button on the mode screen): one fun challenge a day (a track, a goal and a
  silly twist). Do it on several days in a row for a 🔥 streak.
- **My Cup ✨** (last card on the cup screen): pick **any 4 unlocked tracks** in your own order,
  tap the badge and name to style the cup (e.g. *Rocco Ravioli's Cup* 🦄), and race it as a Grand
  Prix. Your cup is remembered. (It's just for fun: it doesn't count as winning a real cup.)
- **How to Play 🎓** (title screen): a calm practice race with no other racers. A friendly coach at
  the bottom shows one trick at a time (gas, steering, drifting, grabbing and using a surprise,
  finishing) with the right button for your controller, and cheers each one. Learn them all for the
  *Sprinkle Scholar* sticker.

**Timers & records:** every race shows the race clock, the current lap time and your lap splits (top
middle). Beat your fastest lap for a *Best lap!*, beat the saved record for a *New record!*. The
**Records 🏆** button on the mode screen lists the best race and lap on every track, with the racer
who set them. (Race records count only for the track's normal number of laps.)

## Controls

### Controller buttons

| What | Button |
|---|---|
| Go (gas) | **A** or **RT** (right trigger) |
| Brake / reverse | **B** or **LT** (left trigger) |
| Steer | Left stick or D-pad |
| Hop & drift | **RB** or **X** (hold it while turning) |
| Use item | **LB** or **Y** |
| Look behind | Click the right stick (or pull it down) |
| Pause | **Start** / **Menu** / **Options** |
| Menus | Stick/D-pad to move, **A** choose, **B** back, **Y** toggle |

On PlayStation pads, **A** is ✕, **B** is ○, **X** is □ and **Y** is △.

### Keyboard (two people can share one keyboard!)

| What | Keyboard 1 (left side) | Keyboard 2 (right side) |
|---|---|---|
| Go (gas) | **W** | **↑** |
| Brake / reverse | **S** | **↓** |
| Steer | **A** / **D** | **←** / **→** |
| Hop & drift | **Space** or **Left Shift** | **Right Shift** |
| Use item | **E** | **/** or **Right Ctrl** |
| Look behind | **Q** | **.** |
| Pause | **Esc** or **P** | **Backspace** or **\\** |
| Menu: choose | **Enter** or **Space** | **/**, **Right Shift** or **Numpad Enter** |
| Menu: back | **Esc** | **Backspace** |
| Menu: start | **P** | **\\** |
| Menu: Kid-Assist | **Tab** | **'** or **Right Ctrl** |

You can also click the menus with the mouse.

## Kid-Assist 🧸

This is for little racers. With Kid-Assist on, the kart **always presses the gas** (even before
**GO**, so it gets a sparkly Rocket Start), **helps steer** along the best line round every bend
and **steers away from the fences**. Pushing the stick left or right picks a lane (to grab an item
box, say); let go and the helper drifts gently back to the best line. Bumping a fence doesn't slow
it down. Pressing **brake** firmly still brakes (and reverses), and drifting still works for kids
who want to try it. Turn it on for each player with **Y** (or **Tab**) on the *Who's playing?*
screen, or make it the default for every new player in the **Grown-ups** corner. Finishing a race
with Kid-Assist on unlocks **Baby Bonbon**!

## Drifting and turbos

Hold drift while you turn: the kart does a little hop and eases into a slide (no sudden jerk).
While drifting, push **into** the turn to tighten it or **away** to widen it. The sparkles change
colour **blue → pink → rainbow** (blue comes in about half a second!).
Let go for a **Mini-Turbo**, a **Super Turbo** or a **Rainbow Turbo**!

### Items (from the rainbow **?** boxes)

| Item | What it does |
|---|---|
| 🍬 Sprinkle Boost | A quick burst of speed |
| 🍭 Triple Sprinkle | Three boosts to use one at a time |
| 🟢 Gumdrop | Drop it behind you; anyone who drives over it does a happy twirl |
| 🫧 Bubble Shield | A bubble that keeps one bonk away |
| 🧁 Cupcake Rocket | Flies to the racer ahead of you and gives them a happy twirl |
| 🌟 Rainbow Star | Super speed, no slowing down on the grass, and anyone you bump twirls |

Racers further back get the better items, so everyone stays in the race.

**What you'll see and hear:** the item slot spins with little ticks, slows down and lands with a
"ta-da!"; under it your item's **name** and **your button** ("Press LB" / "Press E") show up.
Every item has its own sound. A 🧁 coming for you shows a **"Rocket coming!"** warning, a pink
arrow at the edge of your screen and beeps that get faster as it gets close; a bubble or a star
keeps you safe. Shield and star show a shrinking ring so you know how long they last, and bonks say
who did it ("Bonked by Captain Crumbs' Gumdrop!" / "You bonked Lenny! 🎯"). Pick **🎁 Item Guide**
on the title screen (press Down) for a picture of every item.

---

## Unlocks, the Sticker Book and Fun Goals 📒

You start with **8 racers** and the **4 Sprinkle Cup tracks**. Everything else unlocks by playing:
finish races, win on certain tracks, do drift turbos, use items, race with a friend, try a Time
Trial or win a Grand Prix cup (every goal is in the [racer](#the-racers) and [track](#the-tracks)
tables below). **Win any race (finish 1st) and Cotton Candy Girl joins the team!**

When **anyone** in the family reaches a goal, the results screen throws a big party for each new
friend or track, one after the other ("Surprise 1 of 3!"), and a **Next sticker** card shows
what is closest to unlocking. Locked racers and tracks show their goal and a progress bar
(e.g. *Win 3 races — 1/3 ⭐*).

- **📒 Sticker Book** (title screen: press Down, pick it, press A): every racer and track
  as a sticker (locked ones are mystery silhouettes with a hint), trophies and best places per
  track and cup, and the family's totals. **Y / Tab** flips the page, **B** goes back.
- **🏅 Fun Goals** (a page in the Sticker Book): achievement stickers (first win, drift turbos,
  Bubble Battles, Daily Sprinkles, How to Play...), each with a progress bar.

## Paint Shop 🎨

On the title screen, pick **Paint Shop**. Choose any racer and give their kart a new colour
(10 paints, from *Bubblegum Pink* to *Midnight Blue*, or back to *Original*) and see the whole
kart in its new paint. It's saved, and every race, the podium and the title show use it.

## The Grown-ups corner and parent gate ⚙️

**⚙️ Grown-ups** on the title screen has:

- **Music** and **Sounds** volume
- **Kid-Assist for new players** (on or off by default)
- **Unlock everything** (every racer and track, right away) 🔒
- **Start a fresh Sticker Book** (clears stickers, trophies and totals, but keeps your settings) 🔒

The two 🔒 rows sit behind a little **parent gate**: answer an addition question with the d-pad
(Up/Down) and press A. The game remembers everything in this browser.
`?unlockreset=1` added to the address (for example `http://localhost:5173/?unlockreset=1`) also
starts a fresh Sticker Book.

## Effects & comfort ✨

**✨ Effects** on the title screen (press Down) tunes how busy the game feels:

- **Motion: Gentle** for calmer cameras, fewer wiggles and sparkles (it starts on Gentle if the
  device asks for reduced motion)
- **Screen wobble**, **Racer chatter**, **Weather & sparkles** and the **Title show**, each on or off
- **Colour-friendly shapes**: every player gets a shape as well as a colour (P1 ♥ · P2 ★ · P3 ◆ ·
  P4 ●) on the race HUD and on the P1–P4 tags in the menus, with a different border pattern in
  split-screen

These are saved separately from the Sticker Book, so starting a fresh book keeps them.

---

## Showtime: the sparkly extras 🎬

- **Title show:** while the title screen waits, eight racers zoom round one of your unlocked
  tracks behind the logo, and the camera cuts like a TV show: the pack racing at you, a slow
  circle round a *"⭐ Starring …"* racer, a camera by the fence, a helicopter view.
- **Track intro card:** every race starts with a card over the countdown: the cup (or
  *"Grand Prix · Race 2 of 4"*), the track's name and its subtitle.
- **Racer chatter 💬:** your racer talks in a speech bubble next to your place badge: *"Beep beep,
  Lenny!"* after passing someone, a pout and then a giggle after a bonk, *"Boop! Sorry, Muffin!"* when
  your item lands, *"Sparkle power!"* with a Rainbow Star, and their own victory line at the finish.
- **Weather & sparkles ❄️:** every track has its own gentle weather around the camera:
  sprinkle-snow, soap bubbles at the beach, blossom petals, autumn leaves, fireflies at bedtime,
  lemonade fizz, stardust in space.
- **Finish line party 🎉:** crossing the line throws a confetti fountain and the camera swings up
  and round to the front of your kart. Two karts within a quarter of a second? *"📸 Photo finish!"*
- **3D podium 🏆:** on the results screen and at the Grand Prix trophy ceremony the top three are
  real 3D racers dancing their own happy dance, and they cheer in their own voices as they pop up.
- **Music that follows along 🎵:** the title screen has its own bouncy theme; the band goes lighter
  on "Who's playing?", calm in the grown-up corners, soft and dreamy when you pause or take photos,
  plays just a heartbeat during the countdown until everyone joins in at GO, and turns up the drums
  on the final lap. Didn't make the top 3? You get the cosy *"Good try!"* tune instead.
- **Photo mode 📸:** pause the race and pick **Photo mode**. Move the camera round your kart with the
  stick / arrows (Up/Down = closer/further, Start = tilt), **Y / Tab** picks a frame (snapshot,
  hearts, sprinkles, stars), **A / Enter** snaps and saves a picture (it lands in your downloads),
  **B / Esc** goes back.

---

## The racers

### Ready from the start

| Racer | Who they are | How to unlock |
|---|---|---|
| **Rocco Ravioli** 🍝 | A jolly pasta chef with a giant wiggly mustache and a tall red chef hat | Ready to race |
| **Lenny Linguine** 🍜 | Rocco's tall, noodly, nervous little brother, whose knees wobble | Ready to race |
| **Stella Starbloom** ⭐ | A dreamy space princess with a glowing star wand and her star buddy Twinkle | Ready to race |
| **Princess Peachy Pie** 🍑 | A sweet princess whose crown is a tiny peach pie | Ready to race |
| **Gumbo Gummybear** 🐻 | A grumpy-but-huggable gummy bear with candy-corn horns | Ready to race |
| **Muffin Button** 🧁 | A tiny, excited cupcake kid with a wobbly cherry on top | Ready to race |
| **Doodle Dino** 🦕 | A goofy, always-hungry dinosaur who drives an eggshell kart | Ready to race |
| **Bizzy Bumble** 🐝 | A silly bumblebee who talks in puns | Ready to race |
| **Cotton Candy Girl** 🍭 | A giant fluffy pink-and-blue cotton-candy cloud of hair, a sparkly cape and a cotton-candy wand, in a fluffy cloud kart | Win any race |

### More racers to unlock (pack A)

| Racer | Who they are | How to unlock |
|---|---|---|
| **Bruno Bananas** 🍌 | A gentle giant gorilla in a banana-split kart. His licorice necktie flips up and boops his nose when he boosts! | Finish 2 races |
| **Shelly Macaroon** 🐢 | A super-speedy turtle with a strawberry macaron shell. She tucks her head in to zoom, and hides in her shell when bonked | Win on Gumdrop Meadow |
| **Boo Berry** 🫐 | A shy, giggly blueberry ghost who floats over her seat and blushes so hard she goes see-through | Finish top 3 on Starlight Galaxy |
| **Twiggy Licorice** 🎩 | A dramatically tall licorice showman with a top hat and a curly mustache. Every boost is a "Ta-daaa!" pose | Win 3 races |
| **Captain Crumbs** 🍪 | A jolly cookie pirate with a chocolate-chip beard and a pirate-ship kart. He keeps peeking ahead through his spyglass. Arr-some! | Bonk racers 20 times with items |
| **Baby Bonbon** 🍬 | A giggly baby in a wrapped-candy onesie, riding a turbo stroller. Pacifier in, arms up: "Wheee!" | Finish a race with Kid-Assist on |

### Even more friends to unlock (pack B)

| Racer | Who they are | How to unlock |
|---|---|---|
| **Luna Lollicorn** 🦄 | A sparkly unicorn with a swirly lollipop horn and a shimmering rainbow mane, in a lollipop kart | Win on Cotton Candy Castle |
| **Bleep Bloop** 🍞 | A tiny toaster robot. Watch the toast pop up every time it boosts! | Finish a Time Trial |
| **Puff the Sprinkle Dragon** 🐉 | A teeny dragon who sneezes rainbow sprinkles (AH-CHOO!) from a donut kart | Do 25 drift mini-turbos |
| **Prince Ribbit** 🐸 | A very polite frog prince whose crown is three sizes too big (it keeps slipping!) | Win on Mermaid Lagoon |
| **Marina Seashell** 🧜 | A cheerful mermaid floating along in a bubbly clamshell hover-kart | Finish races on 8 different tracks |
| **Lulu Lamb** 🐑 | A sleepy, cloud-fluffy lamb who drives her bed, and dozes off with a Zzz when you stop | Finish a race on Pillow Fort Dreamland |

## The tracks

Five cups of four tracks. A cup can be raced as a Grand Prix once all four of its tracks are unlocked.

### 🍭 Sprinkle Cup

| Track | What's there | Unlock |
|---|---|---|
| **Cotton Candy Castle** | Princess Peachy Pie's pink candy palace, with heart flags, a strawberry-milk moat, rainbow bridges and cotton-candy trees | Ready to race |
| **Gumdrop Meadow** | Sunny rolling hills, giant gumdrops, lollipop trees and candy-cane fences, all on a heart-shaped road | Ready to race |
| **Starlight Galaxy** | Stella's glowing star road floating in space, with planets, crystal islands and an observatory | Ready to race |
| **Sundae Slopes** | Ice-cream mountains, waffle-cone towers, a chocolate river and sprinkle snow | Ready to race |

### 🫧 Bubble Cup

| Track | What's there | Unlock |
|---|---|---|
| **Bubblegum Bay** | A pink-sea beach: a bubblegum road, a boardwalk pier hump, a sandcastle hairpin, a gumball-machine lighthouse and giant wobbly gum bubbles | Finish 1 race |
| **Mermaid Lagoon** | Dive through a glass bubble tunnel UNDER the lagoon (fish, coral and a glowing pearl), then wiggle through coral S-bends on a mermaid-scale road | Win 1 race |
| **Teddy Toyland** | Toy-sized racing on a play-mat road that snakes round the playroom floor, up a crayon ramp onto giant picture books, past a waving teddy and a toy train | Finish 3 races |
| **Honeycomb Hive** | Bizzy's home: a hexagon honey road round a flower-shaped loop, over a hilltop honey pot and straight through a giant beehive full of friendly bees | Use 10 items |

### ☕ Cozy Cup

| Track | What's there | Unlock |
|---|---|---|
| **Pumpkin Pie Patch** | A golden harvest farm: smiling pumpkins, hay-bale hops, a red covered bridge over Apple Juice Creek and spinning pie windmills round a big hairpin | Finish top 3 on 2 different tracks |
| **Teacup Garden** | A tea party on a gingham tablecloth road: a long swoop round a steaming polka-dot teapot, the spinning teacup ride, macaron towers and a hedge-maze wiggle | Win 2 races |
| **Peppermint Village** | A candy-cane shaped road through a snowy gingerbread village at twilight, with twinkly lights, a village tree, snowmen and a skating pond | Do 15 drift mini-turbos |
| **Pillow Fort Dreamland** | Bedtime! A cloud-shaped pajama road over blanket hills, through a pillow-fort tunnel, past counting sheep and a sleepy crescent-moon night-light | Finish 6 races |

### 🌋 Adventure Cup

| Track | What's there | Unlock |
|---|---|---|
| **Jellybean Jungle** | A figure-eight through a candy jungle: a vine bridge over the start, gummy frogs and the Great Jellybean Tree | Win on any Bubble Cup track |
| **Cocoa Canyon** | Layered chocolate rocks, a slot canyon, the Cocoa Arch, a cocoa waterfall and marshmallow cacti | Finish a Time Trial |
| **Lemonade Volcano** | A fizzy lemonade island with a smiling volcano, geysers and a giant glass of lemonade | Win 4 races |
| **Donut Downtown** | A twinkly night city of bakeries, a neon arch tunnel and a giant donut to drive through | Play 3 races with 2+ players |

### 🌟 Superstar Cup

| Track | What's there | Unlock |
|---|---|---|
| **Cupcake Carnival** 🧁 | A funfair shaped like a cupcake: game booths and bunting, roller-coaster humps under rainbow hoops, a turning ferris wheel with cupcake gondolas, a carousel of candy ponies and a big-top tent you drive right through | Win any Grand Prix cup |
| **Aurora Ice Palace** 🏰 | A snowy night under dancing northern lights: an ice bridge over a frozen river, two zig-zag switchbacks, glowing crystal arches, the Crystal Palace, snowmen and a huddle of hopping penguins | Win on any Cozy Cup track |
| **Moonbounce Base** 🌙 | A crescent-moon road with boing-boing moon moguls, a glass tube tunnel, a friendly rocket in the big crater and moon bunnies doing floaty hops. Low gravity makes your hops extra floaty! | Win 8 races |
| **Ribbon Sky Rally** 🎀 | The grand finale: a rainbow ribbon road over the clouds that twirls over and under itself, with hot-air balloons, giant bows, rainbow gates and the Superstar Trophy | Win on 6 different tracks |

## Coming soon: online play 🌐

We're building friends-only online races: room codes, no public matchmaking, no typed chat (just
cute preset emotes), and a grown-up switches it on behind the parent gate. The one-time hosting
setup for grown-ups is in **[docs/INFRA_SETUP.md](docs/INFRA_SETUP.md)** (coming soon: online play).

---

## For developers

- **Stack:** Vite + Three.js, plain ES modules. All the sound is made live with Web Audio (there are no audio files).
  There are no 3D model files either: everything is built from code.
- `npm test` runs the unit tests (vitest); `npm run test:coverage` adds the coverage gate CI uses (report in `coverage/`).
- `npm run build` makes a production build in `dist/`.
- `npm run smoke` (`node scripts/smoke.mjs`) is the end-to-end test. It starts Vite on port 5190 and uses Playwright
  with the system Chrome to race every track with 1, 3 and 4 players. It also runs the menu flow with the keyboard,
  the menu flow with a simulated controller, the menus at full v2 size, and a race that reaches the results and unlock screens.
  Screenshots are saved in `smoke-out/` (failures also get a `-FAIL.log` with the console and game state).
  It waits on the game clock, so slow machines just take longer; `CI=1` runs the lighter CI profile and
  `SMOKE_PORT=<port>` picks another port. Details in `CONTRIBUTING.md`.
- See `ARCHITECTURE.md` for how the modules fit together (the v2 contract: content lineup, one file
  per racer in `src/characters/`, one module per track in `src/tracks/`, the event bus and auto-installed
  systems in `src/systems/`, menu screens in `src/ui/screens/`) and `CONTRIBUTING.md` for the git workflow.

### Debug URL parameters

| Param | Effect |
|---|---|
| `?quick=<trackId>` | Skip the menus and start a race (`cotton-candy-castle`, `gumdrop-meadow`, `starlight-galaxy`, `sundae-slopes`) |
| `&players=1..4` | Human players in a quick race (keyboard 1, keyboard 2, then virtual pads) |
| `&speed=cozy\|zippy\|zoomy` | Speed class |
| `&autodrive=1` | Human karts drive themselves |
| `&fastfinish=1` | One-lap races |
| `&cpus=0..7` | Number of CPU racers in a quick race |
| `&simspeed=1..8` | Run the simulation N times per frame (for automated tests) |
| `?unlockreset=1` | Reset saved unlocks and trophies |
| `?democontent=1` | Menus show locked placeholders for the whole v2 lineup (21 racers, 20 tracks) |
| `?mode=gp&cup=<cupId>` | Skip the menus and start a Grand Prix (e.g. `sprinkle-cup`; works with `players`, `speed`, `autodrive`, `fastfinish`, `cpus`, `laps`) |
| `?mode=tt&quick=<trackId>` | Skip the menus and start a Time Trial on that track (P1 only, vs your saved ghost) |
| `?mode=gp&cup=my-cup&mycup=a,b,c,d` | Skip the menus and start a custom *My Cup* of those tracks (up to 4) |
| `?mode=tutorial` | Skip the menus and start the How to Play practice race (add `&quick=<trackId>` / `&laps=` to change it) |
| `?attract=0` | No title show behind the logo (the ✨ Effects screen has the same switch) |

`window.__game` exposes `state`, `race`, `session`, `fps`, `setup`, `lastResults` (with the race summary) and the event `bus` for tests,
plus `gp` / `lastGp` (the running Grand Prix and its latest GrandPrixResult) and `timeTrial` (ghost info).
Showcase extras add `attract()`, `weather()`, `reactions()`, `spectacle()`, `podium()`, `photoMode()` (each `null` when idle), `music()` (song + layer mix),
`lastPhoto` and `confettiBurst(pos, opts)`.
