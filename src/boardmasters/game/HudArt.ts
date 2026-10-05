import { gradientFill, hardenAlpha, type Hud2D, makeCanvas, outlined, type Stops } from '../engine/Hud2D';
import { mulberry32 } from '../engine/math';

/**
 * The HUD's pixel art, painted once into small canvases at start-up (or on
 * first use, for anything that needs the font) and then only blitted:
 * brushed panels, the chunky digits, the RAGE bar's segments, the icons
 * and the hit sparks. Colours are
 * the mockup's, kept here rather than in PALETTE (the world's).
 */
export const HUD_COLORS = {
  ink: '#0d0820',
  panel: '#120c2a',
  label: '#e9ecff',
  dim: '#a9a3c8',
  gold: ['#fff7b0', '#ffe14d', '#ffc21a', '#ff9a12'] as Stops,
  white: ['#ffffff', '#ffffff', '#e4ecff', '#b9c8ea'] as Stops,
  red: ['#ffd0d8', '#ff6a7f', '#ff2e4d', '#b3122f'] as Stops,
  cyan: ['#ffffff', '#b8fbff', '#5fe3ff', '#2a9dff'] as Stops,
  rage: ['#fff27a', '#ffd23a', '#ff9a1f', '#ff5a1f', '#e8203a'] as Stops,
  rageHot: ['#ffffff', '#ffe0f0', '#ff8fd0', '#ff4fa3', '#e8203a'] as Stops,
  wipeout: ['#ffe0e6', '#ff8a9a', '#ff3a55', '#d0103a', '#8a0a2a'] as Stops,
  green: ['#ffffff', '#d0ffe4', '#6cf2a8', '#22b878'] as Stops,
  silver: ['#ffffff', '#eef2fc', '#bcc6dc', '#7c86a4'] as Stops,
  bronze: ['#fff0dc', '#ffc184', '#e0843e', '#93491c'] as Stops,
} as const;

type Ctx = CanvasRenderingContext2D;

/** A pixel disc on a sprite canvas. */
function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  for (let dy = -r; dy < r; dy++) {
    const half = Math.round(Math.sqrt(r * r - (dy + 0.5) * (dy + 0.5)));
    ctx.fillRect(cx - half, cy + dy, half * 2, 1);
  }
  ctx.globalAlpha = 1;
}

/** A pixel ring `width` pixels thick inside radius `r`. */
function ring(ctx: Ctx, cx: number, cy: number, r: number, width: number, color: string, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const inner = r - width;
  for (let dy = -r; dy < r; dy++) {
    const yy = (dy + 0.5) * (dy + 0.5);
    const outer = Math.round(Math.sqrt(r * r - yy));
    const hole = yy < inner * inner ? Math.round(Math.sqrt(inner * inner - yy)) : 0;
    ctx.fillRect(cx - outer, cy + dy, outer - hole, 1);
    ctx.fillRect(cx + hole, cy + dy, outer - hole, 1);
  }
  ctx.globalAlpha = 1;
}

