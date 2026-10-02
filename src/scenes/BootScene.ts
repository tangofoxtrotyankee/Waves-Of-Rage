import Phaser from 'phaser';

import { Animations, AssetKeys, FONT_CHARS, SceneKeys } from '../game/constants';

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

    // Generated pixel art (see tools/pixelart). Rebuild with `npm run art`.
    const sprites = 'assets/sprites';
    this.load.spritesheet(AssetKeys.Player, `${sprites}/player.png`, { frameWidth: 24, frameHeight: 32 });
    this.load.spritesheet(AssetKeys.Rival, `${sprites}/rival.png`, { frameWidth: 24, frameHeight: 32 });
    this.load.spritesheet(AssetKeys.Shark, `${sprites}/shark.png`, { frameWidth: 30, frameHeight: 18 });
    this.load.spritesheet(AssetKeys.Spray, `${sprites}/spray.png`, { frameWidth: 24, frameHeight: 8 });
    this.load.image(AssetKeys.Rock, `${sprites}/rock.png`);
    this.load.image(AssetKeys.Ramp, `${sprites}/ramp.png`);
    this.load.image(AssetKeys.Sky, `${sprites}/sky.png`);
    this.load.image(AssetKeys.Water, `${sprites}/water.png`);
    this.load.image(AssetKeys.Foam, `${sprites}/foam.png`);
    this.load.image(AssetKeys.Font, `${sprites}/font.png`);
  }

  create(): void {
    // Register the fixed-width pixel font as a bitmap font.
    const fontConfig: Phaser.Types.GameObjects.BitmapText.RetroFontConfig = {
      image: AssetKeys.Font,
      width: 8,
      height: 8,
      chars: FONT_CHARS,
      charsPerRow: 16,
      'offset.x': 0,
      'offset.y': 0,
      'spacing.x': 0,
      'spacing.y': 0,
      lineSpacing: 2,
    };
    this.cache.bitmapFont.add(AssetKeys.Font, Phaser.GameObjects.RetroFont.Parse(this, fontConfig));

    // Global animations shared by every scene.
    this.anims.create({ key: Animations.SharkSwim, frames: this.anims.generateFrameNumbers(AssetKeys.Shark, { start: 0, end: 1 }), frameRate: 4, repeat: -1 });
    this.anims.create({ key: Animations.Spray, frames: this.anims.generateFrameNumbers(AssetKeys.Spray, { start: 0, end: 2 }), frameRate: 12, repeat: -1 });

    this.scene.start(SceneKeys.Title);
  }
}
