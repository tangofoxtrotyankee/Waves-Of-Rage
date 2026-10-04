import { PALETTE } from '../game/constants';
import { hex, mulberry32 } from './math';
import { THREE } from './three';

/**
 * Tiny textures painted at runtime on a canvas: 16 or 32 pixels square,
 * nearest-filtered, no mipmaps. Deliberately crude; the affine mapping in
 * the shader does the rest. Hand-drawn PNGs from tools/pixelart can replace
 * any of these later by loading a texture with the same settings.
 */
function pixelTexture(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void, height = size): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

const fill = (ctx: CanvasRenderingContext2D, color: number, x: number, y: number, w: number, h: number) => {
  ctx.fillStyle = hex(color);
  ctx.fillRect(x, y, w, h);
};

/**
 * Water: a pale detail pattern (light and dark horizontal dashes) that the
 * sea's vertex colours tint, tiled every 4 m. The one texture with mipmaps:
 * without them the dashes become a band of noise at the horizon.
 */
export function waterTexture(): THREE.CanvasTexture {
  const texture = pixelTexture(32, (ctx, size) => {
    const rng = mulberry32(3);
    fill(ctx, 0xdce8f6, 0, 0, size, size);
    for (let i = 0; i < 40; i++) fill(ctx, 0xffffff, Math.floor(rng() * size), Math.floor(rng() * size), 2 + Math.floor(rng() * 4), 1);
    for (let i = 0; i < 30; i++) fill(ctx, 0xa9bee0, Math.floor(rng() * size), Math.floor(rng() * size), 2 + Math.floor(rng() * 3), 1);
    for (let i = 0; i < 14; i++) fill(ctx, 0xc2d3ec, Math.floor(rng() * size), Math.floor(rng() * size), 3 + Math.floor(rng() * 3), 1);
  });
  texture.generateMipmaps = true;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A surfboard: base colour, a stripe down the middle, dark rails. */
export function boardTexture(base: number, stripe: number): THREE.CanvasTexture {
  return pixelTexture(16, (ctx, size) => {
    fill(ctx, base, 0, 0, size, size);
    fill(ctx, stripe, 6, 0, 3, size);
    fill(ctx, PALETTE.outline, 0, 0, 1, size);
    fill(ctx, PALETTE.outline, size - 1, 0, 1, size);
  });
}

/**
 * The skull bell buoy, 32 px: canvas rows 0 to 27 wrap round the bell (red
 * with dark bands, a white skull and crossbones); rows 28 to 31 are plain
 * white, for the parts coloured by their vertices (the cage, the lamp, the
 * foam ring), so the whole buoy is one mesh with one material.
 */
export const SKULL_PLAIN_V = 2 / 32;
export const SKULL_BODY_V: readonly [number, number] = [5 / 32, 31.5 / 32];
export function skullTexture(): THREE.CanvasTexture {
  return pixelTexture(32, (ctx, size) => {
    fill(ctx, 0xd62839, 0, 0, size, 28);
    fill(ctx, 0xa01530, 0, 18, size, 10);
    fill(ctx, PALETTE.outline, 0, 0, size, 2);
    fill(ctx, 0xffd166, 0, 2, size, 1);
    fill(ctx, PALETTE.outline, 0, 24, size, 2);
    for (let x = 0; x < size; x += 8) fill(ctx, PALETTE.outline, x + 3, 25, 2, 2);
    // Crossbones behind the skull.
    for (let i = 0; i < 12; i++) {
      fill(ctx, PALETTE.foam, 10 + i, 9 + Math.floor(i * 0.75), 2, 1);
      fill(ctx, PALETTE.foam, 21 - i, 9 + Math.floor(i * 0.75), 2, 1);
    }
    // Cranium, jaw, eyes and nose.
    fill(ctx, PALETTE.foam, 12, 5, 8, 7);
    fill(ctx, PALETTE.foam, 11, 6, 10, 5);
    fill(ctx, PALETTE.foam, 13, 12, 6, 3);
    fill(ctx, PALETTE.outline, 13, 8, 2, 2);
    fill(ctx, PALETTE.outline, 17, 8, 2, 2);
    fill(ctx, PALETTE.outline, 15, 11, 2, 1);
    fill(ctx, PALETTE.outline, 14, 13, 1, 2);
    fill(ctx, PALETTE.outline, 16, 13, 1, 2);
    fill(ctx, 0xff6f7d, 2, 4, 2, 14); // a highlight down one side
    fill(ctx, PALETTE.foam, 0, 28, size, 4);
  });
}

/** 5x7 pixel glyphs for the banner's letters (rows top to bottom, 1 is ink): drawn by hand so the lettering is the same on every device. */
const BANNER_GLYPHS: Record<string, readonly string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};

