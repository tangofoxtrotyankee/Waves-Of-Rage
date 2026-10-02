import Phaser from 'phaser';

import { AssetKeys, SceneKeys } from '../game/constants';

/**
 * BootScene is the first scene to run.
 *
 * It loads shared assets and then hands over to the title screen. Add new
 * loader calls to preload() as assets arrive.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKeys.Boot);
  }

  preload(): void {
    this.load.image(AssetKeys.TitleConcept, 'assets/title/concept-320x180.png');
  }

  create(): void {
    this.scene.start(SceneKeys.Title);
  }
}
