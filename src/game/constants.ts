import { usePortraitLayout } from './platform';

/**
 * Internal (unscaled) render resolution, chosen once at boot.
 *
 * Desktop plays the 16:9 landscape field (320x180). Touch devices play the
 * 9:16 portrait field (180x320): same pixel scale, the horizon at the top,
 * a longer run of water ahead and the surfer near the bottom. All game logic
 * and positioning works in these units; Phaser scales the canvas up to fit
 * the browser window while preserving the aspect ratio.
 */
export const IS_PORTRAIT = usePortraitLayout();
export const GAME_WIDTH = IS_PORTRAIT ? 180 : 320;
export const GAME_HEIGHT = IS_PORTRAIT ? 320 : 180;

/**
 * Scene keys. Always reference scenes through these constants rather than
 * raw strings so renames and typos are caught by the compiler.
 */
export const SceneKeys = {
  Boot: 'BootScene',
  Title: 'TitleScene',
  Game: 'GameScene',
  GameOver: 'GameOverScene',
  Pause: 'PauseScene',
} as const;

/** Keys for assets loaded from public/assets by BootScene. */
export const AssetKeys = {
  TitleConcept: 'title-concept',
  Player: 'player',
  Rival: 'rival',
  Rock: 'rock',
  Shark: 'shark',
  Ramp: 'ramp',
  Boat: 'boat',
  Spray: 'spray',
  Sky: 'sky',
  Water: 'water',
  Foam: 'foam',
  Font: 'pixel-font',
} as const;

/** Animation keys registered once in BootScene. */
export const Animations = {
  SharkSwim: 'shark-swim',
  Spray: 'spray',
} as const;

/** Frame indices in the player / rival sprite sheets (see tools/pixelart/sprites.mjs). */
export const SurferFrame = {
  Surf: 0,
  Lean: 1,
  Jump: 2,
  Punch: 3,
  Hurt: 4,
  /** Rival sheet only: */
  RiderOnly: 5,
  BoardOnly: 6,
} as const;

/**
 * Characters in the generated pixel font, in sheet order. Must match
 * FONT_CHARS in tools/pixelart/font.mjs. Text is upper-case only.
 */
export const FONT_CHARS = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-x:.!/\u2665\u2661<>';
