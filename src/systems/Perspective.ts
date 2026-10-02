import Phaser from 'phaser';

import { GAME_HEIGHT } from '../game/constants';
import { HORIZON_Y } from './OceanScroller';

/** Scale applied to objects sitting right on the horizon. */
const FAR_SCALE = 0.6;
/** Scale applied to objects at the bottom of the screen. */
const NEAR_SCALE = 1;

/**
 * Fake depth: things near the horizon are drawn a little smaller than things
 * near the bottom of the screen. Purely a function of Y, no real 3D.
 */
export function perspectiveScale(y: number): number {
  const t = Phaser.Math.Clamp((y - HORIZON_Y) / (GAME_HEIGHT - HORIZON_Y), 0, 1);
  return Phaser.Math.Linear(FAR_SCALE, NEAR_SCALE, t);
}
