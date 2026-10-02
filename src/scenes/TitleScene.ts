import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';
import { consumeTap, requestImmersiveMode, touchState } from '../input/TouchControls';
import { HighScores } from '../systems/HighScores';
import { Hud } from '../ui/Hud';
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
    // Sky and water behind the artwork so the portrait field has no black bars.
    this.add.image(GAME_WIDTH / 2, 0, AssetKeys.Sky).setOrigin(0.5, 0);
    this.add.tileSprite(0, 40, GAME_WIDTH, GAME_HEIGHT - 40, AssetKeys.Water).setOrigin(0);

    const art = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, AssetKeys.TitleConcept);

    // Fit inside the 16:9 area without distortion, whatever size the asset is.
    const fit = Math.min(GAME_WIDTH / art.width, GAME_HEIGHT / art.height);
    art.setScale(fit);

    const best = new HighScores().best;
    if (best) pixelText(this, GAME_WIDTH / 2, 4, `BEST ${Hud.pad(best.score, 6)} ${best.name}`, 0xffd166).setOrigin(0.5, 0);

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

    // A click on the canvas also starts. On touch, a tap starts (polled in update) and
    // we try to go fullscreen in landscape.
    if (!touchState.enabled) this.input.once('pointerdown', () => this.startGame());
  }

  override update(): void {
    if (touchState.enabled && consumeTap()) {
      void requestImmersiveMode();
      this.startGame();
    }
  }

  private startGame(): void {
    this.scene.start(SceneKeys.Game);
  }
}
