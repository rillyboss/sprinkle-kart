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
npx vite build            # production build must succeed
node scripts/smoke.mjs    # end-to-end: every track 1p/4p/3p, menus (keyboard, pad, full-size), results + unlock
```

Then **look** at the screenshots in `smoke-out/` that show your work (and the ones you might
have affected). `node scripts/smoke.mjs <filter…>` runs a subset while iterating
(e.g. `node scripts/smoke.mjs menu scale`, `node scripts/smoke.mjs bubblegum-bay`) — add a
smoke case for new tracks/screens by appending a function in `scripts/smoke.mjs`.

If `tests/visual.golden.test.js` fails, you changed how an ORIGINAL track or racer is built.
That is only OK when intended: refresh with `UPDATE_GOLDEN=1 npx vitest run tests/visual.golden.test.js`
and explain it in the PR.

## Pull requests

- PR from your branch into `main`; title = what players get ("Bubble Cup: 4 new tracks").
- Description: what changed, which files outside your area you touched (ideally none), how you
  tested (the three commands + which screenshots you checked), anything another workstream must know.
- Keep PRs focused; several small PRs beat one giant one.
- CI (`.github/workflows/ci.yml`) runs tests, build and the smoke test on every PR.

## House style

- Plain modern JS (ES modules), no new runtime dependencies, no TypeScript. JSDoc for contracts.
- Deterministic content: scenery/models draw randomness only from seeded RNGs.
- Friendly words only in anything a kid can read (no "hit", "kill", "crash", "destroy"…).
- Performance: instance anything repeated; racers < ~3k triangles; target 60 fps (≥ 30 fps in 4-player split-screen).
- Nothing touches `document` or WebGL at import time (tests run in node).
