import { loadJSON, saveJSON } from './Storage';

export interface HighScore {
  name: string;
  score: number;
  distance: number;
  /** ISO date of the run. */
  date: string;
}

export const HIGH_SCORES = {
  /** How many entries the table keeps. */
  size: 10,
  /** Name length in the pixel font (upper-case letters, digits and spaces). */
  maxNameLength: 8,
  defaultName: 'SURFER',
} as const;

const KEY = 'highscores.v1';
const LAST_NAME_KEY = 'lastname.v1';

/** Top-N table persisted in local storage, highest score first. */
export class HighScores {
  private entries: HighScore[];

  constructor() {
    this.entries = HighScores.sanitise(loadJSON<HighScore[]>(KEY, []));
  }

  get list(): readonly HighScore[] {
    return this.entries;
  }

  get best(): HighScore | undefined {
    return this.entries[0];
  }

  /** Would this score make the table? */
  qualifies(score: number): boolean {
    if (score <= 0) return false;
    if (this.entries.length < HIGH_SCORES.size) return true;
    return score > this.entries[this.entries.length - 1].score;
  }

  /** Insert a run and persist. Returns the 0-based rank, or -1 if it did not qualify. */
  add(name: string, score: number, distance: number): number {
    if (!this.qualifies(score)) return -1;
    const entry: HighScore = { name: HighScores.cleanName(name), score: Math.floor(score), distance: Math.floor(distance), date: new Date().toISOString() };
    this.entries.push(entry);
    this.entries.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
    this.entries = this.entries.slice(0, HIGH_SCORES.size);
    saveJSON(KEY, this.entries);
    saveJSON(LAST_NAME_KEY, entry.name);
    return this.entries.indexOf(entry);
  }

  /** The name used last time, to prefill the prompt. */
  static lastName(): string {
    return loadJSON<string>(LAST_NAME_KEY, '');
  }

  /** Upper-case A-Z, 0-9 and spaces only (what the pixel font can draw), trimmed and capped. */
  static cleanName(raw: string): string {
    const cleaned = raw
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, '')
      .trim()
      .slice(0, HIGH_SCORES.maxNameLength);
    return cleaned || HIGH_SCORES.defaultName;
  }

  private static sanitise(raw: unknown): HighScore[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e): e is HighScore => !!e && typeof e === 'object' && typeof (e as HighScore).score === 'number')
      .map((e) => ({ name: HighScores.cleanName(String(e.name ?? '')), score: Math.floor(e.score), distance: Math.floor(Number(e.distance) || 0), date: String(e.date ?? '') }))
      .sort((a, b) => b.score - a.score)
      .slice(0, HIGH_SCORES.size);
  }
}
