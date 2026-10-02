import Phaser from 'phaser';

import { AssetKeys } from '../game/constants';

/**
 * Pixel-font text helper. The generated font is upper-case only, so text is
 * upper-cased here; unknown characters are dropped by Phaser.
 */
export function pixelText(scene: Phaser.Scene, x: number, y: number, text: string, color = 0xffffff, scale = 1): Phaser.GameObjects.BitmapText {
  const label = scene.add.bitmapText(x, y, AssetKeys.Font, text.toUpperCase()).setTint(color).setScale(scale);
  // A one-pixel dark shadow keeps text readable over the sky and water.
  label.setDropShadow(1, 1, 0x1a0b2e, 1);
  return label;
}
