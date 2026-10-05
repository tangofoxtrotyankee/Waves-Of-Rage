import { getDifficulty } from '../game/difficulty';
import { HIGH_SCORES, HighScores, type HighScore, type ScoreMode } from './HighScores';

export type ScoreSource = 'online' | 'local';

export interface SubmitResult {
  rank: number;
  list: readonly HighScore[];
  source: ScoreSource;
}

/** How long to wait for the shared table before falling back to the device's own. */
const FETCH_TIMEOUT_MS = 2500;

/**
 * The shared, cross-device top 10 (served by server/index.mjs; one table per
 * mode: the original game's difficulties and the sequel's endless run) with
 * the device's local table as cache and offline fallback.
 *
 * - `load()` fetches the shared table; if the API is unreachable (static
 *   hosting, offline) it resolves with the local table and `source` is
 *   'local'.
 * - `submit()` always records the run locally too, so the device keeps its
 *   own best even when the shared post fails.
 */
export class ScoreService {
  readonly mode: ScoreMode;
  private readonly local: HighScores;
  private remote: HighScore[] | null = null;

  constructor(mode: ScoreMode = getDifficulty()) {
    this.mode = mode;
    this.local = new HighScores(mode);
  }

  get source(): ScoreSource {
    return this.remote ? 'online' : 'local';
  }

  /** Whatever is known right now, without waiting on the network. */
  get list(): readonly HighScore[] {
    return this.remote ?? this.local.list;
  }

  get best(): HighScore | undefined {
    return this.list[0];
  }

  async load(): Promise<readonly HighScore[]> {
    try {
      const res = await fetch(`/api/scores?mode=${this.mode}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { scores?: unknown };
      this.remote = HighScores.sanitise(data.scores);
    } catch {
      this.remote = null;
    }
    return this.list;
  }

  qualifies(score: number): boolean {
    return HighScores.qualifiesIn(this.list, score);
  }

  async submit(name: string, score: number, distance: number): Promise<SubmitResult> {
    this.local.add(name, score, distance);

    if (this.remote) {
      try {
        const res = await fetch('/api/scores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ name: HighScores.cleanName(name), score: Math.floor(score), distance: Math.floor(distance), mode: this.mode }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { rank?: number; scores?: unknown };
        this.remote = HighScores.sanitise(data.scores);
        return { rank: typeof data.rank === 'number' ? data.rank : -1, list: this.remote, source: 'online' };
      } catch {
        this.remote = null;
      }
    }

    const rank = this.local.list.findIndex((e) => e.score === Math.floor(score) && e.name === HighScores.cleanName(name));
    return { rank, list: this.local.list, source: 'local' };
  }
}

export { HIGH_SCORES };
