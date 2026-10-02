import Phaser from 'phaser';

import { Obstacle } from './Obstacle';

const TEXTURE_KEY = 'ramp-placeholder';
const WIDTH = 30;
const HEIGHT = 14;

/**
 * A curling section of wave that launches whoever rides over it.
 * Harmless: it never damages anyone and jumps pass straight over it.
 */
export class WaveRamp extends Obstacle {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    WaveRamp.ensureTexture(scene);
    super(scene, x, y, {
      kind: 'ramp',
      texture: TEXTURE_KEY,
      approachFactor: 1,
      damage: 0,
      jumpable: true,
      knocksOutRivals: false,
    });
  }

  override get isDangerous(): boolean {
    return false;
  }

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    // Bright cyan wedge with a white foam lip: reads as water, not a hazard.
    g.fillStyle(0x19c2d6);
    g.fillTriangle(0, HEIGHT, WIDTH, HEIGHT, WIDTH, 2);
    g.fillStyle(0x7ff6ff);
    g.fillTriangle(6, HEIGHT, WIDTH, HEIGHT, WIDTH, 6);
    g.fillStyle(0xffffff);
    g.fillRect(WIDTH - 10, 0, 10, 3);
    g.fillRect(0, HEIGHT - 2, WIDTH, 2);

    g.generateTexture(TEXTURE_KEY, WIDTH, HEIGHT);
    g.destroy();
  }
}
