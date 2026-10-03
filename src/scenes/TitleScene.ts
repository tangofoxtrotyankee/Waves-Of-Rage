import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';
import { DIFFICULTY_MODES, DIFFICULTY_ORDER, getDifficulty, setDifficulty, type DifficultyMode } from '../game/difficulty';
import { GAME_ORDER, GAMES, getSelectedGame, setSelectedGame, type GameId } from '../game/games';
import { consumeTap, requestImmersiveMode, touchState } from '../input/TouchControls';
import { ScoreService } from '../systems/ScoreService';
import { Hud } from '../ui/Hud';
import { pixelText } from '../ui/PixelText';

/**
 * Title screen. Uses the concept artwork as a temporary background (the logo
 * is part of the artwork). Under it: the game list (Waves of Rage or
 * Waves of Rage 2: Boardmasters; Up/Down or tapping a row moves the cursor),
 * the difficulty selector for the original game, and a pulsing prompt.
 * Space or Enter starts the selected game.
 */
/** Ignore start input this long after the title opens, so the tap/click that brought us here can't start a game. */
const START_GRACE_MS = 500;

/** Height of the strip under the artwork: two game rows, the difficulty row and the prompt. */
const UI_STRIP = 52;

/** Pixel-font glyph width; the game list is laid out in character cells. */
const GLYPH = 8;

export class TitleScene extends Phaser.Scene {
  /** The game the cursor is on (read by tests through window.game). */
  selectedGame: GameId = 'waves';
  private swallowNextTap = false;
  private acceptStartAt = 0;

  constructor() {
    super(SceneKeys.Title);
  }

  create(): void {
    this.swallowNextTap = false;
    this.acceptStartAt = this.time.now + START_GRACE_MS;
    consumeTap(); // drop any tap left over from the screen that sent us here
    // Sky and water behind the artwork so the portrait field has no black bars.
    this.add.image(GAME_WIDTH / 2, 0, AssetKeys.Sky).setOrigin(0.5, 0);
    this.add.tileSprite(0, 40, GAME_WIDTH, GAME_HEIGHT - 40, AssetKeys.Water).setOrigin(0);

    // The artwork sits above a strip reserved for the game list, the difficulty
    // selector and the start prompt, so none of them overlap the logo or tagline.
    const art = this.add.image(GAME_WIDTH / 2, (GAME_HEIGHT - UI_STRIP) / 2, AssetKeys.TitleConcept);
    const fit = Math.min(GAME_WIDTH / art.width, (GAME_HEIGHT - UI_STRIP) / art.height);
    art.setScale(fit);
    this.add.rectangle(0, GAME_HEIGHT - UI_STRIP, GAME_WIDTH, UI_STRIP, 0x1a0b2e, 0.6).setOrigin(0);

    // Game list: a cursor beside the selected row. Up/Down (W/S) move it; tapping a row selects it.
    const listWidth = (2 + Math.max(...GAME_ORDER.map((id) => GAMES[id].label.length))) * GLYPH;
    const listX = Math.floor((GAME_WIDTH - listWidth) / 2);
    const rowY = (i: number) => GAME_HEIGHT - UI_STRIP + 4 + i * 11;
    const cursor = pixelText(this, listX, rowY(0), '>', 0x7ff6ff);
    const rows = GAME_ORDER.map((id, i) => {
      const row = pixelText(this, listX + 2 * GLYPH, rowY(i), GAMES[id].label);
      row.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(-2 * GLYPH - 4, -2, listWidth + 8, 12), hitAreaCallback: Phaser.Geom.Rectangle.Contains });
      return row;
    });

    // Difficulty selector: < NORMAL >. Left/right keys or tapping the arrows change it.
    const selectorY = GAME_HEIGHT - UI_STRIP + 31;
    const modeText = pixelText(this, GAME_WIDTH / 2, selectorY, '', 0xffffff).setOrigin(0.5);
    const leftArrow = pixelText(this, GAME_WIDTH / 2 - 44, selectorY, '<', 0xffd166).setOrigin(0.5);
    const rightArrow = pixelText(this, GAME_WIDTH / 2 + 44, selectorY, '>', 0xffd166).setOrigin(0.5);
    for (const arrow of [leftArrow, rightArrow]) arrow.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(-10, -10, 28, 28), hitAreaCallback: Phaser.Geom.Rectangle.Contains });
    // Shown in place of the selector for a game that has no difficulty yet.
    const noMode = pixelText(this, GAME_WIDTH / 2, selectorY, 'PROTOTYPE', 0xbbbbbb).setOrigin(0.5);

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
      if (!GAMES[this.selectedGame].hasDifficulty) return;
      const i = DIFFICULTY_ORDER.indexOf(getDifficulty());
      applyMode(DIFFICULTY_ORDER[(i + direction + DIFFICULTY_ORDER.length) % DIFFICULTY_ORDER.length]);
    };
    applyMode(getDifficulty());

    const applyGame = (id: GameId) => {
      this.selectedGame = id;
      setSelectedGame(id);
      const index = GAME_ORDER.indexOf(id);
      cursor.setY(rowY(index));
      rows.forEach((row, i) => row.setTint(i === index ? 0xffd166 : 0xbbbbbb));
      const withDifficulty = GAMES[id].hasDifficulty;
      for (const part of [modeText, leftArrow, rightArrow, bestLine]) part.setVisible(withDifficulty);
      noMode.setVisible(!withDifficulty);
    };
    const stepGame = (direction: number) => {
      const i = GAME_ORDER.indexOf(this.selectedGame);
      applyGame(GAME_ORDER[(i + direction + GAME_ORDER.length) % GAME_ORDER.length]);
    };
    applyGame(getSelectedGame());

    // On touch the DOM tap surface fires independently of Phaser's hit test, so a tap
    // on an arrow or a row must also swallow the "tap to start" that follows on release.
    const tapHandler = (action: () => void) => (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.swallowNextTap = true;
      action();
    };
    leftArrow.on('pointerdown', tapHandler(() => step(-1)));
    rightArrow.on('pointerdown', tapHandler(() => step(1)));
    rows.forEach((row, i) => row.on('pointerdown', tapHandler(() => applyGame(GAME_ORDER[i]))));
    const keyboard = this.input.keyboard;
    keyboard?.on('keydown-LEFT', () => step(-1));
    keyboard?.on('keydown-RIGHT', () => step(1));
    keyboard?.on('keydown-A', () => step(-1));
    keyboard?.on('keydown-D', () => step(1));
    keyboard?.on('keydown-UP', () => stepGame(-1));
    keyboard?.on('keydown-DOWN', () => stepGame(1));
    keyboard?.on('keydown-W', () => stepGame(-1));
    keyboard?.on('keydown-S', () => stepGame(1));

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

    if (keyboard) {
      keyboard.once('keydown-SPACE', () => this.startGame());
      keyboard.once('keydown-ENTER', () => this.startGame());
    }

    // A click on the canvas also starts. On touch, a tap starts (polled in update) and
    // we try to go fullscreen in landscape.
    if (!touchState.enabled) {
      this.input.on('pointerdown', () => {
        if (this.time.now >= this.acceptStartAt) this.startGame();
      });
    }
  }

  override update(): void {
    if (touchState.enabled && consumeTap()) {
      if (this.swallowNextTap || this.time.now < this.acceptStartAt) {
        this.swallowNextTap = false;
        return;
      }
      void requestImmersiveMode();
      this.startGame();
    }
  }

  private startGame(): void {
    this.scene.start(GAMES[this.selectedGame].scene);
  }
}
