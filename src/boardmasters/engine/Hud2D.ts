import { FONT_CHARS } from '../../game/constants';
import { hex } from './math';

/** `#rrggbb` per colour number, cached: the HUD fills rects every frame and should not build strings to do it. */
const HEX = new Map<number, string>();
const css = (color: number): string => {
  let s = HEX.get(color);
  if (s === undefined) {
    s = hex(color);
    HEX.set(color, s);
  }
  return s;
};

const GLYPH = 8;
const PER_ROW = 16;
const SHADOW = '#1a0b2e';
const OUTLINE: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
  [0, 2],
  [1, 2],
];
/** Ring offsets for baked outlines: all eight neighbours. */
const RING: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * Glyphs the shared font sheet lacks (it is the original game's and stays
 * unchanged), drawn here as 5x7 maps in the same style and appended as a
 * fourth row of the working sheet.
 */
const EXTRA_GLYPHS: Record<string, string[]> = {
  ',': ['.....', '.....', '.....', '.....', '.....', '.##..', '.#...', '#....'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..', '.....'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....', '.....'],
  '▶': ['#....', '##...', '###..', '####.', '###..', '##...', '#....', '.....'],
  '#': ['.#.#.', '#####', '.#.#.', '.#.#.', '#####', '.#.#.', '.....', '.....'],
};
const EXTRA_CHARS = Object.keys(EXTRA_GLYPHS).join('');
/** Index into the working sheet per character code (lower case maps to upper case); -1 means not drawn. */
const GLYPH_INDEX = new Int16Array(0x2700).fill(-1);
for (let i = 0; i < FONT_CHARS.length; i++) GLYPH_INDEX[FONT_CHARS.charCodeAt(i)] = i;
for (let i = 0; i < EXTRA_CHARS.length; i++) GLYPH_INDEX[EXTRA_CHARS.charCodeAt(i)] = 3 * PER_ROW + i;
// Lower case draws as upper case, except 'x', which the sheet has as its own glyph (the times sign).
for (let c = 97; c <= 122; c++) if (c !== 120) GLYPH_INDEX[c] = GLYPH_INDEX[c - 32];
const glyphIndex = (code: number): number => (code < GLYPH_INDEX.length ? GLYPH_INDEX[code] : -1);

export interface TextOptions {
  align?: 'left' | 'center' | 'right';
  scale?: number;
  shadow?: boolean;
  /** Draw a 1px dark outline all round (big floating text, labels over the water). */
  outline?: boolean;
  /** Proportional spacing (each glyph's own width plus 1px) instead of the fixed 8px cell. */
  tight?: boolean;
}

/** Colours from the top of a shape to its bottom, for baked vertical gradients. */
export type Stops = readonly string[];

export interface StyleOptions {
  scale?: number;
  stops: Stops;
  /** Shear the rows (1 pixel per this many rows) so the text leans forward; 0 for upright. */
  italic?: number;
  /** Outline thickness in pixels (0 for none) and colour. */
  outline?: number;
  outlineColor?: string;
  tight?: boolean;
}

/** A canvas of `w` x `h` with its 2D context (nearest-neighbour). */
export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/** Fill every opaque pixel of `canvas` with a vertical gradient through `stops` (hard bands, top to bottom). */
export function gradientFill(canvas: HTMLCanvasElement, stops: Stops, top = 0, bottom = canvas.height): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const span = Math.max(1, bottom - top);
  // Hard bands rather than a smooth ramp: the HUD stays pixel art.
  for (let y = 0; y < canvas.height; y++) {
    const t = Math.min(0.999, Math.max(0, (y - top) / span));
    ctx.fillStyle = stops[Math.floor(t * stops.length)];
    ctx.fillRect(0, y, canvas.width, 1);
  }
  ctx.restore();
}

let scratch: CanvasRenderingContext2D | null = null;

/**
 * The pixels of `canvas`, read through one shared scratch canvas made for
 * readback (willReadFrequently), so the sprite canvases themselves stay
 * GPU-friendly and the browser does not warn about repeated readbacks.
 */
function readPixels(canvas: HTMLCanvasElement): ImageData {
  if (!scratch) {
    const c = document.createElement('canvas');
    scratch = c.getContext('2d', { willReadFrequently: true });
    if (!scratch) throw new Error('2D canvas unavailable');
  }
  const c = scratch.canvas;
  if (c.width < canvas.width || c.height < canvas.height) {
    c.width = Math.max(c.width, canvas.width);
    c.height = Math.max(c.height, canvas.height);
  }
  scratch.clearRect(0, 0, canvas.width, canvas.height);
  scratch.drawImage(canvas, 0, 0);
  return scratch.getImageData(0, 0, canvas.width, canvas.height);
}

