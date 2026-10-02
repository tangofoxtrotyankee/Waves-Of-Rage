import Phaser from 'phaser';

/**
 * Forward-speed tuning, in internal pixels per second. Everything that moves
 * "towards" the player (ocean scroll, obstacles) derives from this value.
 */
export const GAME_SPEED = {
  start: 90,
  min: 40,
  max: 240,
  /** How much the base speed grows every second of survival. */
  rampPerSecond: 3,
  /** Speed multiplier applied the instant the player is hit. */
  hitMultiplier: 0.45,
  /** Seconds for the hit penalty to fade back to full speed. */
  hitRecoverySeconds: 1.6,
} as const;

/**
 * Tracks how fast the player is travelling down the wave.
 *
 * A slowly ramping base speed is multiplied by a temporary penalty factor
 * that collisions pull down and time eases back to 1.
 */
export class GameSpeed {
  private base: number = GAME_SPEED.start;
  private penalty = 1;

  /** Current effective speed in pixels per second. */
  get value(): number {
    return Phaser.Math.Clamp(this.base * this.penalty, GAME_SPEED.min, GAME_SPEED.max);
  }

  update(delta: number): void {
    const dt = delta / 1000;
    this.base = Math.min(this.base + GAME_SPEED.rampPerSecond * dt, GAME_SPEED.max);

    if (this.penalty < 1) {
      const recoveryRate = (1 - GAME_SPEED.hitMultiplier) / GAME_SPEED.hitRecoverySeconds;
      this.penalty = Math.min(1, this.penalty + recoveryRate * dt);
    }
  }

  /** Temporarily slow down after a collision. */
  applyHit(): void {
    this.penalty = Math.min(this.penalty, GAME_SPEED.hitMultiplier);
  }
}
