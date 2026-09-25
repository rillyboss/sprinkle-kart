# Sprinkle Kart — Architecture & Module Contracts

A cute, family-friendly **3D local split-screen kart racer** (1–4 human players + CPU racers)
made for Sophia. Vite + Three.js (npm `three`), plain modern JavaScript ES modules (no
TypeScript, no other runtime deps). DOM overlay for menus/HUD. Web Audio synth for sound.
Runs with `npm run dev`. Tests with `npm test` (vitest, node env — pure logic only).

**Tone rules (everyone):** everything is friendly and silly. No violence words: karts get
"bonked", "wobbled", "spun into a happy twirl" — never "hit/killed/destroyed" in UI text.
Nobody can fall off the track. Characters are ORIGINAL (inspired by the vibe of classic kart
games, but no Nintendo names, likenesses, logos or trademarks).

## Files & owners

| Path | Owner | What |
|---|---|---|
| `src/track/TrackPath.js` | done | closed spline, arc-length `s`, `project()` — READ IT |
| `src/render/toon.js` | done | `toon(color, opts)`, `glow(color)`, `addOutline(mesh)` — use for all materials |
| `src/save/progress.js` | done | `isUnlocked`, `unlock`, `recordWin`, `resetProgress` |
| `src/config.js` | done | shared constants (below) |
| `src/data/characters.js` | characters | roster data |
| `src/render/characterModels.js` | characters | procedural 3D kart+driver models |
| `src/render/portraits.js` | characters | render roster portraits to data URLs |
| `src/data/tracks.js` | tracks | 4 track definitions |
| `src/render/trackBuilder.js` | tracks | builds road + scenery + sky for a track |
| `src/race/*.js` | race | kart physics, AI, items, laps, standings |
| `src/input/InputManager.js` | input | keyboard + gamepads, joining, menu events |
| `src/audio/AudioManager.js` | audio | synthesized music + SFX |
| `src/ui/*.js`, `src/ui/ui.css` | ui | all menus, HUD, results, unlock celebration |
| `src/main.js`, `index.html`, `src/render/SplitScreen.js`, `src/render/CameraRig.js` | integrator | boot, game state machine, split-screen rendering |
| `tests/*.test.js` | each owner | unit tests for pure logic |

Only edit files you own. If you need something from another module, code against the
contract below exactly.

## Shared conventions (from TrackPath.js)

- World up = +Y. Units ≈ metres. A kart is ~2.2 long, ~1.6 wide.
- Arc length `s` along the centre line, 0 = start/finish line, racing direction = increasing s.
- `right = (-tz, 0, tx)`; `lateral` = signed offset along right.
- **Model forward is local +Z.** heading `h` ⇒ forward = `(sin h, 0, cos h)`; `object.rotation.y = h`.
- `path.headingAt(s)` gives the heading that faces along the track.

## `src/config.js`
```js
export const MAX_PLAYERS = 4;
export const RACERS_PER_RACE = 8;         // humans + CPU fill
export const DEFAULT_LAPS = 3;
export const SPEED_CLASSES = { cozy: {...}, zippy: {...}, zoomy: {...} }; // maxSpeed, accel, aiSkill
export const UNLOCK_CHARACTER_ID = 'cotton-candy-girl';
```

## Characters — `src/data/characters.js`
```js
export const CHARACTERS = [ /* CharacterDef */ ];
export function getCharacter(id) -> CharacterDef
export function getSelectableCharacters(isUnlockedFn) -> CharacterDef[]  // hides locked ones
```
`CharacterDef`:
```js
{
  id: 'rocco',                 // kebab-case, unique
  name: 'Rocco Ravioli',
  tagline: 'Short funny line',
  personality: 'one sentence',
  colors: { primary: 0xe23b3b, secondary: 0x2f5fd0, accent: 0xffd23f, kart: 0xe23b3b },
  stats: { speed: 1-5, accel: 1-5, handling: 1-5, weight: 1-5 },   // small effect only
  voice: { pitch: 0.5-2.0, style: 'giggle'|'hoho'|'yay'|'boing'|'hum' }, // for AudioManager.voice()
  locked: false,               // true only for cotton-candy-girl
}
```
Roster (8 + 1 unlockable), all original, funny and cute:
1. `rocco` **Rocco Ravioli** — jolly, round pasta chef with a giant bushy mustache & tall red chef hat (red/blue). Mario-vibe hero.
2. `lenny` **Lenny Linguine** — Rocco's tall, noodly, nervous little brother, green chef hat, knees wobble. Luigi-vibe.
3. `stella` **Stella Starbloom** — calm, dreamy space princess, teal star gown, glowing star wand, a tiny floating star buddy "Twinkle". Rosalina-vibe.
4. `peachy` **Princess Peachy Pie** — sweet pink princess with a crown made of a tiny peach pie, curly hair. Peach-vibe.
5. `gumbo` **Gumbo Gummybear** — big grumpy-but-huggable gummy bear "villain" with little horns made of candy corn. Bowser-vibe.
6. `muffin` **Muffin Button** — tiny excited cupcake kid with a cherry on top, squeaky voice. Toad-vibe.
7. `dino` **Doodle Dino** — lime-green, goofy, always-hungry dinosaur with a saddle. Yoshi-vibe.
8. `bizzy` **Bizzy Bumble** — silly bumblebee who talks in puns, tiny wings buzzing.
9. `cotton-candy-girl` **Cotton Candy Girl** — LOCKED. Fluffy pink-and-blue cotton-candy cloud hair, sparkly cape, cone-shaped wand, rides a fluffy cloud kart. Unlocked when any human player wins 1st place.