/** Alpha to 0 or 1 at `threshold` (0..255): canvas text and arcs lose their soft edges. */
export function hardenAlpha(canvas: HTMLCanvasElement, threshold = 110): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = readPixels(canvas);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= threshold ? 255 : 0;
  ctx.putImageData(img, 0, 0);
}

/** A copy of `src` with a solid outline `thickness` pixels wide all round (plus a 1px drop below), `pad` pixels bigger on each side. */
export function outlined(src: HTMLCanvasElement, color: string, thickness: number, drop = 1): HTMLCanvasElement {
  const pad = thickness;
  const { canvas, ctx } = makeCanvas(src.width + pad * 2, src.height + pad * 2 + drop);
  if (thickness > 0) {
    const sil = makeCanvas(src.width, src.height);
    sil.ctx.drawImage(src, 0, 0);
    sil.ctx.globalCompositeOperation = 'source-in';
    sil.ctx.fillStyle = color;
    sil.ctx.fillRect(0, 0, src.width, src.height);
    for (let t = 1; t <= thickness; t++) for (const [dx, dy] of RING) ctx.drawImage(sil.canvas, pad + dx * t, pad + dy * t);
    for (let d = 1; d <= drop; d++) ctx.drawImage(sil.canvas, pad + thickness, pad + thickness + d);
  }
  ctx.drawImage(src, pad, pad);
  return canvas;
}

/**
 * The 2D overlay: a canvas at the internal resolution drawn with the
 * original game's 8x8 pixel font (public/assets/sprites/font.png, white
 * glyphs, tinted per colour here, plus a few extra glyphs drawn in code),
 * so HUD pixels are the same size as world pixels. Also the primitives the
 * HUD view builds its art from: pre-rendered sprites (`blit`), styled text
 * baked into canvases (`styledText`, `heavyText`), rects and pixel discs.
 */
export class Hud2D {
  readonly width: number;
  readonly height: number;
  private readonly ctx: CanvasRenderingContext2D;
  /** The font sheet with the extra glyphs appended, once loaded. */
  private font: HTMLCanvasElement | null = null;
  /** Each glyph's inked width in pixels (for tight spacing). */
  private readonly widths = new Uint8Array(4 * PER_ROW);
  private readonly tints = new Map<string, HTMLCanvasElement>();
  private readonly images = new Map<string, HTMLImageElement>();

  constructor(canvas: HTMLCanvasElement) {
    this.width = canvas.width;
    this.height = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    const font = new Image();
    font.onload = () => {
      this.font = this.buildSheet(font);
    };
    font.onerror = () => console.error('HUD font failed to load', font.src);
    font.src = 'assets/sprites/font.png';
  }

  /** True once the pixel font is usable (tests wait on it). */
  get fontLoaded(): boolean {
    return this.font !== null;
  }

  /** Register an image for `image()`; it draws once loaded. */
  loadImage(key: string, url: string): void {
    const img = new Image();
    img.onerror = () => console.error('HUD image failed to load', url);
    img.src = url;
    this.images.set(key, img);
  }

  /** A registered image once it has loaded. */
  loaded(key: string): HTMLImageElement | null {
    const img = this.images.get(key);
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = css(color);
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    this.ctx.globalAlpha = 1;
  }

  /** A dark panel with a coloured 1px frame. */
  panel(x: number, y: number, w: number, h: number, frame: number, alpha = 0.7): void {
    this.rect(x, y, w, h, 0x1a0b2e, alpha);
    this.frame(x, y, w, h, frame);
  }

  frame(x: number, y: number, w: number, h: number, color: number): void {
    this.ctx.strokeStyle = css(color);
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }

  /** A horizontal bar filled left to right with a gradient from `from` to `to`, in whole pixels. */
  gradientBar(x: number, y: number, w: number, h: number, fill: number, from: number, to: number): void {
    const width = Math.round(w * Math.max(0, Math.min(1, fill)));
    if (width <= 0) return;
    const g = this.ctx.createLinearGradient(Math.round(x), 0, Math.round(x + w), 0);
    g.addColorStop(0, hex(from));
    g.addColorStop(1, hex(to));
    this.ctx.fillStyle = g;
    this.ctx.fillRect(Math.round(x), Math.round(y), width, Math.round(h));
  }

