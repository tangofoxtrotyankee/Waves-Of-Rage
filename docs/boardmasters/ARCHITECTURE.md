# Waves of Rage 2: Boardmasters, technical architecture

**Status: built as proposed; first playable prototype in the repository.**
The go-ahead was given on the recommendations below (Three.js, a second
Vite page in this repository, 426x240, keyboard first with basic touch,
code-built placeholder meshes). Sections 2 to 9 describe what now exists in
`src/boardmasters/`; where the build departs from the proposal it says so.
Section 10 is the roadmap for what comes next.

The brief: a 3D forward-scrolling arcade surf racer/brawler seen from a
chase camera, looking like 1995-1998 PlayStation / Saturn 3D with the
original game's Mega Drive-style presentation around it. Free steering,
waves as terrain, modular systems so racing, tricks, combat, sharks, boats,
shortcuts, pickups, RAGE mode and courses can be added later. Reference art
is in `docs/art-direction/boardmasters/`: the title concept, the gameplay and
HUD mockup, the hazards and enemies sheet, and the character line-up.

## 1. What the repository is today

| Concern      | Today                                                                                    | Reusable by the sequel |
| ------------ | ---------------------------------------------------------------------------------------- | ---------------------- |
| Engine       | Phaser 3.90, a 2D sprite engine. Renders with WebGL or Canvas 2D; no meshes, cameras, depth or fog | No (see below) |
| Language     | TypeScript, strict, `noUnusedLocals`                                                     | Yes |
| Build        | Vite 8, single page (`index.html` -> `src/main.ts`), `base: './'`                        | Yes, extended to two pages |
| Resolution   | 320x180 landscape on desktop, 180x320 portrait on phones, nearest-neighbour FIT scaling  | Same idea, different numbers |
| UI           | 8x8 pixel font sheet (`public/assets/sprites/font.png`), `ui/PixelText.ts`               | Yes (font sheet and palette) |
| Art pipeline | `tools/pixelart/`: ASCII maps and procedural tiles -> PNG, zero dependencies             | Yes, for low-res 3D textures |
| Input        | Keyboard merged with a drag/tap touch surface (`input/`)                                 | Pattern yes, code mostly |
| Persistence  | `systems/Storage.ts` (guarded localStorage), `ScoreService` -> `/api/scores?mode=`        | Yes |
| Server       | `server/index.mjs`, no dependencies, serves `dist/` and the score API (Postgres or JSON) | Yes, unchanged |
| Hosting      | Railway: `npm ci && npm run build`, `npm start`                                          | Yes, unchanged |
| Tests        | `tests/api.mjs`, `tests/e2e.mjs` (Playwright, reads `window.game` in dev)                | Pattern yes |

Phaser cannot carry the sequel. The brief asks for actual polygonal 3D:
meshes with depth, a moving camera, fog and lighting. Phaser 3 has none of
that; it could fake a Mode 7 style road but not low-poly surfers riding a
heightfield. A 3D renderer is required, and it should not be Phaser's.

## 2. Recommendation in one paragraph

Use **Three.js** as the renderer, add it to **this repository as a second
Vite page** (`boardmasters.html` -> `src/boardmasters/main.ts`) so the
original game's bundle is untouched and each page has exactly one engine,
render internally at **426x240** and upscale with nearest-neighbour CSS
scaling, get the PlayStation look from **one small custom shader** (vertex
snapping, affine texture mapping, per-vertex lighting, fog) rather than a
post-processing filter, drive the ocean and the surfer from **one shared
height function** so what you see is what you ride, and build the
placeholder surfer, board, rival and buoy **from boxes and prisms in code**
so nothing waits on a modelling tool. Keep hosting exactly as it is: the
same Railway service, build and start commands.

## 3. Engine choice