/** Paint an ASCII map: each character a colour from `colors`, '.' transparent. */
export function paint(map: readonly string[], colors: Record<string, string>): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(map[0].length, map.length);
  for (let y = 0; y < map.length; y++)
    for (let x = 0; x < map[y].length; x++) {
      const c = colors[map[y][x]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  return canvas;
}

export interface BrushOptions {
  /** Pixels the top row sits right of the bottom row (the forward lean). */
  slant?: number;
  /** Up to this many pixels bitten out of each row's ends. */
  ragged?: number;
  seed?: number;
  /** A lighter first row (the yellow menu rows' highlight). */
  highlight?: string;
  /** A darker last row. */
  shade?: string;
}

/** A slanted panel with brush-stroke ends, like the mockup's HUD boxes and menu rows. */
export function brushPanel(w: number, h: number, color: string, alpha: number, options: BrushOptions = {}): HTMLCanvasElement {
  const { slant = Math.round(h / 4), ragged = 3, seed = 1, highlight, shade } = options;
  const { canvas, ctx } = makeCanvas(w, h);
  const rng = mulberry32(seed * 7919 + w * 31 + h);
  for (let y = 0; y < h; y++) {
    const lean = Math.round((slant * (h - 1 - y)) / Math.max(1, h - 1));
    // Brush ends: mostly a little bitten, now and then a streak running past the edge.
    const streak = rng() < 0.18 ? 2 : 0;
    const x0 = lean + Math.floor(rng() * ragged) - streak;
    const x1 = w - (slant - lean) - Math.floor(rng() * ragged) + (rng() < 0.18 ? 2 : 0);
    ctx.globalAlpha = alpha * (0.88 + rng() * 0.12);
    ctx.fillStyle = y === 0 && highlight ? highlight : y === h - 1 && shade ? shade : color;
    ctx.fillRect(Math.max(0, x0), y, Math.min(w, x1) - Math.max(0, x0), 1);
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/** Parallelogram cells: `n` slanted segments across `w`, each filled by `fill(i)`. */
function segments(ctx: Ctx, x: number, y: number, w: number, h: number, n: number, slant: number, fill: (i: number, row: number) => string | null): void {
  const gap = 1;
  const cell = (w - slant - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    const cx = x + i * (cell + gap);
    for (let row = 0; row < h; row++) {
      const color = fill(i, row);
      if (!color) continue;
      ctx.fillStyle = color;
      const lean = Math.round((slant * (h - 1 - row)) / Math.max(1, h - 1));
      ctx.fillRect(Math.round(cx + lean), y + row, Math.round(cx + cell + lean) - Math.round(cx + lean), 1);
    }
  }
}

const mixHex = (a: string, b: string, t: number): string => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};

/** The colour along the RAGE gradient at `t` (0 gold .. 1 red). */
function rageColor(t: number): string {
  const stops = ['#ffe14d', '#ffb21f', '#ff7a1f', '#ff3a2a', '#e8203a'];
  const f = Math.min(0.999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(f);
  return mixHex(stops[i], stops[i + 1], f - i);
}

/** A segmented, slanted bar: the background with empty cells, the full fill, and a white-hot flash of it. */
export function segmentBar(
  w: number,
  h: number,
  n: number,
  slant: number,
): {
  empty: HTMLCanvasElement;
  full: HTMLCanvasElement;
  hot: HTMLCanvasElement;
} {
  const pad = 2;
  const empty = brushPanel(w + pad * 2 + 4, h + pad * 2, HUD_COLORS.panel, 0.85, { slant: slant + 1, ragged: 3, seed: 5 });
  const ectx = empty.getContext('2d') as Ctx;
  segments(ectx, pad + 2, pad, w, h, n, slant, (_i, row) => (row === 0 ? '#3a3158' : '#262040'));
  const make = (hot: boolean) => {
    const { canvas, ctx } = makeCanvas(w + pad * 2 + 4, h + pad * 2);
    segments(ctx, pad + 2, pad, w, h, n, slant, (i, row) => {
      const base = hot ? mixHex(rageColor(i / (n - 1)), '#ffe0f0', 0.4) : rageColor(i / (n - 1));
      if (row === 0) return mixHex(base, '#ffffff', 0.5);
      if (row === h - 1) return mixHex(base, '#3a0010', 0.35);
      return base;
    });
    return canvas;
  };
  return { empty, full: make(false), hot: make(true) };
}

/** Small slanted stat bar (title screen): `n` cells, the first `filled` lit in `color`. */
export function statBar(n: number, filled: number, color: string): HTMLCanvasElement {
  const cellW = 5;
  const h = 6;
  const { canvas, ctx } = makeCanvas(n * (cellW + 1) + 3, h);
  segments(ctx, 0, 0, n * (cellW + 1) + 2, h, n, 2, (i, row) => (i < filled ? (row === 0 ? mixHex(color, '#ffffff', 0.5) : color) : row === 0 ? '#3a3158' : '#1e1836'));
  return canvas;
}

/** The health bar's fills, left to right: cyan-green while healthy, gold when low, red when nearly gone. */
const HEALTH_FILLS = {
  good: ['#1fc48e', '#36dca8', '#4ff0c4', '#6ff8e4', '#8ffcff'],
  warn: ['#ff9a12', '#ffb21f', '#ffc83a', '#ffd84a', '#ffe66a'],
  low: ['#a8102a', '#d01834', '#ff2e4d', '#ff4a62', '#ff6a7f'],
} as const;

export interface HealthBarArt {
  empty: HTMLCanvasElement;
  good: HTMLCanvasElement;
  warn: HTMLCanvasElement;
  low: HTMLCanvasElement;
  /** White-hot (a heal sweeps it in) and solid red (the flash as a blow lands). */
  hot: HTMLCanvasElement;
  flash: HTMLCanvasElement;
  /** Pixels from the sprites' left edge to the bar's first column, and the bar's drawn width. */
  inset: number;
  w: number;
}

/**
 * The HEALTH bar: `n` chunky slanted cells across `w` (like the RAGE bar,
 * shorter), in a dark well. Each fill is a whole bar, blitted cut to the
 * health left; the cells shade lighter on top and darker underneath.
 */
export function healthBar(w: number, h: number, n: number, slant: number): HealthBarArt {
  const inset = 1;
  const make = (fill: (i: number, row: number) => string | null) => {
    const { canvas, ctx } = makeCanvas(w + inset * 2, h + 2);
    segments(ctx, inset, 1, w, h, n, slant, fill);
    return canvas;
  };
  const tone = (stops: readonly string[]) => (i: number, row: number) => {
    const base = stops[Math.min(stops.length - 1, Math.round((i / Math.max(1, n - 1)) * (stops.length - 1)))];
    if (row === 0) return mixHex(base, '#ffffff', 0.55);
    if (row === 1) return mixHex(base, '#ffffff', 0.2);
    if (row === h - 1) return mixHex(base, '#0d0820', 0.4);
    return base;
  };
  // The well: the empty cells, each ringed in ink (the fills sit inside the ring).
  const cells = make((_i, row) => (row === 0 ? '#3a3158' : '#231d3c'));
  const ink = make(() => HUD_COLORS.ink);
  const { canvas: empty, ctx } = makeCanvas(w + inset * 2, h + 2);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) ctx.drawImage(ink, dx, dy);
  ctx.drawImage(cells, 0, 0);
  return {
    empty,
    good: make(tone(HEALTH_FILLS.good)),
    warn: make(tone(HEALTH_FILLS.warn)),
    low: make(tone(HEALTH_FILLS.low)),
    hot: make((_i, row) => (row === h - 1 ? '#d8fff4' : '#ffffff')),
    flash: make((_i, row) => (row === 0 ? '#ffd0d8' : '#ff2e4d')),
    inset,
    w,
  };
}

/**
 * Chunky 6x9 digits with 2px strokes (the mockup's POS, DIST and SCORE
 * values), baked with a two-tone gradient and a 1px outline, one sheet per
 * colour. The font sheet's 5x7 glyphs at scale 2 would be too wide for four
 * panels across a 240px screen.
 */
const BIG_GLYPHS: Record<string, string[]> = {
  '0': ['.####.', '##..##', '##..##', '##.###', '###.##', '##..##', '##..##', '##..##', '.####.'],
  '1': ['..##..', '.###..', '####..', '..##..', '..##..', '..##..', '..##..', '..##..', '######'],
  '2': ['.####.', '##..##', '....##', '....##', '...##.', '..##..', '.##...', '##....', '######'],
  '3': ['.####.', '##..##', '....##', '..###.', '....##', '....##', '....##', '##..##', '.####.'],
  '4': ['...##.', '..###.', '.####.', '##.##.', '##.##.', '######', '...##.', '...##.', '...##.'],
  '5': ['######', '##....', '##....', '#####.', '....##', '....##', '....##', '##..##', '.####.'],
  '6': ['.####.', '##..##', '##....', '#####.', '##..##', '##..##', '##..##', '##..##', '.####.'],
  '7': ['######', '....##', '....##', '...##.', '...##.', '..##..', '..##..', '..##..', '..##..'],
  '8': ['.####.', '##..##', '##..##', '.####.', '##..##', '##..##', '##..##', '##..##', '.####.'],
  '9': ['.####.', '##..##', '##..##', '##..##', '.#####', '....##', '....##', '##..##', '.####.'],
  '/': ['....##', '....##', '...##.', '...##.', '..##..', '..##..', '.##...', '.##...', '##....'],
  ',': ['...', '...', '...', '...', '...', '...', '.##', '.##', '##.'],
  '.': ['..', '..', '..', '..', '..', '..', '..', '##', '##'],
  ':': ['..', '..', '##', '##', '..', '..', '##', '##', '..'],
  '%': ['##..##', '##..##', '...##.', '...##.', '..##..', '.##...', '.##...', '##..##', '##..##'],
  ' ': ['...', '...', '...', '...', '...', '...', '...', '...', '...'],
};
const BIG_CHARS = Object.keys(BIG_GLYPHS);
const BIG_INDEX = new Int8Array(128).fill(-1);
BIG_CHARS.forEach((c, i) => (BIG_INDEX[c.charCodeAt(0)] = i));
const BIG_H = 9;
const BIG_CELL = 8;

export class BigDigits {
  /** Height of a drawn line including the outline. */
  static readonly height = BIG_H + 2;
  /** One baked sheet per gradient (keyed by the stops array itself, so lookups build no string). */
  private readonly sheets = new Map<Stops, HTMLCanvasElement>();

  /** Width of `text` as drawn (characters it lacks count as nothing). */
  width(text: string): number {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      const index = BIG_INDEX[text.charCodeAt(i)] ?? -1;
      if (index >= 0) w += BIG_GLYPHS[BIG_CHARS[index]][0].length + 1;
    }
    return w > 0 ? w + 1 : 0;
  }

  /** Draw `text` with its left (or right, or centre) edge at x and its top at y. */
  draw(hud: Hud2D, text: string, x: number, y: number, stops: Stops, align: 'left' | 'center' | 'right' = 'left', alpha = 1): void {
    const sheet = this.sheet(stops);
    const w = this.width(text);
    let left = Math.round(align === 'left' ? x : align === 'center' ? x - w / 2 : x - w);
    for (let i = 0; i < text.length; i++) {
      const index = BIG_INDEX[text.charCodeAt(i)] ?? -1;
      if (index < 0) continue;
      const gw = BIG_GLYPHS[BIG_CHARS[index]][0].length;
      hud.blitPart(sheet, index * BIG_CELL, 0, gw + 2, BIG_H + 2, left, y, alpha);
      left += gw + 1;
    }
  }

  private sheet(stops: Stops): HTMLCanvasElement {
    let sheet = this.sheets.get(stops);
    if (sheet) return sheet;
    const { canvas, ctx } = makeCanvas(BIG_CHARS.length * BIG_CELL, BIG_H + 2);
    // Each glyph with its 1px outline in its own cell; drawn glyphs overlap by that outline column only, never a fill.
    BIG_CHARS.forEach((c, i) => {
      const fill = paint(BIG_GLYPHS[c], { '#': '#ffffff' });
      gradientFill(fill, stops);
      ctx.drawImage(outlined(fill, HUD_COLORS.ink, 1, 0), i * BIG_CELL, 0);
    });
    sheet = canvas;
    this.sheets.set(stops, sheet);
    return sheet;
  }
}

/** Small 3x5 digits for the race clock under DIST (with a 1px outline, one sheet per colour). */
const MINI_GLYPHS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  ':': ['.', '#', '.', '#', '.'],
  '.': ['.', '.', '.', '.', '#'],
};
const MINI_CHARS = Object.keys(MINI_GLYPHS);
const MINI_INDEX = new Int8Array(128).fill(-1);
MINI_CHARS.forEach((c, i) => (MINI_INDEX[c.charCodeAt(0)] = i));
const MINI_CELL = 6;

