# Testing

## Quick checks

```bash
npm run typecheck   # TypeScript, strict mode, no emit
npm run build       # typecheck + production bundle
```

Both must pass before a commit.

## Automated tests

`npm test` runs two scripts. `tests/api.mjs` starts `server/index.mjs` on a
spare port with a temporary data directory and checks the score API
(validation, sorting, capping, per-mode tables, rate limiting, persistence,
static serving, path traversal). Set `TEST_DATABASE_URL` to a scratch
Postgres database to also run the same server against the Postgres store
(the suite creates and trims a `scores` table there). Then `tests/e2e.mjs` starts the API on another spare port, a
Vite dev server proxying `/api` to it, drives the game in
headless Chromium with Playwright, and checks the main systems end to end:
title screen, game selection, movement, jumping, ramps and tricks, combat,
health, combos, game over and restart. It reads game state through the dev-only
`window.game` handle, so it runs against the dev server, not the production
bundle.

### Setup (once)

```bash
npm ci
npx playwright install chromium
```

If you already have a Chromium/Chrome binary you would rather use, point
the test at it instead of installing one:

```bash
CHROMIUM_PATH=/path/to/chrome npm test
```

### Run

```bash
npm test
```

Output is one `PASS`/`FAIL` line per check and a summary. The process exits
non-zero on any failure, so it can gate CI.

### How the test controls the game

The test uses a few deliberate hooks that exist for debugging and testing:

- `window.game` (dev builds only) to reach the active scene and its
  objects.
- `ObstacleSpawner.debugSpawn(kind, x?)` to place a rock, rival, shark or
  ramp on demand instead of waiting for the random spawner.
- `gameSpeed.stopFactor = 0` to freeze world scroll while positioning
  things, then `= 1` to resume.

Keep these when refactoring, or update `tests/e2e.mjs` alongside.

## Manual test script

Use this after any change to movement, combat or scoring:

1. Title: artwork fills the window with black bars as needed; `PRESS SPACE`
   pulses; Space and Enter start a run.
2. Movement: arrows and WASD both steer; the surfer stops at the screen
   edges and within the lower half of the screen.
3. Jump: Space hops rocks; you cannot jump again until you land.
4. Combat: X/J punches on the facing side; two punches knock a rival off
   the board and show `+500`; Shift while moving barges with a big shove;
   barging a rival into a rock or shark shows `+750`.
5. Combo: two knockouts within 4 seconds show `COMBO x2` and `+1000`.
6. Ramps: from about 12 seconds in, cyan wedges appear; riding over one
   launches you; left/right spins, X/J grabs; a clean landing shows the
   trick name and points, a bad one shows `WIPEOUT` and costs 1 health.
7. Damage: hearts drop by 1 for rocks, rivals and crashes, 2 for sharks;
   you blink and cannot be hurt again for about a second.
8. Game over: at zero health the world coasts to a halt and the WIPEOUT
   screen shows distance and score; Space restarts, Escape goes to the
   title.
9. F1: debug readout and hitbox outlines toggle on and off.
10. Console: no errors in the browser console throughout.
11. Touch (open `?touch=1` on desktop, or a real phone): the field is
    portrait and fills the width; a tap starts the game and jumps; dragging
    anywhere moves the surfer; in big air a sideways drag spins and a tap
    grabs; on game over a tap restarts and TITLE goes back.
12. High scores: a qualifying run shows the name prompt; Space while typing
    does not restart; after OK the table highlights the entry; SKIP leaves
    the table unchanged; reload and the title shows BEST; a non-qualifying
    run shows no prompt.
13. Difficulty: Left/Right on the title (or tapping the arrows) cycles
    EASY / NORMAL / INSANITY and the choice survives a reload; Easy starts
    with 4 hearts; Insanity is visibly faster; the game-over heading names
    the mode and each mode keeps its own table. With the
    server running (`npm run serve` beside `npm run dev`) the heading reads
    TOP 10 and the entry appears on another device; without it the heading
    reads TOP 10 OFFLINE.
14. Game list: Up/Down (or W/S, or tapping a row) moves the cursor between
    WAVES OF RAGE and WOR 2: BOARDMASTERS; with the sequel selected the
    difficulty row reads PROTOTYPE and Space opens its title card (logo,
    status lines, `WEBGL2 OK`); Esc, Space, a click or a tap returns to the
    title with the cursor still on the sequel. In portrait (`?touch=1`) the
    card shows the whole poster with the status panel over its painted menu.
