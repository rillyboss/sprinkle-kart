# Contributing to Sprinkle Kart

Read **ARCHITECTURE.md** first — it is the contract (content lineup, file ownership,
extension points, event bus, test checklist).

## Git workflow

- `main` is always playable and green. Never commit straight to `main`.
- **One feature branch per workstream**, cut from the latest `main`:
  `git checkout main && git pull && git checkout -b <area>/<short-name>`
  (e.g. `tracks/bubble-cup`, `characters/pack-a`, `progress/unlock-engine`, `modes/grand-prix`,
  `driving/kid-assist`, `items/clarity`). Parallel work uses git worktrees:
  `git worktree add ../sprinkle-kart-bubble -b tracks/bubble-cup main`.
- **Small, logical commits** with a clear subject line in the imperative ("Add Bubblegum Bay
  layout and scenery"), a short body saying *why*, and the co-author trailer when an AI helped:

  ```
  Add Bubblegum Bay layout and scenery

  Beach loop with a pier jump and gum-bubble floaters; unlock = finish 1 race.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

- Stay inside the files your workstream owns (ARCHITECTURE.md §3). Prefer the zero-conflict
  folders (`src/systems/`, `src/ui/screens/`, `src/audio/sfx/`, `src/audio/songs/`) and your
  own pack file over editing shared files. If you must touch a shared file, keep the change
  tiny and additive, and call it out in the PR.
- Rebase on `main` before opening the PR (`git fetch && git rebase origin/main`), re-run the checks.

## Before every merge (and before you move on to the next step)

Every change is covered by tests, and the **full** suite is green:

```bash
npx vitest run            # unit tests (node) — all of them, not just yours
npm run test:coverage     # same suite + coverage thresholds for the logic modules (what CI runs)
npx vite build            # production build must succeed
node scripts/smoke.mjs    # end-to-end: every registered track 1p (Sprinkle Cup also 4p/3p), menus (keyboard, pad, full-size), results + unlock
```

Then **look** at the screenshots in `smoke-out/` that show your work (and the ones you might
have affected). `node scripts/smoke.mjs <filter…>` runs a subset while iterating
(e.g. `node scripts/smoke.mjs menu scale`; `node scripts/smoke.mjs bubblegum-bay` runs that track in
1p and 4p; `SMOKE_FULL=1` runs 4p for every track). New tracks are picked up from the registry
automatically; add a smoke case for a new screen by appending a function in `scripts/smoke.mjs`.

### Smoke test details

- **Parallel worktrees:** `SMOKE_PORT=5310 node scripts/smoke.mjs <filters>` (each engineer uses their own port).
- **Filters** are substrings of scenario names: a track id (`bubblegum-bay` → `bubblegum-bay-1p` + `-4p`),
  `menu` (menu-flow + menu-scale), `scale`, `gamepad`, `results`, `cotton-candy-castle-3p`.
- **Profiles** (`scripts/smoke-plan.mjs`, unit-tested): local = everything above; `CI=1` = 800×450 viewport at
  devicePixelRatio 1, 4× timeouts, every track in 1p but only `cotton-candy-castle` + `starlight-galaxy` in 4p;
  `SMOKE_FULL=1` = 4p on every track. Knobs: `SMOKE_TIMEOUT_SCALE`, `SMOKE_DRIVE_SECONDS` (game seconds each
  race drives), `SMOKE_RETRIES` (default 1), `SMOKE_VIEWPORT=WxH`.
- **Never sleep on the wall clock.** GitHub runners have no GPU (SwiftShader, 1–3 fps), so every wait is on a
  game condition: `waitGame(page, fn)`, `waitRaceTime`, `driveFor(page, gameSeconds)`, `waitFrames`,
  `waitMenusReady` (menus drop presses during their input cooldown), and `pressKey` / `tapPad` with
  `{ until }` (retries the press until the expected screen/state shows up).
- **Layout is asserted, not just screenshotted:** `layoutAt(t, 'my screen', MY_LAYOUT)` measures a rule set
  (selectors + `overlapProblems` / `insideProblems` / `crossOverlapProblems` from `scripts/smoke-layout.mjs`)
  at 1280x720 and 800x450 and fails the scenario on overlapping or clipped UI.
- **A new smoke case** = an `async function myTest(t)` in `scripts/smoke.mjs` + one line in `FLOW_TESTS`
  (`t.page`, `t.check(ok, msg)`, `t.shot(file)`); it is planned, filtered, retried and reported automatically.
- **When it fails:** `smoke-out/<scenario>-FAIL.png` + `<scenario>-FAIL.log` (problems, `window.__game` state,
  the page's console) and `smoke-out/summary.json`. On GitHub they are in the `smoke-screenshots` artifact and the
  job summary has a table of every scenario.

## Test helpers (`tests/helpers/`)

Shared, tested (`tests/qa.helpers.test.js`) building blocks — use them instead of writing new fakes:

| Helper | What it gives you |
|---|---|
| `raceHarness.js` | `runCpuRace(trackId, { laps, seed, humans, easyDrive, speedClass, dtJitter, inputs, builtTrack: 'real', buildKartModel })` runs a whole race on **any registered track** in ~50 ms and checks physics invariants every frame (`r.problems`, `r.standings`, `r.eventCounts`, `r.events`). Also `trackFixture(id)` (cached `{ def, path }`), `kartProblems(kart, path)` (NaN / through-the-wall / silly-speed checks), `wallLimit(path)`, `stubKartModel()`, `defaultRacerIds(n)`. |
| `headlessSession.js` | `runHeadlessSession(trackId, { humans, laps, systems })` wires a real Race to the bus and **every real system** like `main.js` (race-start → `race:*` → race-frame → race-end → race-exit) on fakes: `s.bus`, `s.audio.played('go')`, `s.hud.flashes`, `s.summary`, `s.errors`. For hand-fired events: `createFakeApp()`, `fakeSession(app, { humans })`, `createFakeHud()`, `createFakeProgress()` (in-memory, never touches the real save). |
| `fakeBus.js` | `createFakeBus()` = the real event bus (name checks, error isolation) + `emitted(name)`, `countOf`, `last`, `emittedNames()`, `errors`. |
| `fakeAudio.js` | `createFakeAudio()` records `sfx` / `voice` / `playMusic` / tempo (`played(name)`, `sfxNames()`), `sfxCore()` once unlocked; `createStrictAudioContext()` is a Web Audio mock that throws on what browsers reject (NaN params, expRamp to 0, start twice…) — hand it to `new AudioManager({ createContext })` to test SFX packs and songs. |
| `fakeInput.js` | `createInputRig()` = the real `InputManager` on a fake window + fake pads + fake clock (`target.keydown/tap`, `connectPad(i).press(PAD.A)`, `frame(ms)`); `createFakeInput()` = scripted stand-in (`pushMenu`, `setDrive`, `pressPause`, `connect/disconnect`, `rumbles`). |
| `threeInspect.js` | `nonFiniteTransforms(root)`, `nonFiniteVertices(root)`, `collectResources(root)`, `watchDisposal(res)`, `buildAndDispose(build)` (what survived `dispose()`: compare two builds to tell a shared cache from a leak). |
| `fingerprint.js` | golden fingerprints of the original tracks / racers (architect-owned). |
| `fakeDom.js` | `createFakeDocument()`: just enough DOM to render HUD widgets in node (`vi.stubGlobal('document', doc)`): classList, textContent / innerHTML, `querySelector(All)` for `.class` / `tag`, `doc.writes` (counts text writes). |
| `kidRace.js` | the fairness kid driver: `kidRace(def, path, built, seed, speedClass)` -> `{ place, won }`, `kidPlaces(def)`, `fairnessSuite(cupId)` (one file per cup: `tests/race.fairness.<cup-id>.test.js`). |

**Automatic coverage for new content:** `tests/qa.registry.{tracks,characters,systems}.test.js` run over the live
registries — every track builds with no NaN, frees its geometries, completes a CPU race and a Kid-Assist race with
dt spikes; every racer animates every state without NaN, frees its geometries and finishes a race as a CPU; every
system survives a whole race on every track. `tests/qa.fuzz.test.js` fuzzes `TrackPath.project` and kart physics on
every track. Nothing to edit when you add a track or racer — if one of these fails, your content has a real problem
(the test name says which track/racer, and fuzz failures print their seed).

**Coverage gate:** `npm run test:coverage` (CI) enforces per-module thresholds in `vite.config.js` for the logic
modules (`src/race`, `src/progress`, `src/input`, `src/modes`, `src/game`, `src/systems`, `src/presentation`,
`src/fx`, `src/data`, `src/characters`, `src/tracks`, `src/ui/widgets`, `menuState` / `screenFlow` / `hudLogic` /
`hudWidgets`, `TrackPath`, `audio/compile`), each 2-4 points under the measured numbers (`tests/ci.coverage.test.js`
keeps floors). Adding logic there? Add tests with it. Logic hiding in a DOM screen (a setup builder, a reducer)
belongs in an exported pure function you can test in node. The HTML report lands in
`coverage/` (CI artifact `coverage-report`). Thresholds only mean something on the full suite — a filtered run
with `--coverage` will report misses.

If `tests/visual.golden.test.js` fails, you changed how an ORIGINAL track or racer is built.
That is only OK when intended: refresh with `UPDATE_GOLDEN=1 npx vitest run tests/visual.golden.test.js`
and explain it in the PR.

## Pull requests

- PR from your branch into `main`; title = what players get ("Bubble Cup: 4 new tracks").
- Description: what changed, which files outside your area you touched (ideally none), how you
  tested (the three commands + which screenshots you checked), anything another workstream must know.
- Keep PRs focused; several small PRs beat one giant one.
- CI (`.github/workflows/ci.yml`): **`test-and-build`** (unit suite with the coverage gate + build, ~3 min) is
  the required gate. The **`smoke`** job runs after it: a short subset on PRs (menus, controller flow,
  results/unlocks, mode menu, one track), the full list on pushes to `main`, manual runs and nightly. Smoke is
  slow on GPU-less runners, so don't wait on it: your local full smoke is the real browser gate. A newer push
  cancels the older run on the same branch. Coverage and smoke screenshots are uploaded as artifacts.

## House style

- Plain modern JS (ES modules), no new runtime dependencies, no TypeScript. JSDoc for contracts.
- Deterministic content: scenery/models draw randomness only from seeded RNGs.
- Friendly words only in anything a kid can read (no "hit", "kill", "crash", "destroy"…).
- Performance: instance anything repeated; racers < ~3k triangles; target 60 fps (≥ 30 fps in 4-player split-screen).
- Nothing touches `document` or WebGL at import time (tests run in node).
