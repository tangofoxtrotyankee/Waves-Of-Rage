# Waves of Rage

**The wave fights back. Ride. Fight. Survive.**

Waves of Rage is a browser-based 2D arcade surfing game. The visual direction is
a 16-bit, Mega Drive-era arcade style inspired by the energy and presentation
of games such as *Streets of Rage* and *Road Rash*, but it is an original surfing
game with original assets and gameplay.

> **Status:** feature-complete prototype with a first pixel-art pass, now in
> the playtesting and balancing phase. The 3D sequel, Waves of Rage 2:
> Boardmasters, has its first playable prototype (see below). Title screen, surf down the wave, jump rocks, dodge
> sharks, punch and barge rival surfers off their boards (or into rocks and
> sharks) for combo-multiplied points, hit wave ramps for big air, spin and
> grab for trick points, land clean or wipe out, lose health, see your
> results, restart. Graphics are a first in-house pixel-art pass (generated
> from ASCII pixel maps, see below); no audio yet.

## Tech stack

| Concern            | Choice                                              |
| ------------------ | --------------------------------------------------- |
| Game framework     | [Phaser 3](https://phaser.io/) (3.90.x)             |
| Language           | TypeScript (strict mode)                            |
| Bundler / dev tool | [Vite](https://vite.dev/)                           |
| Internal resolution| 320 x 180 landscape on desktop; 180 x 320 portrait on touch devices (same pixel scale) |
| Scaling            | `Phaser.Scale.FIT` + `CENTER_BOTH` (aspect ratio preserved, letterboxed) |
| Rendering          | `pixelArt: true`, anti-aliasing off, nearest-neighbour upscaling, rounded pixels |
| Input              | Keyboard (desktop browsers)                         |
| Sequel (WOR 2)     | [Three.js](https://threejs.org/) on its own page, `boardmasters.html` (see below) |

The only backend is a small Node server (one dependency, `pg`) that serves
the build and keeps the shared top-10 tables in Postgres or a JSON file.

## Prerequisites

- **Node.js** `^20.19.0` or `>=22.12.0` (required by Vite 8). The current LTS release is recommended.
- **npm** (bundled with Node.js).
- A modern desktop browser (Chrome, Edge, Firefox or Safari).

Check your versions with:

```bash
node --version
npm --version
```

## Installation

```bash
git clone https://github.com/tangofoxtrotyankee/Waves-Of-Rage.git
cd Waves-Of-Rage
npm install
```

## Local development

```bash
npm run dev
```

Vite starts a dev server (by default at <http://localhost:5173>) with hot module
replacement. For the shared high-score table in development, also run
`npm run serve` in another terminal; Vite proxies `/api` to it. Without it
the game uses the per-device table. Open the URL in a desktop browser and click the page so it has
keyboard focus. Edits to anything under `src/` reload automatically.

In development the Phaser instance is exposed as `window.game` for poking at
from the browser console (for example
`game.scene.getScene('GameScene').player`). It is stripped from production
builds.

## Controls

| Action                              | Keys            |
| ----------------------------------- | --------------- |
| Start game (title screen)           | Space / Enter   |
| Choose game (title screen)          | Up / Down, W / S; click or tap a button to start it |
| Choose difficulty (title screen)    | Left / Right, A / D, or tap the arrows |
| Move left                           | Left arrow / A  |
| Move right                          | Right arrow / D |
| Move further up the wave            | Up arrow / W    |
| Move down towards the foreground    | Down arrow / S  |
| Jump (clears rocks only)            | Space           |
| Attack (punch on the facing side)   | X / J           |
| Grab (while in big air)             | X / J           |
| Spin left / right (in big air)      | Left / A, Right / D |
| Shoulder barge (while moving L/R)   | Shift           |
| Pause (RESUME / RESTART / MAIN MENU) | Esc or P, or the top-right button |
| Toggle debug readout + hitboxes     | F1              |
| Game over: surf again / main menu   | Space / Esc     |

**Touch (phones and tablets):** the game runs as a portrait field (180x320)
that fills the phone upright: horizon at the top, a long run of water ahead,
the surfer near the bottom. The whole screen is the control surface.
Drag anywhere to steer (the surfer follows your finger's movement, so your
thumb can rest in the black band below the canvas), tap to jump. In big air,
drag sideways to spin and tap to grab. Taps also start the game and restart
after a wipeout; tap TITLE on the game-over screen to go back. There is no
punching or barging on touch: the mobile game is pure avoidance (dodge rocks,
sharks and rivals, jump rocks, ride ramps for tricks). Works in portrait and
landscape; the first tap tries to go fullscreen and lock landscape where the
browser allows it. Add `?touch=1` to the URL to try it on a desktop.

Both movement schemes work at the same time. Movement accelerates while a key
is held and decelerates to a stop when released. You cannot jump again until
you have landed. The surfer faces the way they last moved; punches and barges
go that way. The debug readout (off by default) shows player state, facing,
health, score, combo, attack and barge cooldowns, position, velocity, air
height, game speed, hazards and rivals, and outlines every hitbox; it lives
in `src/ui/DebugHud.ts` and is easy to delete later.

## How a run works

- Pick a game on the title screen: WAVES OF RAGE (this game) or WOR 2:
  BOARDMASTERS (the sequel, see below). Up/Down move the cursor and Space
  starts; clicking or tapping a button starts that game directly.
- Pick a difficulty on the title screen (remembered between visits):
  EASY (slower, sparser, sharks late, 4 hearts), NORMAL (the baseline),
  INSANITY (1.3x speed, fast ramp, dense spawns, sharks from 5 s). Each
  mode has its own shared top 10. Numbers live in `src/game/difficulty.ts`.
- You start with 3 health (4 on Easy). Rocks, rival surfers and the lifeguard
  boat take 1, sharks take 2.
- A hit knocks you sideways, flashes the surfer, cuts speed for a moment and
  grants about a second of immunity.
- Rocks can be jumped for a bonus. Sharks must be dodged.
- From 15 seconds in, a lifeguard boat crosses the water sideways now and
  then, from either edge. It cannot be jumped and it holds its line, so
  steer around it (rivals it meets wipe out).
- The pause button in the top-right corner (Esc or P on a keyboard) opens a
  popover with RESUME, RESTART and MAIN MENU.
- Rival surfers have 2 health. They drift about, sometimes head for your
  lane, and shoulder-check you when close (on a cooldown). A punch does 1
  damage with a small shove; a barge does 1 damage with a big shove. At zero
  health they lose their board and wipe out for 500 points. A rival knocked
  into a rock or shark wipes out immediately for 750 points.
- Knockouts within 4 seconds of each other build a combo multiplier (up to
  x5) that applies to knockout points only, never to distance.
- Cyan wave ramps appear from 12 seconds in. Ride over one (or jump onto
  it) for big air: higher and longer than a jump, and nothing in the water
  can touch you. While airborne, left/right spin the board and X/J grabs.
  Land within 50 degrees of upright and the trick is scored (air 100,
  180/360/540 spin 250/500/750, grab 250, landing 250, no combo
  multiplier). Land badly and you wipe out for 1 health. Ramps are
  optional; hazards are kept clear of them when they spawn.
- Score grows with distance plus bonuses. Distance is shown separately.
- Speed ramps up over time, spawn gaps shrink gradually, and sharks only
  appear after you have survived for a while (see `DIFFICULTY` in
  `src/game/gameplay.ts`).
- At zero health the world coasts to a stop and the WIPEOUT screen shows
  your distance and score. Space restarts, Escape returns to the title.

## Production build

```bash
npm run build
```

This type-checks the project with `tsc` and then bundles it with Vite into the
`dist/` folder. The output is fully static and uses relative asset paths, so it
can be served from the root of a site or from a sub-folder (GitHub Pages,
itch.io, any static host).

To test the production bundle locally:

```bash
npm run preview
```

## Other scripts

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run typecheck` | Runs the TypeScript compiler without emitting |
| `npm test`          | All suites through `tests/run-all.mjs`: API test + browser tests for both games (see docs/TESTING.md) |
| `npm run serve`     | Runs the score API + static server on port 8787 (use beside `npm run dev`) |
| `npm start`         | Same server, for production (serves `dist/`)   |
| `npm run art`       | Rebuilds `public/assets/sprites/` from `tools/pixelart/` |

## Project structure

```
Waves-Of-Rage/
├── index.html              # HTML shell; hosts the <div id="game"> Phaser mounts into
├── boardmasters.html       # Waves of Rage 2 page: two canvases (Three.js + 2D HUD), see src/boardmasters
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docs/
│   ├── art-direction/      # Approved concept art + written visual direction (reference only)
│   │   └── boardmasters/   #   the sequel's title concept, gameplay mockup, hazards sheet, character line-up
│   └── boardmasters/       # Waves of Rage 2: Boardmasters architecture and roadmap
├── public/                 # Static files copied verbatim to dist/, loaded with 'assets/...'
│   └── assets/
│       ├── title/          #   320x180 crop of the concept art used by the title screen
│       ├── boardmasters/   #   the sequel's logo, drawn on its title screen
│       └── sprites/        #   generated sprite sheets, tiles, sky strip and pixel font
├── server/                 # Node server: static dist/ + /api/scores (Postgres or JSON file store)
├── tools/pixelart/         # Zero-dependency art pipeline (ASCII maps -> PNG), `npm run art`
├── tests/                  # run-all.mjs runs api.mjs (score API), e2e.mjs and boardmasters-e2e.mjs (Playwright)
└── src/
    ├── main.ts             # Entry point: creates the single Phaser.Game instance
    ├── vite-env.d.ts       # Vite client type definitions
    ├── game/
    │   ├── config.ts       # Phaser GameConfig (renderer, scale, scene list)
    │   ├── constants.ts    # GAME_WIDTH / GAME_HEIGHT (orientation-dependent), SceneKeys, AssetKeys
    │   ├── platform.ts     # Touch / portrait detection, evaluated once at boot
│   │   ├── games.ts        # The title menu's games (a scene here, or the sequel's page) and the cursor
    │   └── gameplay.ts     # GAMEPLAY (health, scoring) and DIFFICULTY thresholds
    ├── scenes/
    │   ├── BootScene.ts    # Loads assets, then starts TitleScene
    │   ├── TitleScene.ts   # Concept art, the game menu (two buttons), difficulty selector, prompt
    │   ├── GameScene.ts    # Core loop: wires systems, entities and HUD, tracks health/score
    │   ├── GameOverScene.ts# WIPEOUT screen: results, top-10 table, name prompt, restart/title
    │   └── PauseScene.ts   # Pause popover: RESUME / RESTART / MAIN MENU
    ├── entities/
    │   ├── Player.ts       # The surfer: movement, facing, jump, big air, spin/grab, landing, punch, barge, hit
    │   ├── Obstacle.ts     # Base class: kind, damage, jumpable, knocksOutRivals, hitbox
    │   ├── Rock.ts         # Stationary, jumpable, 1 damage, knocks out rivals
    │   ├── RivalSurfer.ts  # Enemy: health, drift/seek AI, shoulder check, stun, knockout, ramp hop
    │   ├── Shark.ts        # Swims at you, lunges sideways, 2 damage, knocks out rivals
    │   ├── LifeguardBoat.ts# Crosses the field sideways either way, 1 damage, not jumpable
    │   └── WaveRamp.ts     # Harmless launcher: big air for the player, a hop for rivals
    ├── systems/
    │   ├── Combat.ts       # Resolves punches/barges vs rivals and rivals vs hazards
    │   ├── Combo.ts        # Knockout combo multiplier with a timed window
    │   ├── GameSpeed.ts    # Ramping forward speed with collision penalty (GAME_SPEED)
    │   ├── ScoreService.ts # Shared top-10 via /api/scores with local fallback
    │   ├── HighScores.ts   # Per-device top-10 table and name/score validation
    │   ├── Storage.ts      # Guarded localStorage JSON helpers
    │   ├── ObstacleSpawner.ts # Distance-based spawning with lateral clearance (SPAWN)
    │   ├── Perspective.ts  # scale-by-Y helper for the fake depth effect
    │   └── OceanScroller.ts# Procedural scrolling ocean driven by game speed
    ├── input/
    │   ├── Controls.ts     # Arrow keys + WASD + touch merged into one -1/0/1 axis pair
    │   └── TouchControls.ts# Drag-to-steer / tap-to-jump touch surface, fullscreen helper
    └── ui/
        ├── Hud.ts          # DISTANCE counter
        └── DebugHud.ts     # F1-toggled developer readout
    └── boardmasters/       # Waves of Rage 2: Boardmasters (Three.js), nothing here imports Phaser
        ├── main.ts         # Entry for boardmasters.html: renderer, HUD, input, run, loop; dev handle window.bm
        ├── engine/
        │   ├── three.ts    # Imports Three with colour management off (colours are written as given)
        │   ├── Renderer.ts # WebGL canvas + HUD canvas at 426x240 (240x426 upright), nearest-neighbour FIT scaling
        │   ├── PS1Material.ts # The one shader: vertex snapping, affine textures, Gouraud or faceted light, fog, 5-bit banding
        │   ├── Textures.ts # Textures painted at runtime (water, boards, shorts, skull buoy, crowd, banner, flag)
        │   ├── Hud2D.ts    # HUD canvas helpers: pixel font, heavy italic lettering, gradients, outlines, baked sprites
        │   ├── Input.ts    # Keyboard + the phone's buttons into one InputState, with every press for the combo reader
        │   ├── TouchButtons.ts # The phone pad (LEFT, UP, RIGHT) and JUMP, HIT, BRG, drawn by the HUD and hit-tested by Input
        │   ├── immersive.ts # Fullscreen + orientation lock for phones
        │   ├── Loop.ts     # Fixed 60 Hz step, render per frame
        │   └── math.ts     # clamp, lerp, smoothstep, damp, seeded random, colour helpers
        ├── world/
        │   ├── Ocean.ts    # Heightfield mesh resampled each frame from height(x, z); the riders sample the same function
        │   ├── Course.ts   # Course data (Sunset Bay, 2,000 m) and the streaming generator of ramps, troughs, buoys and boost gates
        │   ├── Scenery.ts  # The shore: cliffs with palms and waterfalls, the pier with its crowd, tents, flags and banner
        │   └── Sky.ts      # Sunset dome, sun with rays, drifting clouds
        ├── entities/
        │   ├── Rider.ts    # Physics (carve, launch, jump, spin, grab, land), combat requests, hit reactions, near fade
        │   ├── Surfer.ts   # The player's rider (input -> control)
        │   ├── Rival.ts    # AI rider: lanes, buoy avoidance, rubber-banding, shoulder checks
        │   ├── RiderModel.ts # The skinned low-poly humanoid and the surfboard, built in code
        │   ├── RiderAnimator.ts # Procedural animation: stance, carves, tricks, punch/barge clips, flinch, knockout, wipeout
        │   ├── riderTextures.ts # Per-rider face, shorts and top atlas; deck art
        │   ├── RiderFoam.ts # The foam round each board
        │   ├── Wake.ts     # Foam wakes behind every rider, one mesh
        │   ├── Buoy.ts     # Skull buoy hazard, pooled along the endless course (smashable in RAGE)
        │   ├── Chevron.ts  # Boost gate: a >> sign on a float, pooled; ride over it for a BOOST
        │   ├── FinishLine.ts # The finish arch, stands, chequered strip and fireworks
        │   └── Spray.ts    # Spray clumps and splashes (with foam rings), instanced
        └── game/
            ├── constants.ts # Resolution, camera, fog, physics, scoring, combat, tricks, RAGE, palette, LOOK toggles
            ├── characters.ts # Rider specs: the seven characters' stats and colours, the rival surfers
            ├── Combos.ts   # Input combos (RIGHT RIGHT UP = barrel roll, UP UP = boost) and the reader
            ├── HudView.ts  # The HUD, title, pause and results screens (HudArt.ts: baked pixel art; HudLayout.ts: tap zones)
            └── Run.ts      # One run: title (character select), play, pause, results; combat, tricks, RAGE, camera
```

### How the pieces fit together

1. `index.html` loads `src/main.ts` as an ES module.
2. `main.ts` creates `new Phaser.Game(gameConfig)`.
3. `game/config.ts` sets the internal resolution, pixel-art rendering flags,
   responsive scaling and the ordered list of scenes.
4. `BootScene` runs first, loads assets in `preload()` and starts
   `TitleScene`, whose menu starts `GameScene` or navigates to the sequel's
   page (see `game/games.ts`).
5. `GameScene` owns one `GameSpeed`, and every frame: advances it, feeds the
   resulting speed to the `OceanScroller` and `ObstacleSpawner`, updates the
   `Player` from `Controls`, checks player/obstacle overlaps, and refreshes
   the HUDs. Distance travelled is accumulated from game speed.
6. `Player` is a small container: its x/y is the position on the wave, the
   sprite inside is lifted along a fixed parabola while jumping and a shadow
   stays on the water. It integrates its own velocity, clamps itself to
   `PLAYER_BOUNDS`, and exposes a `playerState` of surfing, jumping, hit or
   wipedOut. Its hitbox is the footprint on the wave; jumping does not move
   it, the obstacle's `jumpable` flag decides whether an overlap counts.
7. `Obstacle` subclasses supply a config (kind, texture, approach factor,
   damage, jumpable) and optional extra motion. The base class moves them
   down the screen at game speed, applies perspective and destroys them
   off-screen. `ObstacleSpawner` picks the type using `DIFFICULTY`.
8. `Combat` runs each frame: the player's active attack box (punch or barge,
   on the facing side) is tested against living rivals, each swing hitting a
   rival at most once, and rivals still sliding from a hit are tested against
   hazards flagged `knocksOutRivals`. It reports hits and knockouts back to
   `GameScene`, which applies `Combo`, adds score, pops floating text and
   nudges the camera.
   Ramps are checked in `GameScene.checkRamps()`: overlapping one calls
   `player.launch()` (big air) or `rival.launch()` (a short hop). When the
   player's big air ends, `Player` judges the landing against
   `GAMEPLAY.landingToleranceDegrees` and queues a `LandingResult` that
   `GameScene.resolveLanding()` turns into trick points or crash damage.
9. When health reaches zero `GameScene` stops spawning, tells `GameSpeed`
   to coast to a halt, plays the wipeout on the player and then starts
   `GameOverScene` with the run's distance and score.
10. `OceanScroller` is purely visual. It generates two seamless 64x64 textures
   and scrolls them as TileSprites at multiples of game speed. Nothing else
   depends on it, so it can be replaced by pixel-art wave tiles later.

### Extending the project

- **Add a scene:** create `src/scenes/MyScene.ts` extending `Phaser.Scene`,
  add a key to `SceneKeys` in `src/game/constants.ts`, and add the class to the
  `scene` array in `src/game/config.ts`.
- **Add assets:** put files under `public/assets/` and load them in
  `BootScene.preload()`, e.g. `this.load.image('surfer', 'assets/surfer.png')`.
  Keep source art at the native 320x180 scale; Phaser upscales it.
- **Position things** using `GAME_WIDTH` / `GAME_HEIGHT` rather than hard-coded
  numbers so the resolution can be changed in one place.
- **Tune the game** through the exported config objects at the top of each
  module: `PLAYER_MOVEMENT`, `PLAYER_JUMP`, `PLAYER_ATTACK`, `PLAYER_BARGE`,
  `PLAYER_BIG_AIR`, `PLAYER_HIT` and `PLAYER_BOUNDS` in `Player.ts`, ramp
  spacing in `RAMP_SPAWN` and the ramp unlock time in `DIFFICULTY`, trick
  points and landing tolerance in `GAMEPLAY`, `ROCK` / `RIVAL` / `SHARK`
  in their entity files (rival health, AI timings and check cooldown live
  in `RIVAL`), knockout and combo values in `GAMEPLAY`,
  `GAME_SPEED` in `GameSpeed.ts`, `SPAWN` in `ObstacleSpawner.ts`,
  `GAMEPLAY` and `DIFFICULTY` in `src/game/gameplay.ts`, and
  `OCEAN_SPEED_FACTORS` in `OceanScroller.ts`.
- **Add a hazard type** by extending `Obstacle` (see `Rock.ts` for the
  minimal version), giving it a `kind`, `damage`, `jumpable` and
  `knocksOutRivals` flag, and adding it to `ObstacleSpawner.pick()`.
  Hazards that should hurt only sometimes override `isDangerous`.
- **Add an entity** under `src/entities/`, give it an `update(delta)` method
  and call it from `GameScene.update()`. Visual-only or world-level systems
  go under `src/systems/`.

## Design decisions

- **Orientation-dependent internal resolution.** Desktop plays 320x180
  (16:9, 6x = 1920x1080); touch devices play 180x320 so the phone is held
  upright and the field fills the screen. The choice is made once at boot in
  `src/game/platform.ts`; every layout is anchored to `GAME_WIDTH` /
  `GAME_HEIGHT` or `PLAYER_BOUNDS`, never to literal pixel positions.
- **FIT scaling.** The canvas grows to the largest size that fits the window
  while keeping the aspect ratio, and is centred with black letterboxing. At
  non-integer zoom levels some pixels may be one screen pixel wider than
  others; switching to integer-only zoom is a small later change if that
  becomes noticeable.
- **Pixel-art rendering.** `pixelArt: true` disables texture smoothing and
  rounds positions to whole pixels. `antialias: false` and `roundPixels: true`
  are also set explicitly for clarity, and `index.html` sets
  `image-rendering: pixelated` on the canvas as a safety net.
- **Phaser pinned to the 3.x line.** The `latest` tag on npm now points at
  Phaser 4; this project intentionally uses `phaser@^3.90.0`.
- **Placeholder text uses a system monospace font.** It is rendered to a
  canvas texture at internal resolution and upscaled, so it looks blocky but is
  not a true bitmap font. Proper bitmap fonts come with the art pass.

## Art direction and pipeline

The approved concept artwork, the character sheet and the written visual
direction live in [`docs/art-direction/`](docs/art-direction/). All assets
follow them.

In-game art is generated, not hand-painted in an editor: every sprite is an
ASCII pixel map in `tools/pixelart/sprites.mjs` using the shared palette in
`tools/pixelart/palette.mjs`; the sky strip, water and foam tiles are painted
procedurally in `environment.mjs`; the 5x7 pixel font is defined in
`font.mjs`. `npm run art` rebuilds everything into `public/assets/sprites/`
and writes `tools/pixelart/preview.png` (4x) for a quick look. The rival
surfer is the player's maps recoloured.

- Player and rival sheets are 24x32 frames: surf, lean, jump, punch, hurt
  (rival adds rider-only and board-only for the knock-off). Frames are
  chosen by state in `Player.pickFrame()` / `RivalSurfer.pickFrame()`.
- Sharks and the spray wake are small looping animations registered in
  `BootScene`.
- HUD and popups use the pixel font through `ui/PixelText.ts` (upper-case
  only, with a one-pixel drop shadow).

To replace any asset with hand-drawn art, drop a PNG of the same size and
frame layout into `public/assets/sprites/`; nothing in the game code needs
to change.

## Playtesting, testing and deployment

- [docs/PLAYTESTING.md](docs/PLAYTESTING.md): how to play, what to look for,
  and which values to tune during the balancing phase.
- [docs/TESTING.md](docs/TESTING.md): type checks, the build, and the
  automated browser test (`npm test`).
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): deploying the static build to
  Railway, GitHub Pages, itch.io or any static host.

## Waves of Rage 2: Boardmasters

The sequel is a separate game sharing this repository, hosting and visual
identity: a 3D forward-scrolling arcade surf racer/brawler seen from behind
the surfer, styled like 1995-1998 PlayStation 3D with this game's Mega Drive
presentation around it. It has its first playable prototype, reached from the
title screen's second menu entry or directly at `boardmasters.html`
(`/boardmasters` on the production server).

**What is in the prototype.** Sunset Bay, a 2,000 m race against five
rivals on a swell that is real terrain: you climb faces, drop into troughs
and launch off crests when you are going fast enough, and steep-backed
ramps and slowing troughs are generated ahead of you as you ride, with the
buoys coming thicker and everyone's pace rising towards the finish. Cyan
`>>` markers are boost gates: ride over them for a free BOOST. "500 M TO
GO" and "FINAL STRETCH" call the run-in to the finish arch; crossing it
ends your race with your place out of six, your time and a place bonus
(2,000 points for a win down to 150 for sixth), and your best place, time
and score on the course are kept on the device and shown on the title.

**Health.** A health bar replaces the hearts. Rivals' punches (12) and
shoulder checks (18) drain it, scaled by the rival's POWER, and so do skull
buoys (25) and crooked landings (20); RAGE halves it all. Tricks refill
it: a clean landing after air you made yourself (a JUMP) gives 4, big air
8, each half turn of spin 6, a grab 5 and a barrel roll 10. At zero you
wipe out and the race is over (DNF).

**Fights.** HIT (X) and BARGE (Shift) take half a rival's health each, so
two blows knock it out of the race for 500 points; knockouts within four
seconds of each other multiply up to x5, and a rival shoved into a buoy or
off the course is out for 750. A blow has a wind-up, a strike and a
recovery; when it lands the game freezes for a few frames, the camera
shakes, a spark and HIT! or BARGE! burst over the rival, who flinches and
is shoved away (a small health bar shows over its head), and a knockout
throws it tumbling through the air into a splash. The fighters among the
rivals hit back: a red "!" over a rival warns of a punch (a 0.4 s
wind-up) or a shoulder check (a lean-out tell) before it comes, and you can
carve out of reach, jump, or strike first to counter it.

**Tricks.** In the air Left/Right spin and X grabs: land within 50
degrees of upright and the air, the spin (180 to 720) and the grab score,
with a clean-landing bonus; land badly and you crash. Spins are forgiving:
only a press made in the air spins (a carve carried over a crest never
does), a short tap or a spin let go settles back upright, and a held spin
is helped round to a clean 360 when there is about a second of air; a half
turn held into the landing still crashes. Tricks and knockouts fill the
RAGE meter: full, you ride 30 % faster for eight seconds, one hit knocks
out, buoys smash for points and the sea turns hot pink. The title screen
picks the character (seven, with SPEED / TURN / POWER / RAGE bars that
scale the physics and colour the rig); the choice is remembered.

**Controls.** Left/Right or A/D carve, Up/W pumps for speed, Down/S brakes
and tightens the carve, Space jumps (also from a crest, for more height),
X or J punches (grabs in the air), Shift barges, Esc pauses (M on the pause
panel for the main menu). On the title, Left/Right change character. On
phones the left thumb has a pad of LEFT, UP and RIGHT (hold LEFT/RIGHT to
carve, hold UP to pump) and the right thumb has JUMP, HIT and BRG; the
pause button is top-centre and MENU is the top-left corner. The first tap
asks for fullscreen and locks the phone upright where the browser allows it.

**Combos.** Presses within about a third of a second of each other form combos,
from the keyboard or the pad alike (`src/boardmasters/game/Combos.ts`):
RIGHT RIGHT UP or LEFT LEFT UP is a BARREL ROLL (a launch and a full roll
about the board, 400 points plus the landing bonus; land before it is done
and you crash), UP UP is a BOOST (a burst of speed, on a short cooldown).
The HUD shows the presses it is holding, so moves can be learnt by watching.

**The look.** One shader gives everything the PlayStation's vertex
snapping, affine textures and 5-bit dithered colour. The world renders at
1.5 to 2.5 times the HUD's resolution (426x240, or 240 wide upright with the
height following the phone) and fills the whole screen. The riders are
skinned low-poly humanoids built in code, faceted and shaded, each with its
own build, hair, face, patterned shorts and a real surfboard with deck art,
animated by a procedural rig (stance, carves, pumping, tricks, punches,
barges, flinches, knockouts, wipeouts). The sea is turquoise near and deep
blue far, with dithered whitewater, the sun's glitter, wakes and big
splashes. Towering cliffs with lit villages, palms and waterfalls run down
the left; the festival pier with its stage, crowd, tents, flags and the
BOARDMASTERS banner comes round on the right; mountains close the bay under
a banded sunset sky. The HUD and title follow the mockups: HEALTH (a bar), POS,
DIST (a percentage, with the race clock) and SCORE panels, RAGE lettering over a segmented bar, a course strip
on the left, heavy trick lettering, and icon buttons on phones.

**Where things are.** The code lives in `src/boardmasters/` (see the tree
above), imports nothing from Phaser and shares only the platform detection,
the pixel font sheet and the palette with this game. Tuning is in
`src/boardmasters/game/constants.ts`; characters, their stats and colours in
`characters.ts`; course data in `world/Course.ts`. The reference art is in
[`docs/art-direction/boardmasters/`](docs/art-direction/boardmasters/) and
the architecture, with how the next features plug in, is in
[`docs/boardmasters/ARCHITECTURE.md`](docs/boardmasters/ARCHITECTURE.md).

## Roadmap

Feature work is paused for a playtest and balance pass. After that: sound
and music, menus/settings/gamepad, and deployment for wider testing.

## License

This project is licensed under the GNU General Public License v3.0. See
[LICENSE](LICENSE).
