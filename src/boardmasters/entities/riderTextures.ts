import { hex, mixRgb, mulberry32, rgb } from '../engine/math';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';
import type { RiderSpec } from '../game/characters';

/**
 * The riders' runtime-painted textures: one small atlas per rider (white
 * for the vertex-coloured parts, the face, the board-shorts print and the
 * top) and one deck texture per board. Nearest-filtered, no mipmaps, like
 * every other texture in the game; the PS1 shader's affine mapping does the
 * rest. Regions are given in canvas pixels and turned into UV rectangles
 * with `regionUv`, so the model builder (RiderModel.ts) can map parts into
 * them.
 */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export const ATLAS_SIZE = 64;
/** The rider atlas: a white block for vertex-coloured parts, the face, the shorts print and the top (vest, crop top, wetsuit). */
export const ATLAS = {
  white: { x: 0, y: 0, w: 8, h: 8 },
  face: { x: 0, y: 16, w: 16, h: 16 },
  shorts: { x: 32, y: 0, w: 32, h: 32 },
  top: { x: 32, y: 32, w: 32, h: 32 },
} as const satisfies Record<string, Region>;

export const BOARD_TEX = { w: 64, h: 64 } as const;
/** The board texture: the deck art (nose at the top), the hull, and a white block for the fins. */
export const BOARD_REGIONS = {
  deck: { x: 0, y: 0, w: 32, h: 64 },
  hull: { x: 32, y: 0, w: 28, h: 64 },
  white: { x: 60, y: 60, w: 4, h: 4 },
} as const satisfies Record<string, Region>;

/** A canvas region as a UV rectangle (v up, as the canvas texture is flipped), inset half a texel so nearest sampling never bleeds. */
export function regionUv(r: Region, texW: number, texH: number): UvRect {
  return {
    u0: (r.x + 0.5) / texW,
    u1: (r.x + r.w - 0.5) / texW,
    v0: 1 - (r.y + r.h - 0.5) / texH,
    v1: 1 - (r.y + 0.5) / texH,
  };
}

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

