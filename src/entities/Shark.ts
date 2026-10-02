import Phaser from 'phaser';

import { PLAYER_BOUNDS } from './Player';
import { Obstacle } from './Obstacle';

const TEXTURE_KEY = 'shark-placeholder';
const WIDTH = 30;
const HEIGHT = 18;

export const SHARK = {
  damage: 2,
  /** A shark can't be jumped: it's in the water, not on it, and it'll get you. */
  jumpable: false,
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
    Shark.ensureTexture(scene);
    super(scene, x, y, {
      kind: 'shark',
      texture: TEXTURE_KEY,
      approachFactor: SHARK.approachFactor,
      damage: SHARK.damage,
      jumpable: SHARK.jumpable,
    });
    this.targetX = x;
    this.untilNextLunge = Shark.rollInterval();
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

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    // Dark grey body low in the water with a tall fin: clearly not a rock or a surfer.
    g.fillStyle(0x3d405b);
    g.fillRect(2, 11, 26, 5);
    g.fillStyle(0x1f2235);
    g.fillRect(0, 12, 4, 3); // tail
    // Fin
    g.fillTriangle(12, 11, 20, 11, 18, 0);
    g.fillStyle(0x3d405b);
    g.fillTriangle(13, 11, 19, 11, 17, 3);
    // Eye and a white splash line
    g.fillStyle(0xff3b3b);
    g.fillRect(25, 12, 2, 2);
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(0, 16, 30, 2);

    g.generateTexture(TEXTURE_KEY, WIDTH, HEIGHT);
    g.destroy();
  }
}
