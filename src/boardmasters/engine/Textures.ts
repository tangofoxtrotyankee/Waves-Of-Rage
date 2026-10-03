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

/** Water: mid blue with light and deep horizontal dashes, tiled every 4 m. */
export function waterTexture(): THREE.CanvasTexture {
  return pixelTexture(32, (ctx, size) => {
    const rng = mulberry32(3);
    fill(ctx, PALETTE.water, 0, 0, size, size);
    for (let i = 0; i < 44; i++) fill(ctx, PALETTE.lightWater, Math.floor(rng() * size), Math.floor(rng() * size), 2 + Math.floor(rng() * 4), 1);
    for (let i = 0; i < 26; i++) fill(ctx, PALETTE.deepWater, Math.floor(rng() * size), Math.floor(rng() * size), 2 + Math.floor(rng() * 3), 1);
    for (let i = 0; i < 6; i++) fill(ctx, PALETTE.foam, Math.floor(rng() * size), Math.floor(rng() * size), 1, 1);
  });
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

/** Chequered flag for the finish banner. */
export function checkerTexture(): THREE.CanvasTexture {
  return pixelTexture(8, (ctx, size) => {
    fill(ctx, PALETTE.foam, 0, 0, size, size);
    for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) if (((x + y) / 2) % 2 === 0) fill(ctx, PALETTE.outline, x, y, 2, 2);
  });
}
