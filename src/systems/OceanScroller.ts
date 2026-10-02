import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH } from '../game/constants';

/** Height of the static sky band at the top of the screen. */
export const HORIZON_Y = 40;

const WATER_KEY = 'ocean-water';
const FOAM_KEY = 'ocean-foam';

/** Tile size for the generated textures. Both layers tile seamlessly. */
const TILE_SIZE = 64;

/**
 * Scroll speeds in pixels per second. Positive values move the texture
 * downwards (towards the player), which reads as the surfer travelling
 * forward. The foam layer is faster to give a cheap parallax / depth cue.
 */
export const OCEAN_SPEEDS = {
  water: 45,
  foam: 110,
} as const;

/**
 * Procedural scrolling ocean made of tiling TileSprites.
 *
 * Purely visual: it owns no gameplay state and nothing else depends on it, so
 * it can be swapped for proper pixel-art wave tiles later without touching
 * the player code. Layers are created in draw order (back to front).
 */
export class OceanScroller {
  private readonly water: Phaser.GameObjects.TileSprite;
  private readonly foam: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene) {
    OceanScroller.ensureTextures(scene);

    const oceanHeight = GAME_HEIGHT - HORIZON_Y;

    // Sky band + a bright horizon line.
    scene.add.rectangle(0, 0, GAME_WIDTH, HORIZON_Y, 0xf7b267).setOrigin(0);
    scene.add.rectangle(0, HORIZON_Y - 2, GAME_WIDTH, 2, 0xffe9c2).setOrigin(0);

    this.water = scene.add.tileSprite(0, HORIZON_Y, GAME_WIDTH, oceanHeight, WATER_KEY).setOrigin(0);
    this.foam = scene.add.tileSprite(0, HORIZON_Y, GAME_WIDTH, oceanHeight, FOAM_KEY).setOrigin(0);
  }

  /** Advance the scroll by `delta` milliseconds. */
  update(delta: number): void {
    const dt = delta / 1000;

    // Subtracting moves the texture down the screen. Wrapping with the modulo
    // keeps the values small forever; TileSprite tiling handles the looping.
    this.water.tilePositionY = (this.water.tilePositionY - OCEAN_SPEEDS.water * dt) % TILE_SIZE;
    this.foam.tilePositionY = (this.foam.tilePositionY - OCEAN_SPEEDS.foam * dt) % TILE_SIZE;
  }

  /** Generate the two tileable placeholder textures once. */
  private static ensureTextures(scene: Phaser.Scene): void {
    if (!scene.textures.exists(WATER_KEY)) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);

      // Base water colour.
      g.fillStyle(0x1b4f8a);
      g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

      // Darker swell bands. Full-width rows tile seamlessly left/right, and
      // staying inside the tile keeps the top/bottom seam clean.
      g.fillStyle(0x163f70);
      for (let y = 4; y < TILE_SIZE; y += 16) {
        g.fillRect(0, y, TILE_SIZE, 3);
      }

      // Lighter ripples offset between the bands.
      g.fillStyle(0x2a6db3);
      for (let y = 12; y < TILE_SIZE; y += 16) {
        g.fillRect(0, y, TILE_SIZE, 1);
      }

      g.generateTexture(WATER_KEY, TILE_SIZE, TILE_SIZE);
      g.destroy();
    }

    if (!scene.textures.exists(FOAM_KEY)) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);

      // Short white streaks on a transparent background. A seeded generator
      // keeps the pattern identical on every run, and each streak is kept
      // fully inside the tile so nothing is cut at the seam.
      const rng = new Phaser.Math.RandomDataGenerator(['waves-of-rage-foam']);
      g.fillStyle(0xffffff, 0.85);
      for (let i = 0; i < 14; i++) {
        const length = rng.between(3, 9);
        const x = rng.between(0, TILE_SIZE - length);
        const y = rng.between(0, TILE_SIZE - 1);
        g.fillRect(x, y, length, 1);
      }

      g.generateTexture(FOAM_KEY, TILE_SIZE, TILE_SIZE);
      g.destroy();
    }
  }
}
