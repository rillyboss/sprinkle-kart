# Sprinkle Kart 🍭🏎️

A cute, silly 3D kart racer for the whole family, made with (and for) **Sophia**.
Up to **4 players** race together on one screen with game controllers or the keyboard,
and CPU friends fill the rest of the 8-kart grid. Nobody gets hurt: karts just get
*bonked* into a happy twirl.

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

---

## Playing

1. **Title:** press **A** (or **Enter**). Whoever presses first is **P1**.
2. **Who's playing?:** every other player presses **A** on their controller (or their keyboard's confirm key) to join.
   Press **Y** to switch on **Kid-Assist 🧸** for that player. **B** leaves. When everyone's in, P1 presses **A**.
3. **Pick your racer:** each player moves their own coloured cursor and presses **A**. Friends can pick the same racer!
4. **Choose a track:** P1 picks the track, the speed (Cozy 🐢 / Zippy 🐇 / Zoomy 🚀) and how many laps.
5. **Race!** Press the gas when the countdown says **GO**. Tip: press the gas just before GO for a sparkly
   *Rocket Start*!

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

### Kid-Assist 🧸

This is for little racers. With Kid-Assist on, the kart **always presses the gas** (even before
**GO**, so it gets a sparkly Rocket Start), **helps steer** along the best line round every bend
and **steers away from the fences**. Pushing the stick left or right picks a lane (to grab an item
box, say); let go and the helper drifts gently back to the best line. Bumping a fence doesn't slow
it down. Pressing **brake** firmly still brakes (and reverses), and drifting still works for kids
who want to try it. Turn it on for each player with **Y** (or **Tab**) on the *Who's playing?* screen.

### Drifting and turbos

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

---

## Unlock **Cotton Candy Girl** ☁️💖

**Win any race (finish 1st) and Cotton Candy Girl joins the team!** She has a giant fluffy
pink-and-blue cotton-candy cloud of hair, a sparkly cape and a cotton-candy wand, and she drives
a fluffy cloud kart. After you unlock her, pick her on the *Pick your racer!* screen.
The game remembers the unlock (and your trophies) in this browser.

To lock her again (to earn her again), open the game with `?unlockreset=1` added to the address, for example
`http://localhost:5173/?unlockreset=1`.

---

## The racers

| Racer | Who they are |
|---|---|
| **Rocco Ravioli** | A jolly pasta chef with a giant wiggly mustache and a tall red chef hat |
| **Lenny Linguine** | Rocco's tall, noodly, nervous little brother, whose knees wobble |
| **Stella Starbloom** | A dreamy space princess with a glowing star wand and her star buddy Twinkle |
| **Princess Peachy Pie** | A sweet princess whose crown is a tiny peach pie |
| **Gumbo Gummybear** | A grumpy-but-huggable gummy bear with candy-corn horns |
| **Muffin Button** | A tiny, excited cupcake kid with a wobbly cherry on top |
| **Doodle Dino** | A goofy, always-hungry dinosaur who drives an eggshell kart |
| **Bizzy Bumble** | A silly bumblebee who talks in puns |
| **Cotton Candy Girl** 🔒 | Fluffy, sparkly and super sweet. Win a race to unlock her! |

## The tracks

| Track | What's there |
|---|---|
| **Cotton Candy Castle** | Princess Peachy Pie's pink candy palace, with heart flags, a strawberry-milk moat, rainbow bridges and cotton-candy trees |
| **Gumdrop Meadow** | Sunny rolling hills, giant gumdrops, lollipop trees and candy-cane fences, all on a heart-shaped road |
| **Starlight Galaxy** | Stella's glowing star road floating in space, with planets, crystal islands and an observatory |
| **Sundae Slopes** | Ice-cream mountains, waffle-cone towers, a chocolate river and sprinkle snow |

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

`window.__game` exposes `state`, `race`, `session`, `fps`, `setup`, `lastResults` (with the race summary) and the event `bus` for tests.
