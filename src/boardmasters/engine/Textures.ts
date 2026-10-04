import { PALETTE } from '../game/constants';
import { hex, mulberry32 } from './math';
import { THREE } from './three';

/**
 * Tiny textures painted at runtime on a canvas: 16 or 32 pixels square,
 * nearest-filtered, no mipmaps. Deliberately crude; the affine mapping in
 * the shader does the rest. Hand-drawn PNGs from tools/pixelart can replace
 * any of these later by loading a texture with the same settings.
 */
function pixelTexture(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
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

/** Water: mid blue with light and deep horizontal dashes, tiled every 4 m. The one texture with mipmaps: without them the dashes become a band of noise at the horizon. */
export function waterTexture(): THREE.CanvasTexture {
  const texture = pixelTexture(32, (ctx, size) => {
    const rng = mulberry32(3);
    fill(ctx, PALETTE.water, 0, 0, size, size);
    for (let i = 0; i < 44; i++) fill(ctx, PALETTE.lightWater, Math.floor(rng() * size), Math.floor(rng() * size), 2 + Math.floor(rng() * 4), 1);
    for (let i = 0; i < 26; i++) fill(ctx, PALETTE.deepWater, Math.floor(rng() * size), Math.floor(rng() * size), 2 + Math.floor(rng() * 3), 1);
    for (let i = 0; i < 6; i++) fill(ctx, PALETTE.foam, Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
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

/** The skull buoy: red with dark bands and a crude white skull. */
export function skullTexture(): THREE.CanvasTexture {
  return pixelTexture(16, (ctx, size) => {
    fill(ctx, 0xe63946, 0, 0, size, size);
    fill(ctx, PALETTE.outline, 0, 0, size, 2);
    fill(ctx, PALETTE.outline, 0, size - 2, size, 2);
    fill(ctx, PALETTE.foam, 5, 4, 6, 5);
    fill(ctx, PALETTE.foam, 6, 9, 4, 2);
    fill(ctx, PALETTE.outline, 6, 6, 1, 1);
    fill(ctx, PALETTE.outline, 9, 6, 1, 1);
    fill(ctx, PALETTE.outline, 7, 10, 1, 1);
  });
}

/** A rectangular canvas texture (not square), same settings. */
function pixelTextureRect(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** A banner with blocky text: dark cloth, gold letters. */
export function bannerTexture(text: string): THREE.CanvasTexture {
  return pixelTextureRect(128, 24, (ctx) => {
    fill(ctx, PALETTE.outline, 0, 0, 128, 24);
    fill(ctx, PALETTE.gold, 0, 0, 128, 2);
    fill(ctx, PALETTE.gold, 0, 22, 128, 2);
    ctx.fillStyle = hex(PALETTE.gold);
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 12);
  });
}

/** A crowd: bright dots of people on a dark stand, tiled along a pier. */
export function crowdTexture(): THREE.CanvasTexture {
  return pixelTextureRect(64, 8, (ctx) => {
    const rng = mulberry32(21);
    fill(ctx, 0x2a1a44, 0, 0, 64, 8);
    const colors = [0xff4fa3, 0x7ff6ff, 0xffd166, 0xf8fbff, 0x45cbe6, 0xff8c42, 0x9b5de5];
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(rng() * 64);
      const y = 1 + Math.floor(rng() * 5);
      fill(ctx, colors[Math.floor(rng() * colors.length)], x, y, 1, 2);
      fill(ctx, 0xf4a261, x, y - 1, 1, 1);
    }
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

/** A blue flag with a white wave. */
export function flagTexture(): THREE.CanvasTexture {
  return pixelTexture(16, (ctx, size) => {
    fill(ctx, 0x2d4fd6, 0, 0, size, size);
    for (let x = 2; x < 14; x++) fill(ctx, PALETTE.foam, x, 8 + Math.round(2 * Math.sin(x * 0.9)), 1, 2);
    fill(ctx, PALETTE.foam, 9, 5, 3, 2);
  });
}
