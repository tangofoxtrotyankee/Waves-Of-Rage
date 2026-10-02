import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';

/**
 * Title screen. Uses the concept artwork as a temporary background (the logo
 * is part of the artwork) with a pulsing prompt. Space or Enter starts play.
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Title);
  }

  create(): void {
    const art = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, AssetKeys.TitleConcept);

    // Fit inside the 16:9 area without distortion, whatever size the asset is.
    const fit = Math.min(GAME_WIDTH / art.width, GAME_HEIGHT / art.height);
    art.setScale(fit);

    const prompt = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 6, 'PRESS SPACE', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#7ff6ff',
        stroke: '#1a0b2e',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.tweens.add({
      targets: prompt,
      alpha: 0.15,
      duration: 500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.once('keydown-SPACE', () => this.startGame());
      keyboard.once('keydown-ENTER', () => this.startGame());
    }
  }

  private startGame(): void {
    this.scene.start(SceneKeys.Game);
  }
}
