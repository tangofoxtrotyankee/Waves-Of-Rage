import { type Hud2D, hardenAlpha, makeCanvas, outlined, type Stops } from '../engine/Hud2D';
import { TOUCH_BUTTONS } from '../engine/TouchButtons';
import { KEY_LABELS } from './Combos';
import { CHARACTER_ORDER } from './characters';
import { IS_PORTRAIT, SCORING } from './constants';
import { BigDigits, brushPanel, type ButtonArt, buttonArt, captionPill, HUD_COLORS, hearts, pauseArt, segmentBar, statBar, stripMarkers } from './HudArt';
import { PAUSE_ZONE, TITLE, titleArrowX } from './HudLayout';
import type { FloatingText, Run } from './Run';

/** How long a floating text lives (Run drops it after 1.3 s); it fades over the last part. */
const FLOAT_LIFE = 1.3;
const FLOAT_FADE = 0.3;
const FLOAT_POP = 0.14;
/** Floating texts stay below the top bar, the RAGE row and the combo. */
const FLOAT_TOP = 64;
/** The course strip shows this many metres ahead of the surfer, and a little behind. */
const STRIP_AHEAD = 220;
const STRIP_BEHIND = 24;
/** Distance milestones on the endless course, shown as the strip's flag. */
const MILESTONE = 500;
const BIG = new BigDigits();
/** Text option objects shared by every call (no per-frame allocation). */
const TIGHT = { tight: true } as const;
const TIGHT_RIGHT = { tight: true, align: 'right' } as const;
const TIGHT_CENTER = { tight: true, align: 'center' } as const;
const TIGHT_OUTLINE = { tight: true, outline: true } as const;
const TIGHT_CENTER_OUTLINE = {
  tight: true,
  align: 'center',
  outline: true,
} as const;
const INK = { tight: true, shadow: false } as const;
const INK_BIG = { tight: true, scale: 2, shadow: false } as const;
const INK_RIGHT = { tight: true, align: 'right', shadow: false } as const;
const ARROW = { align: 'center', scale: 2, outline: true } as const;
const STAT_LABELS = IS_PORTRAIT ? ['SPD', 'TRN', 'PWR', 'RGE'] : ['SPEED', 'TURN', 'POWER', 'RAGE'];
const STAT_COLORS = ['#5fe3ff', '#5fe3ff', '#5fe3ff', '#ff4d6d'];
const CAPTION_EDGE: Record<string, string> = {
  attack: '#ff2e4d',
  barge: '#2a8cff',
  forward: '#ffc21a',
  jump: '#c8d2e8',
  carveLeft: '#9aa6c4',
};

