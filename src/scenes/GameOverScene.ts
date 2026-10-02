import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';
import { Hud } from '../ui/Hud';

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
    const base: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      color: '#ffffff',
      stroke: '#1a0b2e',
      strokeThickness: 3,
      align: 'center',
    };
    const cx = GAME_WIDTH / 2;

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x1a0b2e, 0.8).setOrigin(0);

    this.add.text(cx, 38, 'WIPEOUT', { ...base, fontSize: '24px', color: '#ff4d6d' }).setOrigin(0.5);
    this.add.text(cx, 74, `DISTANCE  ${Hud.pad(data.distanceUnits ?? 0, 5)}`, { ...base, fontSize: '10px', color: '#7ff6ff' }).setOrigin(0.5);
    this.add.text(cx, 90, `SCORE  ${Hud.pad(data.score ?? 0, 6)}`, { ...base, fontSize: '10px', color: '#ffd166' }).setOrigin(0.5);

    const prompt = this.add.text(cx, 130, 'PRESS SPACE TO SURF AGAIN', { ...base, fontSize: '8px' }).setOrigin(0.5);
    this.add.text(cx, 146, 'ESC FOR TITLE', { ...base, fontSize: '8px', color: '#bbbbbb' }).setOrigin(0.5);

    this.tweens.add({ targets: prompt, alpha: 0.15, duration: 500, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

    this.time.delayedCall(INPUT_DELAY_MS, () => {
      const keyboard = this.input.keyboard;
      if (!keyboard) return;
      keyboard.once('keydown-SPACE', () => this.scene.start(SceneKeys.Game));
      keyboard.once('keydown-ESC', () => this.scene.start(SceneKeys.Title));
    });
  }
}
