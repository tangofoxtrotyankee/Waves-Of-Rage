/**
 * Production server: serves the built game from dist/ and a small JSON API
 * for the shared top-10 tables (one per difficulty).
 *
 *   npm run build && npm start
 *
 * Environment:
 *   PORT          port to listen on (Railway sets this)              default 8787
 *   DATABASE_URL  Postgres connection string; when set, scores live
 *                 there (a Railway Postgres linked to the service)
 *   DATA_DIR      otherwise, folder for scores.json (mount a volume)  default ./data
 *   PGSSL         disable | require, to override TLS auto-detection
 *   HOST          bind address                                         default 0.0.0.0
 *   RATE_LIMIT_PER_MIN  score submissions per client IP               default 30
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanMode, ScoreStore } from './scores.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

/** Posts per minute per client IP, to keep a script from spamming the table (RATE_LIMIT_PER_MIN overrides). */
const POST_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN ?? 30);
const posts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (posts.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= POST_LIMIT) return true;
  recent.push(now);
  posts.set(ip, recent);
  return false;
}

const DATABASE_URL = process.env.DATABASE_URL;
let store;
if (DATABASE_URL) {
  const { PgScoreStore } = await import('./scores-pg.mjs');
  store = new PgScoreStore(DATABASE_URL);
} else {
  store = new ScoreStore(DATA_DIR);
}
await store.load();
const STORE_KIND = DATABASE_URL ? 'postgres' : `file ${DATA_DIR}`;

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

function readBody(req, limit = 2048) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/scores' && req.method === 'GET') {
    const mode = cleanMode(url.searchParams.get('mode'));
    const scores = store.refresh ? await store.refresh(mode) : store.list(mode);
    return send(res, 200, { mode, scores });
  }
  if (url.pathname === '/api/scores' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '?';
    if (rateLimited(ip)) return send(res, 429, { error: 'too many submissions' });
    try {
      const body = JSON.parse(await readBody(req));
      const result = await store.add(body);
      return send(res, 200, result);
    } catch (err) {
      return send(res, 400, { error: err.message || 'bad request' });
    }
  }
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, store: DATABASE_URL ? 'postgres' : 'file', scores: store.list('normal').length });
  return send(res, 404, { error: 'not found' });
}

async function handleStatic(req, res, url) {
  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(DIST, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(DIST)) return send(res, 403, { error: 'forbidden' });
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
    const data = await readFile(filePath);
    const ext = extname(filePath);
    // Vite hashes everything under assets/, so those can be cached hard; index.html must not be.
    const cache = filePath.includes(`${join(DIST, 'assets')}`) && ext === '.js' ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch {
    send(res, 404, 'not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await handleStatic(req, res, url);
  } catch (err) {
    send(res, 500, { error: 'server error' });
    console.error(err);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Waves of Rage server on http://${HOST}:${PORT}  (dist: ${DIST}, scores: ${STORE_KIND})`);
});
