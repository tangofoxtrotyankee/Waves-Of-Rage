import Phaser from 'phaser';

import { GAME_HEIGHT } from '../game/constants';
import { perspectiveScale } from '../systems/Perspective';

/** Fraction of the sprite's bounds trimmed from each side for collisions. */
const HITBOX_INSET = 0.2;

/** Once an obstacle is this far below the screen it is destroyed. */
const OFFSCREEN_MARGIN = 32;

/**
 * Base class for things that come down the wave towards the player.
 *
 * Subclasses provide a texture and an `approachFactor`: 1 means the object
 * is stationary in the world (so it approaches at full game speed), lower
 * values mean it is also travelling forward and closes more slowly.
 */
export abstract class Obstacle extends Phaser.GameObjects.Image {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    private readonly approachFactor: number,
  ) {
    super(scene, x, y, texture);
    this.setOrigin(0.5, 1);
    this.applyPerspective();
    scene.add.existing(this);
  }

  /** Advance by `delta` ms at the given game speed. Destroys itself off-screen. */
  update(delta: number, gameSpeed: number): void {
    const dt = delta / 1000;
    this.y += gameSpeed * this.approachFactor * dt;
    this.onUpdate(dt);
    this.applyPerspective();

    if (this.y - this.displayHeight > GAME_HEIGHT + OFFSCREEN_MARGIN) {
      this.destroy();
    }
  }

  /** Collision rectangle, slightly smaller than the drawn sprite. */
  get hitBox(): Phaser.Geom.Rectangle {
    const b = this.getBounds();
    return Phaser.Geom.Rectangle.Inflate(b, -b.width * HITBOX_INSET, -b.height * HITBOX_INSET);
  }

  /** Hook for subclass-specific motion. */
  protected onUpdate(_dt: number): void {}

  private applyPerspective(): void {
    this.setScale(perspectiveScale(this.y));
    this.setDepth(this.y);
  }
}
