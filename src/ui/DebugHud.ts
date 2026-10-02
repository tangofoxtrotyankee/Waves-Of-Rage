import Phaser from 'phaser';

import type { Player } from '../entities/Player';

/**
 * Temporary on-screen readout of player position and velocity.
 *
 * To remove it later, delete this file and the two lines that reference it
 * in GameScene.
 */
export class DebugHud {
  private readonly text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    this.text = scene.add
      .text(2, 2, '', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffffff',
        backgroundColor: '#00000080',
      })
      .setDepth(1000);
  }

  update(player: Player): void {
    this.text.setText([
      `x: ${player.x.toFixed(1)}`,
      `y: ${player.y.toFixed(1)}`,
      `vx: ${player.vx.toFixed(0)}`,
      `vy: ${player.vy.toFixed(0)}`,
    ]);
  }
}
