import Phaser from 'phaser';

import type { Player } from '../entities/Player';

export interface DebugInfo {
  player: Player;
  gameSpeed: number;
  obstacleCount: number;
  secondsToNextSpawn: number;
}

/**
 * Developer readout, hidden by default and toggled with F1 (see GameScene).
 *
 * To remove it later, delete this file and the few lines that reference it
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
      .setDepth(1001)
      .setVisible(false);
  }

  get visible(): boolean {
    return this.text.visible;
  }

  toggle(): void {
    this.text.setVisible(!this.text.visible);
  }

  update(info: DebugInfo): void {
    if (!this.text.visible) return;
    const { player } = info;
    this.text.setText([
      `x: ${player.x.toFixed(1)}  y: ${player.y.toFixed(1)}`,
      `vx: ${player.vx.toFixed(0)}  vy: ${player.vy.toFixed(0)}`,
      `speed: ${info.gameSpeed.toFixed(0)}`,
      `obstacles: ${info.obstacleCount}`,
      `next spawn: ${info.secondsToNextSpawn.toFixed(2)}s`,
    ]);
  }
}
