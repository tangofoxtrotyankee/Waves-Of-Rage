# Waves of Rage 2: Boardmasters, technical architecture

**Status: built as proposed and since reshaped into the original game's
loop: an endless run with swipe and tap controls on phones, sharks and
boats, and the shared top 10 (see the end of section 7).**
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
- Shared high scores: `/api/scores?mode=boardmasters` (the mode is in
  `MODES` in `server/scores.mjs`), through the original game's
  `ScoreService` and name prompt; one table for the sequel.

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
| Low resolution, crisp pixels | The HUD canvas draws at VIEW (426x240; upright 240 wide, its height following the phone from 426 to 540) and is fitted, whole-pixel where possible, inside the safe area. The world renders at `renderScale` times VIEW (1.5, 2 or 2.5, picked by `Renderer.fit` so a world pixel covers a whole number of device pixels within a pixel budget; `?res=N` forces it, `?res=320` is the old 320x180 look) and bleeds past the camera's 426x240 / 240x426 framing rectangle (`VIEW.frame`, `camera.setViewOffset`) to the screen edges, so phones have no letterbox bars. `image-rendering: pixelated`, no post pass. | `engine/Renderer.ts`, `game/constants.ts` |
| Vertex jitter / snapping | In the vertex shader, snap clip-space x/y to the low-res pixel grid: `pos.xy = floor(pos.xy / pos.w * snap) / snap * pos.w`. | `engine/PS1Material.ts` |
| Texture warping | Affine (not perspective-correct) texture mapping: pass `uv * w` and `w` as varyings and divide in the fragment shader. The classic PS1 wobble, switchable. | `engine/PS1Material.ts` |
| Low-res textures | 16 to 512 px textures painted at runtime from the palette (`engine/Textures.ts`, `entities/riderTextures.ts`), `NearestFilter`; only the water texture and the festival atlas (banner lettering) have mipmaps, because they shimmer at a distance without them. | `engine/Textures.ts` |
| Flat, chunky lighting | Per-vertex Lambert (Gouraud) in the shader: one sun direction plus ambient, multiplied with vertex colours. No normal maps, no shadows. The `flat` option (sea, scenery) makes it per facet instead (`flat` varyings) with a per-facet brightness hash, fading with depth; the sea also flattens its normals, foam and colour ramp towards the horizon. | `engine/PS1Material.ts`, `world/Ocean.ts` |
| Short draw distance and fog | Linear fog to the sunset colour, about 30 m to 100 m on the sea; the shore has its own longer fog so the cliffs and pier stay vivid. | `world/Sky.ts`, `world/Scenery.ts`, material uniforms |
| The sea | The `PS1_WATER` block: turquoise near and deep blue far, dithered whitewater from a per-vertex foam amount (cells that travel with the swell), the sun's glitter as sparse points, all faceted; normals, foam and colour calm towards the horizon. Wakes (`entities/Wake.ts`) and splash rings use the same block as a screen-door foam overlay. | `engine/PS1Material.ts`, `world/Ocean.ts` |
| Sky, sun and shore | A dome sharing the fog's elevation ramp with the sun's halo painted in, a striped sun and fading rays, banded sunset clouds and mountain ridges closing the bay; towering cliffs with lit villages, palms and waterfalls along +x (screen-left) and the festival pier with stage, crowd, tents, flags and the BOARDMASTERS banner along -x, in two 1,200 m spans placed from the camera every frame. | `world/Sky.ts`, `world/Scenery.ts` |
| Riders | One `SkinnedMesh` per rider (rigid skinning, 18 bones) built in code from faceted primitives with baked shading, plus the board and its foam: three draw calls. `PS1Material` includes Three's skinning chunks. | `entities/RiderModel.ts`, `RiderFoam.ts` |
| Near fade | Screen-door transparency (`fade: true` materials discard against the 4x4 Bayer matrix): rivals close to the lens or on the sight line to the surfer dither out, except the rival being hit. | `Rider.setNearFade`, `Run.updateNearFade` |
| Dithering and colour banding | In the shader: a 4x4 ordered dither and 5-bit quantise on every material. | `engine/PS1Material.ts` |
| Spray and particles | Instanced two-tone clumps that dissolve (a rooster tail on hard carves) and `splash()` bursts with a foam ring for landings, knockouts and buoy hits. | `entities/Spray.ts` |
| HUD | A second 2D canvas at VIEW resolution with the 8x8 pixel font plus heavy italic lettering baked from canvas text (thresholded, gradient-filled, outlined). Per the mockups: HEALTH, POS, DIST and SCORE panels, RAGE lettering over a segmented bar, a course strip on the left edge, trick text and comic bursts, sparks where blows land, icon buttons with captions; the title, pause and results screens. | `game/HudView.ts`, `HudArt.ts`, `HudLayout.ts`, `engine/Hud2D.ts` |

