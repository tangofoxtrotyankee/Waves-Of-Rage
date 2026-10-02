# Deployment

Waves of Rage builds to a static site (`dist/`) plus a tiny Node server
(`server/index.mjs`, no dependencies) that serves it and hosts the shared,
cross-device top-10 table at `/api/scores`. The game works without the
server too (any static host), falling back to a per-device table marked
OFFLINE. Asset paths are relative (`base: './'` in `vite.config.ts`), so the
build also runs from a sub-folder.

## Build and run

```bash
npm ci
npm run build      # type-checks, then writes dist/
npm start          # serves dist/ + /api/scores on $PORT (default 8787)
```

Environment for the server:

| Variable       | Purpose                                                        | Default   |
| -------------- | -------------------------------------------------------------- | --------- |
| `PORT`         | Port to listen on (Railway sets it)                            | `8787`    |
| `DATABASE_URL` | Postgres connection string; when set, scores are stored there  | unset     |
| `DATA_DIR`     | Without a database: folder for `scores.json` (use a volume)    | `./data`  |
| `PGSSL`        | `disable` or `require` to override TLS auto-detection          | auto      |
| `HOST`         | Bind address                                                   | `0.0.0.0` |

## Railway (with the shared high-score table)

1. Create (or keep) the Railway service from the GitHub repository.
2. Service settings:
   - **Build command:** `npm ci && npm run build`
   - **Start command:** `npm start`
3. **Scores storage.** With a Railway Postgres linked to the service (its
   `DATABASE_URL` variable is shared with the app), nothing else is
   needed: the server creates a `scores` table on first start and keeps
   the top 10 per difficulty there. Railway's internal
   `postgres.railway.internal` host is used without TLS; a public proxy
   URL gets TLS automatically (`PGSSL=disable|require` overrides).
   Without a database, mount a volume at `/data` and set `DATA_DIR=/data`
   so `scores.json` survives redeploys.
4. Generate a public domain under **Settings → Networking**.
5. Check `https://<your-domain>/api/health` returns
   `{"ok":true,"store":"postgres",...}` (or `"file"`).

Inspect or fix scores in SQL: `SELECT * FROM scores ORDER BY mode, score DESC;`
With the file store, `scores.json` holds one array per difficulty; an older
file containing a bare array is read as the normal table.

Every push to the connected branch redeploys. The server is plain Node
(`>= 22.12`); no Dockerfile is needed, but one would be a ten-line
`node:22-alpine` image running `npm ci && npm run build` then `npm start`.

### Static-only hosting

`dist/` still works on any static host (GitHub Pages, itch.io, see below).
Without the API the game shows a per-device table marked OFFLINE.

## GitHub Pages

1. Build locally or in a GitHub Action.
2. Publish `dist/` to the `gh-pages` branch (for example with the
   `peaceiris/actions-gh-pages` action) or point Pages at a `docs/` folder
   that you copy `dist/` into.

Because asset paths are relative, the usual `https://user.github.io/repo/`
sub-path works without changing `base`.

## itch.io

1. `npm run build`
2. Zip the contents of `dist/` (the files, not the folder).
3. Upload as an HTML game, tick **This file will be played in the browser**.
4. Set the viewport to a 16:9 size (for example 1280 x 720) and enable
   fullscreen. The game scales to whatever size it is given.

## Checklist before publishing

- `npm run build` passes with no errors.
- `npm test` passes (see `docs/TESTING.md`), which covers the API too.
- `/api/health` responds on the deployed domain and `DATA_DIR` points at
  a volume.
- Open the preview build in a desktop browser: title loads, Space starts,
  controls respond, no console errors.
- `window.game` is not present in the production build (it is a dev-only
  debug handle; check the browser console).

## Mobile

Touch controls and the portrait field are supported out of the box. On
Android Chrome the first tap enters fullscreen and locks landscape; iOS
Safari ignores both requests (the page still works, with the browser bars
visible). For a home-screen app feel on iOS, users can "Add to Home Screen";
the page sets the relevant meta tags. Analytics and leaderboards remain out
of scope.
