import Phaser from 'phaser';

import { SceneKeys } from '../game/constants';

/**
 * BootScene is the first scene to run.
 *
 * Its job is to load shared assets (sprites, bitmap fonts, audio, etc.) and
 * then hand over to the main game. Nothing is loaded yet; later steps will
 * add loader calls to preload().
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  preload(): void {
    // Asset loading goes here, e.g.
    // this.load.image('surfer', 'assets/surfer.png');
  }

  create(): void {
    this.scene.start(SceneKeys.Game);
  }
}
