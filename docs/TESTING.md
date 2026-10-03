# Testing

## Quick checks

```bash
npm run typecheck   # TypeScript, strict mode, no emit
npm run build       # typecheck + production bundle
```

Both must pass before a commit.

## Automated tests

`npm test` runs `tests/run-all.mjs`, which runs three suites in turn and
fails if any did (so one red suite never hides the others). `tests/api.mjs` starts `server/index.mjs` on a
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
bundle. It ends with a touch-mode page (`?touch=1`) that taps with a
held press, the way a finger does, to cover the two title-screen bugs fixed
in the game menu: tapping a menu entry must start it, and MAIN MENU from the
pause popover must not start a new run. Finally `tests/boardmasters-e2e.mjs`
opens `boardmasters.html` on another spare port and drives the sequel's
prototype through its states via the dev-only `window.bm` handle: title and
attract mode, start, forward travel, carving, pumping, braking, jumping and
landing, the rival, buoys, ramps and finish, a wipeout, restart, the finish,
and Escape back to the main menu, with no console errors, plus character
select, the field of eight, punch and barge knockouts, a clean 360 and a
crashed 180, RAGE, the barrel roll and boost combos, pause, the follow
camera and terrain, and a phone-shaped page (touch, upright view, tap to
start and jump, the HIT and pause buttons, a held RIGHT on the pad, and the
pad's barrel roll). Waits are on game state, not the clock, because SwiftShader runs
the simulation slower than real time. Both browser suites spawn Vite's own
script so killing it really stops the server.

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

(Playwright pins a Chromium revision; when a preinstalled browser is a
different revision, `CHROMIUM_PATH` is the way to use it.)

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

## Manual test script (Waves of Rage 2)

1. Title: the logo and course name show over the attract-mode surfer; Space
   (tap on touch) starts; Esc (MENU corner on touch) returns to the main
   menu page.
2. Riding: the surfer sits on the drawn water at all times; the camera stays
   behind at waist height and never goes under a wave; Left/Right carve
   with a visible lean, Up gains speed (bar), Down brakes.
3. Air: Space jumps; riding fast over a crest or any ramp launches without
   pressing anything; a landing after half a second shows `AIR +100`, after
   a second `BIG AIR +250`; the shadow shrinks while airborne.
4. Hazards: hitting a skull buoy flashes the surfer, shows `OUCH!` and costs
   a heart; the third hit shows `WIPEOUT` and the results panel after a
   moment; touching the rival shows `BUMP` and pushes both apart.
5. Endless: there is no finish; the buoys come thicker and the cruising
   speed rises with distance; after a wipeout the results show distance,
   place, score, knockouts and `NEW BEST!` when it is one; the title shows
   the best; Space restarts from the start line with three hearts.
6. Combat: X beside a rival shows `HIT!` and flashes it, a second X shows
   `KNOCKOUT +500` and the rival tumbles, then reappears behind you; two
   knockouts within four seconds show `X2`; Shift shoves a rival hard and
   costs you a little speed; a rival shoved into a buoy shows
   `INTO THE BUOY +750`; strong rivals shove you (`SHOVED!`) when alongside.
7. Tricks: in the air Left/Right spin and X grabs; a clean 360 shows
   `360 +...`, a half spin shows `WIPEOUT -1` and a tumble.
8. RAGE: the meter fills with tricks and knockouts; full, `RAGE!` shows,
   the sea turns pink, you ride faster, one hit knocks out and buoys show
   `SMASH +100`; it drains over eight seconds.
9. Character select: Left/Right on the title cycle the seven riders with
   their stat bars; the rig changes; the choice survives a reload.
10. Pause: Esc (the top-centre button on touch) shows PAUSED; Space (tap)
    resumes; M (MENU corner) returns to the main menu with the sequel's
    entry highlighted.
11. Look: `bm.look.snap = false` in the console stops the polygon jitter,
    `bm.look.affine = false` straightens the water texture, `bm.look.quantize
    = false` removes the banding, `bm.look.dither = false` the dither;
    `?res=320` is blockier.
12. Touch (`?touch=1`, or a phone): the field is upright; holding LEFT or
    RIGHT on the pad carves, holding UP pumps, JUMP jumps (a tap elsewhere
    does too), HIT and BRG attack, the top-centre button pauses, MENU works;
    the first tap goes fullscreen where allowed.
13. Combos: RIGHT RIGHT UP (keys or pad, within about half a second) shows
    `BARREL ROLL!`, launches the surfer into a full roll about the board
    and lands for `BARREL ROLL +...`; UP UP shows `BOOST!` and a burst of
    speed and spray; the presses show briefly under the surfer.
14. Console: no errors throughout, on either page.

## Manual test script (Waves of Rage)

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
14. Game menu: Up/Down (or W/S) move the cursor between the WAVES OF RAGE
    and WOR 2: BOARDMASTERS buttons; Space starts the highlighted one;
    clicking or tapping a button starts that game at once (the Boardmasters
    button opens `boardmasters.html`); Left/Right still change the
    difficulty under WAVES OF RAGE. On touch, MAIN MENU from the pause
    popover returns to the title and nothing starts by itself.