| Option | Verdict | Why |
| ------ | ------- | --- |
| **Three.js** (recommended) | Yes | Thin scene graph over WebGL, custom `ShaderMaterial` for the PS1 look, `WebGLRenderTarget` if we want post effects, fog and lighting built in, runs on phones, ~160 kB gzipped, huge body of examples. Low level enough to make it look deliberately crude. |
| Babylon.js | No | Larger, PBR-first, more framework in the way of making it look bad on purpose. |
| PlayCanvas | No | Editor-centric workflow; the project is code-first. |
| Raw WebGL | No | We would write a scene graph, loaders and matrix maths that Three already has. More code, same result. |
| Phaser 3 with pseudo-3D | No | Not polygonal; cannot do the chase-cam over a heightfield convincingly. |
| Godot / Unity web export | No | New toolchain, multi-megabyte bundles, worse on phones, and the game stops being a plain web project. |

No framework on top of Three (no react-three-fiber, no ECS library). The
prototype is small enough that plain classes with an `update(dt)` method,
as in the original game, are the simplest thing.

## 4. Where it lives: same repository, second page

```
index.html            -> src/main.ts              Waves of Rage (Phaser, unchanged)
boardmasters.html     -> src/boardmasters/main.ts Waves of Rage 2 (Three.js)
```

As built: nothing was moved into a `src/shared/` folder yet. The sequel
imports `src/game/platform.ts` (touch and portrait detection) and the
`FONT_CHARS` constant from `src/game/constants.ts` directly, and loads the
same `public/assets/sprites/font.png`. Moving those into `src/shared/` is a
mechanical change for when a third consumer appears.

- `vite.config.ts` gains `build.rollupOptions.input` with both pages. Vite
  builds two bundles; Phaser is only in the first, Three only in the second.
- The main menu's "WOR 2: BOARDMASTERS" button navigates to
  `./boardmasters.html` (`GameEntry.url` in `src/game/games.ts`). The
  sequel's title screen and results link back to `./`.
- `server/index.mjs` serves any file in `dist/`; one line maps
  `/boardmasters` to `boardmasters.html` for a clean URL.
- Shared high scores later: `/api/scores?mode=bm-sunset-bay`; add the modes
  to `cleanMode()` in `server/scores.mjs`, one table per course.

Why not a second Phaser scene that hosts a Three canvas: two renderers in
one page fight over the canvas, input and the frame loop, and the original
game's download would grow by the size of Three. Why not a separate
repository: it duplicates the server, deploy, tests and font, and the brief
wants one Railway-hosted site with one home screen. If the sequel outgrows
the shared repository, `src/boardmasters/` lifts out as a folder.

## 5. Rendering: the PlayStation look

