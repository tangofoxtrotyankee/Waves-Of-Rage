import Phaser from 'phaser';

import { AssetKeys, GAME_HEIGHT, GAME_WIDTH, SceneKeys } from '../game/constants';
import { DIFFICULTY_MODES, DIFFICULTY_ORDER, getDifficulty, setDifficulty, type DifficultyMode } from '../game/difficulty';
import { GAME_ORDER, GAMES, getSelectedGame, setSelectedGame, type GameId } from '../game/games';
import { platformOverrideQuery } from '../game/platform';
import { consumeTap, requestImmersiveMode, touchState } from '../input/TouchControls';
import { ScoreService } from '../systems/ScoreService';
import { Hud } from '../ui/Hud';
import { pixelText } from '../ui/PixelText';

/**
 * Title screen. Uses the concept artwork as a temporary background (the logo
 * is part of the artwork). Under it, a menu: one button per game (Waves of
 * Rage, with its difficulty selector beneath it, and Waves of Rage 2:
 * Boardmasters). Up/Down (W/S) move the cursor, Space or Enter start the
 * selected game, and clicking or tapping a button starts that game directly.
 *
 * Input is ignored for a moment after the screen opens, and taps from the
 * drag/tap touch surface are drained every frame, so the press that brought
 * us here (MAIN MENU on the pause popover, for example) can never start a
 * run. The grace is a scene timer, not `time.now`: a restarted scene's clock
 * reads the time it was stopped until its first update.
 */
const START_GRACE_MS = 500;

/** Height of the strip under the artwork: two buttons, the difficulty row and the prompt. */
const UI_STRIP = 56;

/** Pixel-font glyph width; the menu is laid out in character cells. */
const GLYPH = 8;
const BUTTON_HEIGHT = 12;

export class TitleScene extends Phaser.Scene {
  /** The game the cursor is on (read by tests through window.game). */
  selectedGame: GameId = 'waves';
  /** Button centres in game pixels, in GAME_ORDER (read by tests). */
  buttonCentres: { x: number; y: number }[] = [];
  private acceptInput = false;
  private pendingGame: GameId | null = null;

  constructor() {
    super(SceneKeys.Title);
  }

