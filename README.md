# Waves of Rage

**The wave fights back. Ride. Fight. Survive.**

Waves of Rage is a browser-based 2D arcade surfing game. The visual direction is
a 16-bit, Mega Drive-era arcade style inspired by the energy and presentation
of games such as *Streets of Rage* and *Road Rash*, but it is an original surfing
game with original assets and gameplay.

> **Status:** feature-complete prototype with a first pixel-art pass, now in
> the playtesting and balancing phase. Title screen, surf down the wave, jump rocks, dodge
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
| Internal resolution| 320 x 180 (16:9, scales to 1920x1080 at exactly 6x) |
| Scaling            | `Phaser.Scale.FIT` + `CENTER_BOTH` (aspect ratio preserved, letterboxed) |
| Rendering          | `pixelArt: true`, anti-aliasing off, nearest-neighbour upscaling, rounded pixels |
| Input              | Keyboard (desktop browsers)                         |

No backend, database or additional frameworks are used.

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
replacement. Open the URL in a desktop browser and click the page so it has
keyboard focus. Edits to anything under `src/` reload automatically.

In development the Phaser instance is exposed as `window.game` for poking at
from the browser console (for example
`game.scene.getScene('GameScene').player`). It is stripped from production
builds.

## Controls

| Action                              | Keys            |
| ----------------------------------- | --------------- |
| Start game (title screen)           | Space / Enter   |
| Move left                           | Left arrow / A  |
| Move right                          | Right arrow / D |
| Move further up the wave            | Up arrow / W    |
| Move down towards the foreground    | Down arrow / S  |
| Jump (clears rocks only)            | Space           |
| Attack (punch on the facing side)   | X / J           |
| Grab (while in big air)             | X / J           |
| Spin left / right (in big air)      | Left / A, Right / D |
| Shoulder barge (while moving L/R)   | Shift           |
| Toggle debug readout + hitboxes     | F1              |
| Game over: surf again / title       | Space / Esc     |

**Touch (phones and tablets):** on-screen controls appear automatically. A
tap anywhere on the water acts like Space (start, jump, surf again). The
d-pad on the left steers (and spins in big air); HIT punches or grabs; BARGE
shoulder-barges while a direction is held. On the game-over screen, tap
TITLE to go back. Works in portrait (controls sit in the black band under
the canvas) and landscape (controls overlay the edges). The first tap tries
to go fullscreen and lock landscape where the browser allows it. Add
`?touch=1` to the URL to see the touch layout on a desktop.

Both movement schemes work at the same time. Movement accelerates while a key
is held and decelerates to a stop when released. You cannot jump again until
you have landed. The surfer faces the way they last moved; punches and barges
go that way. The debug readout (off by default) shows player state, facing,
health, score, combo, attack and barge cooldowns, position, velocity, air
height, game speed, hazards and rivals, and outlines every hitbox; it lives
in `src/ui/DebugHud.ts` and is easy to delete later.

## How a run works

- You start with 3 health. Rocks and rival surfers take 1, sharks take 2.
- A hit knocks you sideways, flashes the surfer, cuts speed for a moment and
  grants about a second of immunity.
- Rocks can be jumped for a bonus. Sharks must be dodged.
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
| `npm test`          | Browser end-to-end test (see docs/TESTING.md) |
| `npm run art`       | Rebuilds `public/assets/sprites/` from `tools/pixelart/` |

## Project structure

```
Waves-Of-Rage/
├── index.html              # HTML shell; hosts the <div id="game"> Phaser mounts into
├── package.json
├── tsconfig.json
├── vite.config.ts
├── docs/
│   └── art-direction/      # Approved concept art + written visual direction (reference only)
├── public/                 # Static files copied verbatim to dist/, loaded with 'assets/...'
│   └── assets/
│       ├── title/          #   320x180 crop of the concept art used by the title screen
│       └── sprites/        #   generated sprite sheets, tiles, sky strip and pixel font
├── tools/pixelart/         # Zero-dependency art pipeline (ASCII maps -> PNG), `npm run art`
├── tests/e2e.mjs           # Playwright end-to-end test, `npm test`
└── src/
    ├── main.ts             # Entry point: creates the single Phaser.Game instance
    ├── vite-env.d.ts       # Vite client type definitions
    ├── game/
    │   ├── config.ts       # Phaser GameConfig (renderer, scale, scene list)
    │   ├── constants.ts    # GAME_WIDTH / GAME_HEIGHT, SceneKeys, AssetKeys
    │   └── gameplay.ts     # GAMEPLAY (health, scoring) and DIFFICULTY thresholds
    ├── scenes/
    │   ├── BootScene.ts    # Loads assets, then starts TitleScene
    │   ├── TitleScene.ts   # Concept art background + pulsing PRESS SPACE
    │   ├── GameScene.ts    # Core loop: wires systems, entities and HUD, tracks health/score
    │   └── GameOverScene.ts# WIPEOUT screen with results, restart and title prompts
    ├── entities/
    │   ├── Player.ts       # The surfer: movement, facing, jump, big air, spin/grab, landing, punch, barge, hit
    │   ├── Obstacle.ts     # Base class: kind, damage, jumpable, knocksOutRivals, hitbox
    │   ├── Rock.ts         # Stationary, jumpable, 1 damage, knocks out rivals
    │   ├── RivalSurfer.ts  # Enemy: health, drift/seek AI, shoulder check, stun, knockout, ramp hop
    │   ├── Shark.ts        # Swims at you, lunges sideways, 2 damage, knocks out rivals
    │   └── WaveRamp.ts     # Harmless launcher: big air for the player, a hop for rivals
    ├── systems/
    │   ├── Combat.ts       # Resolves punches/barges vs rivals and rivals vs hazards
    │   ├── Combo.ts        # Knockout combo multiplier with a timed window
    │   ├── GameSpeed.ts    # Ramping forward speed with collision penalty (GAME_SPEED)
    │   ├── ObstacleSpawner.ts # Distance-based spawning with lateral clearance (SPAWN)
    │   ├── Perspective.ts  # scale-by-Y helper for the fake depth effect
    │   └── OceanScroller.ts# Procedural scrolling ocean driven by game speed
    ├── input/
    │   ├── Controls.ts     # Arrow keys + WASD + touch merged into one -1/0/1 axis pair
    │   └── TouchControls.ts# DOM d-pad / HIT / BARGE overlay, tap = Space, fullscreen helper
    └── ui/
        ├── Hud.ts          # DISTANCE counter
        └── DebugHud.ts     # F1-toggled developer readout
```

### How the pieces fit together

1. `index.html` loads `src/main.ts` as an ES module.
2. `main.ts` creates `new Phaser.Game(gameConfig)`.
3. `game/config.ts` sets the internal resolution, pixel-art rendering flags,
   responsive scaling and the ordered list of scenes.
4. `BootScene` runs first, loads assets in `preload()` and starts
   `TitleScene`, which starts `GameScene` on Space or Enter.
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

- **320 x 180 internal resolution.** A true 16:9 ratio that scales to common
  display sizes by whole numbers (4x = 1280x720, 6x = 1920x1080).
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

## Roadmap

Feature work is paused for a playtest and balance pass. After that: sound
and music, menus/settings/gamepad, and deployment for wider testing.

## License

This project is licensed under the GNU General Public License v3.0. See
[LICENSE](LICENSE).
