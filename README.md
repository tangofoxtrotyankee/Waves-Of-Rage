# Waves of Rage

**The wave fights back. Ride. Fight. Survive.**

Waves of Rage is a browser-based 2D arcade surfing game. The visual direction is
a 16-bit, Mega Drive-era arcade style inspired by the energy and presentation
of games such as *Streets of Rage* and *Road Rash*, but it is an original surfing
game with original assets and gameplay.

> **Status:** early movement prototype. A placeholder surfer can be steered
> around a procedurally scrolling ocean at 320x180. There are no enemies,
> jumping, scoring, menus, finished art or audio yet.

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
| Move left                           | Left arrow / A  |
| Move right                          | Right arrow / D |
| Move further up the wave            | Up arrow / W    |
| Move down towards the foreground    | Down arrow / S  |

Both schemes work at the same time. Movement accelerates while a key is held
and decelerates to a stop when released. A small debug HUD in the top-left
shows the player's position and velocity; it lives in `src/ui/DebugHud.ts`
and is easy to delete later.

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

## Project structure

```
Waves-Of-Rage/
├── index.html              # HTML shell; hosts the <div id="game"> Phaser mounts into
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/                 # (create when needed) static files copied verbatim to dist/
│   └── assets/             #   sprites, bitmap fonts, audio - load with 'assets/...'
└── src/
    ├── main.ts             # Entry point: creates the single Phaser.Game instance
    ├── vite-env.d.ts       # Vite client type definitions
    ├── game/
    │   ├── config.ts       # Phaser GameConfig (renderer, scale, scene list)
    │   └── constants.ts    # GAME_WIDTH / GAME_HEIGHT and SceneKeys
    ├── scenes/
    │   ├── BootScene.ts    # First scene: loads shared assets, then starts GameScene
    │   └── GameScene.ts    # Gameplay scene: wires ocean, player, controls and HUD together
    ├── entities/
    │   └── Player.ts       # The surfer: placeholder texture, movement tuning, bounds
    ├── systems/
    │   └── OceanScroller.ts# Procedural scrolling ocean (sky band + two tiling layers)
    ├── input/
    │   └── Controls.ts     # Arrow keys + WASD merged into one -1/0/1 axis pair
    └── ui/
        └── DebugHud.ts     # Temporary position / velocity readout
```

### How the pieces fit together

1. `index.html` loads `src/main.ts` as an ES module.
2. `main.ts` creates `new Phaser.Game(gameConfig)`.
3. `game/config.ts` sets the internal resolution, pixel-art rendering flags,
   responsive scaling and the ordered list of scenes.
4. `BootScene` runs first. Its `preload()` is where shared assets will be
   loaded; `create()` starts `GameScene`.
5. `GameScene` creates an `OceanScroller`, a `Player`, a `Controls` reader and
   the `DebugHud`, then calls their `update()` methods every frame.
6. `Player` integrates its own velocity (acceleration while a key is held,
   deceleration when released) and clamps itself to `PLAYER_BOUNDS`. Tuning
   values live in `PLAYER_MOVEMENT` at the top of the file.
7. `OceanScroller` is purely visual. It generates two seamless 64x64 textures
   and scrolls them as TileSprites at different speeds. Nothing else depends
   on it, so it can be replaced by pixel-art wave tiles later.

### Extending the project

- **Add a scene:** create `src/scenes/MyScene.ts` extending `Phaser.Scene`,
  add a key to `SceneKeys` in `src/game/constants.ts`, and add the class to the
  `scene` array in `src/game/config.ts`.
- **Add assets:** put files under `public/assets/` and load them in
  `BootScene.preload()`, e.g. `this.load.image('surfer', 'assets/surfer.png')`.
  Keep source art at the native 320x180 scale; Phaser upscales it.
- **Position things** using `GAME_WIDTH` / `GAME_HEIGHT` rather than hard-coded
  numbers so the resolution can be changed in one place.
- **Tune movement** by editing `PLAYER_MOVEMENT` and `PLAYER_BOUNDS` in
  `src/entities/Player.ts`, and scroll speeds in `OCEAN_SPEEDS` in
  `src/systems/OceanScroller.ts`.
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

## Roadmap (not started)

Jumping, enemies and combat, scoring, HUD, menus, audio, touch controls, and
the full 16-bit art pass.

## License

This project is licensed under the GNU General Public License v3.0. See
[LICENSE](LICENSE).
