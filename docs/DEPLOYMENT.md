# Deployment

Waves of Rage builds to a fully static site: one HTML file, one JavaScript
bundle and the files under `public/`. It needs no server-side code, so any
static host works. Asset paths are relative (`base: './'` in
`vite.config.ts`), so the build also runs from a sub-folder.

## Build

```bash
npm ci
npm run build      # type-checks, then writes dist/
npm run preview    # optional: serve dist/ locally at http://localhost:4173
```

Deploy the contents of `dist/`.

## Railway

Railway can serve the built site with a tiny static server. Two options:

### Option A: static server via npm (simplest)

1. Add a start script that serves `dist/`. The `serve` package is a good
   fit and needs no config:

   ```bash
   npm install --save-dev serve
   ```

   In `package.json`:

   ```json
   "scripts": {
     "start": "serve -s dist -l ${PORT:-3000}"
   }
   ```

2. Create a new Railway project from the GitHub repository.
3. In the service settings set:
   - **Build command:** `npm ci && npm run build`
   - **Start command:** `npm start`
4. Railway injects `PORT`; the start script above binds to it.
5. Generate a public domain under **Settings → Networking**.

Every push to the connected branch redeploys.

### Option B: Dockerfile with nginx

Add a `Dockerfile` at the repository root:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Railway sets PORT; make nginx listen on it.
CMD ["/bin/sh", "-c", "sed -i \"s/listen       80;/listen ${PORT:-80};/\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
```

Railway detects the Dockerfile automatically. This gives proper caching
headers and gzip out of the box.

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
- `npm test` passes (see `docs/TESTING.md`).
- Open the preview build in a desktop browser: title loads, Space starts,
  controls respond, no console errors.
- `window.game` is not present in the production build (it is a dev-only
  debug handle; check the browser console).

## Not yet handled

Mobile layout and touch controls, orientation lock, analytics and
leaderboards are out of scope for now.
