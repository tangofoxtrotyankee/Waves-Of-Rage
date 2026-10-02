import Phaser from 'phaser';

/** Pops a short label (e.g. "+500") that drifts up and fades out. */
export function spawnFloatingText(scene: Phaser.Scene, x: number, y: number, text: string, color = '#ffd166'): void {
  const label = scene.add
    .text(Math.round(x), Math.round(y), text, {
      fontFamily: 'monospace',
      fontSize: '8px',
      color,
      stroke: '#1a0b2e',
      strokeThickness: 2,
    })
    .setOrigin(0.5, 1)
    .setDepth(900);

  scene.tweens.add({
    targets: label,
    y: y - 18,
    alpha: 0,
    duration: 800,
    ease: 'Quad.easeOut',
    onComplete: () => label.destroy(),
  });
}
