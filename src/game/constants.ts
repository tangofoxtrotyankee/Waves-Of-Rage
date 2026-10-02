/**
 * Internal (unscaled) render resolution.
 * All game logic and positioning works in these units; Phaser scales the
 * canvas up to fit the browser window while preserving this aspect ratio.
 */
export const GAME_WIDTH = 320;
export const GAME_HEIGHT = 180;

/**
 * Scene keys. Always reference scenes through these constants rather than
 * raw strings so renames and typos are caught by the compiler.
 */
export const SceneKeys = {
  Boot: 'BootScene',
  Title: 'TitleScene',
  Game: 'GameScene',
} as const;

/** Keys for assets loaded from public/assets by BootScene. */
export const AssetKeys = {
  TitleConcept: 'title-concept',
} as const;