/**
 * Chunky slanted lettering like the title's: the glyphs scaled up (6 by 7
 * canvas pixels each), each row pushed right the higher it is, outlined in
 * the dark outline colour with a cyan drop shadow and filled white to pink
 * from top to bottom. Centred on (cx, cy).
 */
function paintBannerLettering(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number): void {
  const sx = 6;
  const sy = 7;
  const slant = 0.4;
  const width = text.length * 6 * sx - sx;
  const height = 7 * sy;
  const x0 = Math.round(cx - width / 2 - (height * slant) / 2);
  const y0 = Math.round(cy - height / 2);
  // The ink as a mask (with room round it for the outline and the shadow), then painted in layers.
  const W = width + Math.ceil(height * slant) + 12;
  const H = height + 12;
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < text.length; i++) {
    const glyph = BANNER_GLYPHS[text[i]];
    if (!glyph) continue;
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '1') continue;
        for (let py = 0; py < sy; py++) {
          const y = gy * sy + py;
          const shift = Math.round((height - y) * slant);
          for (let px = 0; px < sx; px++) ink[(y + 4) * W + 4 + i * 6 * sx + gx * sx + px + shift] = 1;
        }
      }
    }
  }
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? ink[y * W + x] : 0);
  const near = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (at(x + dx, y + dy)) return true;
    return false;
  };
  const gradient = [0xffffff, 0xffffff, 0xffe6f4, 0xffc8e6, 0xffa6d6, 0xff86c6, 0xff66b6, 0xff4fa3];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let color = -1;
      if (at(x, y)) color = gradient[Math.min(gradient.length - 1, Math.floor(((y - 4) / height) * gradient.length))];
      else if (near(x, y, 2)) color = PALETTE.outline;
      else if (at(x - 3, y - 3)) color = 0x45cbe6;
      else if (near(x - 3, y - 3, 1)) color = PALETTE.outline;
      if (color >= 0) fill(ctx, color, x0 + x - 4, y0 + y - 4, 1, 1);
    }
  }
}

