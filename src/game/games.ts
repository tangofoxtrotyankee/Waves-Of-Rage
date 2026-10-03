import { SceneKeys } from './constants';

/**
 * The games on the title screen's menu.
 *
 * 'waves' is the original 2D game, a scene in this Phaser page.
 * 'boardmasters' is the 3D sequel, Waves of Rage 2: Boardmasters, which is
 * its own page in this build (boardmasters.html, Three.js) so neither game
 * loads the other's engine.
 */
export type GameId = 'waves' | 'boardmasters';

export interface GameEntry {
  /** Menu label in the upper-case pixel font; keep it under 20 characters so it fits the portrait field. */
  label: string;
  /** Scene started when the game is chosen (same page)... */
  scene?: string;
  /** ...or the page navigated to instead. */
  url?: string;
  /** Whether the difficulty selector and the best-score line apply to this game. */
  hasDifficulty: boolean;
}

export const GAMES: Record<GameId, GameEntry> = {
  waves: { label: 'WAVES OF RAGE', scene: SceneKeys.Game, hasDifficulty: true },
  boardmasters: { label: 'WOR 2: BOARDMASTERS', url: './boardmasters.html', hasDifficulty: false },
};

/** Menu order, top to bottom. */
export const GAME_ORDER: GameId[] = ['waves', 'boardmasters'];

/**
 * The game the title cursor is on. Kept for the page's lifetime (not
 * persisted) so coming back from a game lands on the entry that started it.
 */
let selected: GameId = 'waves';
// Coming back from the sequel's page (a new document) carries the cursor in the URL.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('game') === 'boardmasters') selected = 'boardmasters';

export function getSelectedGame(): GameId {
  return selected;
}

export function setSelectedGame(id: GameId): void {
  selected = id;
}