  create(): void {
    this.acceptInput = false;
    this.pendingGame = null;
    consumeTap(); // drop any tap left over from the screen that sent us here
    this.time.delayedCall(START_GRACE_MS, () => (this.acceptInput = true));

    // Sky and water behind the artwork so the portrait field has no black bars.
    this.add.image(GAME_WIDTH / 2, 0, AssetKeys.Sky).setOrigin(0.5, 0);
    this.add.tileSprite(0, 40, GAME_WIDTH, GAME_HEIGHT - 40, AssetKeys.Water).setOrigin(0);

    // The artwork sits above a strip reserved for the menu, so nothing overlaps the logo or tagline.
    const art = this.add.image(GAME_WIDTH / 2, (GAME_HEIGHT - UI_STRIP) / 2, AssetKeys.TitleConcept);
    const fit = Math.min(GAME_WIDTH / art.width, (GAME_HEIGHT - UI_STRIP) / art.height);
    art.setScale(fit);
    const stripTop = GAME_HEIGHT - UI_STRIP;
    this.add.rectangle(0, stripTop, GAME_WIDTH, UI_STRIP, 0x1a0b2e, 0.6).setOrigin(0);

    // Menu buttons: WAVES OF RAGE, then its difficulty row, then WOR 2: BOARDMASTERS.
    const buttonWidth = (2 + Math.max(...GAME_ORDER.map((id) => GAMES[id].label.length))) * GLYPH + 8;
    const cx = GAME_WIDTH / 2;
    const left = Math.round(cx - buttonWidth / 2);
    const buttonY = [stripTop + 9, stripTop + 36];
    this.buttonCentres = buttonY.map((y) => ({ x: cx, y }));
    const buttons = GAME_ORDER.map((id, i) => {
      const y = buttonY[i];
      const box = this.add.rectangle(cx, y, buttonWidth, BUTTON_HEIGHT, 0x1a0b2e, 0.9).setStrokeStyle(1, 0x7ff6ff, 0.5);
      const cursor = pixelText(this, left + 5, y, '>', 0x1a0b2e).setOrigin(0, 0.5);
      const label = pixelText(this, left + 5 + 2 * GLYPH, y, GAMES[id].label).setOrigin(0, 0.5);
      box.setInteractive({ useHandCursor: true });
      // Pressing a button moves the cursor to it; releasing on it starts the game.
      box.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        if (this.acceptInput) applyGame(id);
      });
      box.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        if (this.acceptInput) this.pendingGame = id;
      });
      return { box, cursor, label };
    });

    // Difficulty selector under WAVES OF RAGE: < NORMAL >. Left/Right keys or tapping the arrows change it.
    const selectorY = stripTop + 23;
    const modeText = pixelText(this, cx, selectorY, '', 0xffffff).setOrigin(0.5);
    const leftArrow = pixelText(this, cx - 44, selectorY, '<', 0xffd166).setOrigin(0.5);
    const rightArrow = pixelText(this, cx + 44, selectorY, '>', 0xffd166).setOrigin(0.5);
    for (const arrow of [leftArrow, rightArrow]) arrow.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(-10, -8, 28, 24), hitAreaCallback: Phaser.Geom.Rectangle.Contains });

    // Best score for the selected mode: the device's at once, then the shared table's.
    const bestLine = pixelText(this, cx, 4, '', 0xffd166).setOrigin(0.5, 0);
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
      applyGame('waves'); // the setting belongs to Waves of Rage
    };
    applyMode(getDifficulty());

    const applyGame = (id: GameId) => {
      this.selectedGame = id;
      setSelectedGame(id);
      buttons.forEach(({ box, cursor, label }, i) => {
        const on = GAME_ORDER[i] === id;
        box.setFillStyle(on ? 0xffd166 : 0x1a0b2e, on ? 1 : 0.9);
        cursor.setVisible(on);
        label.setTint(on ? 0x1a0b2e : 0xffffff);
      });
    };
    const stepGame = (direction: number) => {
      const i = GAME_ORDER.indexOf(this.selectedGame);
      applyGame(GAME_ORDER[(i + direction + GAME_ORDER.length) % GAME_ORDER.length]);
    };
    applyGame(getSelectedGame());

    const arrowTap = (direction: number) => (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      if (this.acceptInput) step(direction);
    };
    leftArrow.on('pointerdown', arrowTap(-1));
    rightArrow.on('pointerdown', arrowTap(1));
    const keyboard = this.input.keyboard;
    const onKey = (key: string, action: () => void) => keyboard?.on(`keydown-${key}`, () => this.acceptInput && action());
    onKey('LEFT', () => step(-1));
    onKey('RIGHT', () => step(1));
    onKey('A', () => step(-1));
    onKey('D', () => step(1));
    onKey('UP', () => stepGame(-1));
    onKey('DOWN', () => stepGame(1));
    onKey('W', () => stepGame(-1));
    onKey('S', () => stepGame(1));
    onKey('SPACE', () => (this.pendingGame = this.selectedGame));
    onKey('ENTER', () => (this.pendingGame = this.selectedGame));

    const promptText = touchState.enabled ? 'TAP A GAME TO PLAY' : 'PRESS SPACE';
    const prompt = pixelText(this, cx, GAME_HEIGHT - 7, promptText, 0x7ff6ff).setOrigin(0.5);
    this.tweens.add({ targets: prompt, alpha: 0.15, duration: 500, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
  }

  override update(): void {
    // Taps never start anything here; drain them so the next scene does not inherit one.
    if (touchState.enabled) consumeTap();
    if (this.pendingGame) {
      const id = this.pendingGame;
      this.pendingGame = null;
      this.launch(id);
    }
  }

  private launch(id: GameId): void {
    setSelectedGame(id);
    const entry = GAMES[id];
    if (entry.url) {
      const overrides = platformOverrideQuery(); // keep ?touch=1 and the orientation overrides across the pages
      window.location.href = overrides ? `${entry.url}?${overrides}` : entry.url;
      return;
    }
    if (touchState.enabled) void requestImmersiveMode();
    if (entry.scene) this.scene.start(entry.scene);
  }
}