/** Regions of the festival atlas (u0, v0, u1, v1 in texture space, v up), for the pier's textured parts. */
export const ATLAS = {
  banner: [0, 0.75, 1, 1],
  crowd: [0, 0.5, 0.5, 0.75],
  flag: [0, 0, 0.0625, 0.5],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/**
 * The festival atlas, 512 by 256 px, so the pier's textured parts share one
 * material: the BOARDMASTERS banner (slanted, outlined lettering on dark
 * cloth, like the title), a strip of dense crowd and the blue feather flag
 * with the wave logo. Mipmapped (nearest within a level): the banner is seen
 * from 50 to 150 m, about 4 texels to a screen pixel, where single nearest
 * samples drop whole strokes and the word reads as garbage. The cells sit
 * on 32-texel boundaries, so the mip levels that matter do not bleed.
 */
export function festivalAtlas(): THREE.CanvasTexture {
  const texture = pixelTexture(512, (ctx) => {
    // Banner, canvas rows 0..63 across the full 512 columns (the lettering needs the width to stay legible).
    fill(ctx, 0x2a1652, 0, 0, 512, 64);
    fill(ctx, 0x3a2270, 0, 6, 512, 52);
    fill(ctx, PALETTE.outline, 0, 0, 512, 3);
    fill(ctx, PALETTE.outline, 0, 61, 512, 3);
    fill(ctx, 0xff4fa3, 0, 3, 512, 3);
    fill(ctx, 0x45cbe6, 0, 58, 512, 3);
    paintBannerLettering(ctx, 'BOARDMASTERS', 256, 31);
    // Crowd, rows 64..127: heads, bright shirts and raised arms, packed in three ranks.
    const rng = mulberry32(21);
    fill(ctx, 0x221238, 0, 64, 256, 64);
    const shirts = [0xff4fa3, 0x7ff6ff, 0xffd166, 0xf8fbff, 0x45cbe6, 0xff8c42, 0x9b5de5, 0xe63946, 0x2d4fd6];
    const skins = [0xf4a261, 0xc68642, 0x8d5524, 0xffdbac, 0xe0ac69];
    for (let rank = 0; rank < 3; rank++) {
      const base = 64 + 20 + rank * 17;
      for (let x = (rank * 3) % 5; x < 256; x += 4 + Math.floor(rng() * 2)) {
        const y = base + Math.floor(rng() * 4) - 2;
        fill(ctx, shirts[Math.floor(rng() * shirts.length)], x, y, 3, 12);
        fill(ctx, skins[Math.floor(rng() * skins.length)], x, y - 4, 3, 4);
        if (rng() < 0.3) fill(ctx, PALETTE.outline, x, y - 5, 3, 2);
        if (rng() < 0.3) fill(ctx, skins[Math.floor(rng() * skins.length)], x + (rng() < 0.5 ? -1 : 3), y - 8, 1, 6);
      }
    }
    // Feather flag, columns 0..31, rows 128..255: dark blue with the white wave logo.
    fill(ctx, 0x1d2a8c, 0, 128, 32, 128);
    fill(ctx, 0x2d4fd6, 2, 132, 28, 122);
    fill(ctx, PALETTE.foam, 0, 128, 32, 3);
    for (let i = 0; i < 3; i++) {
      for (let a = 0; a < 20; a++) {
        const t = a / 19;
        const r = 11 - i * 3.5;
        const x = 15 + Math.cos(Math.PI * (0.1 + t * 1.3)) * r;
        const y = 168 - Math.sin(Math.PI * (0.1 + t * 1.3)) * r * 1.2 + i * 2;
        fill(ctx, i === 1 ? 0x7ff6ff : PALETTE.foam, Math.round(x), Math.round(y), 2, 2);
      }
    }
    fill(ctx, PALETTE.foam, 4, 178, 24, 2);
    fill(ctx, 0x7ff6ff, 7, 184, 18, 2);
  }, 256);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  return texture;
}

/** Falling water: streaks of white and pale cyan on blue, scrolled down by the scenery. */
export function waterfallTexture(): THREE.CanvasTexture {
  return pixelTexture(16, (ctx, size) => {
    const rng = mulberry32(9);
    fill(ctx, 0x7fc8f0, 0, 0, size, size);
    for (let i = 0; i < 30; i++) fill(ctx, rng() < 0.6 ? PALETTE.foam : 0xbfefff, Math.floor(rng() * size), Math.floor(rng() * size), 1 + Math.floor(rng() * 2), 3 + Math.floor(rng() * 6));
    for (let i = 0; i < 8; i++) fill(ctx, 0x4f9fe0, Math.floor(rng() * size), Math.floor(rng() * size), 1, 3);
  });
}

/** Board shorts: a base colour with a loud pattern in an accent colour. */
export function shortsTexture(base: number, accent: number): THREE.CanvasTexture {
  return pixelTexture(16, (ctx, size) => {
    const rng = mulberry32(base ^ accent);
    fill(ctx, base, 0, 0, size, size);
    for (let i = 0; i < 9; i++) fill(ctx, accent, Math.floor(rng() * size), Math.floor(rng() * size), 2 + Math.floor(rng() * 3), 2 + Math.floor(rng() * 2));
  });
}
