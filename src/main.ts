import Phaser from 'phaser';

import { gameConfig } from './game/config';

/**
 * Application entry point.
 *
 * Creates the single Phaser.Game instance. Everything else (scenes, scaling,
 * rendering options) is driven by the configuration in ./game/config.ts.
 */
new Phaser.Game(gameConfig);