Internal resolution 426x240 (16:9 at the PS1's 240 lines). 320x180 is
available behind `?res=320` so both can be compared on real screens; 3D at
180 lines tends to read as mush rather than retro.

| Effect | How | Where |
| ------ | --- | ----- |
| Low resolution, crisp pixels | `renderer.setSize(426, 240, false)`, canvas CSS-scaled to the largest fit (same letterboxing rule as the original), `image-rendering: pixelated`. No post pass needed for the prototype. | `engine/Renderer.ts` |
| Vertex jitter / snapping | In the vertex shader, snap clip-space x/y to the low-res pixel grid: `pos.xy = floor(pos.xy / pos.w * snap) / snap * pos.w`. | `engine/PS1Material.ts` |
| Texture warping | Affine (not perspective-correct) texture mapping: pass `uv * w` and `w` as varyings and divide in the fragment shader. The classic PS1 wobble, switchable. | `engine/PS1Material.ts` |
| Low-res textures | 32x32 to 64x64 PNGs from `tools/pixelart/` (so the texture palette is the game palette), `NearestFilter`, no mipmaps. | `tools/pixelart/`, `public/assets/boardmasters/` |
| Flat, chunky lighting | Per-vertex Lambert (Gouraud) in the shader: one sun direction plus ambient, multiplied with vertex colours. No normal maps, no shadows. | `engine/PS1Material.ts` |
| Short draw distance and fog | Linear fog to the sunset colour, roughly 25 m to 70 m; the camera's far plane sits at the fog's far distance. | `world/Sky.ts`, material uniforms |
| Sky and sun | An unlit gradient backdrop quad and a sun disc that follow the camera. | `world/Sky.ts` |
| Dithering and colour banding | Optional later: a fullscreen pass that quantises to 5 bits per channel with a 4x4 Bayer matrix. Not in the prototype. | `engine/PostPass.ts` (later) |
| Spray and particles | A handful of camera-facing quads using the existing foam/spray pixel art, spawned at the board's tail. | `entities/Surfer.ts` |
| HUD | A second 2D canvas at the same internal resolution, drawn with the 8x8 pixel font sheet, so text pixels match world pixels. Content per the gameplay mockup: HEALTH hearts, DIST, SCORE now; POS, RAGE bar, course map and floating trick text later. | `engine/Hud2D.ts` |

One material, `PS1Material` (a `ShaderMaterial`, about 80 lines of GLSL),
is used by everything in the world. Its uniforms (`snapResolution`,
`affine`, `fogColor`, `fogNear`, `fogFar`, `sunDirection`, `map`) are
exposed on the dev handle so the look can be A/B'd live.

## 6. World and movement

**Track space.** Positions are `(x, z)` on the course: `x` lateral in
metres (about -12 to +12), `z` forward from 0 to the course length. Height
`y` comes from the ocean, never stored separately for things on the water.

**Ocean.** A heightfield mesh, about 48 cells across by 96 along at 1 m,
roughly 6,000 vertices, kept centred on the player in whole-cell steps so
the texture does not swim. Every frame its vertices are resampled on the
CPU from `oceanHeight(x, z, t)`; at this size that costs nothing. The same
function drives physics, so the surfer always sits on the drawn surface.
The function is a base swell along `z`, a smaller cross chop, and authored
features the course places ahead: ramps (a bump with a steep back), troughs
(slow), and later barrels, whitewater and the chasing monster wave.

**Surfer.** Forward speed, heading, grounded or airborne. Each frame the
slope under the board is read from the height gradient: downhill adds
speed, uphill takes it, pumping (up) adds a little, braking (down) tightens
the carve and scrubs speed. Carving turns the heading; lateral movement is
`speed * sin(heading)`. Jump gives a vertical impulse when grounded. When
the water drops away faster than gravity can follow, the surfer launches
from the crest on their own; landing is `y <= oceanHeight` and queues a
landing result, which is where trick scoring plugs in later.

**Camera.** Behind and above at about waist height: the target is
`player + (0, 1.4, -4.5)` in the player's heading frame, eased towards each
frame, looking at a point a few metres ahead; a few degrees of roll with
the carve; vertical FOV about 60 degrees; far plane at the fog distance.

**Rival.** Follows a precomputed racing line (`x` as a function of `z`
with noise) at 95 to 105 % of the player's speed; contact shoves both
sideways. Collision is circles in track space, which is cheap and is all
an arcade game needs.

**Obstacle.** A skull buoy (cylinder plus cone) at fixed course positions;
hitting it costs a heart and speed. Rocks, pilings, boats and sharks are
the same interface with different meshes and behaviours.

**Course.** Data: length, swell parameters, a list of `(z, x, kind)`
features and obstacles, rival count. The prototype's Sunset Bay is a
straight 1,200 m run with a DIST counter; the finish line and positions
come with racing.

## 7. File layout and size

```
boardmasters.html                 second page
src/boardmasters/
  main.ts                         creates Renderer, Input, Run; exposes window.bm in dev
  engine/
    Renderer.ts                   Three renderer at 426x240, CSS FIT scaling, resize, WebGL 2 check
    PS1Material.ts                vertex snap, affine uv, Gouraud, fog
    Hud2D.ts                      pixel-font overlay canvas (shares public/assets/sprites/font.png)
    Input.ts                      arrows/WASD, Space, X, Shift plus touch -> one action state
    Loop.ts                       fixed 60 Hz update, render each frame, pause on blur
  world/
    Ocean.ts                      heightfield mesh, oceanHeight(x, z, t), feature list
    Course.ts                     course data and the Sunset Bay prototype course
    Sky.ts                        backdrop, sun, fog colour
  entities/
    Surfer.ts                     track-space physics and a code-built low-poly surfer and board
    Rival.ts                      racing-line AI and contact
    Buoy.ts                       static obstacle
  game/
    Run.ts                        assembles a run: entities, collisions, DIST / SCORE / HEALTH
    constants.ts                  resolution, camera, physics and fog tuning in one place
src/shared/                       Storage.ts, platform.ts, font metrics, palette (moved from src/)
tests/boardmasters-e2e.mjs        Playwright, same style as tests/e2e.mjs
```

As built: about 1,700 lines of TypeScript and 90 lines of GLSL. New
dependencies: `three` (runtime) and `@types/three` (dev), nothing else. The
sequel's bundle is about 145 kB gzipped; the original game's is unchanged.
Additions to the plan: `engine/Textures.ts` (runtime-painted 16/32 px
textures), `engine/TouchButtons.ts` and `engine/immersive.ts`,
`entities/FinishLine.ts` and `entities/Spray.ts` (one instanced mesh),
`game/characters.ts` (the seven characters' stats and colours plus the
rival surfers), an attract mode on the title (the surfer rides on its own
behind the logo), and a `?character=` switch.

Built since the ten-point prototype, in the same modules: a character
select on the title (`Run.selectCharacter`, `Rider.setSpec` rebuilds the
rig), a field of seven rivals with lanes, buoy avoidance and shoulder
checks (`Rival.think`), HIT and BARGE with knockouts, combos and
environmental knockouts (`Run.resolveAttacks`, `resolveHazards`, the
`COMBAT` table), spins and grabs with landing judgement (`Rider`, the
`TRICKS` table, `Run.resolveLanding`), the RAGE meter and mode (`RAGE`
table, `Run.startRage`), a pause state, the mockup's touch buttons, and
the review's fixes (steering direction, step-rate independent launches,
the sky's elevation ramp shared with the fog, ordered dither, the ocean
sampled once per frame from a height grid with coarse outer columns).

