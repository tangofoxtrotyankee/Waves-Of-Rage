import Phaser from 'phaser';

import { Obstacle } from './Obstacle';

const TEXTURE_KEY = 'rock-placeholder';
const WIDTH = 22;
const HEIGHT = 16;

export const ROCK = {
  damage: 1,
  jumpable: true,
} as const;

/** A rock sticking out of the water. Stationary, so it approaches at full speed. */
export class Rock extends Obstacle {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    Rock.ensureTexture(scene);
    super(scene, x, y, { kind: 'rock', texture: TEXTURE_KEY, approachFactor: 1, ...ROCK });
  }

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    // Dark outline block, lighter body, highlight, and a foam ring at the base.
    g.fillStyle(0x2b2d42);
    g.fillRect(2, 2, 18, 14);
    g.fillStyle(0x5c6378);
    g.fillRect(4, 4, 14, 10);
    g.fillStyle(0x8d99ae);
    g.fillRect(6, 5, 5, 3);
    g.fillStyle(0xffffff, 0.9);
    g.fillRect(0, 13, 22, 2);

    g.generateTexture(TEXTURE_KEY, WIDTH, HEIGHT);
    g.destroy();
  }
}