  /** A filled disc with hard pixel edges. */
  disc(x: number, y: number, r: number, color: number, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = css(color);
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let dy = -r; dy < r; dy++) {
      const half = Math.round(Math.sqrt(r * r - (dy + 0.5) * (dy + 0.5)));
      this.ctx.fillRect(cx - half, cy + dy, half * 2, 1);
    }
    this.ctx.globalAlpha = 1;
  }

  circle(x: number, y: number, r: number, color: number, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = css(color);
    this.ctx.beginPath();
    this.ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  }

  ring(x: number, y: number, r: number, color: number, width = 2): void {
    this.ctx.strokeStyle = css(color);
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    this.ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  image(key: string, x: number, y: number, scale = 1): void {
    const img = this.loaded(key);
    if (!img) return;
    this.ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
  }

  /** Draw a pre-rendered sprite with its top-left at (x, y), optionally scaled about its centre and faded. */
  blit(src: HTMLCanvasElement | HTMLImageElement, x: number, y: number, alpha = 1, scale = 1): void {
    if (alpha <= 0) return;
    this.ctx.globalAlpha = Math.min(1, alpha);
    if (scale === 1) this.ctx.drawImage(src, Math.round(x), Math.round(y));
    else {
      const w = Math.round(src.width * scale);
      const h = Math.round(src.height * scale);
      this.ctx.drawImage(src, Math.round(x + (src.width - w) / 2), Math.round(y + (src.height - h) / 2), w, h);
    }
    this.ctx.globalAlpha = 1;
  }

  /** Draw part of a sprite (glyph sheets, bars filled to a width). */
  blitPart(src: HTMLCanvasElement, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, alpha = 1): void {
    if (sw <= 0 || sh <= 0 || alpha <= 0) return;
    this.ctx.globalAlpha = Math.min(1, alpha);
    this.ctx.drawImage(src, sx, sy, sw, sh, Math.round(dx), Math.round(dy), sw, sh);
    this.ctx.globalAlpha = 1;
  }

  /** Width of `text` in pixels; tight spacing uses each glyph's own width. */
  textWidth(text: string, scale = 1, tight = false): number {
    if (!tight) return text.length * GLYPH * scale;
    let w = 0;
    for (let i = 0; i < text.length; i++) w += this.advance(text.charCodeAt(i));
    return Math.max(0, w - 1) * scale;
  }

  /** Draw pixel text; `x` is the left, centre or right edge per `align`. Lower case is drawn as upper case. */
  text(x: number, y: number, text: string, color = '#ffffff', options: TextOptions = {}): void {
    if (!this.font) return;
    const { align = 'left', scale = 1, shadow = true, outline = false, tight = false } = options;
    const width = this.textWidth(text, scale, tight);
    const left = Math.round(align === 'left' ? x : align === 'center' ? x - width / 2 : x - width);
    const top = Math.round(y);
    if (outline) {
      for (let i = 0; i < OUTLINE.length; i++) this.draw(this.ctx, text, left + OUTLINE[i][0], top + OUTLINE[i][1], SHADOW, scale, tight);
    } else if (shadow) this.draw(this.ctx, text, left + 1, top + 1, SHADOW, scale, tight);
    this.draw(this.ctx, text, left, top, color, scale, tight);
  }

  /**
   * Pixel text baked into a new canvas: a vertical gradient through
   * `stops`, an optional forward lean and a dark outline. Callers cache the
   * result (it allocates); null until the font has loaded.
   */
  styledText(text: string, options: StyleOptions): HTMLCanvasElement | null {
    if (!this.font) return null;
    const { scale = 1, stops, italic = 0, outline = 1, outlineColor = SHADOW, tight = true } = options;
    const w = Math.max(1, this.textWidth(text, scale, tight));
    const h = 7 * scale;
    const plain = makeCanvas(w, h);
    this.draw(plain.ctx, text, 0, 0, '#ffffff', scale, tight);
    gradientFill(plain.canvas, stops);
    let body = plain.canvas;
    if (italic > 0) {
      const lean = Math.floor((h - 1) / italic);
      const sheared = makeCanvas(w + lean, h);
      for (let y = 0; y < h; y++) sheared.ctx.drawImage(plain.canvas, 0, y, w, 1, lean - Math.floor(y / italic), y, w, 1);
      body = sheared.canvas;
    }
    return outlined(body, outlineColor, outline);
  }

  /**
   * A word in a heavy italic canvas font, thresholded so its pixels stay
   * hard, filled with a gradient and outlined: the mockup's brush lettering
   * (RAGE, WIPEOUT, PAUSED, trick text). `squeeze` below 1 narrows the
   * letters without making them shorter, so a long word fits a narrow slot
   * and stays legible. Allocates; callers cache it.
   */
  heavyText(text: string, px: number, stops: Stops, outline = 1, outlineColor = SHADOW, squeeze = 1): HTMLCanvasElement {
    const font = heavyFont(px);
    const w = Math.ceil(heavyWidth(text, px) * squeeze + px * 0.7);
    const h = Math.ceil(px * 1.2);
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    // A little extra shear on top of the italic, for the mockup's forward lean.
    ctx.setTransform(squeeze, 0, -0.12, 1, px * 0.15, 0);
    ctx.fillText(text, 1, Math.round(px * 0.95));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    hardenAlpha(canvas);
    const box = inkBox(canvas);
    const trimmed = makeCanvas(box.w, box.h);
    trimmed.ctx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    gradientFill(trimmed.canvas, stops);
    return outlined(trimmed.canvas, outlineColor, outline);
  }

  private advance(code: number): number {
    if (code === 32) return 4;
    const index = glyphIndex(code);
    return index < 0 ? 0 : this.widths[index] + 1;
  }

  private draw(ctx: CanvasRenderingContext2D, text: string, left: number, top: number, color: string, scale: number, tight: boolean): void {
    const sheet = this.sheet(color);
    if (!sheet) return;
    let x = left;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const index = glyphIndex(code);
      if (index >= 0 && code !== 32) {
        const sx = (index % PER_ROW) * GLYPH;
        const sy = Math.floor(index / PER_ROW) * GLYPH;
        ctx.drawImage(sheet, sx, sy, GLYPH, GLYPH, x, top, GLYPH * scale, GLYPH * scale);
      }
      x += (tight ? this.advance(code) : GLYPH) * scale;
    }
  }

  /** The font sheet plus the extra glyphs, and every glyph's inked width. */
  private buildSheet(font: HTMLImageElement): HTMLCanvasElement {
    const { canvas, ctx } = makeCanvas(PER_ROW * GLYPH, 4 * GLYPH);
    ctx.drawImage(font, 0, 0);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < EXTRA_CHARS.length; i++) {
      const rows = EXTRA_GLYPHS[EXTRA_CHARS[i]];
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === '#') ctx.fillRect(i * GLYPH + x, 3 * GLYPH + y, 1, 1);
    }
    const data = readPixels(canvas).data;
    for (let index = 0; index < 4 * PER_ROW; index++) {
      const sx = (index % PER_ROW) * GLYPH;
      const sy = Math.floor(index / PER_ROW) * GLYPH;
      let right = -1;
      for (let y = 0; y < GLYPH; y++) for (let x = 0; x < GLYPH; x++) if (data[((sy + y) * canvas.width + sx + x) * 4 + 3] > 0) right = Math.max(right, x);
      this.widths[index] = right + 1;
    }
    return canvas;
  }

  /** The font sheet recoloured, cached per colour. */
  private sheet(color: string): HTMLCanvasElement | null {
    if (!this.font) return null;
    let sheet = this.tints.get(color);
    if (sheet) return sheet;
    const tinted = makeCanvas(this.font.width, this.font.height);
    tinted.ctx.drawImage(this.font, 0, 0);
    tinted.ctx.globalCompositeOperation = 'source-in';
    tinted.ctx.fillStyle = color;
    tinted.ctx.fillRect(0, 0, tinted.canvas.width, tinted.canvas.height);
    sheet = tinted.canvas;
    this.tints.set(color, sheet);
    return sheet;
  }
}

const heavyFont = (px: number): string => `italic 900 ${px}px "Arial Black", "Arial Bold", Impact, "Helvetica Neue", Arial, sans-serif`;
let probe: CanvasRenderingContext2D | null = null;

/** The advance width of `text` in heavyText's font at `px` (no outline or lean): cheap, for fitting text before baking it. */
export function heavyWidth(text: string, px: number): number {
  probe ??= makeCanvas(1, 1).ctx;
  probe.font = heavyFont(px);
  return probe.measureText(text).width;
}

/** The bounding box of a canvas's opaque pixels. */
function inkBox(canvas: HTMLCanvasElement): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const d = readPixels(canvas).data;
  let x0 = canvas.width;
  let y0 = canvas.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      if (d[(y * canvas.width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
