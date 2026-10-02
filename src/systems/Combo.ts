import { GAMEPLAY } from '../game/gameplay';

/**
 * Lightweight knockout combo: each knockout within the window raises the
 * multiplier (capped); the window expiring resets it to 1.
 */
export class Combo {
  private count = 0;
  private remaining = 0;

  /** Multiplier to apply to combat points. */
  get multiplier(): number {
    return Math.max(1, Math.min(this.count, GAMEPLAY.comboMax));
  }

  /** Seconds left before the combo resets. */
  get secondsRemaining(): number {
    return this.remaining;
  }

  get isActive(): boolean {
    return this.count > 1 && this.remaining > 0;
  }

  /** Register a knockout and return the multiplier that now applies to it. */
  register(): number {
    this.count = this.remaining > 0 ? this.count + 1 : 1;
    this.remaining = GAMEPLAY.comboWindowSeconds;
    return this.multiplier;
  }

  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.remaining === 0) this.count = 0;
  }
}
