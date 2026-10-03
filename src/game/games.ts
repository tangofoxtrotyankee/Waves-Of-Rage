import { SceneKeys } from './constants';

/**
 * The games selectable from the title screen.
 *
 * 'waves' is the original 2D game. 'boardmasters' is the 3D sequel, Waves of
 * Rage 2: Boardmasters, currently a title card while its rendering approach
 * is agreed (see docs/boardmasters/ARCHITECTURE.md).
 */
export type GameId = 'waves' | 'boardmasters';

export interface GameEntry {
  /** Menu label in the upper-case pixel font; keep it under 20 characters so it fits the portrait field. */
  label: string;
  /** Scene started when the game is chosen. */
  scene: string;
  /** Whether the difficulty selector and the best-score line apply to this game. */
  hasDifficulty: boolean;
}

export const GAMES: Record<GameId, GameEntry> = {
  waves: { label: 'WAVES OF RAGE', scene: SceneKeys.Game, hasDifficulty: true },
  boardmasters: { label: 'WOR 2: BOARDMASTERS', scene: SceneKeys.Boardmasters, hasDifficulty: false },
};

/** Menu order, top to bottom. */
export const GAME_ORDER: GameId[] = ['waves', 'boardmasters'];

/**
 * The game the title cursor is on. Kept for the page's lifetime (not
 * persisted) so coming back from a game lands on the entry that started it.
 */
let selected: GameId = 'waves';

export function getSelectedGame(): GameId {
  return selected;
}

export function setSelectedGame(id: GameId): void {
  selected = id;
}
