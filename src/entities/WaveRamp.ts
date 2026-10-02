import Phaser from 'phaser';

import { AssetKeys } from '../game/constants';
import { Obstacle } from './Obstacle';

/**
 * A curling section of wave that launches whoever rides over it.
 * Harmless: it never damages anyone and jumps pass straight over it.
 */
export class WaveRamp extends Obstacle {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      kind: 'ramp',
      texture: AssetKeys.Ramp,
      approachFactor: 1,
      damage: 0,
      jumpable: true,
      knocksOutRivals: false,
    });
  }

  override get isDangerous(): boolean {
    return false;
  }

}
