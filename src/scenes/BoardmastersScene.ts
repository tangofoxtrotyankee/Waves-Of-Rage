import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH, IS_PORTRAIT, SceneKeys } from '../game/constants';
import { consumeTap, touchState } from '../input/TouchControls';
import { pixelText } from '../ui/PixelText';

/** Ignore input this long so the press that opened the screen cannot close it. */
const INPUT_DELAY_MS = 500;

/**
 * Waves of Rage 2: Boardmasters.
 *
 * For now a title card built from the sequel's concept art. The sequel is a
 * 3D chase-camera surf racer/brawler whose rendering approach is being agreed
 * (docs/boardmasters/ARCHITECTURE.md); when the prototype lands it starts
 * from here. The card also reports whether WebGL 2 is available, which the
 * proposed renderer needs. Esc, Space, Enter, a click or a tap go back to the
 * main menu.
 */
export class BoardmastersScene extends Phaser.Scene {
  private acceptInput = false;

  constructor() {
    super(SceneKeys.Boardmasters);
  }

  create(): void {
    this.acceptInput = false;
    consumeTap();

    const webgl2 = hasWebGL2();
    const back = touchState.enabled ? 'TAP: MAIN MENU' : 'ESC: MAIN MENU';
    const lines: [string, number][] = [
      ['3D ARCADE SURF RACER', 0x7ff6ff],
      ['PROTOTYPE COMING SOON', 0xffffff],
      [webgl2 ? 'WEBGL2 OK' : 'WEBGL2 MISSING', webgl2 ? 0xffd166 : 0xff4d6d],
    ];

    let prompt: Phaser.GameObjects.BitmapText;
    if (IS_PORTRAIT) {
      // The whole poster, with its painted menu covered by the status panel.
      this.add.image(0, 0, AssetKeys.BmTitlePortrait).setOrigin(0);
      const panelY = Math.round(GAME_HEIGHT * 0.28);
      this.add.rectangle(0, panelY, GAME_WIDTH, 68, 0x1a0b2e, 0.94).setOrigin(0);
      lines.forEach(([text, color], i) => pixelText(this, GAME_WIDTH / 2, panelY + 17 + i * 17, text, color).setOrigin(0.5));
      this.add.rectangle(0, GAME_HEIGHT - 18, GAME_WIDTH, 18, 0x1a0b2e, 0.88).setOrigin(0);
      prompt = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT - 9, back, 0xbbbbbb).setOrigin(0.5);
    } else {
      // Logo and status on a dark panel, the hero crop filling the right-hand column.
      this.add.image(GAME_WIDTH / 2, 0, AssetKeys.Sky).setOrigin(0.5, 0);
      this.add.tileSprite(0, 40, GAME_WIDTH, GAME_HEIGHT - 40, AssetKeys.Water).setOrigin(0);
      this.add.image(GAME_WIDTH, 0, AssetKeys.BmHero).setOrigin(1, 0);
      const logo = this.add.image(0, 0, AssetKeys.BmLogo).setOrigin(0);
      this.add.rectangle(0, logo.height, logo.width, GAME_HEIGHT - logo.height, 0x1a0b2e, 0.88).setOrigin(0);
      lines.forEach(([text, color], i) => pixelText(this, 8, logo.height + 8 + i * 12, text, color));
      prompt = pixelText(this, 8, GAME_HEIGHT - 12, back, 0xbbbbbb);
    }
    this.tweens.add({ targets: prompt, alpha: 0.15, duration: 500, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

    this.time.delayedCall(INPUT_DELAY_MS, () => {
      this.acceptInput = true;
      const keyboard = this.input.keyboard;
      for (const key of ['keydown-ESC', 'keydown-SPACE', 'keydown-ENTER']) keyboard?.once(key, () => this.mainMenu());
      if (!touchState.enabled) this.input.once('pointerdown', () => this.mainMenu());
    });
  }

  override update(): void {
    if (!touchState.enabled) return;
    // Drain taps every frame so one made during the grace period does not fire later.
    const tapped = consumeTap();
    if (tapped && this.acceptInput) this.mainMenu();
  }

  private mainMenu(): void {
    this.scene.start(SceneKeys.Title);
  }
}

/** True when the browser can create a WebGL 2 context (what the proposed Three.js renderer needs). */
function hasWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}