export class MiniDigits {
  static readonly height = 7;
  private readonly sheets = new Map<string, HTMLCanvasElement>();

  width(text: string): number {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      const index = MINI_INDEX[text.charCodeAt(i)] ?? -1;
      if (index >= 0) w += MINI_GLYPHS[MINI_CHARS[index]][0].length + 1;
    }
    return w > 0 ? w + 1 : 0;
  }

  draw(hud: Hud2D, text: string, x: number, y: number, color: string, align: 'left' | 'right' = 'left'): void {
    let sheet = this.sheets.get(color);
    if (!sheet) {
      const { canvas, ctx } = makeCanvas(MINI_CHARS.length * MINI_CELL, MiniDigits.height);
      MINI_CHARS.forEach((c, i) => ctx.drawImage(outlined(paint(MINI_GLYPHS[c], { '#': color }), HUD_COLORS.ink, 1, 0), i * MINI_CELL, 0));
      sheet = canvas;
      this.sheets.set(color, sheet);
    }
    let left = align === 'left' ? x : x - this.width(text);
    for (let i = 0; i < text.length; i++) {
      const index = MINI_INDEX[text.charCodeAt(i)] ?? -1;
      if (index < 0) continue;
      const gw = MINI_GLYPHS[MINI_CHARS[index]][0].length;
      hud.blitPart(sheet, index * MINI_CELL, 0, gw + 2, MiniDigits.height, left, y);
      left += gw + 1;
    }
  }
}