## Character models — `src/render/characterModels.js`
```js
export function buildKartModel(charDef) -> KartModel
KartModel = {
  group: THREE.Group,        // origin at ground under kart centre, forward = +Z, ~2.2 long
  update(dt, state),         // state: {speed, steer(-1..1), drifting(bool), driftLevel(0..3),
                             //         spinning(bool), boosting(bool), shielded(bool), time}
                             // animates wheels, driver lean, bobbing, drift sparks colours,
                             // boost flame (sparkly rainbow puff), shield bubble visibility.
  dispose(),
}
```
Chibi proportions (big head ~45% of height, big eyes with highlights, rosy cheeks, smile).
Built only from Three.js primitives + `toon()` materials. Low poly (< ~3k tris per kart).

## Portraits — `src/render/portraits.js`
```js
export async function renderPortraits(characters, size = 256) -> Map<id, dataURL>
```
Uses its own small offscreen `THREE.WebGLRenderer` (dispose it after), a 3/4 front view
of `buildKartModel(def).group`, transparent background.

## Tracks — `src/data/tracks.js`
```js
export const TRACKS = [ /* TrackDef */ ];
export function getTrack(id) -> TrackDef
```
`TrackDef`:
```js
{
  id: 'cotton-candy-castle',
  name: 'Cotton Candy Castle',
  subtitle: 'Princess Peachy Pie\'s sugary palace',
  laps: 3,
  width: 18,                                   // road width
  controlPoints: [[x,y,z], ...],              // closed loop, race order, total length 900–1600
  theme: {
    skyTop, skyBottom, fogColor, fogNear, fogFar,  // hex numbers
    ground, road, roadAlt, curbA, curbB, offRoad,
    music: 'castle' | 'meadow' | 'galaxy' | 'sundae',
    sunColor, ambientColor,
  },
  itemBoxRows: [0.15, 0.42, 0.7],              // fractions of track length; a row of 4–5 boxes across road
  boostPads: [{ at: 0.3, lateral: -3 }, ...],  // fractions + lateral offset
  previewColor: 0xffa6d8,                      // for menu card
}
```
4 tracks (curves gentle enough for kids; elevation changes gentle, max ~15 units):
1. `cotton-candy-castle` **Cotton Candy Castle** (the star track, Peach's-castle vibe): pink/white candy palace with towers & heart flags, cotton-candy cloud trees, a moat of strawberry milk, sprinkle road, rainbow bridge.
2. `gumdrop-meadow` **Gumdrop Meadow** — sunny rolling hills, giant gumdrops, lollipop trees, candy-cane fences.
3. `starlight-galaxy` **Starlight Galaxy** (Stella's) — night sky, glowing star road floating in space over purple clouds, planets, observatory.
4. `sundae-slopes` **Sundae Slopes** — ice-cream mountains, waffle-cone towers, chocolate-sauce rivers, snowy sprinkles.

## Track builder — `src/render/trackBuilder.js`
```js
export function buildTrack(trackDef, path /* TrackPath */) -> BuiltTrack
BuiltTrack = {
  group: THREE.Group,          // road ribbon, curbs, start line, ground, scenery, lights
  sky: THREE.Object3D,         // big gradient sky dome (added to group too)
  itemBoxSlots: [{ s, lateral, position: Vector3 }],  // computed from itemBoxRows
  boostPads: [{ s, lateral, length: 6, halfWidth: 2.5, position: Vector3 }],
  lights: [...],               // hemisphere + directional; added to group
  update(dt, time),            // animate flags, sparkles, floating things
  dispose(),
}
```
The road follows the path including y. Under elevated sections draw supports (frosting pillars
/ wafer columns) so nothing floats unless the theme is space. The builder also sets
`scene.fog`-compatible colors but does NOT touch the scene itself; the integrator applies
`trackDef.theme.fog*` to `scene.fog`. Soft invisible walls are enforced by physics, but the
builder should place visual edge barriers (candy fences/bumpers) at ~`width/2 + 3`.

## Race — `src/race/Race.js` (+ `Kart.js`, `AI.js`, `Items.js` as you see fit)
```js
export class Race {
  constructor({ scene, trackDef, path, builtTrack, participants, speedClass, buildKartModel, onEvent })
    // participants: [{ characterId, playerIndex /* 0..3 or null for CPU */, easyDrive: bool }]
    //   (the Race does NOT add CPU racers itself — the integrator fills to RACERS_PER_RACE)
    // Adds kart models, item boxes, items to `scene`; removes them in dispose().
  update(dt, inputs)       // inputs: array indexed by playerIndex of DriveInput
  karts                    // array of KartState
  getStandings()           // KartState[] sorted by place (1st first)
  getPlayerKart(playerIndex) -> KartState
  state                    // 'countdown' | 'racing' | 'finished'
  countdown                // seconds remaining (3..0) during 'countdown'
  time                     // race seconds since GO
  dispose()
}
DriveInput = { steer: -1..1, accel: 0..1, brake: 0..1, drift: bool (held), useItem: bool (edge, true 1 frame), lookBack: bool }
KartState = {
  id, characterId, playerIndex, isCPU, name,
  position: Vector3, heading, speed, velocity: Vector3,
  s, lateral, lap (starts 1), lapsTotal, progress /* lap*L + s, monotonic */, place,
  finished, finishTime, finishPlace,
  item: null | ItemId, itemRoulette: 0..1 (spinning animation time left),
  boosting, spinning, shielded, drifting, driftLevel, starPower,
  model: KartModel,
}
ItemId = 'sprinkle-boost' | 'triple-sprinkle' | 'gumdrop' | 'bubble-shield' | 'cupcake-rocket' | 'rainbow-star'
```
Events via `onEvent({ type, kart, ... })`: `'countdown' {n:3|2|1}`, `'go'`, `'lap' {lap}`, `'final-lap'`,
`'finish' {place}`, `'item-get' {item}`, `'item-use' {item}`, `'bonked'`, `'boost'`, `'drift-boost' {level}`,
`'bump'`, `'race-complete'`.

Behaviour: arcade handling; drifting builds mini-turbo (3 levels blue→pink→rainbow); boost pads;
off-road (outside `path.halfWidth`) slows; invisible soft wall at `halfWidth + 3` pushes back
(nobody leaves the track); kart-kart bumping; items with friendly effects (bonk = 1.2 s happy
spin, no damage); CPU drivers follow racing line with varied skill, rubber-banding, use items;
`easyDrive` = auto-accelerate + gentle steer assist toward centre + no spin-outs from walls.
Race ends (`'race-complete'`) when all human karts finish (CPU karts get placed by progress), or
30 s after the first human finishes. Countdown 3 s before GO.

## Input — `src/input/InputManager.js`
```js
export class InputManager {
  constructor(target = window)
  update()                           // call once per frame (polls gamepads, computes edges)
  getDevices() -> [{ id: 'kb1'|'kb2'|'gp0'..'gp3', type: 'keyboard'|'gamepad', name, connected }]
  consumeMenuEvents() -> [{ deviceId, action: 'up'|'down'|'left'|'right'|'confirm'|'back'|'start'|'toggle' }]
  getDriveInput(deviceId) -> DriveInput   // see Race; useItem is edge-triggered
  isPausePressed(deviceId) -> bool        // edge
  rumble(deviceId, strength 0..1, ms)     // no-op if unsupported
  onAnyUserGesture(cb)                    // fires once on first key/click/pointer (for audio unlock)
  dispose()
}
```
Keyboard 1 (`kb1`): WASD drive, Space drift, E item, Q look back, Enter/Space confirm, Esc back, Tab toggle.
Keyboard 2 (`kb2`): Arrows drive, Right-Shift drift, Right-Ctrl or `/` item, `.` look back, Right-Shift/`/` confirm... (owner picks non-overlapping; document in README).
Gamepad (standard mapping): A or RT accelerate, B or LT brake/reverse, RB/R1 or X drift, LB/L1 or Y item,
left stick/d-pad steer (deadzone 0.2), Start pause. Menu: stick/d-pad move, A confirm, B back, Y toggle, Start start.
Handle connect/disconnect, stable device ids, and non-standard mappings gracefully.

## Audio — `src/audio/AudioManager.js`
```js
export class AudioManager {
  unlock()                     // resume AudioContext (call from user gesture); safe to call often
  get unlocked()
  playMusic(id)                // 'menu' | 'castle' | 'meadow' | 'galaxy' | 'sundae' | 'victory' | null(stop); crossfade
  setMusicTempo(mult)          // e.g. 1.15 on final lap
  sfx(name, opts)              // 'move','confirm','back','join','countdown','go','item-roulette','item-get',
                               // 'boost','bonk','bump','lap','final-lap','finish','win','unlock','drift-spark',
                               // 'drift-boost','bubble','gumdrop','rocket','star','cheer'
  voice(charDef, kind)         // kind: 'select'|'yay'|'oops'|'win' — cute synthesized babble using charDef.voice
  setVolume({ music, sfx })
}
```
All sound synthesized with Web Audio (no files). Upbeat, happy, major-key chiptune/bubbly style,
per-track melody. Never harsh or loud; master limiter.

## UI — `src/ui/`
All DOM, one root `#ui` over the canvas. Big rounded bubbly fonts (Google Font "Fredoka" or
"Baloo 2" via `<link>` in index.html is fine), pastel candy colours, big hit targets, readable by
kids (icons + short words). Everything navigable by controller AND keyboard AND mouse.
```js
// src/ui/Menus.js
export class Menus {
  constructor(root, { input, audio, portraits /* Map id->dataURL */, characters, tracks, progress })
  // Runs the whole pre-race flow and resolves with a RaceSetup.
  // Title → Join (press A / Enter to join; each device becomes a player P1..P4; Y toggles Easy Drive;
  //         shows controller type icon; B leaves) → Character Select (each player moves own cursor,
  //         colour-coded P1 pink P2 blue P3 green P4 yellow; locked Cotton Candy Girl shows as "?"
  //         silhouette with "Win a race to unlock!") → Track Select (cards for 4 tracks + speed class
  //         Cozy/Zippy/Zoomy + laps) → resolve.
  run(opts = { skipTitle:false, previous: RaceSetup|null }) -> Promise<RaceSetup>
  update(dt)                         // call every frame while menus are active (reads input.consumeMenuEvents())
  showPause(playerLabel) -> Promise<'resume'|'restart'|'quit'>
  showResults({ standings, trackDef, humanWinner: KartState|null, newlyUnlocked: CharacterDef|null })
     -> Promise<'again'|'next-track'|'menu'>   // podium, confetti; if newlyUnlocked: BIG celebration
                                               // "You unlocked COTTON CANDY GIRL!" with her portrait
  hide()
}
RaceSetup = { players: [{ playerIndex, deviceId, characterId, easyDrive }], trackId, speedClass, laps }

// src/ui/Hud.js
export class Hud {
  constructor(root)
  layout(rects)                      // rects: [{ playerIndex, x, y, w, h }] in CSS px (fractions ok too, document which)
  update(race, path, { playerIndices, portraits })   // per viewport: place (1st! with medal colours),
     // lap x/3, item slot with roulette animation, speed-ish boost meter optional, minimap (shared, one
     // canvas) with coloured dots, "FINAL LAP!" banner, countdown 3-2-1-GO! big centre, "Finished! 2nd"
  flash(playerIndex, text)           // quick popup text e.g. "Mini-Turbo!", "Bonk!"
  show() / hide() / dispose()
}
```

## Integrator — `src/main.js`, `src/render/SplitScreen.js`, `src/render/CameraRig.js`, `index.html`
- One `THREE.WebGLRenderer` on `#game` canvas, one scene per race; `SplitScreen` computes viewport
  rects for 1–4 players (1: full, 2: top/bottom, 3–4: quadrants; 3 players → 4th quad shows
  minimap/fun spectator cam) and renders each player camera with `setViewport/setScissor`.
- `CameraRig` chase cam per human kart: smooth follow behind/above, look-ahead, FOV kick on boost,
  look-back support, start-of-race swoop.
- Game state machine: boot (renderPortraits) → Menus.run → build race (TrackPath, buildTrack,
  fill CPU racers with distinct unused characters, excluding locked ones) → countdown/race loop
  (input → race.update → cameras → hud → render) → results; if a human finished 1st:
  `recordWin`, and `unlock(UNLOCK_CHARACTER_ID)` → pass `newlyUnlocked` to results.
- Debug URL params for automated testing: `?quick=<trackId>&players=<1-4>&speed=zippy` skips menus
  and starts a race immediately with keyboard/virtual devices; `?autodrive=1` makes human karts
  drive themselves with the CPU AI (for smoke tests); `?fastfinish=1` sets laps to 1.
  Expose `window.__game` (state, race, fps) for tests.
- `scripts/smoke.mjs`: Playwright using system Chrome (`channel: 'chrome'`, headless, args
  `--use-angle=swiftshader --enable-unsafe-swiftshader`) against `vite preview`/dev server:
  loads quick-race URLs for each track with 1 and 4 players, waits, asserts no console errors and
  that karts progress, saves screenshots to `smoke-out/`.
