import Phaser from 'phaser';

import { AssetKeys } from '../game/constants';
import { Obstacle } from './Obstacle';

export const ROCK = {
  damage: 1,
  jumpable: true,
  /** Knocked rivals that slam into it wipe out. */
  knocksOutRivals: true,
} as const;

/** A rock sticking out of the water. Stationary, so it approaches at full speed. */
export class Rock extends Obstacle {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, { kind: 'rock', texture: AssetKeys.Rock, approachFactor: 1, ...ROCK });
  }
}
