import Phaser from 'phaser';

import { gameConfig } from './game/config';
import { installTouchControls, shouldUseTouch } from './input/TouchControls';

/**
 * Application entry point.
 *
 * Creates the single Phaser.Game instance. Everything else (scenes, scaling,
 * rendering options) is driven by the configuration in ./game/config.ts.
 */
const game = new Phaser.Game(gameConfig);

// Phones and tablets get on-screen buttons; add ?touch=1 to the URL to test on desktop.
if (shouldUseTouch()) installTouchControls();

// In development, expose the game for console poking and automated tests.
// Stripped from production builds by Vite.
if (import.meta.env.DEV) {
  (window as Window & { game?: Phaser.Game }).game = game;
}
