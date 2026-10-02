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
  /** Combat bonuses. Combo multiplier applies to these only, never to distance. */
  rivalKnockoutScore: 500,
  environmentalKnockoutScore: 750,
  /** Seconds after a knockout in which the next one raises the combo. */
  comboWindowSeconds: 4,
  comboMax: 5,
  /** Seconds the wipeout plays out before the game-over screen appears. */
  wipeoutSeconds: 1.4,
  /** Trick scoring. Flat values, no combo multiplier. */
  trick: {
    air: 100,
    rotation180: 250,
    rotation360: 500,
    rotation540: 750,
    grab: 250,
    landing: 250,
  },
  /** A landing counts as clean when the sprite is within this many degrees of upright. */
  landingToleranceDegrees: 50,
} as const;

/**
 * Difficulty progression within a run. The per-mode numbers (speed scale,
 * spawn density, shark and ramp unlock times, starting health) live in
 * src/game/difficulty.ts; this is the curve every mode shares.
 */
export const DIFFICULTY = {
  /** Spawn gaps shrink from 1x to this multiplier... */
  spawnGapMultiplierMin: 0.6,
  /** ...linearly over this many seconds of survival. */
  spawnRampSeconds: 90,
} as const;