/** A small gold cup (the title's BEST row). */
export function trophyIcon(): HTMLCanvasElement {
  return outlined(
    paint(['YYYYYYY', 'YLYYYOY', '.YLYYO.', '..YYO..', '...O...', '..YYY..', '.OOOOO.'], { Y: '#ffe14d', L: '#fff7b0', O: '#c98a10' }),
    HUD_COLORS.ink,
    1,
    0,
  );
}

/** A gold star (a new best on a results row). */
export function starIcon(): HTMLCanvasElement {
  return outlined(paint(['...Y...', '..YYY..', 'YYYLYYY', '.YYYYY.', '..YOY..', '.YO.OY.', 'O.....O'], { Y: '#ffe14d', L: '#ffffff', O: '#c98a10' }), HUD_COLORS.ink, 1, 0);
}

/**
 * The warning over a rival winding up a punch at the surfer: a red comic
 * burst with a fat "!" in it; `bright` is the flash frame (a white-hot burst).
 */
export function warnIcon(bright: boolean): HTMLCanvasElement {
  const canvas = burst(21, 9, 10.4, 6.6, bright ? '#ffe14d' : '#ff2e4d');
  const ctx = canvas.getContext('2d') as Ctx;
  ctx.drawImage(burst(21, 9, 7.6, 4.8, bright ? '#ffffff' : '#ff6a55'), 0, 0);
  const mark = outlined(paint(['WWW', 'WWW', 'WWW', 'WWW', '.W.', '.W.', '...', 'WWW', 'WWW'], { W: bright ? '#ff2e4d' : '#ffffff' }), HUD_COLORS.ink, 1, 0);
  ctx.drawImage(mark, Math.round((21 - mark.width) / 2), Math.round((21 - mark.height) / 2));
  return outlined(canvas, HUD_COLORS.ink, 1, 0);
}

