import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';
import { requestImmersiveMode, touchState } from '../input/TouchControls';
import { pixelText } from '../ui/PixelText';

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

    const promptText = touchState.enabled ? 'TAP TO START' : 'PRESS SPACE';
    const prompt = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT - 6, promptText, 0x7ff6ff).setOrigin(0.5);

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

    // A tap (or click) on the canvas also starts; on phones try to go fullscreen in landscape.
    this.input.once('pointerdown', () => {
      if (touchState.enabled) void requestImmersiveMode();
      this.startGame();
    });
  }

  private startGame(): void {
    this.scene.start(SceneKeys.Game);
  }
}
