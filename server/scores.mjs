/**
 * Top-10 score store persisted to a JSON file (one file, atomic writes).
 *
 * Point DATA_DIR at a persistent disk (a Railway volume, for example) so the
 * table survives redeploys. Writes are serialised through a promise chain.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const TABLE_SIZE = 10;
export const MODES = ['easy', 'normal', 'insanity'];

export function cleanMode(raw) {
  return MODES.includes(raw) ? raw : 'normal';
}
export const MAX_NAME = 8;
export const MAX_SCORE = 999_999;
export const MAX_DISTANCE = 99_999;

/** Upper-case A-Z, 0-9 and spaces only, trimmed and capped; never empty. */
export function cleanName(raw) {
  const cleaned = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
    .slice(0, MAX_NAME);
  return cleaned || 'SURFER';
}

function toInt(value, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
}

export class ScoreStore {
  constructor(dataDir) {
    this.file = join(dataDir, 'scores.json');
    this.dataDir = dataDir;
    /** One table per difficulty mode. */
    this.tables = Object.fromEntries(MODES.map((m) => [m, []]));
    this.queue = Promise.resolve();
  }

  async load() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'));
      // v1 files were a bare array (normal mode only); v2 is { mode: [...] }.
      if (Array.isArray(raw)) this.tables.normal = ScoreStore.sanitise(raw);
      else for (const m of MODES) this.tables[m] = ScoreStore.sanitise(raw?.[m]);
    } catch {
      /* fresh store */
    }
    return this.tables;
  }

  list(mode = 'normal') {
    return this.tables[cleanMode(mode)];
  }

  qualifies(score, mode = 'normal') {
    const entries = this.list(mode);
    if (score <= 0) return false;
    if (entries.length < TABLE_SIZE) return true;
    return score > entries[entries.length - 1].score;
  }

  /** Validate and insert a run. Resolves { rank, mode, scores }; rank is -1 when it did not qualify. */
  add(input) {
    const score = toInt(input?.score, MAX_SCORE);
    const distance = toInt(input?.distance, MAX_DISTANCE) ?? 0;
    const mode = cleanMode(input?.mode);
    if (score === null) throw new Error('invalid score');
    const entry = { name: cleanName(input?.name), score, distance, date: new Date().toISOString() };

    const run = async () => {
      if (!this.qualifies(score, mode)) return { rank: -1, mode, scores: this.tables[mode] };
      const next = [...this.tables[mode], entry].sort((a, b) => b.score - a.score || a.date.localeCompare(b.date)).slice(0, TABLE_SIZE);
      this.tables[mode] = next;
      await this.persist();
      return { rank: next.indexOf(entry), mode, scores: next };
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async persist() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.tables, null, 2));
    await rename(tmp, this.file);
  }

  static sanitise(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((e) => e && typeof e === 'object' && Number.isFinite(Number(e.score)))
      .map((e) => ({ name: cleanName(e.name), score: toInt(e.score, MAX_SCORE) ?? 0, distance: toInt(e.distance, MAX_DISTANCE) ?? 0, date: String(e.date ?? '') }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TABLE_SIZE);
  }
}