/** A jagged starburst, hard-edged. */
function burst(size: number, spikes: number, outer: number, inner: number, color: string): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = color;
  ctx.beginPath();
  const c = size / 2;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2 + 0.2;
    const r = i % 2 === 0 ? outer : inner;
    if (i === 0) ctx.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    else ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  hardenAlpha(canvas, 140);
  return canvas;
}

/** The pause button for touch screens: a small dark disc with two bars. */
export function pauseArt(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(18, 18);
  disc(ctx, 9, 9, 9, HUD_COLORS.ink, 0.55);
  disc(ctx, 9, 9, 8, '#141a33', 0.6);
  ring(ctx, 9, 9, 9, 1, '#c8d2e8', 0.9);
  ctx.fillStyle = '#eef2ff';
  ctx.fillRect(6, 5, 2, 8);
  ctx.fillRect(10, 5, 2, 8);
  return canvas;
}

/** Frames in a hit spark (HudView plays them over Run's SPARK_SECONDS). */
export const SPARK_FRAMES = 6;

/** A filled star: `n` points between radius `r` and `inner`, turned by `turn`. */
function star(ctx: Ctx, cx: number, cy: number, r: number, inner: number, n: number, turn: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = turn + (i / (n * 2)) * Math.PI * 2;
    const k = i % 2 === 0 ? r : inner;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * k, cy + Math.sin(a) * k);
    else ctx.lineTo(cx + Math.cos(a) * k, cy + Math.sin(a) * k);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * One frame of the hit spark, `size` pixels across: a comic impact star
 * where a blow lands, like the ATTACK icon's. A white pop, a spiky
 * white-gold-orange star at full size, then its rays flying apart and a
 * last scatter of sparks. Hard-edged and outlined in the HUD's ink.
 */
