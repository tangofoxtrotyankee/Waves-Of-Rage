import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';
import { consumeTap, requestImmersiveMode, touchState } from '../input/TouchControls';
import { DIFFICULTY_MODES, DIFFICULTY_ORDER, getDifficulty, setDifficulty, type DifficultyMode } from '../game/difficulty';
import { ScoreService } from '../systems/ScoreService';
import { Hud } from '../ui/Hud';
import { pixelText } from '../ui/PixelText';

/**
 * Title screen. Uses the concept artwork as a temporary background (the logo
 * is part of the artwork) with a pulsing prompt. Space or Enter starts play.
 */
export class TitleScene extends Phaser.Scene {
  private swallowNextTap = false;

  constructor() {
    super(SceneKeys.Title);
  }

  create(): void {
    this.swallowNextTap = false;
    // Sky and water behind the artwork so the portrait field has no black bars.
    this.add.image(GAME_WIDTH / 2, 0, AssetKeys.Sky).setOrigin(0.5, 0);
    this.add.tileSprite(0, 40, GAME_WIDTH, GAME_HEIGHT - 40, AssetKeys.Water).setOrigin(0);

    // The artwork sits above a strip reserved for the difficulty selector and
    // the start prompt, so neither overlaps the logo or tagline.
    const UI_STRIP = 30;
    const art = this.add.image(GAME_WIDTH / 2, (GAME_HEIGHT - UI_STRIP) / 2, AssetKeys.TitleConcept);
    const fit = Math.min(GAME_WIDTH / art.width, (GAME_HEIGHT - UI_STRIP) / art.height);
    art.setScale(fit);
    this.add.rectangle(0, GAME_HEIGHT - UI_STRIP, GAME_WIDTH, UI_STRIP, 0x1a0b2e, 0.6).setOrigin(0);

    // Difficulty selector: < NORMAL >. Left/right keys or tapping the arrows change it.
    const selectorY = GAME_HEIGHT - 20;
    const modeText = pixelText(this, GAME_WIDTH / 2, selectorY, '', 0xffffff).setOrigin(0.5);
    const leftArrow = pixelText(this, GAME_WIDTH / 2 - 44, selectorY, '<', 0xffd166).setOrigin(0.5);
    const rightArrow = pixelText(this, GAME_WIDTH / 2 + 44, selectorY, '>', 0xffd166).setOrigin(0.5);
    for (const arrow of [leftArrow, rightArrow]) arrow.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(-10, -10, 28, 28), hitAreaCallback: Phaser.Geom.Rectangle.Contains });

    // Best score for the selected mode: the device's at once, then the shared table's.
    const bestLine = pixelText(this, GAME_WIDTH / 2, 4, '', 0xffd166).setOrigin(0.5, 0);
    let scores = new ScoreService(getDifficulty());
    const showBest = (service: ScoreService) => {
      if (service !== scores) return; // a newer mode was selected meanwhile
      const best = service.best;
      bestLine.setText(best ? `BEST ${Hud.pad(best.score, 6)} ${best.name}` : '');
    };
    const applyMode = (mode: DifficultyMode) => {
      setDifficulty(mode);
      modeText.setText(DIFFICULTY_MODES[mode].label).setTint(mode === 'insanity' ? 0xff4d6d : mode === 'easy' ? 0x7ff6ff : 0xffffff);
      scores = new ScoreService(mode);
      showBest(scores);
      const service = scores;
      void service.load().then(() => this.scene.isActive(SceneKeys.Title) && showBest(service));
    };
    const step = (direction: number) => {
      const i = DIFFICULTY_ORDER.indexOf(getDifficulty());
      applyMode(DIFFICULTY_ORDER[(i + direction + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length]);
    };
    applyMode(getDifficulty());
    // On touch the DOM tap surface fires independently of Phaser's hit test, so an
    // arrow tap must also swallow the "tap to start" that follows on release.
    const arrowTap = (direction: number) => (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.swallowNextTap = true;
      step(direction);
    };
    leftArrow.on('pointerdown', arrowTap(-1));
    rightArrow.on('pointerdown', arrowTap(1));
    this.input.keyboard?.on('keydown-LEFT', () => step(-1));
    this.input.keyboard?.on('keydown-RIGHT', () => step(1));
    this.input.keyboard?.on('keydown-A', () => step(-1));
    this.input.keyboard?.on('keydown-D', () => step(1));

    const promptText = touchState.enabled ? 'TAP TO START' : 'PRESS SPACE';
    const prompt = pixelText(this, GAME_WIDTH / 2, GAME_HEIGHT - 7, promptText, 0x7ff6ff).setOrigin(0.5);

    this.tweens.add({
      targets: prompt,
      alpha: 0.15,
      duration: 500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.once('keydown-SPACE', () => this.startGame());
      keyboard.once('keydown-ENTER', () => this.startGame());
    }

    // A click on the canvas also starts. On touch, a tap starts (polled in update) and
    // we try to go fullscreen in landscape.
    if (!touchState.enabled) this.input.once('pointerdown', () => this.startGame());
  }

  override update(): void {
    if (touchState.enabled && consumeTap()) {
      if (this.swallowNextTap) {
        this.swallowNextTap = false;
        return;
      }
      void requestImmersiveMode();
      this.startGame();
    }
  }

  private startGame(): void {
    this.scene.start(SceneKeys.Game);
  }
}
