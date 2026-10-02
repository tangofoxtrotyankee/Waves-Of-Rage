/** Procedurally painted environment textures: sky strip, water tile, foam tile. */
import { Canvas, rng } from './png.mjs';
import { C } from './palette.mjs';

export const SKY_W = 320;
export const SKY_H = 40;
export const TILE = 64;

function lerp(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

export function buildSky() {
  const c = new Canvas(SKY_W, SKY_H);
  // Banded gradient: 5 steps from deep orange at the top to pale yellow at the horizon.
  const steps = [C.skyTop, lerp(C.skyTop, C.skyMid, 0.5), C.skyMid, lerp(C.skyMid, C.skyLow, 0.5), C.skyLow];
  for (let y = 0; y < SKY_H; y++) {
    const band = Math.min(steps.length - 1, Math.floor((y / SKY_H) * steps.length));
    c.fillRect(0, y, SKY_W, 1, steps[band]);
  }
  // Sun: a half-disc on the horizon with horizontal "scanline" gaps, Mega Drive style.
  const cx = 160, cy = 36, r = 16;
  for (let y = cy - r; y < SKY_H; y++) {
    const dy = y - cy;
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
    if (half <= 0) continue;
    const gapRow = y > cy - 6 && (y - cy) % 3 === 0;
    if (gapRow) continue;
    c.fillRect(cx - half, y, half * 2, 1, y < cy - 8 ? C.sunCore : C.sun);
  }
  // Sun glint on the water line.
  c.fillRect(150, SKY_H - 1, 20, 1, C.sunCore);

  // Distant islands as layered silhouettes, left and right.
  const island = (x0, w, h, light) => {
    for (let i = 0; i < w; i++) {
      const t = i / w;
      // Smooth hump with a gentle second bump, stepped to whole pixels.
      const peak = Math.round(h * (0.85 * Math.sin(Math.PI * t) + 0.15 * Math.sin(Math.PI * t * 3)));
      c.fillRect(x0 + i, SKY_H - 1 - peak, 1, peak + 1, light ? C.islandLight : C.island);
    }
  };
  island(0, 80, 15, false);
  island(14, 36, 9, true);
  island(236, 84, 13, false);
  island(272, 44, 17, true);
  // Palm trees: a 2px trunk and a 7-wide crown of fronds.
  const palm = (x, base, h) => {
    for (let i = 0; i < h; i++) c.fillRect(x + (i < h / 2 ? 0 : 1), base - i, 2, 1, C.island);
    const top = base - h;
    const crown = ['..kkk..', '.kkkkk.', 'kk.k.kk', 'k.....k'];
    crown.forEach((row, dy) => [...row].forEach((ch, dx) => ch === 'k' && c.set(x - 2 + dx, top - 3 + dy, C.island)));
  };
  palm(10, SKY_H - 6, 7);
  palm(40, SKY_H - 8, 9);
  palm(58, SKY_H - 4, 6);
  palm(262, SKY_H - 6, 8);
  palm(296, SKY_H - 10, 9);
  palm(312, SKY_H - 4, 6);

  // Clouds: flat-bottomed pixel blobs.
  const cloud = (x, y, w) => {
    c.fillRect(x, y, w, 2, C.cloud);
    c.fillRect(x + 2, y - 1, w - 5, 1, C.cloud);
    c.fillRect(x + 4, y - 2, Math.max(2, w - 10), 1, C.cloud);
  };
  cloud(70, 10, 22);
  cloud(110, 6, 14);
  cloud(210, 12, 26);
  cloud(236, 7, 12);
  // Birds.
  for (const [x, y] of [[96, 4], [100, 5], [188, 9], [192, 10]]) { c.set(x, y, C.island); c.set(x + 1, y + 1, C.island); c.set(x + 2, y, C.island); }
  return c;
}

/** Deep water with banded swells and broken foam crests. Tiles both ways. */
export function buildWaterTile() {
  const c = new Canvas(TILE, TILE);
  const rand = rng(7);
  c.fillRect(0, 0, TILE, TILE, C.waterDeep);
  // Horizontal swell bands.
  for (let y = 0; y < TILE; y++) {
    const phase = y % 16;
    if (phase === 2 || phase === 3) c.fillRect(0, y, TILE, 1, C.waterDark);
    if (phase === 9) c.fillRect(0, y, TILE, 1, C.water);
  }
  // Two crest lines per tile with jagged breaks: light blue body, white top.
  for (const base of [6, 38]) {
    let x = 0;
    while (x < TILE) {
      const len = 4 + Math.floor(rand() * 9);
      const gap = Math.floor(rand() * 4);
      const lift = Math.floor(rand() * 2);
      c.fillRect(x, base - lift, Math.min(len, TILE - x), 1, C.white);
      c.fillRect(x, base - lift + 1, Math.min(len, TILE - x), 1, C.waterLight);
      c.fillRect(x + 1, base - lift + 2, Math.max(0, Math.min(len - 2, TILE - x - 1)), 1, C.water);
      x += len + gap;
    }
  }
  return c;
}

/** Sparse foam flecks on transparency, scrolls faster for parallax. */
export function buildFoamTile() {
  const c = new Canvas(TILE, TILE);
  const rand = rng(21);
  for (let i = 0; i < 18; i++) {
    const len = 2 + Math.floor(rand() * 5);
    const x = Math.floor(rand() * (TILE - len));
    const y = Math.floor(rand() * TILE);
    c.fillRect(x, y, len, 1, i % 3 === 0 ? C.white : C.foam);
    if (len > 4) c.fillRect(x + 1, y + 1, len - 2, 1, C.waterLight);
  }
  return c;
}
