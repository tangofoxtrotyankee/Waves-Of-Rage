import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';
import { consumeTap, touchState } from '../input/TouchControls';
import { HighScores } from '../systems/HighScores';
import { Hud } from '../ui/Hud';
import { promptForName } from '../ui/NameEntry';
import { pixelText } from '../ui/PixelText';

export interface GameOverData {
  distanceUnits: number;
  score: number;
}

/** Ignore key presses for this long so a jump mashed at the moment of death doesn't restart instantly. */
const INPUT_DELAY_MS = 600;

/** Table geometry: "NN NAME.... 000000" is 17 glyphs of 8 px. */
const TABLE_CHARS = 17;

/**
 * Wipeout screen: the run's results, the persistent top-10 table (with a
 * name prompt when the run qualifies), and restart / title prompts.
 *
 * Layout is split in landscape (results left, table right) and stacked in
 * portrait; every y is a fraction of the field height.
 */
export class GameOverScene extends Phaser.Scene {
  private acceptTaps = false;
  private titleChosen = false;
  private tableTexts: Phaser.GameObjects.BitmapText[] = [];

  constructor() {
    super(SceneKeys.GameOver);
  }

  create(data: GameOverData): void {
    this.acceptTaps = false;
    this.titleChosen = false;
    this.tableTexts = [];

    const landscape = GAME_WIDTH > GAME_HEIGHT;
    const cx = landscape ? Math.round(GAME_WIDTH * 0.26) : GAME_WIDTH / 2;
    const row = (fraction: number) => Math.round(GAME_HEIGHT * fraction);

    this.add.image(GAME_WIDTH / 2, 0, AssetKeys.Sky).setOrigin(0.5, 0);
    this.add.tileSprite(0, 40, GAME_WIDTH, GAME_HEIGHT - 40, AssetKeys.Water).setOrigin(0);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x1a0b2e, 0.75).setOrigin(0);

    pixelText(this, cx, row(landscape ? 0.2 : 0.08), 'WIPEOUT', 0xff4d6d, 2).setOrigin(0.5);
    pixelText(this, cx, row(landscape ? 0.36 : 0.17), `DIST ${Hud.pad(data.distanceUnits ?? 0, 5)}`, 0x7ff6ff).setOrigin(0.5);
    pixelText(this, cx, row(landscape ? 0.44 : 0.22), `SCORE ${Hud.pad(data.score ?? 0, 6)}`, 0xffd166).setOrigin(0.5);

    const again = touchState.enabled ? 'TAP TO SURF AGAIN' : 'SPACE TO SURF AGAIN';
    const prompt = pixelText(this, cx, row(landscape ? 0.72 : 0.9), again, 0xffffff).setOrigin(0.5);
    const title = pixelText(this, cx, row(landscape ? 0.82 : 0.95), touchState.enabled ? 'TITLE' : 'ESC FOR TITLE', 0xbbbbbb).setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.15, duration: 500, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });

    const scores = new HighScores();
    const score = Math.floor(data.score ?? 0);
    this.renderTable(scores, -1, landscape);

    const enableInput = () => {
      const keyboard = this.input.keyboard;
      if (keyboard) keyboard.enabled = true;
      this.time.delayedCall(INPUT_DELAY_MS, () => {
        keyboard?.once('keydown-SPACE', () => this.scene.start(SceneKeys.Game));
        keyboard?.once('keydown-ESC', () => this.scene.start(SceneKeys.Title));

        // Tap the TITLE line for the title screen, anywhere else to surf again.
        title.setInteractive({ useHandCursor: true }).once('pointerdown', (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          void pointer;
          this.titleChosen = true;
          this.scene.start(SceneKeys.Title);
        });
        if (!touchState.enabled) this.input.once('pointerdown', () => this.scene.start(SceneKeys.Game));
        consumeTap(); // discard any tap made while the name prompt was open
        this.acceptTaps = true;
      });
    };

    if (scores.qualifies(score)) {
      // Keyboard off while typing so Space/Esc in the form never restart the game.
      if (this.input.keyboard) this.input.keyboard.enabled = false;
      void promptForName().then((name) => {
        if (!this.scene.isActive(SceneKeys.GameOver)) return;
        const rank = scores.add(name, score, data.distanceUnits ?? 0);
        this.renderTable(scores, rank, landscape);
        enableInput();
      });
    } else {
      enableInput();
    }
  }

  override update(): void {
    if (this.acceptTaps && !this.titleChosen && touchState.enabled && consumeTap()) this.scene.start(SceneKeys.Game);
  }

  /** Draw (or redraw) the TOP 10 table, highlighting `highlightRank` if >= 0. */
  private renderTable(scores: HighScores, highlightRank: number, landscape: boolean): void {
    for (const t of this.tableTexts) t.destroy();
    this.tableTexts = [];

    const width = TABLE_CHARS * 8;
    const left = landscape ? Math.round(GAME_WIDTH * 0.52) : Math.round((GAME_WIDTH - width) / 2);
    const top = landscape ? Math.round(GAME_HEIGHT * 0.08) : Math.round(GAME_HEIGHT * 0.3);
    const lineHeight = landscape ? 12 : 14;

    this.tableTexts.push(pixelText(this, left + width / 2, top, 'TOP 10', 0xffd166).setOrigin(0.5, 0));
    for (let i = 0; i < 10; i++) {
      const entry = scores.list[i];
      const rank = String(i + 1).padStart(2, ' ');
      const line = entry ? `${rank} ${entry.name.padEnd(8, ' ')}${Hud.pad(entry.score, 6)}` : `${rank} ${'-'.repeat(8)}------`;
      const color = i === highlightRank ? 0x7ff6ff : entry ? 0xffffff : 0x6b6b8a;
      this.tableTexts.push(pixelText(this, left, top + 12 + i * lineHeight, line, color));
    }
  }
}
