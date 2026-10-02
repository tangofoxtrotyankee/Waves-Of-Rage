# Waves of Rage

**The wave fights back. Ride. Fight. Survive.**

Waves of Rage is a browser-based 2D arcade surfing game. The visual direction is
a 16-bit, Mega Drive-era arcade style inspired by the energy and presentation
of games such as *Streets of Rage* and *Road Rash*, but it is an original surfing
game with original assets and gameplay.

> **Status:** technical foundation only. The project currently boots Phaser,
> scales a 320x180 pixel-art canvas to the browser window and shows a
> placeholder screen. There is no gameplay, art, menus or audio yet.

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
replacement. Open the URL in a desktop browser; you should see a blue screen
with the game title. Edits to anything under `src/` reload automatically.

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
    └── scenes/
        ├── BootScene.ts    # First scene: loads shared assets, then starts GameScene
        └── GameScene.ts    # Gameplay scene (placeholder screen for now)
```

### How the pieces fit together

1. `index.html` loads `src/main.ts` as an ES module.
2. `main.ts` creates `new Phaser.Game(gameConfig)`.
3. `game/config.ts` sets the internal resolution, pixel-art rendering flags,
   responsive scaling and the ordered list of scenes.
4. `BootScene` runs first. Its `preload()` is where shared assets will be
   loaded; `create()` starts `GameScene`.
5. `GameScene` draws the placeholder background and text.

### Extending the project

- **Add a scene:** create `src/scenes/MyScene.ts` extending `Phaser.Scene`,
  add a key to `SceneKeys` in `src/game/constants.ts`, and add the class to the
  `scene` array in `src/game/config.ts`.
- **Add assets:** put files under `public/assets/` and load them in
  `BootScene.preload()`, e.g. `this.load.image('surfer', 'assets/surfer.png')`.
  Keep source art at the native 320x180 scale; Phaser upscales it.
- **Position things** using `GAME_WIDTH` / `GAME_HEIGHT` rather than hard-coded
  numbers so the resolution can be changed in one place.

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

Player movement, wave and ocean systems, enemies and combat, HUD, menus, audio,
and the full 16-bit art pass.

## License

This project is licensed under the GNU General Public License v3.0. See
[LICENSE](LICENSE).
