import { loadJSON, saveJSON } from '../systems/Storage';

export type DifficultyMode = 'easy' | 'normal' | 'insanity';

export interface DifficultySpec {
  label: string;
  /** Multiplier on forward speed (start and cap). */
  speedScale: number;
  /** Multiplier on how fast speed ramps. */
  rampScale: number;
  /** Multiplier on the distance between hazard spawns (lower = denser). */
  spawnGapScale: number;
  sharkAfterSeconds: number;
  sharkChance: number;
  rampAfterSeconds: number;
  startHealth: number;
}

/** Normal is the tuning the game shipped with; the others scale it. */
export const DIFFICULTY_MODES: Record<DifficultyMode, DifficultySpec> = {
  easy: { label: 'EASY', speedScale: 0.8, rampScale: 0.6, spawnGapScale: 1.35, sharkAfterSeconds: 40, sharkChance: 0.12, rampAfterSeconds: 10, startHealth: 4 },
  normal: { label: 'NORMAL', speedScale: 1, rampScale: 1, spawnGapScale: 1, sharkAfterSeconds: 20, sharkChance: 0.2, rampAfterSeconds: 12, startHealth: 3 },
  insanity: { label: 'INSANITY', speedScale: 1.3, rampScale: 1.8, spawnGapScale: 0.65, sharkAfterSeconds: 5, sharkChance: 0.35, rampAfterSeconds: 8, startHealth: 3 },
};

export const DIFFICULTY_ORDER: DifficultyMode[] = ['easy', 'normal', 'insanity'];

const KEY = 'difficulty.v1';

export function getDifficulty(): DifficultyMode {
  const saved = loadJSON<string>(KEY, 'normal');
  return (DIFFICULTY_ORDER as string[]).includes(saved) ? (saved as DifficultyMode) : 'normal';
}

export function setDifficulty(mode: DifficultyMode): void {
  saveJSON(KEY, mode);
}

export function difficultySpec(mode: DifficultyMode = getDifficulty()): DifficultySpec {
  return DIFFICULTY_MODES[mode];
}
