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
starts the score API and a Vite dev server on other spare ports, opens
`boardmasters.html` and drives the sequel through its states via the
dev-only `window.bm` handle: title and attract mode, character select,
start, forward travel, carving, pumping, braking, jumping and landing, the
pack of five rivals, the follow camera and terrain, a buoy hit, a shark
(it swims at the surfer and costs 40), the lifeguard boat (it crosses the
course and costs 30 even over a jump), a rival barged into a shark (SHARK
FOOD), the endless course past 2,000 m with the pace up 70 % by 1,800 m,
punch and barge knockouts, rivals fighting back (a telegraphed punch,
dodging it, countering it in the wind-up, the shoulder check's tell), RAGE,
a clean 360 and a crashed 180, forgiving spins (a tap in the air, a carve
carried over a crest, weaving with carve taps, a spin let go at the top, a
held spin through big air), the health bar (exact damage, healing from
tricks you made, the cap, invulnerability, a wipeout at zero), the keyboard
barrel roll and boost combos, pause (which holds the run clock and freezes
wakes, spray and floating words), boost gates, the wipeout with the shared
top 10 (the name prompt for a run that makes it, Space while typing not
restarting, the cleaned name and score on the table and at the API, no
prompt for a run of no score), the best score and distance kept on the
device and shown on the title after a reload, restart, the shore after a
restart, Escape back to the main menu, and a phone-shaped page (touch, an
upright view whose HUD fills the screen, a sideways swipe on the title
changing character, tap to start, the floating stick carving and reversing
without a lift, a flick up jumping and barrel-rolling in the air, a tap
punching, a flick down barging, the gesture hints noted, the pause button,
a knockout that stays in frame, and MENU keeping the URL overrides). Waits
are on game state or the run clock, not wall time, because SwiftShader
renders slowly and a loaded machine slows it further. Both browser suites
spawn Vite's own script so killing it really stops the server.

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

1. Title: the logo, the yellow PLAY row and the character panel show over
   the attract-mode surfer; Space (tap on touch) starts; Esc (MENU corner
   on touch) returns to the main menu page; the BEST row shows the device's
   best score and the distance it was set at (NO RUN YET at first).
2. Riding: the surfer (a faceted low-poly rider in a surf stance, arms out,
   knees soaking up the swell) sits on the drawn water at all times; the
   camera stays behind and above and never goes under a wave; Left/Right
   carve with the rider leaning in and the camera banking a little, never
   reading as the board spinning; Up pumps, Down brakes. DIST counts the
   metres and SCORE grows with them.
3. Air: Space jumps; riding fast over a crest or any ramp launches without
   pressing anything; a landing after half a second shows `AIR +100`, after
   a second `BIG AIR +250`; the shadow shrinks while airborne.
4. Hazards and health: hitting a skull bell buoy splashes, shakes the
   camera, makes the surfer flinch and pulse white, shows `OUCH!` and
   takes a quarter of the HEALTH bar (`-25` under it, the panel flashes
   red); from about 250 m the lifeguard boat crosses the course (`BOAT!`,
   `-30`; a jump does not clear it), from about 550 m sharks swim up the
   course at you and lunge sideways (`SHARK!`, `-40`); below a quarter the
   bar pulses red and the screen edges glow; at zero the surfer pitches
   over the nose into the water and the results say WIPED OUT; landing a
   JUMP, a spin, a grab or a barrel roll cleanly heals (`+n HP` beside the
   surfer).
5. The run: five rivals ride with you; the pace rises as the metres go by
   (noticeably faster by 1,000 m, 70 % faster by 1,800 m) and the buoys
   and sharks come thicker. Riding over a set of cyan chevrons shows
   `BOOST!` and a burst of speed, and the gate vanishes.
6. Combat: X beside a rival swings a punch at it (wind-up, strike,
   recovery); as it lands the game freezes for a few frames, the camera
   shakes, a spark and `HIT!` burst over the rival, which flinches and is
   shoved away while staying in view; a second X shows `KNOCKOUT +500` and
   throws the rival tumbling through the air into a splash, its board
   flying off on its own, then it reappears behind you; two
   knockouts within four seconds show `X2`; Shift shoves a rival hard and
   costs you a little speed; a rival shoved into a buoy shows
   `INTO THE BUOY +750`, into a shark `SHARK FOOD +750`, into the boat
   `INTO THE BOAT +750`; a hit rival shows a small health bar over its
   head. Fighters hit back: a red `!` over a rival (and a flash at that
   screen edge) warns of a punch wind-up or a shoulder-check lean-out;
   carving away or jumping shows `DODGED!`, striking it first shows
   `COUNTER!`, and a blow that lands shows `PUNCHED!` and takes health.
7. Tricks: in the air Left/Right spin and X grabs; a short tap or a spin
   let go settles back upright; a carve carried over a crest never spins;
   a spin held through about a second of air lands as a clean `360 +...`;
   a half turn held into the landing shows `CRASH!` and `-20` (no health
   lost while you are still invulnerable from a hit).
8. RAGE: the meter fills with tricks and knockouts; full, `RAGE!` shows,
   the sea turns pink, you ride faster, one hit knocks out and buoys show
   `SMASH +100`; it drains over eight seconds.
9. Character select: Left/Right on the title (a sideways swipe on touch)
   cycle the seven riders with their stat bars; the rig changes; the
   choice survives a reload.
10. Pause: Esc (the top-centre button on touch) shows PAUSED with DIST and
    SCORE; Space (tap) resumes; M (MENU corner) returns to the main menu
    with the sequel's entry highlighted.
11. Wipeout and the top 10: the results show DISTANCE, SCORE (a star and
    NEW BEST! when it beats the device's best), KNOCKOUTS and the shared
    table (TOP 10 with the server running, TOP 10 OFFLINE without it); a
    run that makes the table shows the name prompt once the panel is up,
    Space while typing does not restart, after OK the entry is lit in
    cyan, SKIP leaves the table unchanged; Space (tap) restarts, Esc (MENU)
    returns to the main menu; the entry appears on another device.
12. Look: compare with docs/art-direction/boardmasters/gameplay-mockup.webp.
    The sea is turquoise near and deep blue far with dithered whitewater, a
    sparse glitter of the sun and foam wakes behind every rider; towering
    cliffs with lit villages, palms and waterfalls run down the left and the
    festival pier with its stage, crowd and BOARDMASTERS banner comes round
    on the right about every 1,200 m; a rival between the camera and the
    surfer fades out in a dither instead of filling the screen. `bm.look.snap = false` in the
    console stops the polygon jitter, `bm.look.affine = false` straightens
    the water texture, `bm.look.quantize = false` removes the banding,
    `bm.look.dither = false` the dither; `?res=320` is blockier.
13. Touch (`?touch=1`, or a phone): the field is upright and the HUD runs
    from the top of the screen to the bottom with no buttons; the hints
    SWIPE TO CARVE, SWIPE UP TO JUMP and TAP TO PUNCH show at the bottom
    until each gesture has been used; dragging sideways and holding carves
    (further is harder, back across reverses, lifting straightens), a flick
    up jumps (a second flick in the air barrel-rolls), a tap punches the
    rival alongside (grabs in the air), a flick down barges, dragging
    sideways in the air spins; the thumb's way back after a flick is not a
    flick; the top-centre button pauses, MENU works; the first tap goes
    fullscreen where allowed; rivals attack less often and hazards are
    further apart than with a keyboard.
14. Combos (keyboard): RIGHT RIGHT UP (about a third of a second apart) shows
    `BARREL ROLL!`, launches the surfer into a full roll about the board
    and lands for `BARREL ROLL +...`; UP UP shows `BOOST!` and a burst of
    speed and spray; the presses show briefly at the bottom.
15. Console: no errors throughout, on either page.

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
