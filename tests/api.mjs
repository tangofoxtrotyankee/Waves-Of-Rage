/**
 * Score API test: starts server/index.mjs on a spare port with a temporary
 * data directory and exercises the endpoints. Run with `npm test`.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.API_TEST_PORT ?? 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

const dataDir = await mkdtemp(join(tmpdir(), 'wor-scores-'));
const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, HOST: '127.0.0.1', RATE_LIMIT_PER_MIN: '1000' }, stdio: 'ignore' });

async function waitForServer(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
const post = (body) => fetch(`${BASE}/api/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

try {
  if (!(await waitForServer(10000))) throw new Error('server did not start');

  const empty = await (await fetch(`${BASE}/api/scores`)).json();
  check('GET /api/scores starts empty', Array.isArray(empty.scores) && empty.scores.length === 0);

  const first = await (await post({ name: 'kai', score: 9120, distance: 700 })).json();
  check('POST qualifies and returns rank 0', first.rank === 0 && first.scores[0].name === 'KAI', JSON.stringify(first));

  const second = await (await post({ name: 'mo-ana!!', score: 6400.7, distance: 510 })).json();
  check('names cleaned, scores floored, sorted', second.rank === 1 && second.scores[1].name === 'MOANA' && second.scores[1].score === 6400, JSON.stringify(second.scores.map((s) => s.name)));

  for (let i = 0; i < 9; i++) await post({ name: `P${i}`, score: 1000 + i, distance: 10 });
  const full = await (await fetch(`${BASE}/api/scores`)).json();
  check('table capped at 10', full.scores.length === 10, `len ${full.scores.length}`);

  const low = await (await post({ name: 'LOW', score: 5, distance: 1 })).json();
  check('score below the table does not qualify', low.rank === -1 && low.scores.length === 10);

  const bad = await post({ name: 'X', score: 'nope' });
  check('invalid score rejected with 400', bad.status === 400);

  const huge = await (await post({ name: 'HUGE', score: 99999999, distance: 1 })).json();
  check('score capped at 999999', huge.scores[0].score === 999999, `top ${huge.scores[0].score}`);

  // Rate limiting: a second server with a tiny limit refuses the 3rd post in a minute.
  const limited = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PORT + 1), DATA_DIR: dataDir + '-rl', HOST: '127.0.0.1', RATE_LIMIT_PER_MIN: '2' }, stdio: 'ignore' });
  try {
    if (!(await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 10000) { try { if ((await fetch(`http://127.0.0.1:${PORT + 1}/api/health`)).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 150)); } return false; })())) throw new Error('rate-limit server did not start');
    const rl = (body) => fetch(`http://127.0.0.1:${PORT + 1}/api/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await rl({ name: 'A', score: 1 }); await rl({ name: 'B', score: 2 });
    const third = await rl({ name: 'C', score: 3 });
    check('rate limit returns 429 after the configured number of posts', third.status === 429, `status ${third.status}`);
  } finally {
    limited.kill();
    await rm(dataDir + '-rl', { recursive: true, force: true });
  }

  const ins = await (await post({ name: 'MAD', score: 50, distance: 5, mode: 'insanity' })).json();
  const insList = await (await fetch(`${BASE}/api/scores?mode=insanity`)).json();
  const normalList = await (await fetch(`${BASE}/api/scores`)).json();
  check('modes keep separate tables', ins.rank === 0 && insList.scores.length === 1 && insList.mode === 'insanity' && normalList.scores.length === 10 && !normalList.scores.some((s) => s.name === 'MAD'));
  const bogus = await (await fetch(`${BASE}/api/scores?mode=bogus`)).json();
  check('unknown mode falls back to normal', bogus.mode === 'normal');

  const onDisk = JSON.parse(await readFile(join(dataDir, 'scores.json'), 'utf8'));
  check('persisted to scores.json in DATA_DIR (per-mode)', onDisk.normal.length === 10 && onDisk.normal[0].name === 'HUGE' && onDisk.insanity.length === 1);

  // Static serving (dist/ exists after npm run build)
  const html = await fetch(`${BASE}/`);
  check('serves index.html from dist/', html.ok && (await html.text()).includes('<canvas') === false && html.headers.get('content-type')?.includes('text/html'));
  const traversal = await fetch(`${BASE}/../package.json`);
  check('path traversal blocked', traversal.status === 404 || traversal.status === 403, `status ${traversal.status}`);
} catch (err) {
  console.error('API TEST CRASHED:', err);
  results.push(false);
} finally {
  server.kill();
  await rm(dataDir, { recursive: true, force: true });
}

// Optional: the same server against Postgres, when TEST_DATABASE_URL points at a scratch database.
if (process.env.TEST_DATABASE_URL) {
  const PG_PORT = PORT + 2;
  const PG_BASE = `http://127.0.0.1:${PG_PORT}`;
  const pgServer = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(PG_PORT), DATABASE_URL: process.env.TEST_DATABASE_URL, HOST: '127.0.0.1', RATE_LIMIT_PER_MIN: '1000' }, stdio: ['ignore', 'ignore', 'inherit'] });
  const pgPost = (body) => fetch(`${PG_BASE}/api/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const up = await (async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { try { if ((await fetch(`${PG_BASE}/api/health`)).ok) return true; } catch {} await new Promise((r) => setTimeout(r, 200)); } return false; })();
    if (!up) throw new Error('postgres-backed server did not start');
    const health = await (await fetch(`${PG_BASE}/api/health`)).json();
    check('pg: health reports the postgres store', health.store === 'postgres', JSON.stringify(health));
    const r1 = await (await pgPost({ name: 'pg one', score: 500, distance: 40, mode: 'normal' })).json();
    const r2 = await (await pgPost({ name: 'PG TWO', score: 900, distance: 70, mode: 'normal' })).json();
    check('pg: inserts rank correctly', r1.rank === 0 && r2.rank === 0 && r2.scores[1].name === 'PG ONE', JSON.stringify(r2.scores.map((s) => s.name)));
    const ins = await (await pgPost({ name: 'MAD', score: 10, mode: 'insanity' })).json();
    const normal = await (await fetch(`${PG_BASE}/api/scores?mode=normal`)).json();
    check('pg: modes are separate tables', ins.rank === 0 && normal.scores.length === 2, JSON.stringify(normal.scores.length));
    for (let i = 0; i < 12; i++) await pgPost({ name: `F${i}`, score: 1000 + i, mode: 'easy' });
    const easy = await (await fetch(`${PG_BASE}/api/scores?mode=easy`)).json();
    check('pg: table trimmed to 10', easy.scores.length === 10 && easy.scores[0].score === 1011, `len ${easy.scores.length}`);
    const bad = await pgPost({ name: 'X', score: 'nope' });
    check('pg: invalid score rejected', bad.status === 400);
  } catch (err) {
    console.error('PG TEST CRASHED:', err);
    results.push(false);
  } finally {
    pgServer.kill();
  }
} else {
  console.log('(postgres suite skipped: set TEST_DATABASE_URL to run it)');
}

const fails = results.filter((r) => !r).length;
console.log(`\n${results.length - fails}/${results.length} API checks passed`);
process.exit(fails ? 1 : 0);
