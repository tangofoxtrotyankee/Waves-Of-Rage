# Playtesting guide

The prototype is feature-complete for its first loop. Before adding more,
play it. The question is no longer "does it work" but "is it fun".

## How to play

Run `npm run dev`, open the URL in a desktop browser, click the page, press
Space.

| Action                              | Keys                |
| ----------------------------------- | ------------------- |
| Steer                               | Arrows / WASD       |
| Jump (clears rocks)                 | Space               |
| Punch (facing side)                 | X / J               |
| Shoulder barge (while moving L/R)   | Shift               |
| Spin / grab (only in big air)       | Left/Right, X/J     |
| Debug readout and hitboxes          | F1                  |
| Game over: again / title            | Space / Esc         |

- Rocks: 1 damage, jumpable, knock rivals out.
- Rival surfers: 2 health, shoulder-check you when close, 500 points to
  knock out, 750 if they hit a rock or shark. Knockouts within 4 s chain a
  combo up to x5.
- Sharks: from 20 s, 2 damage, lunge sideways, cannot be jumped.
- Ramps: from 12 s, launch you into big air. Spin with left/right, grab
  with X/J, land within 50 degrees of upright. Bad landing = 1 damage.

## On a phone

The field is portrait (180x320): more water ahead, so hazards take longer
to arrive and there are more of them on screen at once. Touch play is
deliberately simpler: drag to steer, tap to jump, drag
sideways in big air to spin, tap in big air to grab. No punching or barging.
Rivals still shoulder-check you, so they are obstacles to dodge. When
balancing, remember the two audiences: keyboard players fight, touch players
only avoid. The drag feel is tuned by `TOUCH.sensitivity` in
`src/input/TouchControls.ts`.

## The session

Play 10 to 20 full runs. Vary your style: pure dodging, pure fighting,
ramp hunting. After each run note the distance, score, what killed you and
one sentence on how it felt. Then answer:

1. **Movement.** Does steering feel snappy or floaty? Is the up/down range
   useful or ignorable?
2. **Speed.** When does it start to feel fast? Does it ever feel unfair?
   Does the hit slowdown feel like a punishment or a relief?
3. **Spawning.** Are there stretches with nothing to do? Walls you cannot
   get through? Do ramps feel like opportunities or clutter?
4. **Combat.** Is punching worth the risk versus dodging? Does the barge
   feel powerful? Are rival shoulder-checks readable before they land?
5. **Jumping and tricks.** Is the big-air window long enough for a 360?
   Too easy to land? Is the trick payoff worth seeking ramps?
6. **Damage.** Does 3 health give runs the right length (aim for roughly
   60 to 120 seconds for a decent player)?
7. **Readability.** With placeholder art, can you always tell what is a
   rock, rival, shark or ramp? Where did your eyes go when you died?

## Where the knobs are

Every tunable is a named constant at the top of its module:

| What                               | Where                                   |
| ---------------------------------- | --------------------------------------- |
| Steering speed, acceleration       | `PLAYER_MOVEMENT` in `src/entities/Player.ts` |
| Jump height/time, big air, spin    | `PLAYER_JUMP`, `PLAYER_BIG_AIR`        |
| Punch / barge reach, cooldowns     | `PLAYER_ATTACK`, `PLAYER_BARGE`         |
| Knockback, immunity                | `PLAYER_HIT`                            |
| Forward speed ramp and caps        | `GAME_SPEED` in `src/systems/GameSpeed.ts` |
| Hazard spacing, mix, max on screen | `SPAWN` in `src/systems/ObstacleSpawner.ts` |
| Ramp spacing and clearance         | `RAMP_SPAWN` (same file)                |
| Shark/ramp unlock times, density   | `DIFFICULTY` in `src/game/gameplay.ts`  |
| Health, scores, combo, tolerance   | `GAMEPLAY` (same file)                  |
| Rival health, AI timings, check    | `RIVAL` in `src/entities/RivalSurfer.ts` |
| Shark lunges                       | `SHARK` in `src/entities/Shark.ts`      |

Change one thing at a time, play three runs, keep or revert.

## Debug tools

- **F1** shows state, cooldowns, speed, spawn timer, combo, air/spin and
  hitbox outlines.
- In the browser console (dev build): `game.scene.getScene('GameScene')`
  gives the live scene. Useful one-liners:

  ```js
  const s = game.scene.getScene('GameScene');
  s.spawner.debugSpawn('shark');       // spawn a kind now
  s.spawner.debugSpawn('ramp', 160);   // at a given x
  s.gameSpeed.stopFactor = 0;          // freeze the scroll (1 to resume)
  s.health = 50;                       // survive while experimenting
  s.elapsedSeconds = 60;               // jump ahead in the difficulty curve
  ```

## High scores

The top 10 is in the browser's local storage under
`waves-of-rage.highscores.v1`. To reset it while testing, run
`localStorage.clear()` in the console or clear site data.

## Recording findings

Keep a short list in this folder (for example `docs/playtest-notes.md`)
with: the change made, why, and what it did to the feel. That list drives
the balance pass and the next steps.
