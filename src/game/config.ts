import Phaser from 'phaser';

import { BootScene } from '../scenes/BootScene';
import { GameScene } from '../scenes/GameScene';
import { GAME_HEIGHT, GAME_WIDTH } from './constants';

/**
 * Central Phaser configuration.
 *
 * Rendering is tuned for 16-bit style pixel art:
 *  - a fixed 320x180 internal resolution
 *  - nearest-neighbour upscaling (no texture smoothing / anti-aliasing)
 *  - positions rounded to whole pixels
 *  - FIT scaling that preserves the aspect ratio and centres the canvas
 */
export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // WebGL where available, otherwise Canvas
  backgroundColor: '#000000',

  // pixelArt: true also disables anti-aliasing and enables roundPixels, but
  // the related flags are set explicitly below so the intent is obvious.
  pixelArt: true,
  antialias: false,
  roundPixels: true,

  scale: {
    parent: 'game',
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },

  input: {
    keyboard: true,
  },

  // The first scene in this list starts automatically.
  scene: [BootScene, GameScene],
};
