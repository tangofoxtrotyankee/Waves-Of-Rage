import Phaser from 'phaser';

import { AssetKeys, GAME_WIDTH } from '../game/constants';
import { Obstacle } from './Obstacle';

export const BOAT = {
  damage: 1,
  /** A boat is far too big to hop. */
  jumpable: false,
  /** Rivals shoved into it wipe out. */
  knocksOutRivals: true,
  /** It holds its line across the wave, drifting only slowly towards the player. */
  approachFactor: 0.15,
  /** Crossing speed, pixels per second. */
  speed: 48,
  /** How far past the edge it starts and ends. */
  margin: 28,
} as const;

/**
 * A lifeguard boat crossing the field horizontally, in either direction.
 * Spawned off one edge and removed once it has crossed past the other.
 */
export class LifeguardBoat extends Obstacle {
  private readonly direction: 1 | -1;

  constructor(scene: Phaser.Scene, y: number, direction: 1 | -1) {
    const x = direction > 0 ? -BOAT.margin : GAME_WIDTH + BOAT.margin;
    super(scene, x, y, {
      kind: 'boat',
      texture: AssetKeys.Boat,
      approachFactor: BOAT.approachFactor,
      damage: BOAT.damage,
      jumpable: BOAT.jumpable,
      knocksOutRivals: BOAT.knocksOutRivals,
    });
    this.direction = direction;
    this.setFlipX(direction < 0);
  }

  protected override onUpdate(dt: number): void {
    this.x += this.direction * BOAT.speed * dt;
    if ((this.direction > 0 && this.x > GAME_WIDTH + BOAT.margin) || (this.direction < 0 && this.x < -BOAT.margin)) {
      this.destroy();
    }
  }
}
