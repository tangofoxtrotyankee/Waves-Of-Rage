import Phaser from 'phaser';

import { GAME_HEIGHT } from '../game/constants';
import { perspectiveScale } from '../systems/Perspective';

/** Fraction of the sprite's bounds trimmed from each side for collisions. */
const HITBOX_INSET = 0.2;

/** Once an obstacle is this far below the screen it is destroyed. */
const OFFSCREEN_MARGIN = 32;

export type HazardKind = 'rock' | 'rival' | 'shark' | 'ramp';

/** Per-frame world information hazards may react to. */
export interface HazardContext {
  playerX: number;
  playerY: number;
  /** True while the player is in big air (launched from a ramp). */
  playerInBigAir: boolean;
}

export interface ObstacleConfig {
  kind: HazardKind;
  texture: string;
  /** 1 = stationary in the world (approaches at full game speed); lower = also moving forward. */
  approachFactor: number;
  /** Health points removed when the player collides with it. */
  damage: number;
  /** Whether the player passes safely over it while airborne. */
  jumpable: boolean;
  /** Whether a rival knocked into this hazard wipes out immediately. */
  knocksOutRivals: boolean;
}

/**
 * Base class for hazards that come down the wave towards the player.
 *
 * Subclasses provide their config (texture, approach speed, damage, whether
 * a jump clears them) and optionally extra motion via onUpdate().
 */
export abstract class Obstacle extends Phaser.GameObjects.Sprite {
  readonly kind: HazardKind;
  readonly damage: number;
  readonly jumpable: boolean;
  readonly knocksOutRivals: boolean;
  private readonly approachFactor: number;

  /** Set once the player has been credited for clearing this hazard. */
  cleared = false;

  constructor(scene: Phaser.Scene, x: number, y: number, config: ObstacleConfig) {
    super(scene, x, y, config.texture);
    this.kind = config.kind;
    this.damage = config.damage;
    this.jumpable = config.jumpable;
    this.knocksOutRivals = config.knocksOutRivals;
    this.approachFactor = config.approachFactor;

    this.setOrigin(0.5, 1);
    this.applyPerspective();
    scene.add.existing(this);
  }

  /** Whether touching this hazard hurts the player right now. */
  get isDangerous(): boolean {
    return true;
  }

  /** Advance by `delta` ms at the given game speed. Destroys itself off-screen. */
  update(delta: number, gameSpeed: number, ctx: HazardContext): void {
    const dt = delta / 1000;
    this.y += gameSpeed * this.approachFactor * dt;
    this.onUpdate(dt, ctx);
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
  protected onUpdate(_dt: number, _ctx: HazardContext): void {}

  protected applyPerspective(): void {
    this.setScale(perspectiveScale(this.y));
    this.setDepth(this.y);
  }
}
