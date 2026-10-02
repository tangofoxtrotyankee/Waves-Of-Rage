import Phaser from 'phaser';

import { pixelText } from './PixelText';

/** Pops a short label (e.g. "+500") that drifts up and fades out. */
export function spawnFloatingText(scene: Phaser.Scene, x: number, y: number, text: string, color = 0xffd166): void {
  const label = pixelText(scene, Math.round(x), Math.round(y), text, color).setOrigin(0.5, 1).setDepth(900);

  scene.tweens.add({
    targets: label,
    y: y - 18,
    alpha: 0,
    duration: 800,
    ease: 'Quad.easeOut',
    onComplete: () => label.destroy(),
  });
}