## 8. Mobile

- WebGL 2 is required (Three's current releases target it). It is available
  on iOS 15+ Safari, Android Chrome and all desktop browsers; the title
  card now reports `WEBGL2 OK` or `WEBGL2 MISSING` on the device in hand.
- At 426x240 the GPU work is negligible on any phone; the cost is the
  upscale, which is free.
- Portrait phones render 240x426 (same pixel count, taller view) with a
  taller vertical FOV. The gameplay mockup is portrait, so phones are a
  primary target, not an afterthought.
- Touch for the prototype keeps the original's pattern (drag to carve, tap
  to jump). The mockup's on-screen CARVE / ATTACK / BARGE buttons arrive
  with combat.

## 9. Testing

`tests/boardmasters-e2e.mjs`, same harness as the original: start Vite,
open `boardmasters.html` in headless Chromium with SwiftShader, read
`window.bm` (dev only) and check: no console errors; the ocean mesh exists;
the surfer's `z` increases; Left and Right change `x`; Space sets
`airborne` then clears it; the rival and the buoy exist; the HUD text
updates. `npm test` runs the API test and both browser tests.

## 10. Roadmap: what comes next, and where it plugs in

Three designs were drawn up and judged for this codebase (data-driven,
systems-first, player-first); the player-first order won, with the
data-driven tables grafted in. The order below makes the one course fun
before multiplying content. Sizes are rough line counts.

