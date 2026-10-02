import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH } from '../game/constants';

/** Height of the static sky strip at the top of the screen (matches sky.png). */
export const HORIZON_Y = 40;

/** Tile size of the water / foam textures (see tools/pixelart/environment.mjs). */
const TILE_SIZE = 64;

/**
 * Each layer scrolls at a multiple of the current game speed. The water
 * (far, big swells) moves slower than the foam (near, surface detail) to
 * give a cheap parallax / depth cue.
 */
export const OCEAN_SPEED_FACTORS = {
  water: 0.5,
  foam: 1.2,
} as const;

/**
 * Scrolling ocean: a painted sky strip plus two tiling water layers.
 *
 * Purely visual: it owns no gameplay state and nothing else depends on it.
 * The textures come from public/assets/sprites (built by tools/pixelart).
 */
export class OceanScroller {
  private readonly water: Phaser.GameObjects.TileSprite;
  private readonly foam: Phaser.GameObjects.TileSprite;

  constructor(scene: Phaser.Scene) {
    const oceanHeight = GAME_HEIGHT - HORIZON_Y;

    // The sky strip is 320 wide; centring it keeps the sun in the middle on the 180-wide portrait field.
    scene.add.image(GAME_WIDTH / 2, 0, AssetKeys.Sky).setOrigin(0.5, 0);
    this.water = scene.add.tileSprite(0, HORIZON_Y, GAME_WIDTH, oceanHeight, AssetKeys.Water).setOrigin(0);
    this.foam = scene.add.tileSprite(0, HORIZON_Y, GAME_WIDTH, oceanHeight, AssetKeys.Foam).setOrigin(0);
  }

  /** Advance the scroll by `delta` milliseconds at the given game speed. */
  update(delta: number, gameSpeed: number): void {
    const dt = delta / 1000;

    // Subtracting moves the texture down the screen. Wrapping with the modulo
    // keeps the values small forever; TileSprite tiling handles the looping.
    this.water.tilePositionY = (this.water.tilePositionY - gameSpeed * OCEAN_SPEED_FACTORS.water * dt) % TILE_SIZE;
    this.foam.tilePositionY = (this.foam.tilePositionY - gameSpeed * OCEAN_SPEED_FACTORS.foam * dt) % TILE_SIZE;
  }
}