export function hitSparkFrame(frame: number, size: number): HTMLCanvasElement {
  const S = Math.max(8, Math.round(size));
  const { canvas, ctx } = makeCanvas(S + 4, S + 4, true); // read back by hardenAlpha: CPU-backed
  const c = (S + 4) / 2;
  const R = S / 2;
  const turn = 0.2 + frame * 0.13;
  const spikes = 8;
  if (frame === 0) {
    star(ctx, c, c, R * 0.55, R * 0.25, spikes, turn, '#ffffff');
  } else if (frame <= 2) {
    const r = frame === 1 ? R * 0.85 : R;
    star(ctx, c, c, r, r * 0.42, spikes, turn, '#ff7a1e');
    star(ctx, c, c, r * 0.74, r * 0.34, spikes, turn + 0.12, '#ffe14d');
    star(ctx, c, c, r * 0.44, r * 0.22, spikes, turn + 0.3, '#ffffff');
  } else if (frame <= 4) {
    // The rays break away from the middle and fly out.
    const from = frame === 3 ? 0.4 : 0.66;
    ctx.lineCap = 'round';
    for (let i = 0; i < spikes; i++) {
      const a = turn + (i / spikes) * Math.PI * 2;
      ctx.strokeStyle = frame === 3 ? '#ffe14d' : '#ffffff';
      ctx.lineWidth = Math.max(2, Math.round(S / (frame === 3 ? 9 : 13)));
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * R * from, c + Math.sin(a) * R * from);
      ctx.lineTo(c + Math.cos(a) * R * (from + 0.42), c + Math.sin(a) * R * (from + 0.42));
      ctx.stroke();
    }
    if (frame === 3) star(ctx, c, c, R * 0.3, R * 0.16, spikes, turn, '#ffffff');
  } else {
    for (let i = 0; i < spikes; i++) {
      const a = turn + 0.2 + (i / spikes) * Math.PI * 2;
      disc(ctx, Math.round(c + Math.cos(a) * R * 0.98), Math.round(c + Math.sin(a) * R * 0.98), Math.max(1, Math.round(S / 22)), '#ffe9a0');
    }
  }
  hardenAlpha(canvas, 128);
  return outlined(canvas, HUD_COLORS.ink, 1, 0);
}