| Step | What | Where it plugs in | Size |
| ---- | ---- | ----------------- | ---- |
| 1. Combat depth | Move `Run.resolveAttacks` and the rival half of `resolveHazards` into `game/Combat.ts`; an `ATTACKS` table (`hit`, `barge`, `grab`: damage, shove, ranges, cooldown, pose) replaces the per-attack fields in `Rider`; GRAB holds a rival for 0.3 s then throws it (the existing shoved-into-hazard path finishes it); rivals punch back, and a heart is lost only on a would-be knockout | `Rider.ts`, `Run.ts`, `constants.ts`, `Input.ts` (`attackHeld`) | ~220 |
| 2. Tricks and multiplier | `game/Tricks.ts` with a trick table (`id`, `name`, `points`, `match`) and a pure `scoreLanding(landing)`; one multiplier (1 to 8) fed by clean landings and knockouts, reset by damage, applied to both; a held hard carve floats `+250 CARVE` | `Run.resolveLanding`, HUD | ~80 |
| 3. RAGE as a choice | A full meter waits for the player (R, or tapping the bar); the pink tint becomes `RAGE.fog` / `RAGE.horizon` plus a water tint uniform; rivals steer away from a raging player | `Run.ts`, `PS1Material.ts`, `Rival.think` | ~50 |
| 4. Hazard interface and rival personality | `entities/Hazard.ts` (`x`, `z`, extents, `lethalToShoved`, `update`, `onPlayer`); `Buoy` implements it and `Run.hazards` replaces `buoys`; `RIVALS` rows gain an `ai` block (lane amplitude and frequency, catch-up, aggression) replacing the constants in `Rival.think`; `Run.standings()` for the results | `entities/`, `characters.ts`, `Run.ts` | ~150 |
| 5. Characters | A `BOARDS` table (the eight boards from the sheet) referenced by `RiderSpec.board`; unlockables gated by `bm.unlocks` in storage (finish, knockouts, score); title and results drawing pulled out of `drawHud` into `game/Screens.ts`; TURN also scales `maxHeading` so it is felt | `characters.ts`, `Rider.setSpec`, `Run.ts` | ~150 |
| 6. Pickups | `entities/Pickup.ts` implementing `Hazard` (`coin`, `health`, `speed`); `buildCourse` places them, in arcs over ramp apexes | `Course.ts`, `Run.ts` | ~80 |
| 7. Courses and hazards | `CourseSpec` gains swell, palette, storm and a hazard mix; `Ocean.setSwell`, `Sky.setPalette`; new hazards `Piling`, `Reef`, `Shark` (lunge ported from the original's `Shark.ts`), `Boat`, `JetSki extends Rival`; `?course=`; `bm-*` score modes in `server/scores.mjs` | `world/`, `entities/`, `main.ts`, server | ~350 |

Deliberately deferred: an entity/component split (a third contact rule
would justify it; today `Rider` and the `Hazard` interface cover the
cases), audio (an `engine/Audio.ts` wrapper, nothing depends on it),
and modelled meshes (the box rigs are placeholders; glTF rigs slot into
`Rider.setSpec`).

## 11. Risks

- **Is it fun?** Carving over a heightfield can feel floaty. Everything
  that matters (speeds, slope gain, carve rate, camera lag) lives in
  `constants.ts` for fast tuning; finding this out is the prototype's job.
- **CSS scaling versus a render target.** Identical pixels except at
  non-integer zoom, where the original has the same unevenness. Moving to
  a `WebGLRenderTarget` plus a fullscreen quad is about 40 lines if we want
  dithering, scanlines or integer-only zoom.
- **CPU heightfield.** Trivial at 6,000 vertices. If it grows past about
  20,000, move the height function into the vertex shader and keep a
  coarse CPU copy for physics.
- **Two engines in one repository.** Kept apart by the two-page build;
  neither bundle contains the other engine. Type-check and tests cover both.

## 12. Decisions needed before coding

1. **Three.js** as the renderer (recommended) or something else.
2. **Same repository, second Vite page** (recommended) or a separate repository.
3. **426x240** internal resolution (recommended) or 320x180; both stay switchable in dev.
4. **Desktop keyboard first, portrait touch second** (recommended) or both from the start.
5. **Code-built placeholder meshes** (recommended) or wait for modelled assets.

Once agreed, the first pull request is the renderer, the ocean, the camera
and the surfer (brief items 1 to 6), playable at `/boardmasters.html`,
followed by jump, rival, buoy and HUD (items 7 to 10) in a second.
