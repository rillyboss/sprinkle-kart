# Sprinkle Kart v2 — Architecture & Module Contracts

A cute, family-friendly **3D local split-screen kart racer** (1–4 human players + CPU racers)
made for Sophia. Vite + Three.js (npm `three`), plain modern JavaScript ES modules (no
TypeScript, no other runtime deps). DOM overlay for menus/HUD. Web Audio synth for sound.
`npm run dev` to play, `npx vitest run` (unit, node env), `npx vite build`, `node scripts/smoke.mjs`
(end-to-end with system Chrome).

**Tone rules (everyone):** everything is friendly and silly. No violence words: karts get
"bonked", "wobbled", "spun into a happy twirl" — never "hit/killed/destroyed" in UI text.
Nobody can fall off the track. Characters are ORIGINAL (no Nintendo names, likenesses, logos
or trademarks). Pumpkins are smiley, never spooky; volcanoes are fizzy lemonade.

This file is the **contract** for the v2 workstreams. Sections:
[Lineup](#1-v2-content-lineup-binding) · [Map of the code](#2-map-of-the-code) ·
[Ownership](#3-workstreams--ownership) · [Adding a racer](#4-how-to-add-a-racer) ·
[Adding a track](#5-how-to-add-a-track) · [Event bus](#6-event-bus) · [Systems & per-frame hooks](#7-systems-per-frame-hooks-and-other-extension-points) ·
[Screens](#8-menus-screen-router) · [Progress & unlocks](#9-progress-stats-and-unlock-rules) ·
[Core contracts](#10-core-contracts-unchanged-from-v1) · [Testing](#11-testing--quality-bar)

---

## 1. v2 content lineup (binding)

The single source of truth is **`src/content/lineup.js`** (ids, display names, cup/pack,
unlock rules). `tests/registries.test.js` fails if a registered racer/track disagrees with it.
All ids are kebab-case and unique across characters **and** tracks (they share one unlock list).

**Cups** (Grand Prix = 4 races, points 15/12/10/8/6/4/2/1 — `src/data/cups.js`):

| Cup | id | Tracks (in order) |
|---|---|---|
| 🍭 Sprinkle Cup | `sprinkle-cup` | cotton-candy-castle, gumdrop-meadow, starlight-galaxy, sundae-slopes (built, always unlocked) |
| 🫧 Bubble Cup | `bubble-cup` | bubblegum-bay, mermaid-lagoon, teddy-toyland, honeycomb-hive |
| ☕ Cozy Cup | `cozy-cup` | pumpkin-patch, teacup-garden, peppermint-village, pillow-fort |
| 🌋 Adventure Cup | `adventure-cup` | jellybean-jungle, cocoa-canyon, lemonade-volcano, donut-downtown |
| 🌟 Superstar Cup | `superstar-cup` | cupcake-carnival, aurora-palace, moonbounce-base, ribbon-sky |

**New tracks** (name — theme — unlock):

| id | Name | Theme | Unlock rule |
|---|---|---|---|
| bubblegum-bay | Bubblegum Bay | pink-sea beach, giant gum bubbles, sandcastles, surfboards | finish 1 race `{stat racesFinished 1}` |
| mermaid-lagoon | Mermaid Lagoon | sparkly lagoon floor/shore, coral, shells, glass bubble tunnel | win 1 race `{stat wins 1}` |
| teddy-toyland | Teddy Toyland | giant toy room: blocks, toy trains, teddy bears, crayon ramps | finish 3 races |
| honeycomb-hive | Honeycomb Hive | Bizzy's home: hexagon honey road, drips, flowers, friendly bees | use 10 items `{stat itemsUsed 10}` |
| pumpkin-patch | Pumpkin Pie Patch | cozy harvest farm, smiling pumpkins, hay bales, pie windmills | top-3 on 2 different tracks `{distinct-tracks top3 2}` |
| teacup-garden | Teacup Garden | tea-party garden: giant teacups, teapots, macarons, hedge maze | win 2 races |
| peppermint-village | Peppermint Village | snowy candy-cane village, gingerbread houses, twinkly lights | 15 drift mini-turbos `{stat miniTurbos 15}` |
| pillow-fort | Pillow Fort Dreamland | bedroom at night: pillow forts, blanket hills, night-lights, sheep | finish 6 races |
| jellybean-jungle | Jellybean Jungle | jellybean trees, vine bridges, gummy frogs | win on any Bubble Cup track `{cup-track bubble-cup win}` |
| cocoa-canyon | Cocoa Canyon | chocolate-rock canyon, cocoa waterfalls, marshmallow cacti | finish 1 Time Trial `{stat timeTrialsFinished 1}` |
| lemonade-volcano | Lemonade Volcano | fizzy lemonade volcano island (friendly yellow, bubbly) | win 4 races |
| donut-downtown | Donut Downtown | twinkly night city of bakeries, donut signs, neon sprinkles | 3 races with 2+ humans `{stat multiplayerRaces 3}` |
| cupcake-carnival | Cupcake Carnival | funfair: ferris wheel, carousel, balloons, bunting | win any Grand Prix cup `{stat cupsWon 1}` |
| aurora-palace | Aurora Ice Palace | crystal ice palace under northern lights | win on any Cozy Cup track |
| moonbounce-base | Moonbounce Base | bouncy moon base, craters, low-gravity hops | win 8 races |
| ribbon-sky | Ribbon Sky Rally | grand finale: rainbow ribbon road over clouds + hot-air balloons | win on 6 different tracks `{distinct-tracks win 6}` |

**Racers**: the original 9 (`rocco, lenny, stella, peachy, gumbo, muffin, dino, bizzy` free;
`cotton-candy-girl` = win 1 race) plus:

| Pack | id | Name | Concept | Unlock |
|---|---|---|---|---|
| A | bruno | Bruno Bananas | gentle giant gorilla, banana-split kart, licorice necktie | finish 2 races |
| A | shelly | Shelly Macaroon | speedy turtle with a pastel macaron shell | win on Gumdrop Meadow `{track gumdrop-meadow win}` |
| A | boo-berry | Boo Berry | shy, giggly blueberry ghost who blushes see-through | top-3 on Starlight Galaxy |
| A | twiggy | Twiggy Licorice | dramatically tall licorice showman, top hat, strikes poses | win 3 races |
| A | captain-crumbs | Captain Crumbs | cookie pirate captain, "Arr-some!", chocolate-chip beard | bonk racers 20 times `{stat bonksGiven 20}` |
| A | baby-bonbon | Baby Bonbon | giggly baby in a bonbon-wrapper onesie, stroller kart | finish 1 race with Kid-Assist `{stat kidAssistFinishes 1}` |
| B | luna | Luna Lollicorn | unicorn, swirly lollipop horn, rainbow mane | win on Cotton Candy Castle |
| B | bleep | Bleep Bloop | tiny toaster robot that pops toast when boosting | finish 1 Time Trial |
| B | puff | Puff the Sprinkle Dragon | tiny dragon who sneezes sprinkles | 25 drift mini-turbos |
| B | prince-ribbit | Prince Ribbit | very polite frog prince with a too-big crown | win on Mermaid Lagoon |
| B | marina | Marina Seashell | cheerful mermaid in a clamshell hover-kart | finish on 8 different tracks `{distinct-tracks finish 8}` |
| B | lulu | Lulu Lamb | sleepy cloud-fluffy lamb in pajamas | finish a race on Pillow Fort `{track pillow-fort finish}` |

**Other v2 decisions:** "Easy Drive"/"Magic Steering" becomes **Kid-Assist** everywhere
(always full gas + strong steering help). Modes: **Free Race** (existing), **Grand Prix**
(cups), **Time Trial** (solo vs ghost). Parents can unlock everything via a simple parent gate
in a **Settings** screen.

---

## 2. Map of the code

```
src/
  main.js                  boot + game state machine; emits game-flow events on the bus
  config.js                shared constants (MAX_PLAYERS, SPEED_CLASSES, PLAYER_COLORS, ...)
  content/lineup.js        BINDING v2 ids/names/homes/unlock rules (read-only for workstreams)
  characters/              racers: one file per racer + shared parts
    index.js               registry (CHARACTERS, getCharacter, getSelectableCharacters, getCharacterEntry)
    pack-original.js       the first 9 racers        pack-a.js / pack-b.js   v2 packs
    parts.js               Kit batcher, outlines, G.* geometry, faces, kart chassis, wheels, FX
    model.js               buildKartModel(def): rig + animation around a racer's build(); effects come from src/fx/
    <id>.js                { def: CharacterDef, build(kit, rig, def) }
    types.js               JSDoc CharacterDef / CharacterEntry
  tracks/                  tracks: one module per track + generic core
    index.js               registry (TRACKS, getTrack, findTrack, getTrackModule, TRACK_PACKS)
    pack-original.js       Sprinkle Cup   pack-bubble / pack-cozy / pack-adventure / pack-superstar.js
    core.js                buildTrack(def, path): road, curbs, fences, arch, pads, sky, lights, ground, clouds
    sceneryKit.js          scatter, candy-floss trees, lollipops, towers, flags, floaters, sparkles, hills, snow
    layout.js              straights+arcs layout DSL (runLayout, makeTrack)
    pathTools.js           seeded rng, road spatial index, terrain, item-box slots, boost pads
    geometry.js            frames/ribbon/wall/outlines/shapes/mat4/Batch/procedural textures
    constants.js           FENCE_OFFSET, SKY_RADIUS, SHOULDER_IN, ...
    <id>.js                { def: TrackDef, buildScenery(ctx), prepare?, buildRoadDetails? }
  fx/                      kart-model effects, one module per owner (§7)
    kartEffects.js         host: buildKartEffects(rig, owned); tags nodes userData.kartFx (not fingerprinted)
    driftSparks.js         drift sparks (driving feel)    powerupEffects.js   boost puff, shield, dizzy stars (power-up)
  data/                    compatibility shims + cups
    characters.js          → re-exports src/characters/index.js (race code + tests import this path)
    tracks.js              → re-exports src/tracks/index.js + runLayout
    cups.js                CUPS, GP_POINTS, cupTracks(), groupTracksByCup(), isCupPlayable(), scoreGrandPrix() ...
  progress/                saved progress + unlock data (progression workstream)
    progress.js            localStorage save: isUnlocked, unlock, recordWin, getRecord, submitRecord, loadProgress, resetProgress
    schema.js              STAT_KEYS, emptyProgress(), mergeProgress(), UnlockRule format, isValidUnlockRule()
    describeUnlock.js      describeUnlock(rule) / describeUnlockShort(rule) / unlockDetail(rule, kind) hint text
    access.js              isAvailable(def) — "may a player use this?" for racers AND tracks
  game/
    events.js              the event bus (bus, createEventBus, EVENTS incl. gp-race-end / gp-end)
    session.js             createSessionHelpers(): sfx/voice/rumble/flash/isHuman/panFor per race
    raceStats.js           per-race counters per human from Race events
    summary.js             raceStartInfo() / buildRaceSummary() payloads, MODES
    setup.js               pure helpers for main.js (debug params, CPU picks, participants, quick races)
    demoContent.js         ?democontent=1 placeholders so menus can be checked at full size
  systems/                 auto-installed bus subscribers (one file each, see §7)
    index.js               listSystems() / installSystems() (import.meta.glob)
    raceFlowReactions.js   countdown / go / lap / final-lap / finish sounds + callouts
    drivingReactions.js    boost / rocket start / drift sparks + turbos / bumps
    itemReactions.js       item boxes / get / use / bonks / shield pops
    progressUnlocks.js     race-end → trophies + Cotton Candy Girl unlock (to be replaced by the rule engine)
  ui/
    Menus.js               screen router (run / showPause / showResults / open / update)
    screens/index.js       screen registry (import.meta.glob)   screens/_shared.js  helpers
    screens/title.js join.js characterSelect.js trackSelect.js pause.js results.js unlock.js
    screenFlow.js          pure flow ordering helpers + menuEntries() / titleFocusReduce() (§8)
    menuState.js           pure reducers for every screen (tested)
    Hud.js + hudLogic.js   race HUD; hudWidgets.js (+ .css) = per-player widget host with anchored zones (hud.addWidget)
    dom.js, ui.css         DOM helpers, base stylesheet (frozen — new CSS goes in your own file)
  race/                    Race, Kart physics, AI (+ Kid-Assist), Items, ItemBoxes, KartFx, tuning,
                           gameplay.js (per-track physics multipliers -> env.gameplay)
  audio/                   AudioManager, sfx.js (+ sfx/*.js packs, SFX_OWNERS overrides), songs.js (+ songs/*.js), voice, synth
  render/                  toon.js, SplitScreen, CameraRig, occlusion, portraits
                           characterModels.js + trackBuilder.js are re-export shims
  input/                   InputManager, gamepad mapping, keyboard layouts, menu repeat
  track/TrackPath.js       closed spline, arc-length s, project()
tests/                     vitest (node) — see §11
scripts/smoke.mjs          end-to-end smoke (Playwright + system Chrome); track list read from the live registry
```

Every old import path still works (`src/data/characters.js`, `src/data/tracks.js`,
`src/render/characterModels.js`, `src/render/trackBuilder.js`, `src/save/progress.js`).
New code should import from the new homes, **except** `src/race/*`, which keeps importing
`../data/characters.js` because the race tests `vi.mock` that path.

**Auto-registration (zero-conflict) folders** — drop a file in, nothing else to edit:
`src/systems/*.js`, `src/ui/screens/*.js`, `src/audio/sfx/*.js`, `src/audio/songs/*.js`
(files starting with `_` are ignored). **Pack files** (`src/characters/pack-*.js`,
`src/tracks/pack-*.js`) each have exactly one owner.

---

## 3. Workstreams & ownership

Rule of thumb: **create files freely inside your own area; edit only files you own**.
"Append-only" = add new entries at the end, never reorder/rename others' lines.
If you truly need a change in a file you don't own, keep it tiny and additive, say so in
your PR description, and cover it with a test (the orchestrator merges in order).

| # | Workstream | Owns (create / edit) | May append to | Must not edit |
|---|---|---|---|---|
| 1 | **Tracks — Bubble Cup** | `src/tracks/{bubblegum-bay,mermaid-lagoon,teddy-toyland,honeycomb-hive}.js`, `src/tracks/pack-bubble.js`, `src/audio/songs/<its track ids>.js`, `src/tracks/props/bubble-*.js` (optional shared-able props), `tests/tracks.bubble.test.js`, `dev/tracks-bubble/**` | — | `core.js`, `sceneryKit.js`, `geometry.js`, `layout.js`, other packs |
| 2 | **Tracks — Cozy Cup** | same pattern: `pumpkin-patch, teacup-garden, peppermint-village, pillow-fort` + `pack-cozy.js`, `props/cozy-*.js`, `tests/tracks.cozy.test.js` | — | same |
| 3 | **Tracks — Adventure Cup** | `jellybean-jungle, cocoa-canyon, lemonade-volcano, donut-downtown` + `pack-adventure.js`, `props/adventure-*.js`, `tests/tracks.adventure.test.js` | — | same |
| 4 | **Tracks — Superstar Cup** | `cupcake-carnival, aurora-palace, moonbounce-base, ribbon-sky` + `pack-superstar.js`, `props/superstar-*.js`, `tests/tracks.superstar.test.js` | — | same |
| 5 | **Characters — pack A** | `src/characters/{bruno,shelly,boo-berry,twiggy,captain-crumbs,baby-bonbon}.js`, `src/characters/pack-a.js`, `tests/characters.packA.test.js`, `dev/characters-a/**` | — | `parts.js`, `model.js`, `index.js`, other packs, `voice.js` |
| 6 | **Characters — pack B** | `src/characters/{luna,bleep,puff,prince-ribbit,marina,lulu}.js`, `src/characters/pack-b.js`, `tests/characters.packB.test.js`, `dev/characters-b/**` | — | same |
| 7 | **Progression / unlocks** | `src/progress/**` (incl. the record storage behind `getRecord`/`submitRecord`), `src/systems/progressUnlocks.js` (+ new `src/systems/progress*.js`, which also handle `gp-end`), `src/ui/screens/unlock.js`, new screens `src/ui/screens/settings.js` (parent gate, reset, unlock-all) and e.g. `collection.js` (reached via `menuEntry`, §8), their CSS files, `src/audio/sfx/progress.js`, `tests/progress*.test.js` | `src/game/summary.js` (new optional fields only) | lineup rules (binding), `Menus.js` router, `title.js` (declare `menuEntry` instead) |
| 8 | **Modes + timing** (Grand Prix, Time Trial + ghost, timers & records) | `src/main.js` (flow / GP loop / time-trial session — the **only** workstream that edits it; emits `gp-race-end` / `gp-end` built with `scoreGrandPrix()`), `src/race/Race.js` (race rules: items on/off, CPU count, ghost hooks — keep `env.gameplay`), `src/modes/**` (new), `src/systems/raceFlowReactions.js` (+ new `src/systems/timing*.js`, `gp*.js`; best times via `progress.submitRecord`), new screens `modeSelect.js` (order 25), `cupSelect.js`, `gpStandings.js`, `timeTrialResults.js`, HUD widgets for timers (`src/ui/widgets/timer*.js`, anchor `top-center`), `src/audio/sfx/race-flow.js`, `src/game/summary.js`, `src/game/setup.js`, `tests/modes*.test.js` | `src/config.js` | `Hud.js` internals (use widgets), `menuState.js` existing reducers (add new ones in `src/modes/`), `src/progress/*` (call its API) |
| 9 | **Driving feel** (drift tuning, Kid-Assist, driving SFX/FX) | `src/race/Kart.js` (reads `env.gameplay`), `src/race/AI.js` (Kid-Assist = `applyEasyDrive`), `src/race/tuning.js`, `src/fx/driftSparks.js`, `src/systems/drivingReactions.js` + new `src/systems/drivingSounds.js`, `src/audio/sfx/driving.js` (may `override` boost / bump / drift-spark / drift-boost), HUD widgets `src/ui/widgets/drive*.js` (anchor `bottom-center`), the `ASSIST_LABEL` constant in `src/ui/screens/join.js` + README Kid-Assist section, `tests/race.physics*.test.js`, `tests/driving*.test.js` | `src/audio/AudioManager.js` (new methods at the end, if `sfxCore()` isn't enough) | `Race.js` (ask modes), items, `src/fx/powerupEffects.js` |
| 10 | **Power-up clarity** (item FX / SFX / HUD callouts) | `src/race/Items.js`, `src/race/ItemBoxes.js`, `src/race/KartFx.js`, `src/fx/powerupEffects.js` (boost puff, shield bubble, dizzy stars), `src/systems/itemReactions.js` (+ new `src/systems/item*.js`; owns item-boost sounds), `src/audio/sfx/items.js` (may `override` item-roulette / item-get / bonk / bubble / gumdrop / rocket / star), `src/ui/Hud.js` (item slot / roulette) + `src/ui/widgets/item*.js` (anchors `under-cluster`, `callout`), `tests/race.items*.test.js`, `tests/items*.test.js` | `src/ui/hudLogic.js` (`ITEM_ICONS` etc.) | `Kart.js` physics (ask driving), `src/fx/driftSparks.js` |

Shared, owned by the architect/orchestrator (change only with a heads-up in the PR):
`ARCHITECTURE.md`, `CONTRIBUTING.md`, `src/content/lineup.js`, `src/characters/{parts,model,index,types}.js`,
`src/fx/kartEffects.js`, `src/race/gameplay.js`, `src/audio/sfx.js` (built-in book + `SFX_OWNERS`), `src/ui/hudWidgets.css`,
`src/tracks/{core,sceneryKit,geometry,pathTools,layout,constants,index,types}.js`, `src/data/cups.js`,
`src/game/{events,session,raceStats}.js`, `src/systems/index.js`, `src/ui/{Menus,screenFlow,menuState,dom,hudWidgets}.js`,
`src/ui/screens/{index,_shared,title,join,characterSelect,trackSelect,pause,results}.js`, `src/ui/ui.css`,
`scripts/smoke.mjs` (append new test functions only; tracks come from the registry, never add ids),
`tests/visual.golden.test.js` + `tests/golden/*` + `tests/helpers/fingerprint.js`, `tests/contract.seams.test.js`, `tests/kartEffects.test.js`,
`README.md` (each workstream edits only its own section).

Cross-workstream seams (agree in PR descriptions, don't reach into each other's files):
- **Moonbounce Base low gravity**: the track sets `def.gameplay = { gravity: 0.55, hopBoost: 1.4 }`;
  `Race` normalises it (`src/race/gameplay.js`: defaults 1, clamped) into `race.gameplay` and hands it to
  physics as **`env.gameplay`** (`stepKart(kart, input, env, dt)`). The driving-feel owner decides what the
  multipliers do in `Kart.js`; nobody needs to touch `Race.js` for it.
- **Grand Prix -> progression**: modes emits `gp-race-end` after every GP race and `gp-end` after the last one,
  with a `GrandPrixResult` built by `scoreGrandPrix(cupId, raceSummaries)` (`src/data/cups.js`, §6). Progression
  subscribes to `gp-end` to count `grandPrixFinished` / `cupsWon` / `cups[cupId]` and pushes `{ kind, id }` into
  `gp.unlocks`; the GP standings screen (modes) celebrates them with `screens/unlock.js`.
- **Best times**: modes calls `progress.submitRecord(trackId, { raceTime, bestLap })` -> `{ newBestRace, newBestLap,
  previous, record }` and reads `progress.getRecord(trackId)`; progression owns how and where they are stored.
- **Kart effects**: drift sparks = `src/fx/driftSparks.js` (driving), boost puff / shield bubble / dizzy stars =
  `src/fx/powerupEffects.js` (power-up). Neither is in the golden fingerprints, so both restyle freely.
- **Sounds**: a built-in recipe is restyled only by its owner's pack with `override: true` (`SFX_OWNERS`, §7).
  Pad / start / drift boosts are voiced by `drivingReactions.js`; item boosts (`race:boost` with `source: 'item'`)
  by `itemReactions.js` — never both.
- **Settings / Collection**: progression's screens declare `menuEntry` and appear on the title screen (§8);
  mode select may list `where: 'mode-select'` entries the same way.
- **HUD**: widgets pick a reserved zone with `anchor` (§7) so the timer, item callouts and drift meter never overlap.
- **Time Trial**: modes owns the session (`setup.mode = 'time-trial'`, 1 human, no CPUs, no items);
  ghosts record from `race-frame` (kart position/heading) and render a translucent `buildKartModel()`.
- **Kid-Assist**: `easyDrive` stays the field name in RaceSetup/participants/karts
  (summary payloads expose it as `kidAssist`); only the UI label changes.
- **Unlock celebrations**: progression pushes `{ kind, id }` into `summary.unlocks` on `race-end`;
  the results screen shows them (`unlock.js`).

---

## 4. How to add a racer

1. Create `src/characters/<id>.js` (copy an original racer as a template):

```js
import { G, toon, glow, frame, limb, stick, part, addFace, addArms, buildKartBase, makeHead, SKIN, WHITE, TAU } from './parts.js';

/** @type {import('./types.js').CharacterDef} */
export const def = {
  id: 'bruno',                        // from src/content/lineup.js
  name: 'Bruno Bananas',              // exactly the lineup name
  tagline: 'Short, funny line',
  personality: 'One friendly sentence (20+ chars).',
  colors: { primary: 0xffd84d, secondary: 0x7a4a2a, accent: 0xff6fa8, kart: 0xfff3c4 },
  stats: { speed: 3, accel: 3, handling: 3, weight: 4 },   // whole numbers 1..5, total 11..14
  voice: { pitch: 0.6, style: 'hoho' },                     // 'giggle'|'hoho'|'yay'|'boing'|'hum', pitch 0.5..2
  locked: true,                                             // === (unlock !== null)
  unlock: { type: 'stat', stat: 'racesFinished', count: 2 }, // EXACTLY the lineup rule
  pack: 'a',
  pronoun: 'he',                                            // 'she'|'he'|'they' for friendly lines
  emoji: '🍌',
  quotes: { select: 'Ooh-ooh! Banana time!', win: 'Bananas for everyone!', oops: 'Slippy!' },
  camera: { height: 0.3, lookHeight: -0.1 },                // optional: tall hats/hair
};

export function build(kit, rig, def) {
  const c = def.colors;
  buildKartBase(kit, rig, { body: c.kart, trim: c.secondary, seat: c.accent, hub: c.accent });
  const D = rig.driver;
  kit.add(D, G.sph(0.36), toon(c.primary), { p: [0, 0.94, 0] });
  addArms(kit, rig, c.primary, SKIN);
  const R = 0.45;
  const H = makeHead(rig, 1.55);
  kit.add(H, G.sph(R, 18, 12), toon(c.primary));
  addFace(kit, rig, R, { mouth: 'grin' });
  // your own wiggles: rig.anims.push((t, dt, st, s) => { ... });
}

export default { def, build };
```

2. List it in **your** pack file (`pack-a.js` / `pack-b.js`) in menu order.
3. Look at it: `npm run dev` → character select; or `?quick=gumdrop-meadow&players=1` (P1 is
   the first free racer; use the menus to pick yours). Portraits render automatically.

**Parts API** (`src/characters/parts.js`): `G.sph/bowl/box/rbox/cyl/cone/tor/cap/ico/star/heart/tube`
(fresh geometries), `kit.add(target, geo, material, { p, r, q, s, f, outline, ow })`,
`frame(p, r, parent)`, `surf(R, u, v, depth, c, roll)` (a frame on a head sphere),
`limb/stick(kit, target, a, b, r, mat)`, `part(parent, p)` (a sub-group you animate),
`buildKartBase(kit, rig, { body, trim, seat, tire, hub, bar, width, shell, lights, wheels:'classic'|'donut',
fr, rr, steer, steerHeart, hubStar, pipes, icing })`, `addArms`, `makeHead(rig, y)`,
`addFace(kit, rig, R, { eyeColor, eyeU, eyeV, eyeW, eyeH, cheek, mouth:'smile'|'grin'|'tiny'|'none', brows, lashes, c })`,
`addMouth`, `toon(color, opts)` / `glow(color)`, `SKIN`, `WHITE`, `TAU`, `EYE_DARK`, `THREE`.
**Rig**: `rig.root` (spin/drift yaw), `rig.chassis` (kart), `rig.driver` (body, origin at seat),
`rig.head`, `rig.anims.push((t, dt, st, s) => …)`, `rig.bounce`, `rig.headLag`.
`st` = smoothed state `{ t, steer, speedF (0..1), drifting, boosting, spinning, happy, spinA, ... }`;
`s` = raw model state from the race `{ speed, steer, drifting, driftLevel 0..3, spinning, boosting,
shielded, star, driftDir, hop, offRoad, time }` (e.g. Bleep pops toast while `st.boosting`).

**Checklist** (all enforced by tests — run them): chibi proportions (head ~45% of height, big
eyes with highlights, rosy cheeks, smile); model fits the kart box (~2.2 long, 1.3–2.4 wide, sits on
the ground, head behind z 0.2); **< ~3k triangles**; only toon/glow materials; animates without
NaNs for every state; friendly words only; lineup name/pack/unlock match; balanced stats;
never breaks the golden fingerprints of the original 9 (don't edit `parts.js`/`model.js`; the kart effects in
`src/fx/` are not fingerprinted). Per-racer effect wiggles (e.g. Bleep's toast) go in your own `rig.anims`.

---

## 5. How to add a track

1. Create `src/tracks/<id>.js`:

```js
import * as THREE from 'three';
import { toon, glow } from '../render/toon.js';
import { makeTrack } from './layout.js';
import { FENCE_OFFSET, mat4, extruded, heartShape } from './sceneryKit.js';

export const def = makeTrack(
  {
    id: 'bubblegum-bay', name: 'Bubblegum Bay', subtitle: 'Pop! goes the beach',
    laps: 3, width: 18, previewColor: 0xff9ecf, art: ['🫧', '🏖️', '🍬'],
    cup: 'bubble-cup',
    unlock: { type: 'stat', stat: 'racesFinished', count: 1 },   // EXACTLY the lineup rule
    theme: { /* colours, music, builder extras — see below */ },
  },
  { start: [0, 0], heading: 0, startAt: 54, ops: [ /* straights + arcs, see below */ ] },
  (frac, centroid) => ({
    itemBoxRows: [frac('beach', 'mid'), ...],        // 3+ rows, 80+ units apart
    boostPads: [{ at: frac('pier', 'end'), lateral: 3 }, ...],
    scenery: { kind: 'bay', terrain: 'hills', hills: { amp: 6, scale: 0.012 }, center: centroid(),
               fence: { ... }, arch: { ... } },
  }),
);

export function buildScenery(ctx) {
  const { group, rng, scatter, clearOfRoad, groundH, cottonCandyTrees, sparkles, center, extent } = ctx;
  cottonCandyTrees(scatter(80, (x, z) => clearOfRoad(x, z, FENCE_OFFSET + 4)), [0xff9ecf, 0xbfe9ff]);
  sparkles(300, center.x, center.z, extent, 3, 25, [0xffffff, 0xffd1ec]);
}

export default { def, buildScenery };
```

2. List it in **your cup's** pack file (`pack-bubble.js` …) in cup order.
3. Optional music: `src/audio/songs/<id>.js` (see `src/audio/songs/README.md`), then `theme.music: '<id>'`.
   Otherwise reuse `'castle' | 'meadow' | 'galaxy' | 'sundae'`.
4. Look at it: `npm run dev` then `?quick=<id>&players=1&autodrive=1` (quick races ignore locks),
   and `&players=4` for split-screen. `buildTrack(def, path, { module })` also previews an
   unregistered module (handy in `dev/` pages).

**Layout DSL** (`src/tracks/layout.js`, heading convention = TrackPath: forward `(sin h, 0, cos h)`):
`ops` = `{ s: length, y?, hump?, flex?, mark? }` (straight) or `{ turn: ±deg (+ = left), r: radius, y?, hump?, mark? }`
(arc). Turns must sum to ±360. Exactly **two** non-parallel straights get `flex: true`; their
lengths are solved so the loop closes. `y` = elevation at the end of the op (eased), `hump` = sine
bump (bridges). `startAt` moves the start line into the loop so the grid sits on a straight.
`frac(mark, 'start'|'mid'|'end')` → lap fraction; `centroid(fromMark?, toMark?)` → `[x, z]`.

**TrackDef** (`src/tracks/types.js`): `id, name, subtitle, laps, width (16–22), previewColor, art[3],
cup, unlock, controlPoints` (from makeTrack), `theme, itemBoxRows, boostPads, scenery`, optional `gameplay`.

**Theme fields** — contract: `skyTop, skyBottom, fogColor, fogNear, fogFar, ground, road, roadAlt,
curbA, curbB, offRoad, sunColor, ambientColor` (hex numbers), `music` (a song id). Builder extras
(all optional, defaults in brackets):
`night` [false] unlit curbs/arch + softer sun + no clouds · `skyStars` [false] star field ·
`clouds` [!night] · `roadSprinkles: { style: 'dashes'|'dots'|'stars', count [95], palette [castle] }` ·
`groundTints: [3 hex]` [greens] + `groundTintMix` [0.5] · `skirt: { color, trim, rainbow }` (road edge skirt) ·
`pillar: { shape: 'round'|'box', color, ring }` (supports under raised road) · `startLineDark` ·
`underside, undersideGlow, undersideEdge` (void terrain).

**Scenery hints** (`def.scenery`): `terrain: 'flat'|'hills'|'void'` · `hills: { amp, scale }` ·
`basin: { center: [x, z], moatInner, moatOuter, depth }` (ring-shaped dip in flat terrain, e.g. a lagoon; castle uses `castle`) ·
`bridges: [[fromFrac, toFrac], ...]` (terrain kept well below) · `riverLine: [[x, z], ...]` (channel carved
in hills — compute it in a `prepare` hook) · `fence: { post, postAlt, rail, topper: 'ball'|'heart'|'star'|'cane'|'cherry', topperColor, glow }` ·
`arch: { a, b, banner, text }` · `center: [x, z]` (anything else is yours).

**Module hooks**: `buildScenery(ctx)` (required) · `prepare({ def, path, index }) → def` (optional,
before terrain; return a NEW def) · `buildRoadDetails(ctx)` (optional, right after road/curbs).

**Scenery ctx API** (built in `core.js`; everything is deterministic — draw randomness only from `ctx.rng`):

| Field | What |
|---|---|
| `def, theme, path, index, terrain, night` | the (prepared) TrackDef, TrackPath, road spatial index, terrain model |
| `group` | THREE.Group to add your meshes to |
| `rng()` | seeded random 0..1 (seed = track id); call order matters |
| `hw, L, bounds, center, extent` | road half-width, lap length, XZ bounds, centre Vector3, half-size |
| `loopFrames` | road frames sampled every `path.step` (for ribbons/walls) |
| `groundH(x, z)` | ground height (−1000 over the void) · `bridgeWeight[i]` 0 on bridges |
| `distToRoad(x, z, maxR)` · `clearOfRoad(x, z, margin)` | keep props off the road (use margin ≥ `FENCE_OFFSET + 3`) |
| `batch.add(geo, material, matrix, outline=true)` | static props merged per material, with cartoon outlines |
| `own(material)` · `ownTex(texture)` | register things for dispose() (cached `toon()`/`glow()` need not be owned) |
| `outlineMat, toonTex(tex, color, opts), toonVC(opts)` | outline material, textured / vertex-colour toon materials |
| `animate(fn(dt, time))` (or `animators.push`) | per-frame animation |
| `scatter, cottonCandyTrees, floatingShapes, sparkles, backgroundHills, lollipops, tower, heartFlag, fallingSprinkles` | the scenery kit (signatures at the top of `sceneryKit.js`) |
| `FENCE_OFFSET, SHOULDER_IN, SHOULDER_OUT, TREE_CAMERA_CLEARANCE, distToPolyline, smoothstep` | constants/helpers |

Geometry helpers to import from `./sceneryKit.js`: `frames, ribbon, wall, pushedCopy, heartShape, starShape,
archShape, extruded, mat4, Batch, stripeTexture, swirlTexture, waffleTexture, sparkleTexture, makeRng, seedFromString`.
Reusable props of your own go in `src/tracks/props/<cup>-<name>.js` (pure functions taking `ctx`).

**Track testing checklist** (the shared tests run over every registered track automatically —
`tests/tracks.test.js`, `tests/tracksBuilder.test.js`, `tests/registries.test.js`, `tests/race.fairness.test.js`):
length 900–1600 · closed loop, no seam jump · never closer to itself than 1.5× width unless ≥ 8 units
apart vertically (bridges) · min curve radius > 1.15× width and > half-width + FENCE_OFFSET + 5 ·
elevation range ≤ 16, slopes < 0.25 · start on a straight (grid 45 units behind) · item boxes and boost pads
inside the road, pads 12+ from the start and 8+ from item rows · item rows 80+ apart · the ground never pokes
through the road · builds, animates and disposes headlessly · lineup id/name/cup/unlock match · `theme.music`
is a real song · friendly words · a centre-line (non-drifting) kid driver wins at least 3 of 8 Zippy races (`tests/race.fairness.test.js`). Also: look at it in 1p and 4p,
props never block the chase camera, ≥ ~30 fps target on a normal laptop (instancing for anything repeated).
Add your own `tests/tracks.<cup>.test.js` for anything special (tunnels, basins, low gravity data).

---

## 6. Event bus

`src/game/events.js` — `bus.on(name, fn) → off`, `bus.once`, `bus.off`, `bus.emit(name, ...args)`,
`bus.define(name, description)` for your own events. Names must be declared (typo guard); the
`race:*` namespace is open. Handlers run in order; a throwing handler is reported once and never
stops the others.

**Game-flow events** (emitted by `main.js`):

| Event | Arguments | When |
|---|---|---|
| `frame` | `(dt, game)` | every animation frame (menus and races) |
| `menu-enter` | `({ skipTitle, previous })` | the pre-race menus open |
| `race-start` | `(info: RaceStartInfo, session)` | race built, countdown about to start |
| `race-frame` | `(dt, session)` | every frame a race session is on screen (after physics + cameras, before render; `session.paused`, `session.resultsShown`) |
| `race-pause` / `race-resume` | `({ label }, session)` / `({ choice }, session)` | pause menu opens / closes |
| `race-end` | `(summary: RaceSummary, session)` | race complete, **before** the results screen — push unlocks into `summary.unlocks` |
| `results-choice` | `({ choice }, session)` | player picked again / next-track / menu |
| `race-exit` | `({ outcome }, session)` | session torn down |
| `gp-race-end` | `(gp: GrandPrixResult, session)` | a Grand Prix race finished (after its `race-end`); standings so far. Emitted by **modes** |
| `gp-end` | `(gp: GrandPrixResult, session)` | the last race of a cup finished, **before** the GP standings screen; push unlocks into `gp.unlocks`. Consumed by **progression** |

**Race events** — every Race `onEvent` is forwarded as `race:<type>` with `(e, session)`:
`race:countdown {n}`, `race:go`, `race:boost {source:'start'|'pad'|'item'…}`, `race:drift-level {level}`,
`race:drift-boost {level}`, `race:item-box {rolling}`, `race:item-get {item}`, `race:item-use {item}`,
`race:bonked {cause, by}`, `race:shield-pop {cause?, by?, expired?}`, `race:bump {other, strength}`,
`race:lap {lap}`, `race:final-lap`, `race:finish {place}`, `race:race-complete {standings}`.
Every `e` has `e.kart` (KartState, see §10) except countdown/go/race-complete.

**RaceStartInfo** (`src/game/summary.js`): `{ mode: 'free'|'grand-prix'|'time-trial', trackId, cupId,
speedClass, laps, humans: [{ playerIndex, deviceId, characterId, kidAssist }], cpuCharacterIds }`.

**RaceSummary**: `{ mode, trackId, cupId, speedClass, laps, humanCount, raceTime,
humans: [{ playerIndex, deviceId, characterId, kidAssist, place, finished, estimated, finishTime, lapTimes[],
stats: { itemsUsed, bonksGiven, bonked, miniTurbos, driftBoosts[3], boosts, itemBoxes, bumps } }],
standings: [{ characterId, playerIndex, isCPU, place, finished, estimated, finishTime }],
winner: { playerIndex, characterId } | null (a real human 1st place), totals: { itemsUsed, bonksGiven, miniTurbos },
unlocks: [] }` — `unlocks` is a collector: subscribers push `{ kind: 'character'|'track', id }`.

**GrandPrixResult** (`scoreGrandPrix(cupId, races)` in `src/data/cups.js`; both GP events carry it):
`{ cupId, raceIndex, raceCount, finished, races: RaceSummary[], standings: [{ characterId, playerIndex|null, isCPU,
points, place, racePoints[] }] (best first; ties -> more wins -> better latest place), humanWinner: { playerIndex,
characterId } | null (a human 1st on points), bestHumanPlace, unlocks: [] }`.
Events that another workstream subscribes to are declared here in `EVENTS` (ask the architect) rather than with
`bus.define` in the emitter's file: `bus.on` throws on undeclared names, so a subscriber installed before the
emitter's module loads would be skipped.

**Session** (2nd argument of race events): `race, trackDef, setup, mode, laps, humans, playerIndices,
scene, built, path, rigs, spectator, stats, audio, input, hud, params, paused, resultsShown, outcome` plus
safe helpers `isHuman(kart)`, `panFor(kart)`, `deviceFor(kart)`, `sfx(name, opts)`, `voice(kart, kind)`,
`rumble(kart, strength, ms)`, `flash(kart, text)` (from `src/game/session.js`).

---

## 7. Systems, per-frame hooks and other extension points

**Systems** — any `src/systems/<name>.js` default-exporting `{ id, order?, install(bus, app) }` is
installed at boot (order ascending, default 100; built-ins use 10–40). `app = { audio, input, hud, menus,
progress, params, game }`. Return an uninstall function if you keep state.

```js
// src/systems/drivingSounds.js  (driving-feel)
export default {
  id: 'driving-sounds',
  order: 50,
  install(bus, app) {
    let hum = null;
    const offs = [
      bus.on('race-start', () => { hum = null; }),
      bus.on('race-frame', (dt, s) => {
        const core = app.audio.sfxCore();              // null until audio is unlocked
        if (!core || s.paused) return;
        for (const p of s.humans) { const k = s.race.getPlayerKart(p.playerIndex); /* k.speed, k.drifting ... */ }
      }),
      bus.on('race-exit', () => { /* stop your nodes */ }),
    ];
    return () => offs.forEach((off) => off());
  },
};
```

Other zero-conflict extension points:
- **HUD widgets** — `app.hud.addWidget({ id, anchor, order, create(node, playerIndex, vpNode) { return { update(kart, race, t), reset(), destroy() } } })`
  (`src/ui/hudWidgets.js`). One instance per player viewport; put your CSS in your own file. With an `anchor`, `node`
  is the widget's own box inside a shared flex zone (stacked by `order`, removed for you); without one it is the raw
  viewport node and you position yourself (avoid). **Reserved zones** (the built-in HUD has the item slot + lap pill
  in the top corner on the item side, the place badge in a bottom corner, countdown / final-lap banner / flashes /
  wrong-way in the 20-45% band, and the minimap on the divider or a corner):

  | anchor | where | for |
  |---|---|---|
  | `top-center` | top middle | race timer, lap splits, ghost gap (modes + timing) |
  | `under-cluster` | under the item slot, item side | item name, "hold to drag" hints (power-up) |
  | `callout` | centre, from 50% down | big item callouts, "Incoming rocket!" (power-up) |
  | `bottom-center` | bottom middle | drift / turbo meter, speed (driving feel) |
- **SFX packs** — `src/audio/sfx/<pack>.js` default-exports `{ recipes: { name(core, t, o) }, throttle?, override? }`
  (`src/audio/sfx/README.md`). Play with `audio.sfx(name, { pan, volume, pitch, level })`. New names are free;
  a built-in is restyled only by the owner file named in `SFX_OWNERS` with `override: true`:
  `items.js` (item-roulette, item-get, bonk, bubble, gumdrop, rocket, star) · `driving.js` (boost, bump,
  drift-spark, drift-boost) · `race-flow.js` (countdown, go, lap, final-lap, finish) · `progress.js` (unlock).
- **Kart effects** — `src/fx/<effect>.js` modules `{ id, build(rig, owned) -> { update(t, dt, s, st), dispose() } }`
  hosted by `src/fx/kartEffects.js` (nodes tagged `userData.kartFx`, skipped by the golden fingerprints;
  `tests/kartEffects.test.js` animates them for every racer).
- **Continuous sounds** — `audio.sfxCore()` → `{ ctx, noise, out, wet }` or `null`.
- **Songs** — `src/audio/songs/<id>.js` (`src/audio/songs/README.md`).
- **Screens** — `src/ui/screens/<name>.js` (§8).
- **Menu look at full size** — `?democontent=1` shows locked placeholders for all 21 racers / 20 tracks.

---

## 8. Menus: screen router

`src/ui/Menus.js` keeps the v1 API (`run`, `update`, `showPause`, `showResults`, `hide`, `setPortraits`)
and adds `open(id, params)` for one-off screens. Screens are auto-registered from `src/ui/screens/`:

```js
export default {
  id: 'mode-select',
  flow: { order: 25, when: (ctx) => true },   // optional: part of the pre-race flow
  mount(ctx, nav, params) {
    const node = el('div.sk-screen.sk-modes', {}, ...);
    const handle = (ev) => { /* ev = { deviceId, action: up|down|left|right|confirm|back|start|toggle|pick|set|select } */ };
    return { node, cls: 'sk-mode-full', handle, update(dt) {}, refresh() {}, destroy() {} };
  },
};
```

- **Flow**: `title` 10 → `join` 20 → `character-select` 30 → `track-select` 40 (last; calls `nav.finish(setup)`).
  A new screen slots in by `flow.order`. `flow.when(ctx)` or `ctx.draft.skip.add(id)` leaves screens out for
  this run (e.g. Grand Prix: mode select sets `ctx.draft.mode = 'grand-prix'`, a `cup-select` screen at 40 with
  `when: mode === 'grand-prix'`, and track-select gets skipped via `draft.skip`).
- **nav**: `next()`, `back()`, `goto(id, params)`, `finish(setup)` (resolves `run()`), `resolve(value)`
  (resolves `open()` / `showPause()` / `showResults()`).
- **ctx** (= the Menus instance): `input, audio, portraits, characters, tracks, progress, draft, time`,
  `sfx(name)`, `fx(reducerResult)`, `char(id)`, `isLocked(charDef)`, `isTrackLocked(trackDef)`,
  `devices()`, `setCooldown(s)`. `ctx.draft` = `{ previous, joinState, charPicks, charState, trackPrev, mode, skip }`
  and any fields your screens add (e.g. `cupId`). The RaceSetup a flow finishes with may carry
  `mode` and `cupId` — main.js/summary read them (`mode` defaults to `'free'`).
- **Menu entries**: a non-flow screen becomes reachable from the title screen by declaring
  `menuEntry: { label: 'Grown-ups', emoji: '⚙️', order?: 90, where?: 'title' }`. The title screen shows the entries
  as a button row under "Press A" (Down focuses it, Left/Right choose, A opens it with params `{ returnTo: 'title' }`,
  Up/B go back to "Press A"; Start always plays). The screen returns with `nav.goto(params.returnTo ?? 'title')`.
  Other hubs (e.g. mode select) list their own with `menuEntries(ctx.screens, '<their id>')` (`src/ui/screenFlow.js`).
  With no entries the title screen looks exactly as before.
- Keep screen logic in **pure reducers** (like `src/ui/menuState.js`) and test them in node.
- Character select and track select are data-driven over the registries: locked entries show a `?`
  silhouette / padlock with `describeUnlock(rule)` (or `def.unlockHint`; big rosters use the compact
  `describeUnlockShort(rule)` / `def.unlockHintShort` on tiles and keep the full sentence in the panel); rosters > 12 get up to 7 columns and a
  scrolling grid (cursor kept in view); tracks page by cup (tab strip, left/right walks across cups).
- Results: `showResults({ standings, trackDef, humanWinner, unlocks: [{ kind, def }], summary, options? })`
  celebrates each unlock in order (`screens/unlock.js`); pause/results accept custom `options`.

---

## 9. Progress, stats and unlock rules

**`progress.isUnlocked(id)` is the single source of truth** for "has this racer/track been earned";
`src/progress/access.js` `isAvailable(def)` = no rule, or earned. Menus, CPU fill (only unlocked racers
race as CPUs) and cups all use it. A parent "unlock everything" must make `isUnlocked` return true.

Saved progress (`localStorage['sprinkle-kart-progress-v1']`, see `src/progress/schema.js`):

```js
{
  unlocked: string[],               // earned content ids (characters and tracks)
  wins: number, trophies: { [trackId]: n },   // legacy (title screen trophies, track cards)
  stats: { racesFinished, wins, podiums, itemsUsed, bonksGiven, miniTurbos, timeTrialsFinished,
           multiplayerRaces, kidAssistFinishes, grandPrixFinished, cupsWon },
  tracks: { [trackId]: { finishes, wins, top3, bestPlace } },
  cups: { [cupId]: { bestPlace, wins } },
  records: { [trackId]: { bestRace, bestLap } },   // seconds, written via submitRecord() (modes+timing calls it)
  unlockAll: boolean,                              // parent gate
}
```

Loading always goes through `mergeProgress(saved)` (`schema.js`): `stats` is merged key by key over `emptyStats()`,
so a save from an older version gets every new STAT_KEY at 0 (never `undefined + 1 = NaN`), and wrong-typed fields
fall back to empty. Add new counters to `STAT_KEYS` only; the merge picks them up.

**Records API** (`src/progress/progress.js`): `getRecord(trackId) -> { bestRace, bestLap }` (seconds or null) and
`submitRecord(trackId, { raceTime, bestLap }) -> { newBestRace, newBestLap, previous, record }` (invalid or missing
times are ignored). Modes calls it (from a `race-end` system or the Time Trial flow); progression owns the storage.

Counting rules: a "race" is a Free Race or Grand Prix race (not a Time Trial); counters are shared by the
family (any human's result counts once per race); `wins`/`top3` ignore estimated finishes.
The RaceSummary (§6) has everything needed: `humans[].place/estimated/kidAssist/stats`, `humanCount`, `mode`, `cupId`.

**UnlockRule** (plain JSON on `def.unlock`, `null` = free):
`{ type: 'stat', stat: <STAT_KEY>, count }` · `{ type: 'track', trackId, result: 'win'|'top3'|'finish' }` ·
`{ type: 'cup-track', cupId, result }` (any track of that cup) · `{ type: 'distinct-tracks', result, count }`.
Hints: `describeUnlock(rule)` ("Win on Mermaid Lagoon to unlock!"), `unlockDetail(rule, kind)`.
Today `src/systems/progressUnlocks.js` still hard-codes the v1 behaviour (a human win → trophy + Cotton Candy
Girl); the progression workstream replaces it with a rule engine that evaluates every `def.unlock`.

---

## 10. Core contracts (unchanged from v1)

- World up = +Y, units ≈ metres, a kart is ~2.2 long / ~1.6 wide. Arc length `s` along the centre line,
  0 = start line, racing direction = increasing s. `right = (-tz, 0, tx)`, `lateral` = signed offset along right.
  **Model forward is local +Z**; heading `h` ⇒ forward `(sin h, 0, cos h)`, `object.rotation.y = h`.
- `src/config.js`: `MAX_PLAYERS 4`, `RACERS_PER_RACE 8`, `DEFAULT_LAPS 3`, `SPEED_CLASSES { cozy, zippy, zoomy }`,
  `UNLOCK_CHARACTER_ID`, `PLAYER_COLORS`.
- **KartModel** = `buildKartModel(def) → { group, update(dt, state), dispose(), characterId, triangles, head }`
  (effects from `src/fx/`).
- **BuiltTrack** = `buildTrack(def, path, { module? }) → { group, sky, itemBoxSlots, boostPads, lights,
  terrainHeight(x, z), update(dt, time), dispose() }`; the caller applies `theme.fog*` to `scene.fog`.
- **Race** (`src/race/Race.js`): `new Race({ scene, trackDef, path, builtTrack, participants, speedClass,
  buildKartModel, onEvent, laps })`, `update(dt, inputs)`, `karts`, `getStandings()`, `getPlayerKart(pi)`,
  `state 'countdown'|'racing'|'finished'`, `countdown`, `time`, `clock`, `dispose()`.
  `race.gameplay` (normalised `trackDef.gameplay`, `src/race/gameplay.js`); physics gets it as `env.gameplay` in
  `stepKart(kart, input, env = { path, boostPads, emit, gameplay }, dt)`.
  `participants: [{ characterId, playerIndex|null, easyDrive }]`; `DriveInput = { steer -1..1, accel 0..1,
  brake 0..1, drift (held), useItem (edge), lookBack }`.
  **KartState**: `id, characterId, charDef, playerIndex, isCPU, name, position, heading, speed, velocity, s, lateral,
  lap, lapsTotal, progress, place, finished, finishTime, finishPlace, finishEstimated, lapTimes[], item,
  itemRoulette, boosting, spinning, shielded, drifting, driftLevel, starPower, offRoad, wrongWay, easyDrive, model`.
  ItemId = `'sprinkle-boost'|'triple-sprinkle'|'gumdrop'|'bubble-shield'|'cupcake-rocket'|'rainbow-star'`.
- **RaceSetup** (menus → main): `{ players: [{ playerIndex, deviceId, characterId, easyDrive }], trackId,
  speedClass, laps, mode?, cupId? }`.
- **InputManager**: `update()`, `getDevices()`, `consumeMenuEvents()`, `getDriveInput(id)`, `isPausePressed(id)`,
  `rumble(id, s, ms)`, `onAnyUserGesture(cb)`, `onDeviceChange(cb)`, `addVirtualDevice(id, name)`.
- **AudioManager**: `unlock()`, `playMusic(id|null)`, `setMusicTempo(m)`, `sfx(name, opts)`, `voice(def, kind, opts)`,
  `setVolume({ music, sfx })`, `sfxCore()`. All sound is synthesized, happy, never harsh (master limiter).
- **Hud**: `layout(rects)`, `update(race, path, { playerIndices, portraits })`, `flash(pi, text)`, `addWidget(def)`,
  `show/hide/reset/dispose`.
- Debug URL params: `?quick=<trackId>&players=1..4&speed=…&autodrive=1&fastfinish=1&cpus=0..7&simspeed=1..8&laps=n`,
  `?unlockreset=1`, `?democontent=1`. `window.__game` exposes `state, race, session, setup, fps, frames, errors,
  lastResults (incl. summary, unlocks), bus, menus, hud, audio, input`.

---

## 11. Testing & quality bar

- **Every change is covered by tests and the FULL suite stays green** before you move on:
  `npx vitest run` · `npx vite build` · `node scripts/smoke.mjs` (or a filter: `node scripts/smoke.mjs menu scale results`).
- The smoke reads the track list from the live registry: every registered track runs in 1p; 4p runs for the
  Sprinkle Cup, for tracks named in the filter (`node scripts/smoke.mjs bubblegum-bay` -> 1p + 4p) or for all
  tracks with `SMOKE_FULL=1`. Stale `*-FAIL.png` screenshots are deleted at the start of every run.
- Put new tests in new files named after your area (see §3) so they never conflict.
- Shared contract tests run over **every** registered racer/track automatically (`registries`, `characters`,
  `charactersModels`, `tracks`, `tracksBuilder`, `race.fairness`) — new content must pass them, not change them.
- `tests/visual.golden.test.js` fingerprints the ORIGINAL 4 tracks and 9 racers: if it fails you changed shared
  building code; only refresh the goldens (`UPDATE_GOLDEN=1 npx vitest run tests/visual.golden.test.js`) when that
  change is intended, and say so in the PR.
- Smoke screenshots land in `smoke-out/`; LOOK at the ones for your area before opening a PR.
- Headless-safe code: nothing touches `document`/WebGL at import time; guard DOM use (`typeof document`).
