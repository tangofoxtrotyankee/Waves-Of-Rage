import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';
import { consumeTap } from '../input/TouchControls';
import { pixelText } from '../ui/PixelText';

/**
 * Pause overlay, launched on top of a paused GameScene.
 * RESUME continues, RESTART starts a fresh run, MAIN MENU goes to the title.
 * Keyboard: Esc or P resumes, R restarts, M for the menu.
 */
export class PauseScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Pause);
  }

  create(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x1a0b2e, 0.7).setOrigin(0);
    this.add.rectangle(cx, cy, Math.min(GAME_WIDTH - 20, 150), 96, 0x1a0b2e, 0.95).setStrokeStyle(2, 0x7ff6ff);

    pixelText(this, cx, cy - 36, 'PAUSED', 0xffd166, 2).setOrigin(0.5);

    const option = (y: number, label: string, color: number, action: () => void) => {
      const text = pixelText(this, cx, y, label, color).setOrigin(0.5);
      text.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(-10, -5, text.width + 20, text.height + 10), hitAreaCallback: Phaser.Geom.Rectangle.Contains });
      text.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        action();
      });
      return text;
    };
    option(cy - 8, 'RESUME', 0xffffff, () => this.resume());
    option(cy + 10, 'RESTART', 0x7ff6ff, () => this.restart());
    option(cy + 28, 'MAIN MENU', 0xbbbbbb, () => this.mainMenu());

    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-ESC', () => this.resume());
    keyboard?.on('keydown-P', () => this.resume());
    keyboard?.on('keydown-R', () => this.restart());
    keyboard?.on('keydown-M', () => this.mainMenu());
  }

  private resume(): void {
    consumeTap(); // the tap that chose RESUME must not become a jump
    this.scene.stop();
    this.scene.resume(SceneKeys.Game);
  }

  private restart(): void {
    consumeTap();
    this.scene.stop(SceneKeys.Game);
    this.scene.stop();
    this.scene.start(SceneKeys.Game);
  }

  private mainMenu(): void {
    consumeTap();
    this.scene.stop(SceneKeys.Game);
    this.scene.stop();
    this.scene.start(SceneKeys.Title);
  }
}