One material, `PS1Material` (a `ShaderMaterial` with optional `flat`,
`water`, `fade` and `dissolve` blocks), is used by everything in the world. Its uniforms (`snapResolution`,
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
landing result for trick scoring.

**Air spin.** Only a press made in the air spins (a steer carried over a
crest arms only once released). It builds to 330 degrees a second over a
quarter of a second after the first tenth of a second of air. The rider
predicts its touchdown: a press that cannot become a full turn by then is
a tweak of up to 30 degrees that settles upright; once a spin is 60
degrees round and a full turn is reachable, it is helped round (up to
1.8 times the rate) to land the 360; released, the rider settles to the
upright its momentum points at. A half turn held into the landing still
crashes. A JUMP press is kept for 0.3 s and pops the rider off an
unplanned hop. Tuning in `TRICKS` and `PHYSICS`.

**Hits.** A punch or barge counts at once but lands `RIDER_ANIM.impactDelay`
later, when the fist or shoulder arrives: the run freezes for a few frames
(hit-stop), shakes the camera, throws a spark and the word over the victim,
which flinches and is shoved; a knockout launches it tumbling, and its body
and board splash where they meet the water. Crashes, buoy hits, bumps and
the last heart flinch and shake too. Tuning in `IMPACT` and `RIDER_ANIM`.

**Camera.** Behind and above, looking down on the surfer as in the
mockup (upright: 4.3 m back, 2.4 m up, 64 degree FOV, looking 12 m ahead),
swinging round with part of the heading and banking with the turn rate
(`Rider.lean`), letting big airs rise in the frame, widening its FOV with
speed, BOOST and RAGE, pulling back for a fight so both riders stay in
frame, shaking on demand (`Run.shake`), and never going under the water.
All in the `CAMERA` block.

**Rival.** Rides its own wavy lane round the buoys, paced against the
surfer (catching up from behind, easing off ahead, sprinting at the end);
contact shoves both sideways. Collision is circles in track space, which is cheap and is all
an arcade game needs.

**Hazards.** A skull bell buoy (tapered bell, cage top, skull decal) at
fixed course positions; the shark (`entities/Shark.ts`: swims up the course
at the rider at `SHARK.speed`, lunges sideways on a timer, lies low so a
big jump clears it) and the lifeguard boat (`entities/Boat.ts`: crosses the
course from either edge at `BOAT.speed`, drifting towards the rider, too
tall to jump), both pooled and spawned when their generated spots come
within a window ahead of the surfer. Hitting one costs health and speed
(`HEALTH.buoy`, `shark`, `boat`); `Run.collectHazards` gathers them into
one list each step for the rivals' steering and the contact rules, and a
rival shoved into any of them is knocked out. Boost gates
(`entities/Chevron.ts`, a small `>>` sign on a float) are the first
pickup: the generator lays one every 110 to 190 m in a lane, and riding
over it on the water gives a BOOST (ignoring the combo's cooldown), a
little RAGE and `BOOST!`.

**Course and the endless run.** Sunset Bay goes on until the surfer wipes
out, the original game's loop. `CourseGenerator` lays out ramps, troughs,
buoy and gate spots, and from their unlock distances (`ENDLESS.boatsFrom`,
`sharksFrom`) boat crossings and shark spots, deterministically from the
seed a few hundred metres ahead of the surfer, dropping what is behind;
buoys and gates are pools of meshes placed at the spots, sharks and boats
wait in queues until their spawn window. Buoys and sharks come thicker
with distance (tightest from `ENDLESS.tightMetres`) and everyone's pace
rises with it (`Run.pace`: up to `ENDLESS.rampMax` more at `rampMetres`,
the surfer's `targetSpeed` and the rivals' cruise alike). The score is the
metres plus tricks and knockouts (`SCORING`); the device keeps the best
score and its distance per course (`bm.best.<course id>`, the race
prototype's `bm.race.<id>` score carried over), and the run posts to the
shared table (`Run.offerScore`, after `scoreboard` has loaded). Rivals ride
in a pack round the surfer (catching up from behind, easing off ahead,
`ENDLESS.pack*`). On phones the hazards' gaps and the rivals' attack
cooldowns are scaled up (`ENDLESS.touchHazardGap`, `touchAttackGap`).

**Health.** `Run.health` is 0..100 (`HEALTH`): rivals' punches (12) and
shoulder checks (18, both scaled by the rival's POWER), buoys (25), the
boat (30), sharks (40), crashes (20) and bumps (1) drain it, halved in RAGE; landing air the surfer made,
spins, grabs and rolls heal it. Short invulnerability after each hit. Zero
is the wipeout and the race ends unfinished. Rivals have 100 too; the
player's punch and barge take 50, a RAGE blow 100.

**Rivals fighting back.** Fighters (POWER at least 0.5) close in when
their attack is ready and throw a telegraphed punch (a 0.4 s wind-up from a
lane frozen at its start; it lands only if the surfer is still in reach
and near the water) or a shoulder check with a lean-out tell. Striking
during either cancels it (COUNTER!). Per-rival cooldowns, a stagger
between any two attacks and a back-off after a blow lands keep it fair. In
`COMBAT` and `Rival.think`; `Run.resolveRivalPunches` decides at contact.

A rider whose water jumps by more than `PHYSICS.surfaceSnap` in one step
(it was moved, or the course was generated under it) settles onto the
surface instead of reading a huge climb.

## 7. File layout and size

```
boardmasters.html                 second page
src/boardmasters/
  main.ts                         creates Renderer, Input, Run; exposes window.bm in dev
  engine/
    Renderer.ts                   Three renderer at 426x240, CSS FIT scaling, resize, WebGL 2 check
    PS1Material.ts                vertex snap, affine uv, Gouraud, fog
    Hud2D.ts                      pixel-font overlay canvas (shares public/assets/sprites/font.png)
    Input.ts                      arrows/WASD, Space, X, Shift plus the phone's gestures -> one action state
    Loop.ts                       fixed 60 Hz update, render each frame, pause on blur
  world/
    Ocean.ts                      heightfield mesh, oceanHeight(x, z, t), feature list
    Course.ts                     the endless Sunset Bay course generator
    Sky.ts                        dome, sun and rays, clouds
    Scenery.ts                    cliffs, palms, waterfalls, the pier
  entities/
    Surfer.ts                     track-space physics and a code-built low-poly surfer and board
    Rival.ts                      racing-line AI and contact
    Buoy.ts                       static obstacle
    Shark.ts, Boat.ts             the moving hazards from the original game
    Chevron.ts                    boost gate
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
textures), `engine/immersive.ts`, `entities/Spray.ts` (one instanced
mesh),
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
Then the phone pad and the combo reader, the endless course with the
persisted best, and the first graphics tranche towards the mockup: the
faceted sea, the sun's rays and clouds, the shore and the pier
(`world/Scenery.ts`), boost gates (`entities/Chevron.ts`), the boxed HUD
with the gradient RAGE bar and the radar, and a better rig (tapered
chest, hair spikes, patterned shorts from `shortsTexture`). Then the big
upgrade after the first phone playtest ("the graphics need a big upgrade!
the physics also spin too hard, hitting animation non existent"): skinned
riders with per-character looks and a procedural animator, the forgiving
air spin, hit-stop, shake, flinches, knockout tumbles and splashes, the
turquoise sea with whitewater, wakes and glitter, the cliffs and festival
pier, the higher world resolution with full-bleed framing, and the
mockup HUD and title spanning the phone screen. Then, after the race
prototype proved too hard on phones ("gameplay too difficult for mobile
and button combo; make like the Waves of Rage 1"), the loop was brought
back to the original game's: the race, its finish line, places, race
clock, POS panel, course strip and the phone's button pad were removed;
the run is endless with the pace rising by distance, sharks and the
lifeguard boat came back as 3D hazards, the score is distance plus tricks
and knockouts, the device's best and a shared top 10 (the original game's
API, mode `boardmasters`, with its name prompt) replaced the best race,
and phones play with gestures: a floating stick to carve, flicks to jump
and barge, taps to punch (`engine/Input.ts`, `Run.gestureInput`).
Combos stay on the keyboard only.

## 8. Mobile

- WebGL 2 is required (Three's current releases target it). It is available
  on iOS 15+ Safari, Android Chrome and all desktop browsers; the title
  card now reports `WEBGL2 OK` or `WEBGL2 MISSING` on the device in hand.
- The world renders at about 280k to 420k pixels on a phone (1.5 to 2.5
  times the HUD's resolution, bleeding to the screen edges); draw calls
  are about 50 in play. The loop catches up six fixed steps per frame, so
  the game keeps full speed down to 10 frames per second.
- Upright phones get a HUD 240 wide whose height follows the screen (426
  to 540), so the top bar sits at the top and the buttons at the bottom;
  the camera keeps its 240x426 framing in the middle and the world bleeds
  past it. The gameplay mockup is portrait, so phones are a primary
  target, not an afterthought.
- Touch: the original game's scheme, no buttons. The first finger down is
  a floating stick (the steer is its offset from an anchor that trails it,
  so holding carves, dragging back reverses and lifting straightens), a
  flick up jumps (a barrel roll in the air), a flick down barges (a grab
  in the air), and a tap punches (a grab in the air); any finger may tap
  or flick, so one thumb steers while the other fights. Swipes are
  measured by travel since the last pause or reversal, not by speed, so a
  slow device still reads a flick, and the stroke back after a flick is
  not another flick. The pad with its combos (the first attempt, a drag
  stick, and then digital buttons) was dropped after the phone playtest;
  combos (`game/Combos.ts`) remain for the keyboard.

## 9. Testing

`tests/boardmasters-e2e.mjs`, same harness as the original: start the score
API and Vite, open `boardmasters.html` in headless Chromium with
SwiftShader, read `window.bm` (dev only) and check the run end to end (see
docs/TESTING.md): movement, air and tricks, the hazards (buoys, sharks,
the boat), the endless course and its pace, combat, health, RAGE, pause,
the wipeout with the shared top 10 and the name prompt, the best on the
title, and the phone page with its gestures. `npm test` runs the API test
and both browser tests.

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
| 6. Pickups | `entities/Pickup.ts` implementing `Hazard` (`coin`, `health`, `speed`); the generator places them, in arcs over ramp apexes; the boost gate (`Chevron`) becomes the first row of the table | `Course.ts`, `Run.ts` | ~80 |
| 7. Courses and hazards | `CourseSpec` gains swell, palette, storm and a hazard mix; `Ocean.setSwell`, `Sky.setPalette`; new hazards `Piling`, `Reef`, `JetSki extends Rival` (the shark and the boat are in); `?course=`; a score mode per course in `server/scores.mjs` | `world/`, `entities/`, `main.ts`, server | ~300 |

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