/** Whole number with thousands separators ("12,480"). */
export function withCommas(value: number): string {
  const s = String(Math.max(0, Math.floor(value)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return out;
}

/** Formats a number only when it changes, so steady values cost no string per frame. */
class Memo {
  private value = Number.NaN;
  private text = '';
  constructor(private readonly format: (v: number) => string) {}
  get(value: number): string {
    const v = Math.floor(value);
    if (v !== this.value) {
      this.value = v;
      this.text = this.format(v);
    }
    return this.text;
  }
}

/** Gradient stops for a float's colour (Run passes the palette's hex strings). */
function stopsFor(color: string): Stops {
  switch (color.toLowerCase()) {
    case '#ffd166':
      return HUD_COLORS.gold;
    case '#ff4d6d':
      return HUD_COLORS.red;
    case '#7ff6ff':
      return HUD_COLORS.cyan;
    case '#ffffff':
      return HUD_COLORS.white;
    default:
      return ['#ffffff', color, color, color];
  }
}

/** Contact words get a comic impact burst behind them. */
const IMPACT = /^(HIT!|BARGE!|BUMP|SHOVED!|OUCH!)$/;
/** "NAME +250" or "NAME +1000 X2": the points go on their own line above the name. */
const POINTS = /^(.*?)\s*(\+\d+(?:\s+X\d+)?)$/;

/**
 * Everything on the 2D overlay, per the gameplay and title mockups: the
 * top bar (HEALTH, POS, DIST, SCORE), the RAGE lettering and segmented bar,
 * the course strip on the left edge, floating trick text beside the surfer,
 * the input trail, the touch buttons with icons and captions, the title's
 * menu rows and character select, and the pause and results panels.
 * Reads the run and changes nothing. Art is baked once (HudArt, or on first
 * use for anything that needs the pixel font) and blitted; the in-play path
 * allocates nothing per frame beyond a string when a shown number changes.
 */
export class HudView {
  private readonly hud: Hud2D;
  private readonly W: number;
  private readonly H: number;
  private readonly heartArt = hearts();
  private readonly marks = stripMarkers();
  private readonly pauseButton = pauseArt();
  private readonly buttons: ButtonArt[] = TOUCH_BUTTONS.map((b) => buttonArt(b));
  private readonly captions: (HTMLCanvasElement | null)[] = TOUCH_BUTTONS.map(() => null);
  private readonly floatArt = new WeakMap<FloatingText, HTMLCanvasElement>();
  /** Panels and other art by a fixed key (literal strings only, so lookups allocate nothing). */
  private readonly panels = new Map<string, HTMLCanvasElement>();
  private readonly names = new Map<string, HTMLCanvasElement | null>();
  private readonly comboArt: (HTMLCanvasElement | null)[] = [];
  private readonly statArt: (HTMLCanvasElement | null)[] = [];
  private rageWord: HTMLCanvasElement | null = null;
  private rageHot: HTMLCanvasElement | null = null;
  private titles: {
    paused: HTMLCanvasElement;
    wipeout: HTMLCanvasElement;
    best: HTMLCanvasElement;
  } | null = null;
  private promptPill: HTMLCanvasElement | null = null;
  private readonly score = new Memo(withCommas);
  private readonly dist = new Memo((v) => String(v));
  private readonly bestScore = new Memo(withCommas);
  private readonly bestDist = new Memo((v) => `${v}M`);
  private readonly milestone = new Memo((v) => `${v}M`);
  private readonly small = new Memo((v) => String(v));
  private readonly kos = new Memo((v) => String(v));
  private readonly pauseLine = new Memo(() => `DIST ${this.dist.get(this.run.distance)}M   SCORE ${this.score.get(this.run.score)}`);
  private readonly field: string;
  /** Top bar panels: x and width each. */
  private readonly bar: {
    hx: number;
    hw: number;
    px: number;
    pw: number;
    dx: number;
    dw: number;
    sx: number;
    sw: number;
  };
  private readonly rage: {
    x: number;
    y: number;
    w: number;
    wordX: number;
    empty: HTMLCanvasElement;
    full: HTMLCanvasElement;
    hot: HTMLCanvasElement;
  };
  /** The course strip: box, and per frame the surfer's z and the scale (set in drawStrip). */
  private readonly strip: {
    x: number;
    y: number;
    h: number;
    playerY: number;
    perM: number;
    z: number;
  };

  constructor(private readonly run: Run) {
    this.hud = run.hud;
    this.W = this.hud.width;
    this.H = this.hud.height;
    this.hud.loadImage('logo-big', 'assets/boardmasters/logo-236x118.png');
    const W = this.W;
    this.field = `/${run.rivals.length + 1}`;
    // HEALTH and POS from the left, SCORE and DIST from the right, the pause button between (240 wide upright: 1/55/131/181).
    this.bar = IS_PORTRAIT
      ? { hx: 1, hw: 52, px: 55, pw: 38, dx: W - 109, dw: 48, sx: W - 59, sw: 58 }
      : { hx: 4, hw: 58, px: 66, pw: 44, dx: W - 130, dw: 56, sx: W - 70, sw: 66 };
    const barW = IS_PORTRAIT ? Math.min(132, W - 108) : 150;
    const barX = IS_PORTRAIT ? W - barW - 22 : Math.round(W / 2 - 40);
    this.rage = {
      x: barX,
      y: 30,
      w: barW,
      wordX: barX - 54,
      ...segmentBar(barW, 7, 10, 3),
    };
    const sy = IS_PORTRAIT ? 128 : 56;
    const sh = IS_PORTRAIT ? 186 : run.input.touch ? 96 : 160;
    const playerY = sy + sh - Math.round((STRIP_BEHIND / (STRIP_AHEAD + STRIP_BEHIND)) * sh);
    this.strip = {
      x: 4,
      y: sy,
      h: sh,
      playerY,
      perM: (playerY - sy - 4) / STRIP_AHEAD,
      z: 0,
    };
    const top = 25;
    this.bake('health', this.bar.hw, top, 1);
    this.bake('pos', this.bar.pw, top, 2);
    this.bake('dist', this.bar.dw, top, 3);
    this.bake('score', this.bar.sw, top, 4);
    this.panels.set(
      'strip',
      brushPanel(18, sh, HUD_COLORS.panel, 0.5, {
        slant: 0,
        ragged: 2,
        seed: 6,
      }),
    );
    this.panels.set(
      'menu',
      brushPanel(58, 16, HUD_COLORS.panel, 0.85, {
        slant: 3,
        seed: 3,
        shade: '#5fe3ff',
      }),
    );
  }

  draw(): void {
    const run = this.run;
    this.hud.clear();
    if (run.state === 'title') {
      this.drawTitle();
      return;
    }
    this.drawTopBar();
    if (run.state === 'wipeout') {
      this.drawResults();
      return;
    }
    this.drawRage();
    this.drawStrip();
    this.drawFloats();
    if (run.state === 'playing') {
      this.drawTrail();
      if (run.input.touch) this.drawButtons();
    }
    if (run.state === 'paused') this.drawPause();
  }

  // --- shared pieces -----------------------------------------------------------

  private bake(key: string, w: number, h: number, seed: number, color: string = HUD_COLORS.panel, alpha = 0.78, highlight?: string, shade?: string): HTMLCanvasElement {
    const panel = brushPanel(w, h, color, alpha, {
      seed,
      highlight,
      shade,
      slant: Math.max(2, Math.round(h / 4)),
    });
    this.panels.set(key, panel);
    return panel;
  }

  /** A baked panel by key, made on first use. */
  private panel(key: string, w: number, h: number, seed: number, color: string = HUD_COLORS.panel, alpha = 0.85, highlight?: string, shade?: string): HTMLCanvasElement {
    return this.panels.get(key) ?? this.bake(key, w, h, seed, color, alpha, highlight, shade);
  }

  private bigTitles(): {
    paused: HTMLCanvasElement;
    wipeout: HTMLCanvasElement;
    best: HTMLCanvasElement;
  } {
    return (this.titles ??= {
      paused: this.hud.heavyText('PAUSED', 24, HUD_COLORS.gold, 1),
      wipeout: this.hud.heavyText('WIPEOUT', 28, HUD_COLORS.wipeout, 1),
      best: this.hud.heavyText('NEW BEST!', 15, HUD_COLORS.gold, 1),
    });
  }

  /** The MENU corner on touch screens (the tap zone is MENU_ZONE, 80x32; the pill sits inside it). */
  private menuCorner(): void {
    if (!this.run.input.touch) return;
    this.hud.blit(this.panels.get('menu') as HTMLCanvasElement, 2, 3);
    this.hud.text(10, 7, '< MENU', '#b8fbff', TIGHT);
  }

  /** A yellow highlighted menu row with a dark caption, a bobbing arrow, and an optional hint at its right end. */
  private yellowRow(key: string, x: number, y: number, w: number, text: string, hint: string): void {
    this.hud.blit(this.panel(key, w, 16, 9, '#ffd23a', 1, '#fff3a0', '#c98a10'), x, y);
    const bob = Math.floor(this.run.time * 3) % 2;
    this.hud.text(x + 9 + bob, y + 4, '▶', HUD_COLORS.ink, INK);
    this.hud.text(x + 19, y + 1, text, HUD_COLORS.ink, INK_BIG);
    if (hint) this.hud.text(x + w - 10, y + 5, hint, '#6a4300', INK_RIGHT);
  }

  // --- in play -------------------------------------------------------------------

  private drawTopBar(): void {
    const run = this.run;
    const hud = this.hud;
    const b = this.bar;
    const top = 2;
    const valueY = top + 11;
    // HEALTH: big hearts, the lost ones dark; the one just lost flashes while invulnerable.
    // On touch screens the MENU corner takes its place outside play.
    if (!run.input.touch || run.state === 'playing') {
      hud.blit(this.panels.get('health') as HTMLCanvasElement, b.hx, top);
      hud.text(b.hx + 6, top + 2, 'HEALTH', HUD_COLORS.label, TIGHT);
      const flashing = run.time < run.invulnerableTill && Math.floor(run.time * 10) % 2 === 0;
      for (let i = 0; i < SCORING.startHealth; i++) {
        const sprite = i < run.health ? this.heartArt.full : i === run.health && flashing ? this.heartArt.flash : this.heartArt.empty;
        hud.blit(sprite, b.hx + 4 + i * 14, valueY - 1);
      }
    }
    // POS: the place big, the field size small.
    hud.blit(this.panels.get('pos') as HTMLCanvasElement, b.px, top);
    hud.text(b.px + 9, top + 2, 'POS', HUD_COLORS.label, TIGHT);
    const place = this.small.get(run.rank);
    BIG.draw(hud, place, b.px + 7, valueY, HUD_COLORS.gold);
    hud.text(b.px + 7 + BIG.width(place), valueY + 3, this.field, HUD_COLORS.label, TIGHT);
    // DIST: metres (the course is endless).
    hud.blit(this.panels.get('dist') as HTMLCanvasElement, b.dx, top);
    hud.text(b.dx + 9, top + 2, 'DIST', HUD_COLORS.label, TIGHT);
    const dist = this.dist.get(run.distance);
    const dWidth = BIG.width(dist);
    if (dWidth + 7 <= b.dw - 8) {
      BIG.draw(hud, dist, b.dx + 6, valueY, HUD_COLORS.white);
      hud.text(b.dx + 6 + dWidth, valueY + 3, 'M', HUD_COLORS.label, TIGHT);
    } else hud.text(b.dx + 6, valueY + 3, dist, HUD_COLORS.label, TIGHT);
    // SCORE: thousands separated.
    hud.blit(this.panels.get('score') as HTMLCanvasElement, b.sx, top);
    hud.text(b.sx + 9, top + 2, 'SCORE', HUD_COLORS.label, TIGHT);
    const score = this.score.get(run.score);
    if (BIG.width(score) <= b.sw - 8) BIG.draw(hud, score, b.sx + 5, valueY, HUD_COLORS.gold);
    else hud.text(b.sx + 5, valueY + 3, score, '#ffe14d', TIGHT);
    // The pause button on touch screens, at the top centre (PAUSE_ZONE).
    if (run.input.touch && run.state === 'playing') hud.blit(this.pauseButton, Math.round(this.W / 2 - 9), top + Math.round((PAUSE_ZONE.h - 18) / 2) + 2);
  }

  /** RAGE: the slanted lettering beside a segmented bar that pulses when nearly full and flashes while raging. */
  private drawRage(): void {
    const run = this.run;
    const hud = this.hud;
    const r = this.rage;
    const hot = run.raging && Math.floor(run.time * 8) % 2 === 0;
    this.rageWord ??= hud.heavyText('RAGE', 17, HUD_COLORS.rage, 1);
    this.rageHot ??= hud.heavyText('RAGE', 17, HUD_COLORS.rageHot, 1);
    const word = hot ? this.rageHot : this.rageWord;
    const shake = run.raging ? Math.round(Math.sin(run.time * 40)) : 0;
    hud.blit(word, r.wordX + shake, r.y + 5 - Math.round(word.height / 2));
    hud.blit(r.empty, r.x, r.y);
    const fill = Math.round((r.w - 3) * Math.max(0, Math.min(1, run.rage)));
    if (fill > 0) {
      hud.blitPart(hot ? r.hot : r.full, 0, 0, 4 + fill + 3, r.empty.height, r.x, r.y);
      // Nearly full: the bar breathes, asking to be filled.
      if (!run.raging && run.rage >= 0.75) hud.blitPart(r.hot, 0, 0, 4 + fill + 3, r.empty.height, r.x, r.y, (0.5 + 0.5 * Math.sin(run.time * 9)) * 0.6);
    }
    if (run.combo > 1 && run.time < run.comboUntil) {
      const n = run.combo;
      const combo = (this.comboArt[n] ??= hud.styledText(`COMBO X${n}`, { scale: 2, stops: HUD_COLORS.gold, italic: 6, outline: 1 }));
      if (combo) hud.blit(combo, Math.round(r.x + r.w / 2 - combo.width / 2), r.y + 15, 1, 1 + 0.15 * Math.max(0, Math.sin(run.time * 10)));
    }
  }

  private stripY(z: number): number {
    return Math.round(this.strip.playerY - (z - this.strip.z) * this.strip.perM);
  }

  private stripX(z: number, worldX: number): number {
    // A gentle wiggle anchored to the water, plus the lateral position (world +x is screen-left).
    return this.strip.x + 8 + Math.round(Math.sin(z * 0.021) * 3 + Math.sin(z * 0.0071 + 1) * 1.5) - Math.round(worldX / 12) * 2;
  }

  private inStrip(z: number): boolean {
    const dz = z - this.strip.z;
    return dz > -STRIP_BEHIND + 2 && dz < STRIP_AHEAD;
  }

  /** The course strip on the left edge: a dotted path with the buoys, gates and rivals ahead, the surfer as an arrow and the next milestone as a flag. */
  private drawStrip(): void {
    const run = this.run;
    const hud = this.hud;
    const s = run.surfer;
    const st = this.strip;
    st.z = s.z;
    hud.blit(this.panels.get('strip') as HTMLCanvasElement, st.x, st.y);
    // Dots anchored to the water, so they stream down as the surfer goes.
    const step = 5 / st.perM;
    for (let z = Math.ceil((s.z - STRIP_BEHIND) / step) * step; z < s.z + STRIP_AHEAD; z += step) {
      const py = this.stripY(z);
      if (py < st.y + 2 || py > st.y + st.h - 3) continue;
      hud.rect(this.stripX(z, 0), py, 2, 2, z < s.z ? 0x5a6a8a : 0x9fe8ff, 0.9);
    }
    const m = this.marks;
    for (const c of run.chevrons) if (c.active && this.inStrip(c.z)) hud.blit(m.gate, this.stripX(c.z, c.x) - 2, this.stripY(c.z) - 2);
    for (const b of run.buoys) if (b.active && !b.smashed && this.inStrip(b.z)) hud.blit(m.buoy, this.stripX(b.z, b.x) - 2, this.stripY(b.z) - 3);
    for (const r of run.rivals) if (!r.knockedOut && this.inStrip(r.z)) hud.blit(m.rival, this.stripX(r.z, r.x) - 2, this.stripY(r.z) - 3);
    // The next milestone: on the strip once in range, pinned to its top until then.
    const next = (Math.floor(run.distance / MILESTONE) + 1) * MILESTONE;
    const fy = Math.max(st.y + 1, this.stripY(next) - 8);
    hud.blit(m.flag, this.stripX(next, 0) - 1, fy);
    hud.text(st.x + 17, fy + 1, this.milestone.get(next), '#ffffff', TIGHT_OUTLINE);
    hud.blit(m.arrow, this.stripX(s.z, s.x) - 3, st.playerY - 4);
  }

  /** Floating trick text: big gradient lettering with a dark outline, popping in, stacked beside the surfer (newest lowest) and fading. */
  private drawFloats(): void {
    const list = this.run.floats;
    const anchorX = IS_PORTRAIT ? this.W - 4 : Math.round(this.W * 0.6);
    const baseY = Math.round(this.H * (IS_PORTRAIT ? 0.68 : 0.62));
    let stack = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      const c = this.floatArt.get(f) ?? this.bakeFloat(f);
      if (!c) continue;
      const pop = f.age < FLOAT_POP ? 1 + 0.6 * (1 - f.age / FLOAT_POP) ** 2 : 1;
      const alpha = Math.min(1, (FLOAT_LIFE - f.age) / FLOAT_FADE);
      const top = baseY - c.height - stack - Math.round(f.age * 10);
      if (top < FLOAT_TOP) break; // older texts give way rather than cover the RAGE row
      this.hud.blit(c, IS_PORTRAIT ? anchorX - c.width : anchorX, top, alpha, pop);
      stack += c.height + 1;
    }
  }

  private bakeFloat(f: FloatingText): HTMLCanvasElement | null {
    const hud = this.hud;
    const stops = stopsFor(f.color);
    const maxW = (IS_PORTRAIT ? this.W : this.W * 0.4) - 8;
    const line = (text: string, scale: number): HTMLCanvasElement | null => {
      const big = hud.styledText(text, { scale, stops, italic: scale > 1 ? 6 : 4, outline: 1 });
      if (!big || big.width <= maxW || scale === 1) return big;
      return hud.styledText(text, { scale: 1, stops, italic: 4, outline: 1 });
    };
    const match = POINTS.exec(f.text);
    let canvas: HTMLCanvasElement | null;
    if (match && match[1]) {
      // "+250" over "CARVE", like the mockup.
      const points = line(match[2], 2);
      const name = line(match[1], f.scale >= 2 ? 2 : 1);
      if (!points || !name) return null;
      const w = Math.max(points.width, name.width + 2);
      const made = makeCanvas(w, points.height + name.height - 2);
      made.ctx.drawImage(points, IS_PORTRAIT ? w - points.width : 0, 0);
      made.ctx.drawImage(name, IS_PORTRAIT ? w - name.width - 2 : 2, points.height - 2);
      canvas = made.canvas;
    } else {
      const impact = IMPACT.test(f.text);
      const text = line(f.text, f.scale >= 2 || impact ? 2 : 1);
      if (!text) return null;
      canvas = impact ? withBurst(text) : text;
    }
    this.floatArt.set(f, canvas);
    return canvas;
  }

  /** The combo reader's held presses, so moves can be learnt by watching. */
  private drawTrail(): void {
    const run = this.run;
    const recent = run.combos.recent(run.time);
    if (recent.length === 0) return;
    let trail = '';
    for (const k of recent) trail += (trail ? ' ' : '') + KEY_LABELS[k];
    const y = run.input.touch ? (IS_PORTRAIT ? 312 : this.H - 92) : this.H - 22;
    this.hud.text(this.W / 2, y, trail, '#b8fbff', TIGHT_CENTER_OUTLINE);
  }

  private drawButtons(): void {
    const run = this.run;
    const hud = this.hud;
    for (let i = 0; i < TOUCH_BUTTONS.length; i++) {
      const b = TOUCH_BUTTONS[i];
      const art = this.buttons[i];
      hud.blit(run.input.holding(b.id) ? art.down : art.up, b.x + art.offset, b.y + art.offset);
    }
    for (let i = 0; i < TOUCH_BUTTONS.length; i++) {
      const b = TOUCH_BUTTONS[i];
      if (b.captionAt === 'none') continue;
      const pill = (this.captions[i] ??= captionPill(hud, b.caption, CAPTION_EDGE[b.id] ?? '#9aa6c4'));
      if (!pill) continue;
      // The CARVE caption sits under the LEFT/RIGHT pair.
      const cx = b.id === 'carveLeft' ? (TOUCH_BUTTONS[0].x + TOUCH_BUTTONS[1].x) / 2 : b.x;
      const y = b.captionAt === 'below' ? Math.min(this.H - pill.height, b.y + b.r - 1) : b.y - b.r - pill.height + 1;
      hud.blit(pill, Math.round(cx - pill.width / 2), y);
    }
  }

  // --- panels --------------------------------------------------------------------

  private drawPause(): void {
    const run = this.run;
    const hud = this.hud;
    const touch = run.input.touch;
    const W = this.W;
    const pw = Math.min(W - 20, 210);
    const ph = 104;
    const px = Math.round((W - pw) / 2);
    const py = Math.round((this.H - ph) / 2) - (IS_PORTRAIT ? 20 : 0);
    hud.blit(this.panel('pause', pw, ph, 11, HUD_COLORS.panel, 0.9), px, py);
    const title = this.bigTitles().paused;
    hud.blit(title, Math.round(W / 2 - title.width / 2), py + 6);
    this.yellowRow('resume', px + 12, py + 38, pw - 24, 'RESUME', touch ? 'TAP' : 'SPACE');
    hud.blit(this.panel('pauseMenu', pw - 24, 16, 4), px + 12, py + 58);
    hud.text(px + 31, py + 63, 'MAIN MENU', HUD_COLORS.label, TIGHT);
    hud.text(px + pw - 22, py + 63, touch ? 'MENU' : 'M', HUD_COLORS.dim, TIGHT_RIGHT);
    hud.text(W / 2, py + 84, this.pauseLine.get(run.score), HUD_COLORS.dim, TIGHT_CENTER);
    this.menuCorner();
  }

  private drawResults(): void {
    const run = this.run;
    const hud = this.hud;
    const touch = run.input.touch;
    const W = this.W;
    const pw = Math.min(W - 16, 220);
    const ph = 172;
    const px = Math.round((W - pw) / 2);
    const py = Math.round((this.H - ph) / 2) - (IS_PORTRAIT ? 16 : 0);
    hud.blit(this.panel('results', pw, ph, 12, HUD_COLORS.panel, 0.9), px, py);
    const titles = this.bigTitles();
    const shake = run.stateTime < 0.4 ? Math.round(Math.sin(run.stateTime * 60) * 2) : 0;
    const slam = run.stateTime < 0.15 ? 1.4 - run.stateTime * 2.6 : 1;
    hud.blit(titles.wipeout, Math.round(W / 2 - titles.wipeout.width / 2) + shake, py + 4, 1, slam);
    const rx = px + 10;
    const rw = pw - 20;
    this.statRow(0, rx, py + 38, rw, 'DISTANCE', this.dist.get(run.distance), HUD_COLORS.white, 'M');
    this.statRow(1, rx, py + 55, rw, 'POSITION', this.small.get(run.rank), HUD_COLORS.white, this.field);
    this.statRow(2, rx, py + 72, rw, 'SCORE', this.score.get(run.score), HUD_COLORS.gold, '');
    this.statRow(3, rx, py + 89, rw, 'KNOCKOUTS', this.kos.get(run.knockouts), HUD_COLORS.white, '');
    const by = py + 108;
    if (run.newBest) {
      hud.blit(titles.best, Math.round(W / 2 - titles.best.width / 2), by, 1, 1 + 0.08 * Math.max(0, Math.sin(run.stateTime * 8)));
    } else {
      hud.text(W / 2 - 4, by + 3, 'BEST ', HUD_COLORS.dim, TIGHT_RIGHT);
      hud.text(W / 2 - 4, by + 3, this.bestScore.get(run.best.score), '#ffe14d', TIGHT);
      hud.text(W / 2 + 4 + hud.textWidth(this.bestScore.get(run.best.score), 1, true) + 6, by + 3, this.bestDist.get(run.best.distance), HUD_COLORS.label, TIGHT);
    }
    if (run.stateTime > SCORING.wipeoutSeconds) {
      this.yellowRow('again', rx, py + 128, rw, 'SURF AGAIN', touch ? 'TAP' : 'SPACE');
      hud.blit(this.panel('resultsMenu', rw, 16, 30), rx, py + 148);
      hud.text(rx + 19, py + 153, 'MAIN MENU', HUD_COLORS.label, TIGHT);
      hud.text(rx + rw - 10, py + 153, touch ? 'MENU' : 'ESC', HUD_COLORS.dim, TIGHT_RIGHT);
      this.menuCorner();
    }
  }

  private statRow(i: number, x: number, y: number, w: number, label: string, value: string, stops: Stops, unit: string): void {
    const hud = this.hud;
    hud.blit(this.panel(STAT_ROW_KEYS[i], w, 15, 20 + i), x, y);
    hud.text(x + 9, y + 4, label, HUD_COLORS.dim, TIGHT);
    const unitW = unit ? hud.textWidth(unit, 1, true) + 1 : 0;
    BIG.draw(hud, value, x + w - 9 - unitW, y + 2, stops, 'right');
    if (unit) hud.text(x + w - 8 - unitW, y + 5, unit, HUD_COLORS.label, TIGHT);
  }

  // --- title -----------------------------------------------------------------------

  private drawTitle(): void {
    const run = this.run;
    const hud = this.hud;
    const touch = run.input.touch;
    const W = this.W;
    const H = this.H;
    const spec = run.spec;
    const logo = hud.loaded('logo-big');
    if (logo) hud.blit(logo, TITLE.logoX, TITLE.logoY);
    const colW = TITLE.columnW;
    const colX = Math.round(TITLE.columnX - colW / 2);
    // PLAY: the highlighted row.
    this.yellowRow('play', colX + 20, TITLE.playY, colW - 40, 'PLAY', touch ? '' : 'SPACE');
    // The character select: the name between arrows, the title, the stat bars.
    const row = TITLE.rowY;
    const panelH = IS_PORTRAIT ? 46 : 64;
    hud.blit(this.panel('character', colW, panelH, 7), colX, row - 9);
    let name = this.names.get(spec.id);
    if (!name) {
      // Upright: the lean breaks letters like M at this size.
      name = hud.styledText(spec.name, { scale: 2, stops: HUD_COLORS.gold, outline: 1 });
      if (name) this.names.set(spec.id, name);
    }
    if (name) hud.blit(name, Math.round(TITLE.columnX - name.width / 2), row - 3);
    const nudge = Math.floor(run.time * 3) % 2;
    hud.text(titleArrowX(-1) - nudge, row - 1, '<', '#ffe14d', ARROW);
    hud.text(titleArrowX(1) + nudge, row - 1, '>', '#ffe14d', ARROW);
    hud.text(TITLE.columnX, row + 15, spec.title, HUD_COLORS.label, TIGHT_CENTER);
    const cols = IS_PORTRAIT ? 4 : 2;
    const cw = IS_PORTRAIT ? 53 : 84;
    for (let i = 0; i < 4; i++) {
      const value = i === 0 ? spec.speed : i === 1 ? spec.turn : i === 2 ? spec.power : spec.rage;
      const sx = Math.round(TITLE.columnX - (cols * cw) / 2) + (i % cols) * cw + 3;
      const sy = row + 26 + Math.floor(i / cols) * 11;
      const filled = Math.max(1, Math.min(5, Math.round(value * 5)));
      const slot = (i === 3 ? 6 : 0) + filled;
      const bar = (this.statArt[slot] ??= statBar(5, filled, STAT_COLORS[i]));
      hud.text(sx, sy, STAT_LABELS[i], HUD_COLORS.dim, TIGHT);
      if (bar) hud.blit(bar, sx + (IS_PORTRAIT ? 19 : 33), sy + 1);
    }
    // Which of the seven, as pips under the panel.
    const pipsY = row - 9 + panelH + 3;
    for (let i = 0; i < CHARACTER_ORDER.length; i++) {
      const on = i === run.characterIndex;
      hud.rect(TITLE.columnX - CHARACTER_ORDER.length * 4 + i * 8 + 2, pipsY - (on ? 1 : 0), 4, on ? 3 : 2, on ? 0xffe14d : 0x8a82b0, 1);
    }
    // The best run on this device.
    const bestY = IS_PORTRAIT ? H - 44 : pipsY + 9;
    hud.blit(this.panel('best', 168, 13, 8), Math.round(TITLE.columnX - 84), bestY - 3);
    const bestScore = this.bestScore.get(run.best.score);
    const bestDist = this.bestDist.get(run.best.distance);
    const bw = hud.textWidth(bestScore, 1, true) + hud.textWidth(bestDist, 1, true) + 40;
    const bx = Math.round(TITLE.columnX - bw / 2);
    hud.text(bx, bestY, 'BEST', HUD_COLORS.dim, TIGHT);
    hud.text(bx + 27, bestY, bestScore, '#ffe14d', TIGHT);
    hud.text(bx + bw, bestY, bestDist, HUD_COLORS.label, TIGHT_RIGHT);
    // The moves, then the prompt pill.
    hud.text(W / 2, H - 29, touch ? '> > UP: ROLL   UP UP: BOOST' : 'RIGHT RIGHT UP: BARREL ROLL   UP UP: BOOST   ARROWS: RIDER', HUD_COLORS.label, TIGHT_CENTER_OUTLINE);
    if (!this.promptPill) {
      const text = hud.styledText(touch ? 'TAP TO PLAY' : 'PRESS SPACE', {
        stops: HUD_COLORS.white,
        outline: 1,
      });
      if (text) {
        this.promptPill = brushPanel(text.width + 30, 15, HUD_COLORS.panel, 0.88, { slant: 3, seed: 13 });
        this.promptPill.getContext('2d')?.drawImage(text, 20, 3);
      }
    }
    if (this.promptPill) {
      const blink = Math.floor(run.time * 2.5) % 2 === 0;
      const x = Math.round(W / 2 - this.promptPill.width / 2);
      hud.blit(this.promptPill, x, H - 17);
      hud.text(x + 8 + (blink ? 1 : 0), H - 13, '▶', blink ? '#ffe14d' : '#c98a10', TIGHT);
    }
    if (touch) this.menuCorner();
    else hud.text(5, 4, 'ESC: MAIN MENU', HUD_COLORS.dim, TIGHT);
  }
}

const STAT_ROW_KEYS = ['stat0', 'stat1', 'stat2', 'stat3'];

/** A jagged comic burst behind contact words. */
function withBurst(text: HTMLCanvasElement): HTMLCanvasElement {
  const w = text.width + 16;
  const h = text.height + 12;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#ff5a3a';
  ctx.beginPath();
  const spikes = 12;
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const k = i % 2 === 0 ? 1 : 0.68;
    const px = w / 2 + Math.cos(a) * (w / 2 - 1) * k;
    const py = h / 2 + Math.sin(a) * (h / 2 - 1) * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  hardenAlpha(canvas, 128);
  const burst = outlined(canvas, HUD_COLORS.ink, 1, 0);
  burst.getContext('2d')?.drawImage(text, Math.round((burst.width - text.width) / 2), Math.round((burst.height - text.height) / 2));
  return burst;
}
