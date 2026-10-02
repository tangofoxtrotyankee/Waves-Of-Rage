import Phaser from 'phaser';

import { GAME_WIDTH } from '../game/constants';
import { GAMEPLAY } from '../game/gameplay';

export interface HudInfo {
  health: number;
  score: number;
  distanceUnits: number;
  /** 1 when no combo is running. */
  comboMultiplier: number;
  /** Seconds left on the combo window (drives the fade). */
  comboSecondsRemaining: number;
}

/** Simple arcade HUD: hearts on the left, score and distance on the right. */
export class Hud {
  private readonly health: Phaser.GameObjects.Text;
  private readonly score: Phaser.GameObjects.Text;
  private readonly distance: Phaser.GameObjects.Text;
  private readonly combo: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#ffffff',
      stroke: '#1a0b2e',
      strokeThickness: 2,
    };
    const label = { ...style, color: '#ffd166' };

    scene.add.text(4, 3, 'HEALTH', label).setDepth(1000);
    this.health = scene.add.text(4, 12, '', { ...style, color: '#ff4d6d' }).setDepth(1000);

    scene.add.text(GAME_WIDTH - 4, 3, 'SCORE', label).setOrigin(1, 0).setDepth(1000);
    this.score = scene.add.text(GAME_WIDTH - 4, 12, '000000', style).setOrigin(1, 0).setDepth(1000);

    scene.add.text(GAME_WIDTH - 64, 3, 'DIST', label).setOrigin(1, 0).setDepth(1000);
    this.distance = scene.add.text(GAME_WIDTH - 64, 12, '00000', style).setOrigin(1, 0).setDepth(1000);

    this.combo = scene.add
      .text(GAME_WIDTH / 2, 4, '', { ...style, fontSize: '10px', color: '#7ff6ff' })
      .setOrigin(0.5, 0)
      .setDepth(1000)
      .setVisible(false);
  }

  update(info: HudInfo): void {
    this.health.setText('♥'.repeat(Math.max(0, info.health)) + '♡'.repeat(Math.max(0, GAMEPLAY.startHealth - info.health)));
    this.score.setText(Hud.pad(info.score, 6));
    this.distance.setText(Hud.pad(info.distanceUnits, 5));

    const showCombo = info.comboMultiplier > 1 && info.comboSecondsRemaining > 0;
    this.combo.setVisible(showCombo);
    if (showCombo) {
      this.combo.setText(`COMBO x${info.comboMultiplier}`);
      this.combo.setAlpha(Math.min(1, 0.3 + info.comboSecondsRemaining / GAMEPLAY.comboWindowSeconds));
    }
  }

  static pad(value: number, digits: number): string {
    return String(Math.max(0, Math.floor(value))).padStart(digits, '0');
  }
}
