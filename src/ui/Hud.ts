import Phaser from 'phaser';

import { GAME_WIDTH } from '../game/constants';
import { GAMEPLAY } from '../game/gameplay';
import { pixelText } from './PixelText';

export interface HudInfo {
  health: number;
  maxHealth: number;
  score: number;
  distanceUnits: number;
  /** 1 when no combo is running. */
  comboMultiplier: number;
  /** Seconds left on the combo window (drives the fade). */
  comboSecondsRemaining: number;
}

const LABEL = 0xffd166;
const VALUE = 0xffffff;
const HEART = 0xff4d6d;
const COMBO = 0x7ff6ff;

/** Simple arcade HUD in the pixel font: hearts on the left, score and distance on the right. */
export class Hud {
  private readonly health: Phaser.GameObjects.BitmapText;
  private readonly score: Phaser.GameObjects.BitmapText;
  private readonly distance: Phaser.GameObjects.BitmapText;
  private readonly combo: Phaser.GameObjects.BitmapText;

  constructor(scene: Phaser.Scene) {
    pixelText(scene, 4, 3, 'HEALTH', LABEL).setDepth(1000);
    this.health = pixelText(scene, 4, 13, '', HEART).setDepth(1000);

    pixelText(scene, GAME_WIDTH - 20, 3, 'SCORE', LABEL).setOrigin(1, 0).setDepth(1000);
    this.score = pixelText(scene, GAME_WIDTH - 20, 13, '000000', VALUE).setOrigin(1, 0).setDepth(1000);

    pixelText(scene, GAME_WIDTH - 80, 3, 'DIST', LABEL).setOrigin(1, 0).setDepth(1000);
    this.distance = pixelText(scene, GAME_WIDTH - 80, 13, '00000', VALUE).setOrigin(1, 0).setDepth(1000);

    this.combo = pixelText(scene, GAME_WIDTH / 2, 24, '', COMBO).setOrigin(0.5, 0).setDepth(1000).setVisible(false);
  }

  update(info: HudInfo): void {
    const full = Math.max(0, Math.min(info.health, info.maxHealth));
    const empty = Math.max(0, info.maxHealth - full);
    this.health.setText('\u2665'.repeat(full) + '\u2661'.repeat(empty));
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
