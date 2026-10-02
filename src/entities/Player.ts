import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH } from '../game/constants';
import type { Controls } from '../input/Controls';
import { perspectiveScale } from '../systems/Perspective';

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

/** What happens when the surfer hits something. */
export const PLAYER_HIT = {
  /** Sideways shove away from the obstacle, pixels per second. */
  knockbackX: 160,
  /** Push towards the foreground, pixels per second. */
  knockbackY: 70,
  /** Seconds of immunity after a hit. */
  invulnerableSeconds: 1.2,
  /** Seconds of red tint before the blink phase takes over. */
  flashSeconds: 0.15,
} as const;

/** Fraction of the sprite's bounds trimmed from each side for collisions. */
const HITBOX_INSET = 0.2;

/**
 * The area the surfer is allowed to occupy (the sprite's bottom-centre, i.e.
 * the board). The top edge keeps the surfer on the lower half of the screen,
 * the bottom edge stops the board going off the foreground.
 */
export const PLAYER_BOUNDS = {
  minX: SPRITE_WIDTH / 2,
  maxX: GAME_WIDTH - SPRITE_WIDTH / 2,
  minY: 92 + SPRITE_HEIGHT / 2,
  maxY: GAME_HEIGHT,
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
  private invulnerableUntil = 0;
  private blinkTween?: Phaser.Tweens.Tween;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    Player.ensureTexture(scene);
    super(scene, x, y, TEXTURE_KEY);
    this.setOrigin(0.5, 1);
    this.applyPerspective();
    scene.add.existing(this);
  }

  /** True while the post-hit immunity window is active. */
  get isInvulnerable(): boolean {
    return this.scene.time.now < this.invulnerableUntil;
  }

  /** Collision rectangle, slightly smaller than the drawn sprite. */
  get hitBox(): Phaser.Geom.Rectangle {
    const b = this.getBounds();
    return Phaser.Geom.Rectangle.Inflate(b, -b.width * HITBOX_INSET, -b.height * HITBOX_INSET);
  }

  /**
   * React to a collision with something at `fromX`: shove away from it, push
   * towards the foreground, flash red, then blink for the immunity period.
   */
  hit(fromX: number): void {
    const direction = Math.sign(this.x - fromX) || (this.x < GAME_WIDTH / 2 ? 1 : -1);
    this.velocityX = direction * PLAYER_HIT.knockbackX;
    this.velocityY = PLAYER_HIT.knockbackY;
    this.invulnerableUntil = this.scene.time.now + PLAYER_HIT.invulnerableSeconds * 1000;

    this.blinkTween?.stop();
    this.setTint(0xff3b3b).setAlpha(1);
    this.scene.time.delayedCall(PLAYER_HIT.flashSeconds * 1000, () => {
      this.clearTint();
      this.blinkTween = this.scene.tweens.add({
        targets: this,
        alpha: 0.25,
        duration: 80,
        yoyo: true,
        repeat: Math.floor(((PLAYER_HIT.invulnerableSeconds - PLAYER_HIT.flashSeconds) * 1000) / 160),
        onComplete: () => this.setAlpha(1),
      });
    });
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
    this.applyPerspective();
  }

  /** Subtle size change with depth, and draw order by Y so nearer things are on top. */
  private applyPerspective(): void {
    this.setScale(perspectiveScale(this.y));
    this.setDepth(this.y);
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
