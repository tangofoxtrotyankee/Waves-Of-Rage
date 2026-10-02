import Phaser from 'phaser';

import { PLAYER_BOUNDS } from './Player';
import { Obstacle } from './Obstacle';

const TEXTURE_KEY = 'rival-placeholder';
const WIDTH = 24;
const HEIGHT = 32;

/** Rivals surf forward too, so they close on the player more slowly. */
const APPROACH_FACTOR = 0.55;
/** Side-to-side weave, in pixels and radians per second. */
const WEAVE_AMPLITUDE = 18;
const WEAVE_RATE = 2.2;

/** Another surfer weaving across the wave. */
export class RivalSurfer extends Obstacle {
  private readonly baseX: number;
  private readonly phase: number;
  private elapsed = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    RivalSurfer.ensureTexture(scene);
    super(scene, x, y, TEXTURE_KEY, APPROACH_FACTOR);
    this.baseX = x;
    this.phase = Math.random() * Math.PI * 2;
  }

  protected override onUpdate(dt: number): void {
    this.elapsed += dt;
    const offset = Math.sin(this.phase + this.elapsed * WEAVE_RATE) * WEAVE_AMPLITUDE;
    this.x = Phaser.Math.Clamp(this.baseX + offset, PLAYER_BOUNDS.minX, PLAYER_BOUNDS.maxX);
  }

  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(TEXTURE_KEY)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    // Board
    g.fillStyle(0xf1faee);
    g.fillRect(1, 24, 22, 6);
    g.fillStyle(0x457b9d);
    g.fillRect(3, 26, 18, 2);
    // Legs
    g.fillStyle(0x1d3557);
    g.fillRect(7, 16, 4, 8);
    g.fillRect(13, 16, 4, 8);
    // Torso
    g.fillStyle(0xe63946);
    g.fillRect(7, 6, 10, 10);
    // Arms + head
    g.fillStyle(0xd9a066);
    g.fillRect(3, 7, 4, 3);
    g.fillRect(17, 7, 4, 3);
    g.fillRect(9, 0, 6, 6);
    // Hair
    g.fillStyle(0x3a2a1a);
    g.fillRect(9, 0, 6, 2);

    g.generateTexture(TEXTURE_KEY, WIDTH, HEIGHT);
    g.destroy();
  }
}
