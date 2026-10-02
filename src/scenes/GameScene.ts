import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';

/**
 * GameScene is where gameplay will live.
 *
 * For now it only proves the pipeline works: a plain coloured background and
 * some text rendered at the internal 320x180 resolution.
 */
export class GameScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Game);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1b4f8a');

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 8, 'WAVES OF RAGE', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 10, 'Phaser 3 foundation online', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffd166',
      })
      .setOrigin(0.5);
  }
}
