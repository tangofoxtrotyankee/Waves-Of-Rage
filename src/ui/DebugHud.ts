import Phaser from 'phaser';

import type { Obstacle } from '../entities/Obstacle';
import type { Player } from '../entities/Player';
import { RivalSurfer } from '../entities/RivalSurfer';

export interface DebugInfo {
  player: Player;
  health: number;
  score: number;
  gameSpeed: number;
  elapsedSeconds: number;
  obstacles: Obstacle[];
  secondsToNextSpawn: number;
  comboMultiplier: number;
  comboSecondsRemaining: number;
}

/**
 * Developer readout, hidden by default and toggled with F1 (see GameScene).
 * While visible it also outlines collision and attack hitboxes.
 *
 * To remove it later, delete this file and the few lines that reference it
 * in GameScene.
 */
export class DebugHud {
  private readonly text: Phaser.GameObjects.Text;
  private readonly boxes: Phaser.GameObjects.Graphics;

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
    this.boxes = scene.add.graphics().setDepth(999).setVisible(false);
  }

  get visible(): boolean {
    return this.text.visible;
  }

  toggle(): void {
    const show = !this.text.visible;
    this.text.setVisible(show);
    this.boxes.setVisible(show);
    if (!show) this.boxes.clear();
  }

  update(info: DebugInfo): void {
    if (!this.text.visible) return;
    const { player } = info;

    const counts: Record<string, number> = {};
    for (const o of info.obstacles) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
    const hazards = Object.entries(counts)
      .map(([kind, n]) => `${kind}:${n}`)
      .join(' ');
    const rivals = info.obstacles.filter((o): o is RivalSurfer => o instanceof RivalSurfer);
    const rivalStates = rivals.map((r) => `${r.rivalState[0]}${r.currentHealth}`).join(' ');

    this.text.setText([
      `state: ${player.playerState}  facing: ${player.facing > 0 ? 'R' : 'L'}  health: ${info.health}`,
      `score: ${info.score.toFixed(0)}  combo: x${info.comboMultiplier} (${info.comboSecondsRemaining.toFixed(1)}s)`,
      `attack cd: ${player.attackCooldown.toFixed(2)}  barge cd: ${player.bargeCooldown.toFixed(2)}`,
      `x: ${player.x.toFixed(1)}  y: ${player.y.toFixed(1)}  air: ${player.airHeight.toFixed(0)}`,
      `vx: ${player.vx.toFixed(0)}  vy: ${player.vy.toFixed(0)}  speed: ${info.gameSpeed.toFixed(0)}  t: ${info.elapsedSeconds.toFixed(1)}s`,
      `hazards: ${info.obstacles.length} ${hazards}`,
      `rivals: ${rivals.length} ${rivalStates}`,
      `next spawn: ${info.secondsToNextSpawn.toFixed(2)}s`,
    ]);

    this.drawHitboxes(info);
  }

  private drawHitboxes(info: DebugInfo): void {
    const g = this.boxes;
    g.clear();

    g.lineStyle(1, 0x00ff88, 0.9);
    g.strokeRectShape(info.player.hitBox);

    const attack = info.player.attackHitBox;
    if (attack) {
      g.lineStyle(1, 0xffe066, 1);
      g.strokeRectShape(attack);
    }

    for (const o of info.obstacles) {
      g.lineStyle(1, o.isDangerous ? 0xff4d6d : 0x7ff6ff, 0.9);
      g.strokeRectShape(o.hitBox);
    }
  }
}
