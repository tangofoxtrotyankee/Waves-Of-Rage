import { FONT_CHARS } from '../../game/constants';
import { hex } from './math';

const GLYPH = 8;
const PER_ROW = 16;
const SHADOW = '#1a0b2e';
const OUTLINE: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 2], [1, 2]];

export interface TextOptions {
  align?: 'left' | 'center' | 'right';
  scale?: number;
  shadow?: boolean;
  /** Draw a 1px dark outline all round (big floating text, labels over the water). */
  outline?: boolean;
}

/**
 * The 2D overlay: a canvas at the internal resolution drawn with the
 * original game's 8x8 pixel font (public/assets/sprites/font.png, white
 * glyphs, tinted per colour here), so HUD pixels are the same size as world
 * pixels. Upper-case only; characters outside the font are skipped.
 */
export class Hud2D {
  readonly width: number;
  readonly height: number;
  private readonly ctx: CanvasRenderingContext2D;
  private font: HTMLImageElement | null = null;
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
      this.font = font;
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

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = hex(color);
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    this.ctx.globalAlpha = 1;
  }

  /** A dark panel with a coloured 1px frame, the HUD's box style. */
  panel(x: number, y: number, w: number, h: number, frame: number, alpha = 0.7): void {
    this.rect(x, y, w, h, 0x1a0b2e, alpha);
    this.frame(x, y, w, h, frame);
  }

  frame(x: number, y: number, w: number, h: number, color: number): void {
    this.ctx.strokeStyle = hex(color);
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

  circle(x: number, y: number, r: number, color: number, alpha = 1): void {
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = hex(color);
    this.ctx.beginPath();
    this.ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.globalAlpha = 1;
  }

  ring(x: number, y: number, r: number, color: number, width = 2): void {
    this.ctx.strokeStyle = hex(color);
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    this.ctx.arc(Math.round(x), Math.round(y), r, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  image(key: string, x: number, y: number, scale = 1): void {
    const img = this.images.get(key);
    if (!img || !img.complete || img.naturalWidth === 0) return;
    this.ctx.drawImage(img, Math.round(x), Math.round(y), Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
  }

  textWidth(text: string, scale = 1): number {
    return text.length * GLYPH * scale;
  }

  /** Draw upper-case pixel text; `x` is the left, centre or right edge per `align`. */
  text(x: number, y: number, text: string, color = '#ffffff', options: TextOptions = {}): void {
    if (!this.font) return;
    const { align = 'left', scale = 1, shadow = true, outline = false } = options;
    const upper = text.toUpperCase();
    const width = this.textWidth(upper, scale);
    const left = Math.round(align === 'left' ? x : align === 'center' ? x - width / 2 : x - width);
    const top = Math.round(y);
    if (outline) {
      for (const [dx, dy] of OUTLINE) this.draw(upper, left + dx, top + dy, SHADOW, scale);
    } else if (shadow) this.draw(upper, left + 1, top + 1, SHADOW, scale);
    this.draw(upper, left, top, color, scale);
  }

  private draw(text: string, left: number, top: number, color: string, scale: number): void {
    const sheet = this.sheet(color);
    if (!sheet) return;
    const size = GLYPH * scale;
    for (let i = 0; i < text.length; i++) {
      const index = FONT_CHARS.indexOf(text[i]);
      if (index < 0) continue;
      const sx = (index % PER_ROW) * GLYPH;
      const sy = Math.floor(index / PER_ROW) * GLYPH;
      this.ctx.drawImage(sheet, sx, sy, GLYPH, GLYPH, left + i * size, top, size, size);
    }
  }

  /** The font sheet recoloured, cached per colour. */
  private sheet(color: string): HTMLCanvasElement | null {
    if (!this.font) return null;
    let sheet = this.tints.get(color);
    if (sheet) return sheet;
    sheet = document.createElement('canvas');
    sheet.width = this.font.naturalWidth;
    sheet.height = this.font.naturalHeight;
    const ctx = sheet.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(this.font, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    this.tints.set(color, sheet);
    return sheet;
  }
}
