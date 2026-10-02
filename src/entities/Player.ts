import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH } from '../game/constants';
import type { Controls } from '../input/Controls';

const TEXTURE_KEY = 'player-placeholder';

/** Placeholder sprite size, sized for a future 32x40 / 32x48 pixel-art surfer. */
const SPRITE_WIDTH = 24;
const SPRITE_HEIGHT = 32;

/**
 * Movement tuning. All values are in internal pixels per second (or per
 * second squared). Horizontal movement is the main axis; vertical movement
 * is deliberately slower and more limited so the surfer only shifts a little
 * up and down the face of the wave.
 */
export const PLAYER_MOVEMENT = {
  maxSpeedX: 150,
  maxSpeedY: 70,
  accelerationX: 900,
  accelerationY: 600,
  /** Applied when no input is held, so the surfer settles quickly. */
  decelerationX: 1100,
  decelerationY: 800,
} as const;

/**
 * The area the surfer is allowed to occupy (centre point of the sprite).
 * The top edge keeps the surfer on the lower half of the screen, the bottom
 * edge stops the board going off the foreground.
 */
export const PLAYER_BOUNDS = {
  minX: SPRITE_WIDTH / 2,
  maxX: GAME_WIDTH - SPRITE_WIDTH / 2,
  minY: 92,
  maxY: GAME_HEIGHT - SPRITE_HEIGHT / 2,
} as const;

/**
 * The player's surfer.
 *
 * A simple velocity model with acceleration and deceleration, integrated by
 * hand in update(). No physics engine is involved; this keeps the feel
 * arcade-like and fully under our control.
 */
export class Player extends Phaser.GameObjects.Image {
  private velocityX = 0;
  private velocityY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    Player.ensureTexture(scene);
    super(scene, x, y, TEXTURE_KEY);
    scene.add.existing(this);
  }

  /** Current horizontal velocity in pixels per second. */
  get vx(): number {
    return this.velocityX;
  }

  /** Current vertical velocity in pixels per second. */
  get vy(): number {
    return this.velocityY;
  }

  /** Advance movement by `delta` milliseconds using the given controls. */
  update(controls: Controls, delta: number): void {
    const dt = delta / 1000;

    this.velocityX = Player.integrateAxis(
      this.velocityX,
      controls.axisX,
      PLAYER_MOVEMENT.maxSpeedX,
      PLAYER_MOVEMENT.accelerationX,
      PLAYER_MOVEMENT.decelerationX,
      dt,
    );
    this.velocityY = Player.integrateAxis(
      this.velocityY,
      controls.axisY,
      PLAYER_MOVEMENT.maxSpeedY,
      PLAYER_MOVEMENT.accelerationY,
      PLAYER_MOVEMENT.decelerationY,
      dt,
    );

    const nextX = Phaser.Math.Clamp(this.x + this.velocityX * dt, PLAYER_BOUNDS.minX, PLAYER_BOUNDS.maxX);
    const nextY = Phaser.Math.Clamp(this.y + this.velocityY * dt, PLAYER_BOUNDS.minY, PLAYER_BOUNDS.maxY);

    // Kill velocity when pressed against an edge so we don't "store up" speed.
    if (nextX !== this.x + this.velocityX * dt) this.velocityX = 0;
    if (nextY !== this.y + this.velocityY * dt) this.velocityY = 0;

    this.setPosition(nextX, nextY);
  }

  /**
   * Move one velocity component towards the target implied by the input:
   * accelerate towards +/- maxSpeed while held, decelerate to zero otherwise.
   */
  private static integrateAxis(
    velocity: number,
    input: number,
    maxSpeed: number,
    acceleration: number,
    deceleration: number,
    dt: number,
  ): number {
    if (input !== 0) {
      // Turning around uses the (stronger) deceleration so direction changes feel snappy.
      const rate = Math.sign(velocity) === -input ? deceleration + acceleration : acceleration;
      return Phaser.Math.Clamp(velocity + input * rate * dt, -maxSpeed, maxSpeed);
    }

    // No input: ease back to a stop without overshooting zero.
    const step = deceleration * dt;
    if (Math.abs(velocity) <= step) return 0;
    return velocity - Math.sign(velocity) * step;
  }

  /** Draw the placeholder surfer (board + body) into a texture once. */
  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;

    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    // Surfboard
    g.fillStyle(0xffb703);
    g.fillRect(1, 24, 22, 6);
    g.fillStyle(0xe76f51);
    g.fillRect(3, 26, 18, 2);

    // Legs
    g.fillStyle(0x264653);
    g.fillRect(7, 16, 4, 8);
    g.fillRect(13, 16, 4, 8);

    // Torso
    g.fillStyle(0x2a9d8f);
    g.fillRect(7, 6, 10, 10);

    // Arms
    g.fillStyle(0xf4a261);
    g.fillRect(3, 7, 4, 3);
    g.fillRect(17, 7, 4, 3);

    // Head
    g.fillStyle(0xf4a261);
    g.fillRect(9, 0, 6, 6);

    g.generateTexture(TEXTURE_KEY, SPRITE_WIDTH, SPRITE_HEIGHT);
    g.destroy();
  }
}
