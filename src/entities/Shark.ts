import Phaser from 'phaser';

import { Animations, AssetKeys } from '../game/constants';
import { PLAYER_BOUNDS } from './Player';
import { Obstacle } from './Obstacle';

export const SHARK = {
  damage: 2,
  /** A shark can't be jumped: it's in the water, not on it, and it'll get you. */
  jumpable: false,
  /** Knocked rivals that slam into it wipe out. */
  knocksOutRivals: true,
  /** Swims towards the player, so it closes a little slower than a rock. */
  approachFactor: 0.85,
  /** Seconds between sideways lunges (random within this range). */
  lungeIntervalMin: 1.0,
  lungeIntervalMax: 1.8,
  /** Lunge distance in pixels and how fast it gets there. */
  lungeDistance: 36,
  lateralSpeed: 60,
} as const;

/**
 * A shark that mostly swims straight at you but occasionally lunges a fixed
 * distance sideways. Simple and readable: no tracking of the player.
 */
export class Shark extends Obstacle {
  private targetX: number;
  private untilNextLunge: number;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      kind: 'shark',
      texture: AssetKeys.Shark,
      approachFactor: SHARK.approachFactor,
      damage: SHARK.damage,
      jumpable: SHARK.jumpable,
      knocksOutRivals: SHARK.knocksOutRivals,
    });
    this.targetX = x;
    this.untilNextLunge = Shark.rollInterval();
    this.play(Animations.SharkSwim);
  }

  protected override onUpdate(dt: number): void {
    this.untilNextLunge -= dt;
    if (this.untilNextLunge <= 0) {
      const direction = Math.random() < 0.5 ? -1 : 1;
      this.targetX = Phaser.Math.Clamp(this.x + direction * SHARK.lungeDistance, PLAYER_BOUNDS.minX, PLAYER_BOUNDS.maxX);
      this.untilNextLunge = Shark.rollInterval();
    }

    const step = SHARK.lateralSpeed * dt;
    const diff = this.targetX - this.x;
    if (Math.abs(diff) <= step) {
      this.x = this.targetX;
    } else {
      this.x += Math.sign(diff) * step;
      this.setFlipX(diff < 0);
    }
  }

  private static rollInterval(): number {
    return Phaser.Math.FloatBetween(SHARK.lungeIntervalMin, SHARK.lungeIntervalMax);
  }

}