type Ctx = CanvasRenderingContext2D;
const fill = (ctx: Ctx, color: number, x: number, y: number, w = 1, h = 1) => {
  ctx.fillStyle = hex(color);
  ctx.fillRect(x, y, w, h);
};
const toHex = ([r, g, b]: [number, number, number]): number => (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
/** Mix two 0xrrggbb colours. */
export const mixColor = (a: number, b: number, t: number): number => toHex(mixRgb(rgb(a), rgb(b), t));

/** Pixels inside a region, wrapping horizontally (prints run round the leg). */
function wrapPixel(ctx: Ctx, r: Region, color: number, x: number, y: number): void {
  const px = ((x % r.w) + r.w) % r.w;
  if (y < 0 || y >= r.h) return;
  fill(ctx, color, r.x + px, r.y + y);
}

/** Board shorts: u runs round the body from the front (0) by the left side to the back (0.5); v from the hem (bottom) to the waistband (top rows). */
function paintShorts(ctx: Ctx, spec: RiderSpec, r: Region): void {
  const { look, colors } = spec;
  const base = colors.shorts;
  const accent = look.accent;
  const rng = mulberry32(base ^ (accent << 3) ^ spec.id.length);
  fill(ctx, base, r.x, r.y, r.w, r.h);
  const dark = mixColor(base, 0x000000, 0.35);
  const light = mixColor(accent, 0xffffff, 0.35);
  switch (look.shorts) {
    case 'floral':
      // Big jagged leaves in the accent, small flowers in a lighter tint (the mockup's teal-and-magenta print), bold enough to read at 20 pixels.
      for (let i = 0; i < 7; i++) {
        let x = Math.floor(rng() * r.w);
        let y = 3 + Math.floor(rng() * (r.h - 12));
        const dx = rng() < 0.5 ? 1 : -1;
        for (let k = 0; k < 10; k++) {
          const w = k < 2 || k > 7 ? 2 : 3;
          for (let j = 0; j < w; j++) wrapPixel(ctx, r, accent, x + j, y);
          // Jagged edges: a tooth every other row.
          if (k % 2 === 0) wrapPixel(ctx, r, accent, x + (dx > 0 ? w : -1), y);
          x += dx;
          y += rng() < 0.8 ? 1 : 0;
        }
      }
      for (let i = 0; i < 8; i++) {
        const x = Math.floor(rng() * r.w);
        const y = 4 + Math.floor(rng() * (r.h - 6));
        wrapPixel(ctx, r, light, x, y);
        wrapPixel(ctx, r, light, x + 1, y + 1);
        wrapPixel(ctx, r, light, x - 1, y + 1);
        wrapPixel(ctx, r, light, x, y + 2);
      }
      break;
    case 'palm':
      for (let i = 0; i < 6; i++) {
        const cx = Math.floor(rng() * r.w);
        const cy = 6 + Math.floor(rng() * (r.h - 10));
        for (let a = 0; a < 5; a++) {
          const ang = -Math.PI / 2 + (a - 2) * 0.6;
          for (let k = 1; k < 5; k++) wrapPixel(ctx, r, accent, cx + Math.round(Math.cos(ang) * k), cy + Math.round(Math.sin(ang) * k * 0.8));
        }
        for (let k = 0; k < 4; k++) wrapPixel(ctx, r, dark, cx, cy + k);
      }
      break;
    case 'leopard':
      for (let i = 0; i < 22; i++) {
        const x = Math.floor(rng() * r.w);
        const y = 4 + Math.floor(rng() * (r.h - 6));
        wrapPixel(ctx, r, accent, x, y);
        wrapPixel(ctx, r, accent, x + 1, y);
        wrapPixel(ctx, r, accent, x - 1, y + 1);
        wrapPixel(ctx, r, accent, x + 2, y + 1);
        wrapPixel(ctx, r, accent, x, y + 2);
        wrapPixel(ctx, r, mixColor(base, accent, 0.4), x, y + 1);
        wrapPixel(ctx, r, mixColor(base, accent, 0.4), x + 1, y + 1);
      }
      break;
    case 'stripe':
      // Lifeguard shorts: a broad stripe down each side and a cross on the left leg.
      for (const sx of [6, 22]) fill(ctx, accent, r.x + sx, r.y + 3, 3, r.h - 3);
      fill(ctx, accent, r.x + 11, r.y + 18, 5, 1);
      fill(ctx, accent, r.x + 13, r.y + 16, 1, 5);
      break;
    case 'denim':
      for (let i = 0; i < 40; i++) fill(ctx, mixColor(base, 0xffffff, 0.2 + rng() * 0.2), r.x + Math.floor(rng() * r.w), r.y + 4 + Math.floor(rng() * (r.h - 4)), 1, 2);
      for (let x = 0; x < r.w; x += 2) fill(ctx, light, r.x + x, r.y + r.h - 2 + (x % 4 === 0 ? 1 : 0));
      fill(ctx, mixColor(base, 0xffe0a0, 0.6), r.x + 8, r.y + 4, 1, r.h - 6);
      fill(ctx, mixColor(base, 0xffe0a0, 0.6), r.x + 24, r.y + 4, 1, r.h - 6);
      break;
    case 'solid':
      for (const sx of [8, 24]) fill(ctx, accent, r.x + sx, r.y, 1, r.h);
      break;
    case 'bikini':
      // Bikini bottoms: plain with ties at the hips.
      for (const sx of [7, 8, 23, 24]) fill(ctx, accent, r.x + sx, r.y + r.h - 12, 1, 3);
      break;
  }
  // Waistband: the top rows, with the drawstring at the front.
  if (look.shorts !== 'bikini') {
    fill(ctx, dark, r.x, r.y, r.w, 3);
    fill(ctx, accent, r.x, r.y + 1, r.w, 1);
    fill(ctx, 0xffffff, r.x, r.y + 2, 1, 2);
    fill(ctx, 0xffffff, r.x + r.w - 1, r.y + 2, 1, 2);
  }
  // Hem: a darker row.
  fill(ctx, dark, r.x, r.y + r.h - 1, r.w, 1);
}

/** The face, seen from the front: u runs across from the rider's right to its left, v up. */
function paintFace(ctx: Ctx, spec: RiderSpec, r: Region): void {
  const { look, colors } = spec;
  const skin = colors.skin;
  const shadow = mixColor(skin, 0x40182a, 0.3);
  fill(ctx, skin, r.x, r.y, r.w, r.h);
  fill(ctx, shadow, r.x, r.y + 13, r.w, 3);
  const at = (x: number, y: number, color: number, w = 1, h = 1) => fill(ctx, color, r.x + x, r.y + y, w, h);
  if (look.hair === 'hood') {
    // A mask: dark with the goggles.
    fill(ctx, 0x15151f, r.x, r.y, r.w, r.h);
    at(2, 5, look.topColor, 12, 3);
    at(4, 6, 0xffffff, 1, 1);
    at(10, 6, 0xffffff, 1, 1);
    at(7, 5, 0x15151f, 2, 3);
    return;
  }
  // Brows, eyes, nose shadow, mouth.
  const brow = mixColor(colors.hair, 0x000000, 0.3);
  at(3, 5, brow, 4, 1);
  at(9, 5, brow, 4, 1);
  at(4, 6, 0xffffff, 2, 2);
  at(10, 6, 0xffffff, 2, 2);
  at(5, 6, 0x1a1a2e, 1, 2);
  at(10, 6, 0x1a1a2e, 1, 2);
  at(7, 8, shadow, 2, 2);
  at(6, 11, 0x7a2a2a, 4, 1);
  if (look.female) {
    at(6, 11, 0xc0304a, 4, 1);
    at(3, 7, brow, 1, 1);
    at(12, 7, brow, 1, 1);
  }
  if (look.beard) {
    at(2, 10, colors.hair, 12, 5);
    at(4, 9, colors.hair, 8, 1);
    at(6, 11, 0x7a2a2a, 4, 1);
  }
  if (look.shades) {
    at(2, 5, 0x111122, 12, 3);
    at(3, 5, 0x3a4a7a, 2, 1);
    at(9, 5, 0x3a4a7a, 2, 1);
    at(7, 6, 0x111122, 2, 1);
  }
}

/** The top, round the torso like the shorts: a vest with a skull on the back and an open front, a crop top, or a wetsuit's trim. */
function paintTop(ctx: Ctx, spec: RiderSpec, r: Region): void {
  const { look, colors } = spec;
  const at = (x: number, y: number, color: number, w = 1, h = 1) => fill(ctx, color, r.x + x, r.y + y, w, h);
  switch (look.top) {
    case 'vest': {
      const base = look.topColor;
      fill(ctx, base, r.x, r.y, r.w, r.h);
      // Open at the front: the chest shows.
      at(0, 0, colors.skin, 4, r.h);
      at(28, 0, colors.skin, 4, r.h);
      at(4, 0, 0x6a6a7a, 1, r.h);
      at(27, 0, 0x6a6a7a, 1, r.h);
      // Studs along the hem.
      for (let x = 5; x < 27; x += 3) at(x, r.h - 2, 0xb0b0c0);
      // The skull on the back (u = 0.5 is the spine).
      const W = 0xf4f4f0;
      const K = base;
      at(11, 7, W, 10, 7);
      at(12, 6, W, 8, 1);
      at(12, 14, W, 8, 2);
      at(13, 16, W, 6, 2);
      at(12, 9, K, 3, 3);
      at(17, 9, K, 3, 3);
      at(15, 12, K, 2, 2);
      at(13, 16, K, 1, 2);
      at(15, 16, K, 1, 2);
      at(17, 16, K, 1, 2);
      // Crossed bones under it.
      for (let k = 0; k < 8; k++) {
        at(11 + k, 19 + Math.floor(k / 2), W);
        at(20 - k, 19 + Math.floor(k / 2), W);
      }
      break;
    }
    case 'wetsuit': {
      fill(ctx, colors.skin, r.x, r.y, r.w, r.h);
      for (const sx of [7, 23]) at(sx, 0, look.topColor, 2, r.h);
      at(16, 2, mixColor(colors.skin, 0xffffff, 0.25), 1, r.h - 6);
      break;
    }
    default: {
      // Crop top (and anything else): the top colour with a pale trim.
      fill(ctx, look.topColor, r.x, r.y, r.w, r.h);
      at(0, r.h - 2, mixColor(look.topColor, 0xffffff, 0.5), r.w, 1);
      at(0, 1, mixColor(look.topColor, 0xffffff, 0.5), r.w, 1);
      at(14, 5, 0xffffff, 4, 4);
      break;
    }
  }
}

/** One rider's atlas. */
export function riderAtlas(spec: RiderSpec): THREE.CanvasTexture {
  return canvasTexture(ATLAS_SIZE, ATLAS_SIZE, (ctx) => {
    fill(ctx, 0xffffff, 0, 0, ATLAS_SIZE, ATLAS_SIZE);
    paintFace(ctx, spec, ATLAS.face);
    paintShorts(ctx, spec, ATLAS.shorts);
    paintTop(ctx, spec, ATLAS.top);
  });
}

/** Deck art: 32 across (the board's widest point spans it) by 64 along, nose at the top. */
function paintDeck(ctx: Ctx, spec: RiderSpec, r: Region): void {
  const base = spec.colors.board;
  const stripe = spec.colors.boardStripe;
  const rng = mulberry32(base ^ stripe);
  const at = (x: number, y: number, color: number, w = 1, h = 1) => fill(ctx, color, r.x + x, r.y + y, w, h);
  fill(ctx, base, r.x, r.y, r.w, r.h);
  const mid = r.w / 2;
  switch (spec.look.board) {
    case 'classic':
      at(mid - 1, 0, stripe, 3, r.h);
      at(mid - 5, 4, stripe, 1, r.h - 8);
      at(mid + 5, 4, stripe, 1, r.h - 8);
      break;
    case 'jagged':
      // Pink lightning streaks along a yellow board (the mockup's hero board).
      for (let s = 0; s < 4; s++) {
        let x = 6 + Math.floor(rng() * 20);
        for (let y = 4 + s * 3; y < r.h - 4; y += 2) {
          at(x, y, stripe, 3, 2);
          x += Math.floor(rng() * 5) - 2;
          x = Math.max(3, Math.min(r.w - 6, x));
        }
      }
      for (let i = 0; i < 18; i++) at(4 + Math.floor(rng() * 24), Math.floor(rng() * r.h), 0xff8c42, 2, 1);
      at(mid - 1, 0, PALETTE.outline, 2, r.h);
      break;
    case 'flame': {
      // Flames licking up from the tail.
      const colors = [0xe63946, stripe, 0xffd166];
      for (let layer = 0; layer < 3; layer++) {
        for (let x = 2; x < r.w - 2; x += 4) {
          const height = 22 + Math.floor(rng() * 16) - layer * 7;
          for (let k = 0; k < height; k++) {
            const w = Math.max(1, 3 - Math.floor((k / height) * 3));
            at(x + Math.round(Math.sin(k * 0.35 + x) * 1.5) + layer, r.h - 1 - k, colors[layer], w, 1);
          }
        }
      }
      break;
    }
    case 'palm':
      // A sunset disc and a palm silhouette.
      ctx.fillStyle = hex(0xffd166);
      ctx.beginPath();
      ctx.arc(r.x + mid, r.y + 24, 9, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 30; k++) at(mid + Math.round(Math.sin(k * 0.08) * 3), 50 - k, stripe, 2, 1);
      for (let a = 0; a < 7; a++) {
        const ang = Math.PI + (a / 6) * Math.PI;
        for (let k = 0; k < 9; k++) at(mid + 2 + Math.round(Math.cos(ang) * k), 20 + Math.round(Math.sin(ang) * k * 0.6 + k * k * 0.05), stripe, 1, 1);
      }
      break;
    case 'shark': {
      // A shark's open mouth at the nose: red gums, white teeth, an eye either side.
      fill(ctx, mixColor(base, 0xffffff, 0.75), r.x + 6, r.y + 18, r.w - 12, r.h - 18);
      at(7, 6, 0xc0303a, r.w - 14, 14);
      for (let x = 7; x < r.w - 7; x += 3) {
        at(x, 6, 0xffffff, 2, 3);
        at(x + 1, 9, 0xffffff, 1, 1);
        at(x, 17, 0xffffff, 2, 3);
        at(x + 1, 16, 0xffffff, 1, 1);
      }
      at(5, 24, 0x101010, 3, 3);
      at(r.w - 8, 24, 0x101010, 3, 3);
      at(6, 24, 0xffffff);
      at(r.w - 7, 24, 0xffffff);
      for (let k = 0; k < 3; k++) at(4 + k * 2, 30 + k, stripe, 1, 6);
      break;
    }
    case 'skull': {
      const W = stripe;
      at(mid - 6, 22, W, 12, 10);
      at(mid - 5, 21, W, 10, 1);
      at(mid - 4, 32, W, 8, 4);
      at(mid - 4, 25, base, 3, 3);
      at(mid + 1, 25, base, 3, 3);
      at(mid - 1, 29, base, 2, 2);
      for (let x = mid - 3; x < mid + 4; x += 2) at(x, 33, base, 1, 3);
      for (let k = 0; k < 14; k++) {
        at(mid - 8 + k, 38 + Math.floor(k * 0.6), W, 2, 1);
        at(mid + 6 - k, 38 + Math.floor(k * 0.6), W, 2, 1);
      }
      at(2, 0, 0xe63946, 2, r.h);
      at(r.w - 4, 0, 0xe63946, 2, r.h);
      break;
    }
    case 'reggae':
      fill(ctx, 0xe63946, r.x, r.y, r.w, 21);
      fill(ctx, 0xffd166, r.x, r.y + 21, r.w, 22);
      fill(ctx, 0x2bb673, r.x, r.y + 43, r.w, 21);
      at(mid - 1, 0, PALETTE.outline, 2, r.h);
      break;
    case 'neon':
      fill(ctx, 0x3a1060, r.x, r.y, r.w, r.h);
      for (let k = -r.h; k < r.w + r.h; k += 9) {
        for (let y = 0; y < r.h; y++) {
          at(k + Math.floor(y * 0.5), y, PALETTE.cyan, 2, 1);
          at(k + 4 + Math.floor(y * 0.5), y, stripe, 1, 1);
        }
      }
      break;
    case 'cross':
      at(mid - 2, 20, stripe, 4, 16);
      at(mid - 8, 26, stripe, 16, 4);
      at(3, 0, stripe, 2, r.h);
      at(r.w - 5, 0, stripe, 2, r.h);
      break;
  }
}

/** One board's texture: deck art, a hull with a stringer, and a white block for the fins. */
export function boardDeckTexture(spec: RiderSpec): THREE.CanvasTexture {
  return canvasTexture(BOARD_TEX.w, BOARD_TEX.h, (ctx) => {
    paintDeck(ctx, spec, BOARD_REGIONS.deck);
    const hull = BOARD_REGIONS.hull;
    fill(ctx, mixColor(spec.colors.board, 0xffffff, 0.15), hull.x, hull.y, hull.w, hull.h);
    fill(ctx, spec.colors.boardStripe, hull.x + hull.w / 2 - 1, hull.y, 2, hull.h);
    const white = BOARD_REGIONS.white;
    fill(ctx, 0xffffff, white.x, white.y, white.w, white.h);
  });
}
