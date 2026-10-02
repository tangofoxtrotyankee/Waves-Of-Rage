/**
 * Run-level gameplay tuning that does not belong to a single entity.
 * Entity-specific values (movement, jump, hit reaction, obstacle damage)
 * live next to the entity that uses them.
 */
export const GAMEPLAY = {
  /** Health points at the start of a run. */
  startHealth: 3,
  /** World pixels per displayed distance unit. */
  pixelsPerDistanceUnit: 8,
  /** Score awarded per distance unit travelled. */
  scorePerDistanceUnit: 1,
  /** Bonus for clearing a jumpable hazard in mid-air. */
  jumpClearBonus: 50,
  /** Seconds the wipeout plays out before the game-over screen appears. */
  wipeoutSeconds: 1.4,
} as const;

/**
 * Difficulty progression. Game speed has its own ramp in GameSpeed.ts;
 * these thresholds control hazard mix and spawn density over run time.
 */
export const DIFFICULTY = {
  /** Sharks only appear once the player has survived this long. */
  sharkAfterSeconds: 20,
  /** Share of spawns that are sharks once they are unlocked. */
  sharkChance: 0.2,
  /** Spawn gaps shrink from 1x to this multiplier... */
  spawnGapMultiplierMin: 0.6,
  /** ...linearly over this many seconds of survival. */
  spawnRampSeconds: 90,
} as const;
