import Phaser from 'phaser';

import { GAME_WIDTH } from '../game/constants';

/** World pixels per displayed distance unit. */
const PIXELS_PER_UNIT = 8;

/** Simple arcade HUD: a label and a zero-padded distance counter. */
export class Hud {
  private readonly value: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#ffffff',
      stroke: '#1a0b2e',
      strokeThickness: 2,
    };

    scene.add.text(GAME_WIDTH - 4, 3, 'DISTANCE', { ...style, color: '#ffd166' }).setOrigin(1, 0).setDepth(1000);
    this.value = scene.add.text(GAME_WIDTH - 4, 12, '00000', style).setOrigin(1, 0).setDepth(1000);
  }

  /** `travelledPixels` is the total world distance covered so far. */
  update(travelledPixels: number): void {
    const units = Math.floor(travelledPixels / PIXELS_PER_UNIT);
    this.value.setText(String(units).padStart(5, '0'));
  }
}
