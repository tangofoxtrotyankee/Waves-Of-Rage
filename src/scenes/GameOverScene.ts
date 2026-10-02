import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';
import { Hud } from '../ui/Hud';
import { pixelText } from '../ui/PixelText';

export interface GameOverData {
  distanceUnits: number;
  score: number;
}

/** Ignore key presses for this long so a jump mashed at the moment of death doesn't restart instantly. */
const INPUT_DELAY_MS = 600;

/** Wipeout screen: shows the run's results and offers restart or title. */
export class GameOverScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.GameOver);
  }

  create(data: GameOverData): void {
    const cx = GAME_WIDTH / 2;

    this.add.image(0, 0, AssetKeys.Sky).setOrigin(0);
    this.add.tileSprite(0, 40, GAME_WIDTH, GAME_HEIGHT - 40, AssetKeys.Water).setOrigin(0);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x1a0b2e, 0.75).setOrigin(0);

    pixelText(this, cx, 40, 'WIPEOUT', 0xff4d6d, 3).setOrigin(0.5);
    pixelText(this, cx, 76, `DISTANCE ${Hud.pad(data.distanceUnits ?? 0, 5)}`, 0x7ff6ff).setOrigin(0.5);
    pixelText(this, cx, 90, `SCORE ${Hud.pad(data.score ?? 0, 6)}`, 0xffd166).setOrigin(0.5);

    const prompt = pixelText(this, cx, 130, 'PRESS SPACE TO SURF AGAIN', 0xffffff).setOrigin(0.5);
    pixelText(this, cx, 146, 'ESC FOR TITLE', 0xbbbbbb).setOrigin(0.5);

    this.tweens.add({ targets: prompt, alpha: 0.15, duration: 500, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

    this.time.delayedCall(INPUT_DELAY_MS, () => {
      const keyboard = this.input.keyboard;
      if (!keyboard) return;
      keyboard.once('keydown-SPACE', () => this.scene.start(SceneKeys.Game));
      keyboard.once('keydown-ESC', () => this.scene.start(SceneKeys.Title));
    });
  }
}
