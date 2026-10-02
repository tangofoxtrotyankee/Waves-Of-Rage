/**
 * Postgres-backed top-10 store (used when DATABASE_URL is set, e.g. a
 * Railway Postgres linked to the service). Same interface as ScoreStore.
 *
 * One table holds every run that made a top 10; reads always compute the
 * current top 10 per mode, so the table can be inspected or edited in SQL.
 */
import pg from 'pg';
import { cleanMode, cleanName, MAX_DISTANCE, MAX_SCORE, MODES, TABLE_SIZE } from './scores.mjs';

const { Pool } = pg;

function toInt(value, max) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
}

/** Railway's internal host and localhost speak plain TCP; public URLs need TLS. PGSSL=disable|require overrides. */
function sslFor(url) {
  const forced = process.env.PGSSL;
  if (forced === 'disable') return false;
  if (forced === 'require') return { rejectUnauthorized: false };
  return /railway\.internal|localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
}

export class PgScoreStore {
  constructor(databaseUrl) {
    this.pool = new Pool({ connectionString: databaseUrl, ssl: sslFor(databaseUrl), max: 4 });
    this.cache = Object.fromEntries(MODES.map((m) => [m, []]));
  }

  async load() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id         BIGSERIAL PRIMARY KEY,
        mode       TEXT NOT NULL,
        name       TEXT NOT NULL,
        score      INTEGER NOT NULL,
        distance   INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await this.pool.query('CREATE INDEX IF NOT EXISTS scores_mode_score_idx ON scores (mode, score DESC, created_at ASC)');
    for (const m of MODES) this.cache[m] = await this.fetch(m);
    return this.cache;
  }

  async fetch(mode) {
    const { rows } = await this.pool.query(
      'SELECT name, score, distance, created_at FROM scores WHERE mode = $1 ORDER BY score DESC, created_at ASC LIMIT $2',
      [mode, TABLE_SIZE],
    );
    return rows.map((r) => ({ name: r.name, score: r.score, distance: r.distance, date: new Date(r.created_at).toISOString() }));
  }

  /** Last known top 10 (refreshed on every read and write). */
  list(mode = 'normal') {
    return this.cache[cleanMode(mode)];
  }

  async refresh(mode) {
    this.cache[mode] = await this.fetch(mode);
    return this.cache[mode];
  }

  qualifies(score, mode = 'normal') {
    const entries = this.list(mode);
    if (score <= 0) return false;
    if (entries.length < TABLE_SIZE) return true;
    return score > entries[entries.length - 1].score;
  }

  async add(input) {
    const score = toInt(input?.score, MAX_SCORE);
    const distance = toInt(input?.distance, MAX_DISTANCE) ?? 0;
    const mode = cleanMode(input?.mode);
    if (score === null) throw new Error('invalid score');
    const name = cleanName(input?.name);

    await this.refresh(mode);
    if (!this.qualifies(score, mode)) return { rank: -1, mode, scores: this.cache[mode] };

    const { rows } = await this.pool.query(
      'INSERT INTO scores (mode, name, score, distance) VALUES ($1, $2, $3, $4) RETURNING id',
      [mode, name, score, distance],
    );
    // Keep the table tidy: anything outside the top 10 can go.
    await this.pool.query(
      `DELETE FROM scores WHERE mode = $1 AND id NOT IN (
         SELECT id FROM scores WHERE mode = $1 ORDER BY score DESC, created_at ASC LIMIT $2)`,
      [mode, TABLE_SIZE],
    );
    const list = await this.refresh(mode);
    const rank = list.findIndex((e) => e.name === name && e.score === score);
    void rows;
    return { rank, mode, scores: list };
  }
}
