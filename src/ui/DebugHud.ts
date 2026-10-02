import Phaser from 'phaser';

import type { Obstacle } from '../entities/Obstacle';
import type { Player } from '../entities/Player';

export interface DebugInfo {
  player: Player;
  health: number;
  score: number;
  gameSpeed: number;
  elapsedSeconds: number;
  obstacles: Obstacle[];
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
      .text(2, 24, '', {
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

    const counts: Record<string, number> = {};
    for (const o of info.obstacles) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
    const hazards = Object.entries(counts)
      .map(([kind, n]) => `${kind}:${n}`)
      .join(' ');

    this.text.setText([
      `state: ${player.playerState}  health: ${info.health}`,
      `score: ${info.score.toFixed(0)}  t: ${info.elapsedSeconds.toFixed(1)}s`,
      `x: ${player.x.toFixed(1)}  y: ${player.y.toFixed(1)}  air: ${player.airHeight.toFixed(0)}`,
      `vx: ${player.vx.toFixed(0)}  vy: ${player.vy.toFixed(0)}`,
      `speed: ${info.gameSpeed.toFixed(0)}`,
      `hazards: ${info.obstacles.length} ${hazards}`,
      `next spawn: ${info.secondsToNextSpawn.toFixed(2)}s`,
    ]);
  }
}
