import { type Hud2D, hardenAlpha, heavyWidth, makeCanvas, outlined, type Stops } from '../engine/Hud2D';
import { KEY_LABELS } from './Combos';
import { CHARACTER_ORDER } from './characters';
import { hex } from '../engine/math';
import { COMBAT, HEALTH, IS_PORTRAIT, PALETTE, RIDER_ANIM, SCORING, VIEW } from './constants';
import { BigDigits, brushPanel, type HealthBarArt, healthBar, HUD_COLORS, hitSparkFrame, pauseArt, segmentBar, SPARK_FRAMES, starIcon, statBar, trophyIcon, warnIcon } from './HudArt';
import { PAUSE_ZONE, TITLE, titleArrowX } from './HudLayout';
import { type FloatingText, type Run, SPARK_SECONDS } from './Run';

/** Seconds after the wipeout before the results panel slams in: the fall plays first. */
const RESULTS_DELAY = RIDER_ANIM.wipeoutFall + 0.3;

/** How long a floating text lives (Run drops it after 1.3 s); it fades over the last part. */
const FLOAT_LIFE = 1.3;
const FLOAT_FADE = 0.3;
const FLOAT_POP = 0.14;
/** Floating texts stay below the top bar, the RAGE row and the combo. */
const FLOAT_TOP = 71;
/** The top bar's panels' height, and the RAGE row's top under it. */
const BAR_H = 25;
const RAGE_Y = 37;
/** A blow's shake of the HEALTH panel, its red flash and the edges' red glow (seconds), and a heal's bright sweep along the bar. */
const HURT_SECONDS = 0.32;
const HEAL_SECONDS = 0.5;
/** The bar's lost chunk waits this long, then drains at this many health points a second (the surfer's and the rivals'). */
const TRAIL_HOLD = 0.3;
const TRAIL_RATE = 110;
/** The phone's gesture hints show for this long into a run (each goes sooner once its gesture has been used). */
const HINT_SECONDS = 10;
const HINT_FADE = 0.4;
/** The shared table on the results: "NN NAME.... 000000" is 17 glyphs of 8 px; rows this far apart. */
const TABLE_CHARS = 17;
const TABLE_ROW = 11;
const BIG = new BigDigits();
/** Scratch for a float's projected point (no allocation per frame). */
const FLOAT_AT = { x: 0, y: 0 };
/** Scratch for a rival's head and the surfer's on the HUD. */
const HEAD_AT = { x: 0, y: 0 };
const SURFER_AT = { x: 0, y: 0 };
/** Metres over the top of a rider's head where its marks sit. */
const HEAD_LIFT = 0.12;
/** Scratch for a hit spark's projected centre and a point above it (its size on screen). */
const SPARK_AT = { x: 0, y: 0 };
const SPARK_UP = { x: 0, y: 0 };
/** Hit spark sizes are baked in steps of this many pixels. */
const SPARK_STEP = 4;
/** Baked floats kept by text, colour and scale. */
const FLOAT_CACHE = 48;
/** The words Run floats with fixed text (colours as Run passes them), baked on the title before play. */
const FLOAT_VOCABULARY: [string, string, number][] = [
  ['HIT!', '#ffffff', 1],
  ['BARGE!', '#ffffff', 1],
  ['OUCH!', hex(PALETTE.red), 1],
  ['SHARK!', hex(PALETTE.red), 1],
  ['BOAT!', hex(PALETTE.red), 1],
  ['CRASH!', hex(PALETTE.red), 1],
  ['SHOVED!', hex(PALETTE.red), 1],
  ['PUNCHED!', hex(PALETTE.red), 1],
  ['COUNTER!', '#ffffff', 1],
  ['DODGED!', hex(PALETTE.cyan), 1],
  ['BOOST!', hex(PALETTE.cyan), 1],
  ['BOOST!', hex(PALETTE.gold), 1],
  ['BARREL ROLL!', hex(PALETTE.cyan), 1],
  ['RAGE!', hex(PALETTE.red), 2],
  ['WIPEOUT', hex(PALETTE.red), 2],
  [`AIR +${SCORING.airBonus}`, hex(PALETTE.gold), 1],
  [`BIG AIR +${SCORING.bigAirBonus}`, hex(PALETTE.gold), 1],
  [`KNOCKOUT +${COMBAT.knockoutPoints}`, hex(PALETTE.gold), 2],
];
/**
 * The title logo, fetched as soon as this module is evaluated (with the
 * bundle, alongside the font) rather than when the first frame is drawn.
 */
const LOGO = new Image();
LOGO.onerror = () => console.error('HUD image failed to load', LOGO.src);
LOGO.src = 'assets/boardmasters/logo-236x118.png';
/** Text option objects shared by every call (no per-frame allocation). */
const TIGHT = { tight: true } as const;
const TIGHT_RIGHT = { tight: true, align: 'right' } as const;
const TIGHT_CENTER = { tight: true, align: 'center' } as const;
const TIGHT_CENTER_OUTLINE = {
  tight: true,
  align: 'center',
  outline: true,
} as const;
const INK = { tight: true, shadow: false } as const;
const INK_BIG = { tight: true, scale: 2, shadow: false } as const;
const INK_RIGHT = { tight: true, align: 'right', shadow: false } as const;
const ARROW = { align: 'center', scale: 2, outline: true } as const;
const STAT_LABELS = ['SPEED', 'TURN', 'POWER', 'RAGE'];
const STAT_COLORS = ['#5fe3ff', '#5fe3ff', '#5fe3ff', '#ff4d6d'];
/** The phone's gesture hints, in the order they stack, each with the gesture that dismisses it. */
const HINTS: [string, 'steer' | 'jump' | 'hit'][] = [
  ['SWIPE TO CARVE', 'steer'],
  ['SWIPE UP TO JUMP', 'jump'],
  ['TAP TO PUNCH', 'hit'],
];

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
const IMPACT = /^(HIT!|BARGE!|BUMP|SHOVED!|OUCH!|SHARK!|BOAT!|PUNCHED!|COUNTER!)$/;
/** "NAME +250" or "NAME +1000 X2": the points go on their own line above the name. */
const POINTS = /^(.*?)\s*(\+\d+(?:\s+X\d+)?)$/;

/**
 * Everything on the 2D overlay, per the gameplay and title mockups: the
 * top bar (HEALTH, DIST, SCORE), the RAGE lettering and segmented bar,
 * floating trick text beside the surfer, the input trail (keyboard), the
 * phone's gesture hints, the title's menu rows and character select, and
 * the pause and results panels (the results with the shared top 10).
 * Reads the run and changes nothing. Art is baked once (HudArt, or on first
 * use for anything that needs the pixel font) and blitted; the in-play path
 * allocates nothing per frame beyond a string when a shown number changes.
 */
export class HudView {
  private readonly hud: Hud2D;
  private readonly W: number;
  /** The HUD's height: upright it follows the screen (VIEW.height). */
  private H = 0;
  private readonly pauseButton = pauseArt();
  /** Float sprites per float (no key string per frame), backed by floatCache by text, colour and scale. */
  private readonly floatArt = new WeakMap<FloatingText, HTMLCanvasElement>();
  /** Baked float sprites by `text|color|scale`, most recently used last (a small LRU): the same word is baked once. */
  private readonly floatCache = new Map<string, HTMLCanvasElement>();
  /** Hit spark frames by baked size (SPARK_STEP buckets), made on first use. */
  private readonly sparkArt = new Map<number, HTMLCanvasElement[]>();
  /** How many of FLOAT_VOCABULARY are baked ahead (one per frame on the title, so a first HIT! costs nothing). */
  private prebaked = 0;
  /** Panels and other art by a fixed key (literal strings only, so lookups allocate nothing). */
  private readonly panels = new Map<string, HTMLCanvasElement>();
  private readonly names = new Map<string, HTMLCanvasElement | null>();
  private readonly comboArt: (HTMLCanvasElement | null)[] = [];
  private readonly statArt: (HTMLCanvasElement | null)[] = [];
  private readonly hintArt: (HTMLCanvasElement | null)[] = [];
  private rageWord: HTMLCanvasElement | null = null;
  private rageHot: HTMLCanvasElement | null = null;
  private titles: {
    paused: HTMLCanvasElement;
    wipeout: HTMLCanvasElement;
    best: HTMLCanvasElement;
  } | null = null;
  /** The HEALTH bar's art, the health its lost chunk still shows (draining after a blow), and the run time of the last frame drawn. */
  private readonly healthArt: HealthBarArt;
  private healthTrail: number = HEALTH.max;
  private lastDrawAt = 0;
  /** "-12" and "+6" beside the HEALTH panel, baked by change. */
  private readonly changeArt = new Map<number, HTMLCanvasElement>();
  /** Per rival: the health its bar's lost chunk still shows, and the run time its punch wind-up was first seen (-1 when not winding up). */
  private readonly rivalTrail: number[] = [];
  /** The "+n HP" words beside the surfer after a heal, by amount. */
  private readonly hpArt = new Map<number, HTMLCanvasElement>();
  private readonly warnSince: number[] = [];
  private readonly warnArt = [warnIcon(false), warnIcon(true)];
  private readonly trophy = trophyIcon();
  private readonly star = starIcon();
  private promptPill: HTMLCanvasElement | null = null;
  private readonly score = new Memo(withCommas);
  private readonly dist = new Memo((v) => String(v));
  private readonly bestRow = new Memo(() => this.bestText());
  private readonly kos = new Memo((v) => String(v));
  private readonly change = new Memo((v) => (v > 0 ? `+${v}` : String(v)));
  private readonly pauseLine = new Memo(() => `DIST ${this.dist.get(this.run.distance)} M   SCORE ${this.score.get(this.run.score)}`);
  /** The table's rows, rebuilt only when the table changes (its identity and the highlighted row). */
  private tableRows: string[] = [];
  private tableFor: unknown = null;
  private tableRank = -2;
  private trail = '';
  private trailSig = 0;
  /** Top bar panels: x and width each. */
  private readonly bar: {
    hx: number;
    hw: number;
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

  constructor(private readonly run: Run) {
    this.hud = run.hud;
    this.W = this.hud.width;
    this.H = this.hud.height;
    const W = this.W;
    // HEALTH from the left, SCORE and DIST from the right, the pause button between (240 wide upright: 1/132/182).
    this.bar = IS_PORTRAIT ? { hx: 1, hw: 70, dx: 132, dw: 48, sx: W - 58, sw: 57 } : { hx: 4, hw: 70, dx: W - 152, dw: 62, sx: W - 86, sw: 82 };
    const barW = IS_PORTRAIT ? Math.min(132, W - 108) : 150;
    const barX = IS_PORTRAIT ? W - barW - 22 : Math.round(W / 2 - 40);
    this.rage = {
      x: barX,
      y: RAGE_Y,
      w: barW,
      wordX: barX - 54,
      ...segmentBar(barW, 7, 10, 3),
    };
    this.bake('health', this.bar.hw, BAR_H, 1);
    this.bake('healthHurt', this.bar.hw, BAR_H, 1, '#7a0c26', 0.9, '#ff6a7f');
    this.bake('dist', this.bar.dw, BAR_H, 3);
    this.bake('score', this.bar.sw, BAR_H, 4);
    this.healthArt = healthBar(this.bar.hw - 12, 8, 5, 2);
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
    this.H = this.hud.height;
    this.hud.clear();
    const dt = Math.max(0, Math.min(0.1, run.time - this.lastDrawAt));
    this.lastDrawAt = run.time;
    if (run.state === 'title') {
      this.prebakeFloats();
      this.drawTitle();
      return;
    }
    this.updateTrails(dt);
    this.drawEdges();
    this.drawTopBar();
    if (run.state === 'wipeout') {
      // The results wait until the surfer has gone over the nose into the water.
      if (run.stateTime < RESULTS_DELAY) {
        this.drawSparks();
        this.drawFloats();
      } else this.drawResults();
      return;
    }
    this.drawRage();
    if (run.state !== 'paused') {
      this.drawRivalMarks();
      this.drawSparks();
      this.drawFloats();
    }
    if (run.state === 'playing') {
      if (run.input.touch) this.drawHints();
      else this.drawTrail();
    }
    if (run.state === 'paused') this.drawPause();
  }

  /** The surfer's latest loss (`sign` -1) or gain (+1) of health still in the log, or null. */
  private lastChange(sign: number): { delta: number; at: number } | null {
    const list = this.run.healthChanges;
    for (let i = list.length - 1; i >= 0; i--) if (Math.sign(list[i].delta) === sign) return list[i];
    return null;
  }

  /**
   * The lost chunks of the health bars: after a blow the bar drops at once
   * and the chunk lost stays lit for a moment, then drains down to it; on a
   * heal (or a new run) the chunk goes. Also notes when each rival starts
   * winding up a punch (its warning pops in).
   */
  private updateTrails(dt: number): void {
    const run = this.run;
    const hurt = this.lastChange(-1);
    if (run.health >= this.healthTrail) this.healthTrail = run.health;
    else if (!hurt || run.time - hurt.at > TRAIL_HOLD) this.healthTrail = Math.max(run.health, this.healthTrail - TRAIL_RATE * dt);
    for (let i = 0; i < run.rivals.length; i++) {
      const r = run.rivals[i];
      const trail = this.rivalTrail[i] ?? r.health;
      if (r.health >= trail || r.knockedOut) this.rivalTrail[i] = r.health;
      else if (run.time - r.lastHitAt > TRAIL_HOLD) this.rivalTrail[i] = Math.max(r.health, trail - TRAIL_RATE * dt);
      else this.rivalTrail[i] = trail;
      if (!r.threatening || r.knockedOut) this.warnSince[i] = -1;
      else if (!(this.warnSince[i] >= 0)) this.warnSince[i] = run.time;
    }
  }

  /**
   * Red glow at the screen's edges: both sides as a blow lands and, faintly
   * pulsing, while health is low; one side, flashing, while a rival on that
   * side winds up a punch or shapes up a shoulder check.
   */
  private drawEdges(): void {
    const run = this.run;
    if (run.state === 'paused') return;
    const hurt = this.lastChange(-1);
    let a = 0;
    if (hurt) {
      const age = run.time - hurt.at;
      if (age >= 0 && age < HURT_SECONDS) a = 0.5 * (1 - age / HURT_SECONDS);
    }
    if (run.state === 'playing' && run.health > 0 && run.health < HEALTH.max * HEALTH.low) a = Math.max(a, 0.16 + 0.12 * Math.sin(run.time * 6));
    if (a > 0) {
      this.edgeGlow(-1, a);
      this.edgeGlow(1, a);
    }
    if (run.state !== 'playing' || Math.floor(run.time * 10) % 2 === 1) return;
    let sides = 0;
    for (let i = 0; i < run.rivals.length; i++) {
      if (!(this.warnSince[i] >= 0)) continue;
      const r = run.rivals[i];
      if (!run.headPoint(r, 0, HEAD_AT) || !run.headPoint(run.surfer, 0, SURFER_AT)) continue;
      const side = HEAD_AT.x < SURFER_AT.x ? -1 : 1;
      if (sides & (side < 0 ? 1 : 2)) continue;
      sides |= side < 0 ? 1 : 2;
      this.edgeGlow(side, 0.5);
    }
  }

  /** A red glow down one edge of the screen (-1 left, 1 right), in steps (no smooth gradient on the pixel HUD). */
  private edgeGlow(side: number, alpha: number): void {
    const step = 3;
    for (let k = 0; k < 4; k++) {
      const x = side < 0 ? k * step : this.W - (k + 1) * step;
      this.hud.rect(x, 0, step, this.H, 0xff2e4d, alpha * (1 - k * 0.24));
    }
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
      wipeout: this.hud.heavyText('WIPED OUT', 26, HUD_COLORS.wipeout, 1),
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
    // HEALTH: the bar, the panel shaking and flashing red as a blow lands. On touch screens the MENU corner takes its place outside play.
    if (!run.input.touch || run.state === 'playing' || (run.state === 'wipeout' && run.stateTime <= SCORING.wipeoutSeconds)) {
      const hurt = this.lastChange(-1);
      const age = hurt ? run.time - hurt.at : 1e9;
      const hit = age >= 0 && age < HURT_SECONDS ? 1 - age / HURT_SECONDS : 0;
      const shake = hit > 0 ? Math.round(Math.sin(age * 95) * 2.5 * hit) : 0;
      const x = b.hx + shake;
      hud.blit(this.panels.get('health') as HTMLCanvasElement, x, top);
      const low = run.health < HEALTH.max * HEALTH.low && run.health > 0;
      const tint = Math.max(hit, low && run.state === 'playing' ? 0.35 + 0.3 * Math.sin(run.time * 6) : 0);
      if (tint > 0) hud.blit(this.panels.get('healthHurt') as HTMLCanvasElement, x, top, tint);
      const labelRed = (hit > 0 && Math.floor(age * 16) % 2 === 0) || (low && Math.floor(run.time * 3) % 2 === 0);
      hud.text(x + 6, top + 2, 'HEALTH', labelRed ? '#ff8a9a' : HUD_COLORS.label, TIGHT);
      this.drawHealthBar(x + 5, valueY + 1);
      this.drawHealthChange(b.hx + 3, top + BAR_H);
    }
    // DIST: metres ridden, the original game's counter.
    hud.blit(this.panels.get('dist') as HTMLCanvasElement, b.dx, top);
    hud.text(b.dx + 9, top + 2, 'DIST', HUD_COLORS.label, TIGHT);
    const dist = this.dist.get(run.distance);
    const unitW = hud.textWidth('M', 1, true) + 1;
    BIG.draw(hud, dist, b.dx + b.dw - 9 - unitW, valueY, HUD_COLORS.white, 'right');
    hud.text(b.dx + b.dw - 8 - unitW, valueY + 3, 'M', HUD_COLORS.label, TIGHT);
    // SCORE: thousands separated.
    hud.blit(this.panels.get('score') as HTMLCanvasElement, b.sx, top);
    hud.text(b.sx + 9, top + 2, 'SCORE', HUD_COLORS.label, TIGHT);
    const score = this.score.get(run.score);
    if (BIG.width(score) <= b.sw - 8) BIG.draw(hud, score, b.sx + 5, valueY, HUD_COLORS.gold);
    else hud.text(b.sx + 5, valueY + 3, score, '#ffe14d', TIGHT);
    // The pause button on touch screens, at the top centre (PAUSE_ZONE).
    if (run.input.touch && run.state === 'playing') hud.blit(this.pauseButton, Math.round(this.W / 2 - 9), top + Math.round((PAUSE_ZONE.h - 18) / 2) + 2);
  }

  /**
   * The health bar: chunky slanted cells, cyan-green while healthy, gold
   * when low, red and pulsing when nearly gone. A blow flashes it red and
   * leaves the chunk lost lit a moment before it drains (the trail); a heal
   * sends a bright sweep along it.
   */
  private drawHealthBar(x: number, y: number): void {
    const run = this.run;
    const hud = this.hud;
    const art = this.healthArt;
    const cut = (value: number) => Math.round((art.w * Math.max(0, Math.min(HEALTH.max, value))) / HEALTH.max);
    const fill = run.health > 0 ? Math.max(1, cut(run.health)) : 0;
    const trail = cut(this.healthTrail);
    const frac = run.health / HEALTH.max;
    const sx = x - art.inset;
    const sy = y - 1;
    const h = art.empty.height;
    hud.blit(art.empty, sx, sy);
    const low = frac < HEALTH.low;
    const sheet = low ? art.low : frac < HEALTH.warn ? art.warn : art.good;
    const pulse = low ? 0.6 + 0.4 * Math.sin(run.time * 12) : 1;
    // The chunk just lost: white, then red, draining.
    const hurt = this.lastChange(-1);
    const hurtAge = hurt ? run.time - hurt.at : 1e9;
    if (trail > fill) hud.blitPart(hurtAge < 0.1 ? art.hot : art.flash, art.inset + fill, 0, trail - fill, h, sx + art.inset + fill, sy, 0.9);
    if (fill > 0) hud.blitPart(sheet, 0, 0, art.inset + fill, h, sx, sy, pulse);
    if (hurtAge >= 0 && hurtAge < HURT_SECONDS && Math.floor(hurtAge * 24) % 2 === 0) hud.blitPart(art.flash, 0, 0, art.inset + Math.max(fill, trail), h, sx, sy, 0.75);
    const healed = this.lastChange(1);
    const healAge = healed ? run.time - healed.at : 1e9;
    if (fill > 0 && healAge >= 0 && healAge < HEAL_SECONDS) {
      const k = healAge / HEAL_SECONDS;
      hud.blitPart(art.hot, 0, 0, art.inset + fill, h, sx, sy, 0.55 * (1 - k));
      // The sweep: a bright band running along the bar, left to right.
      const band = 5;
      const at = Math.round(k * (fill + band)) - band;
      const from = Math.max(0, at);
      const to = Math.min(fill, at + band);
      if (to > from) hud.blitPart(art.hot, art.inset + from, 0, to - from, h, sx + art.inset + from, sy);
    }
  }

  /** The latest change of health ("-12" in red, "+6" in green) under the HEALTH panel, popping in and fading. */
  private drawHealthChange(x: number, y: number): void {
    const run = this.run;
    const list = run.healthChanges;
    if (list.length === 0) return;
    const last = list[list.length - 1];
    const age = run.time - last.at;
    if (age < 0 || age >= HEALTH.changeSeconds) return;
    let art = this.changeArt.get(last.delta);
    if (!art) {
      if (this.changeArt.size > 40) this.changeArt.clear();
      art = this.hud.heavyText(this.change.get(last.delta), 12, last.delta < 0 ? HUD_COLORS.red : HUD_COLORS.green, 1);
      this.changeArt.set(last.delta, art);
    }
    const pop = age < FLOAT_POP ? 1 + 0.35 * (1 - age / FLOAT_POP) ** 2 : 1;
    const alpha = Math.min(1, (HEALTH.changeSeconds - age) / FLOAT_FADE);
    // A loss drops a little, a gain rises a little.
    const drift = Math.min(3, Math.round(age * 8)) * (last.delta < 0 ? 1 : -1);
    this.hud.blit(art, x, y + 1 + drift + (last.delta < 0 ? 0 : 3), alpha, pop);
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
      const combo = (this.comboArt[n] ??= hud.styledText(`COMBO X${n}`, { scale: 2, stops: HUD_COLORS.gold, outline: 1 }));
      if (combo) hud.blit(combo, Math.round(r.x + r.w / 2 - combo.width / 2), r.y + 15, 1, 1 + 0.15 * Math.max(0, Math.sin(run.time * 10)));
    }
  }

  /**
   * Over the rivals: a small health bar for a while after a blow lands on
   * one (HEALTH.rivalBarSeconds), its lost chunk lit then draining; and a
   * flashing red "!" burst over one winding up a punch or a shoulder check at the surfer (the
   * screen's edge on its side flashes too: drawEdges).
   */
  private drawRivalMarks(): void {
    const run = this.run;
    const hud = this.hud;
    for (let i = 0; i < run.rivals.length; i++) {
      const r = run.rivals[i];
      if (r.knockedOut) continue;
      const since = run.time - r.lastHitAt;
      const bar = since >= 0 && since < HEALTH.rivalBarSeconds;
      const warn = this.warnSince[i] >= 0;
      if (!bar && !warn) continue;
      if (!run.headPoint(r, HEAD_LIFT, HEAD_AT)) continue;
      const x = Math.round(HEAD_AT.x);
      const y = Math.round(HEAD_AT.y);
      if (bar && y > RAGE_Y + 16) {
        const alpha = Math.min(1, (HEALTH.rivalBarSeconds - since) / 0.4);
        const w = 24;
        const h = 4;
        const bx = x - w / 2;
        const by = y - h - 2;
        const frac = Math.max(0, Math.min(1, r.health / r.maxHealth));
        const fill = r.health > 0 ? Math.max(1, Math.round(w * frac)) : 0;
        const trail = Math.round((w * Math.max(0, Math.min(r.maxHealth, this.rivalTrail[i] ?? r.health))) / r.maxHealth);
        hud.rect(bx - 1, by - 1, w + 2, h + 2, 0x0d0820, 0.95 * alpha);
        hud.rect(bx, by, w, h, 0x2b2346, alpha);
        if (trail > fill) hud.rect(bx + fill, by, trail - fill, h, since < 0.1 ? 0xffffff : 0xff6a7f, alpha);
        if (fill > 0) {
          hud.rect(bx, by, fill, h, frac > 0.5 ? 0x3fe0b0 : frac > HEALTH.low ? 0xffc21a : 0xff2e4d, alpha);
          hud.rect(bx, by, fill, 1, 0xffffff, 0.45 * alpha);
        }
        for (let k = 1; k < 4; k++) hud.rect(bx + Math.round((w * k) / 4), by, 1, h, 0x0d0820, 0.6 * alpha);
      }
      if (warn) {
        const age = run.time - this.warnSince[i];
        const icon = this.warnArt[Math.floor(age * 14) % 2];
        const pop = age < 0.1 ? 1.7 - 7 * age : 1 + 0.1 * Math.max(0, Math.sin(age * 30));
        const ix = Math.max(2, Math.min(this.W - icon.width - 2, x - Math.round(icon.width / 2)));
        const iy = Math.max(RAGE_Y + 16, y - (bar ? 9 : 3) - icon.height);
        hud.blit(icon, ix, iy, 1, pop);
      }
    }
  }

  /** Hit sparks: a comic star where each blow lands, sized by its distance from the camera, playing over SPARK_SECONDS. */
  private drawSparks(): void {
    const run = this.run;
    for (const sp of run.hitSparks) {
      if (!run.hudPoint(sp.x, sp.y, sp.z, SPARK_AT) || !run.hudPoint(sp.x, sp.y + sp.size / 2, sp.z, SPARK_UP)) continue;
      const px = Math.max(12, Math.min(72, Math.hypot(SPARK_UP.x - SPARK_AT.x, SPARK_UP.y - SPARK_AT.y) * 2));
      const bucket = Math.round(px / SPARK_STEP) * SPARK_STEP;
      let frames = this.sparkArt.get(bucket);
      if (!frames) {
        frames = [];
        for (let i = 0; i < SPARK_FRAMES; i++) frames.push(hitSparkFrame(i, bucket));
        this.sparkArt.set(bucket, frames);
      }
      const art = frames[Math.min(SPARK_FRAMES - 1, Math.floor((sp.age / SPARK_SECONDS) * SPARK_FRAMES))];
      this.hud.blit(art, Math.round(SPARK_AT.x - art.width / 2), Math.round(SPARK_AT.y - art.height / 2));
    }
  }

  /**
   * Floating text: heavy brush lettering with a dark outline, popping in and
   * fading. Trick and score words stack beside the surfer (newest lowest, at
   * most two: Run caps them); the blows' words (HIT!, BARGE!, KNOCKOUT) rise
   * over the rider who took the blow.
   */
  private drawFloats(): void {
    const list = this.run.floats;
    // Beside the surfer: upright, right of his head and above his arm; landscape, right of him, with the stack's room reaching down to the bottom fifth.
    const baseY = IS_PORTRAIT ? VIEW.frame.top + Math.round(VIEW.frame.height * 0.5) : Math.round(this.H * 0.8);
    const at = FLOAT_AT;
    let stack = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      const c = this.floatArt.get(f) ?? this.floatSprite(f);
      const rise = Math.round(f.age * 10);
      const pop = f.age < FLOAT_POP ? 1 + 0.6 * (1 - f.age / FLOAT_POP) ** 2 : 1;
      const alpha = Math.min(1, (FLOAT_LIFE - f.age) / FLOAT_FADE);
      if (f.anchor) {
        // Over the rider, kept on screen and under the RAGE row.
        if (!this.run.floatPoint(f, at)) continue;
        const grow = Math.ceil(((pop - 1) * c.width) / 2);
        const x = Math.max(2 + grow, Math.min(this.W - 2 - grow - c.width, Math.round(at.x - c.width / 2)));
        const top = Math.max(FLOAT_TOP, Math.min(this.H - c.height, Math.round(at.y) - c.height - rise));
        this.hud.blit(c, x, top, alpha, pop);
        continue;
      }
      const top = baseY - c.height - stack - rise;
      // Only the entries that would cover the RAGE row give way; the rest still show.
      if (top < FLOAT_TOP) continue;
      this.hud.blit(c, this.columnX(c.width, pop), top, alpha, pop);
      stack += c.height;
    }
    this.drawHealGain(baseY);
  }

  /**
   * The health a clean landing gave back ("+14 HP" in green) just under the
   * trick's word beside the surfer, rising with it: where the eye already
   * is, not only in the HEALTH panel's corner.
   */
  private drawHealGain(baseY: number): void {
    const run = this.run;
    const gain = this.lastChange(1);
    if (!gain) return;
    const age = run.time - gain.at;
    if (age < 0 || age >= FLOAT_LIFE) return;
    let art = this.hpArt.get(gain.delta);
    if (!art) {
      if (this.hpArt.size > 40) this.hpArt.clear();
      art = this.hud.heavyText(`+${gain.delta} HP`, IS_PORTRAIT ? 15 : 16, HUD_COLORS.green, 1);
      this.hpArt.set(gain.delta, art);
    }
    const pop = age < FLOAT_POP ? 1 + 0.6 * (1 - age / FLOAT_POP) ** 2 : 1;
    const alpha = Math.min(1, (FLOAT_LIFE - age) / FLOAT_FADE);
    this.hud.blit(art, this.columnX(art.width, pop), baseY + 1 - Math.round(age * 10), alpha, pop);
  }

  /**
   * The left of a column word `w` wide: right-aligned upright, left-aligned
   * in landscape, and kept on screen while it pops (blit scales about the
   * centre, so a popping word grows by (pop - 1) * w / 2 each side).
   */
  private columnX(w: number, pop: number): number {
    const grow = Math.ceil(((pop - 1) * w) / 2);
    const x = IS_PORTRAIT ? this.W - 3 - w : Math.round(this.W * 0.6);
    return Math.max(2 + grow, Math.min(this.W - 2 - grow - w, x));
  }

  /**
   * `text` in the heavy brush lettering at `px`, made to fit `maxW`: first
   * narrowed (down to 72% width, which keeps the letters tall and legible),
   * then smaller, but not below `minPx`. Fitted by measuring, so each line
   * is baked once.
   */
  private heavyFit(text: string, px: number, minPx: number, maxW: number, stops: Stops): HTMLCanvasElement {
    // The baked sprite is about the advance width plus the outline and a little lean.
    const room = maxW - 4;
    const w = heavyWidth(text, px);
    if (w <= room) return this.hud.heavyText(text, px, stops, 1);
    const squeeze = Math.max(0.72, room / w);
    const size = w * squeeze <= room ? px : Math.max(minPx, Math.floor((px * room) / (w * squeeze)));
    return this.hud.heavyText(text, size, stops, 1, undefined, squeeze);
  }

  /** The sprite for a float: from the cache by text, colour and scale, or baked now. */
  private floatSprite(f: FloatingText): HTMLCanvasElement {
    const canvas = this.cachedFloat(f.text, f.color, f.scale);
    this.floatArt.set(f, canvas);
    return canvas;
  }

  private cachedFloat(text: string, color: string, scale: number): HTMLCanvasElement {
    const key = `${text}|${color}|${scale}`;
    let canvas = this.floatCache.get(key);
    if (canvas) this.floatCache.delete(key); // re-inserted below as the most recent
    else {
      canvas = this.bakeFloat(text, color, scale);
      if (this.floatCache.size >= FLOAT_CACHE) {
        const oldest = this.floatCache.keys().next().value;
        if (oldest !== undefined) this.floatCache.delete(oldest);
      }
    }
    this.floatCache.set(key, canvas);
    return canvas;
  }

  /** Bake the next word of the fixed vocabulary ahead of play (one per call). */
  private prebakeFloats(): void {
    if (this.prebaked >= FLOAT_VOCABULARY.length) return;
    const [text, color, scale] = FLOAT_VOCABULARY[this.prebaked++];
    this.cachedFloat(text, color, scale);
  }

  private bakeFloat(text: string, color: string, scale: number): HTMLCanvasElement {
    const f = { text, scale };
    const stops = stopsFor(color);
    // Upright the stack sits right of the surfer's head, above his outstretched arm (the mockup's "+250 CARVE" sits at x 180..232 of 240).
    const maxW = IS_PORTRAIT ? 96 : Math.round(this.W * 0.4 - 8);
    const big = IS_PORTRAIT ? 18 : 20;
    const match = POINTS.exec(f.text);
    let canvas: HTMLCanvasElement;
    if (match && match[1]) {
      // "+250" over "CARVE", like the mockup: both in the heavy lettering, the name a little smaller and set back.
      const points = this.heavyFit(match[2], big, 14, maxW, stops);
      const name = this.heavyFit(match[1], f.scale >= 2 ? big - 1 : big - 3, 14, maxW - 4, stops);
      const shift = 4;
      // The line set back carries the shift: upright the name (right-aligned), in landscape the points (left-aligned).
      const w = IS_PORTRAIT ? Math.max(points.width, name.width + shift) : Math.max(points.width + shift, name.width);
      // The name goes on last, so the points' outline never hides the tops of its letters (a T's bar).
      const made = makeCanvas(w, points.height + name.height - 2);
      made.ctx.drawImage(points, IS_PORTRAIT ? w - points.width : shift, 0);
      made.ctx.drawImage(name, IS_PORTRAIT ? w - name.width - shift : 0, points.height - 2);
      canvas = made.canvas;
    } else {
      const impact = IMPACT.test(f.text);
      const text = this.heavyFit(f.text, f.scale >= 2 || impact ? big - 1 : big - 3, 14, maxW - (impact ? 16 : 0), stops);
      canvas = impact ? withBurst(text, stops === HUD_COLORS.red) : text;
    }
    return canvas;
  }

  /** The combo reader's held presses (keyboard), so moves can be learnt by watching. The string is rebuilt only when the presses change. */
  private drawTrail(): void {
    const run = this.run;
    const recent = run.combos.recent(run.time);
    if (recent.length === 0) return;
    let sig = recent.length;
    for (let i = 0; i < recent.length; i++) sig = (sig * 31 + recent[i].charCodeAt(0)) | 0;
    if (sig !== this.trailSig) {
      this.trailSig = sig;
      let trail = '';
      for (const k of recent) trail += (trail ? ' ' : '') + KEY_LABELS[k];
      this.trail = trail;
    }
    this.hud.text(this.W / 2, this.H - 22, this.trail, '#b8fbff', TIGHT_CENTER_OUTLINE);
  }

  /**
   * The phone's gesture hints for the first seconds of a run, stacked at the
   * bottom of the screen (clear of the surfer): each goes once its gesture
   * has been used, and all of them after HINT_SECONDS.
   */
  private drawHints(): void {
    const run = this.run;
    const t = run.stateTime;
    if (t >= HINT_SECONDS) return;
    const fade = Math.min(1, (HINT_SECONDS - t) / HINT_FADE);
    let y = this.H - 18;
    for (let i = HINTS.length - 1; i >= 0; i--) {
      const [text, gesture] = HINTS[i];
      if (run.gestures[gesture]) continue;
      const art = (this.hintArt[i] ??= this.hud.styledText(text, { stops: HUD_COLORS.white, outline: 1 }));
      if (!art) continue;
      const blink = i === 0 && Math.floor(t * 2) % 2 === 0 ? 1 : 0;
      this.hud.blit(art, Math.round(this.W / 2 - art.width / 2), y - blink, fade);
      y -= art.height + 3;
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
    hud.text(W / 2, py + 84, this.pauseLine.get(Math.floor(run.score) * 1e6 + Math.floor(run.distance)), HUD_COLORS.dim, TIGHT_CENTER);
    this.menuCorner();
  }

  /**
   * The results, over the surfer floating after the wipeout with the pack
   * riding on: WIPED OUT, DISTANCE, SCORE and KNOCKOUTS, NEW BEST (or the
   * best so far), the shared TOP 10 with this run's row lit (under the
   * rows upright, beside them in landscape), then SURF AGAIN and MAIN MENU
   * once input is taken.
   */
  private drawResults(): void {
    const run = this.run;
    const hud = this.hud;
    const touch = run.input.touch;
    const W = this.W;
    const stacked = IS_PORTRAIT;
    const tableW = TABLE_CHARS * 8;
    const pw = stacked ? Math.min(W - 16, 224) : Math.min(W - 16, 400);
    const ph = stacked ? 276 : 162;
    const px = Math.round((W - pw) / 2);
    const py = Math.round((this.H - ph) / 2) - (stacked ? 10 : 0);
    hud.blit(this.panel('results', pw, ph, 12, HUD_COLORS.panel, 0.9), px, py);
    const titles = this.bigTitles();
    const t = run.stateTime - RESULTS_DELAY; // the panel's own clock: it arrives after the fall
    const shake = t < 0.4 ? Math.round(Math.sin(t * 60) * 2) : 0;
    const slam = t < 0.15 ? 1.4 - t * 2.6 : 1;
    const title = titles.wipeout;
    // The column of rows: the whole panel upright; the left part in landscape, with the table to its right.
    const cw = stacked ? pw : pw - tableW - 30;
    const cx = px + Math.round(cw / 2);
    hud.blit(title, Math.round(cx - title.width / 2) + shake, py + 5, 1, slam);
    const rx = px + 10;
    const rw = cw - 20;
    // The rows slide in one after another.
    const slide = (i: number) => {
      const k = Math.max(0, Math.min(1, (t - 0.12 - i * 0.07) / 0.14));
      return Math.round((1 - k) ** 2 * W);
    };
    this.statRow(0, rx + slide(0), py + 36, rw, 'DISTANCE', this.dist.get(run.distance), HUD_COLORS.white, 'M', false);
    this.statRow(1, rx + slide(1), py + 53, rw, 'SCORE', this.score.get(run.score), HUD_COLORS.gold, '', run.newBest);
    this.statRow(2, rx + slide(2), py + 70, rw, 'KNOCKOUTS', this.kos.get(run.knockouts), HUD_COLORS.white, '', false);
    const by = py + 89;
    if (run.newBest) hud.blit(titles.best, Math.round(cx - titles.best.width / 2), by, 1, 1 + 0.08 * Math.max(0, Math.sin(t * 8)));
    else hud.text(cx, by + 3, this.bestRow.get(this.bestKey()), HUD_COLORS.dim, TIGHT_CENTER);
    // The shared table.
    const tx = stacked ? px + Math.round((pw - tableW) / 2) : px + cw + 14;
    const ty = stacked ? py + 108 : py + 8;
    if (t > 0.3) this.drawTable(tx, ty, tableW);
    const taking = run.stateTime > SCORING.wipeoutSeconds && !run.entering;
    if (taking) {
      const ay = stacked ? ty + 12 + 10 * TABLE_ROW + 8 : py + 112;
      this.yellowRow('again', rx, ay, rw, 'SURF AGAIN', touch ? 'TAP' : 'SPACE');
      hud.blit(this.panel('resultsMenu', rw, 16, 30), rx, ay + 20);
      hud.text(rx + 19, ay + 25, 'MAIN MENU', HUD_COLORS.label, TIGHT);
      hud.text(rx + rw - 10, ay + 25, touch ? 'MENU' : 'ESC', HUD_COLORS.dim, TIGHT_RIGHT);
      this.menuCorner();
    }
  }

  /** The shared top 10 at (x, y), `w` wide: the heading (where it came from), ten rows, this run's row in cyan, empty rows as dashes. */
  private drawTable(x: number, y: number, w: number): void {
    const run = this.run;
    const hud = this.hud;
    const sb = run.scoreboard;
    const heading = run.entering ? 'ENTER YOUR NAME' : sb.source === 'loading' ? 'LOADING' : sb.source === 'online' ? 'TOP 10' : 'TOP 10 OFFLINE';
    hud.text(x + w / 2, y, heading, '#ffe14d', TIGHT_CENTER);
    if (sb.list !== this.tableFor || sb.rank !== this.tableRank) {
      this.tableFor = sb.list;
      this.tableRank = sb.rank;
      this.tableRows = [];
      for (let i = 0; i < 10; i++) {
        const entry = sb.list[i];
        const rank = String(i + 1).padStart(2, ' ');
        this.tableRows.push(entry ? `${rank} ${entry.name.padEnd(8, ' ')}${String(Math.min(999999, entry.score)).padStart(6, '0')}` : `${rank} ${'-'.repeat(8)}------`);
      }
    }
    for (let i = 0; i < this.tableRows.length; i++) {
      const color = i === sb.rank ? '#7ff6ff' : sb.list[i] ? '#ffffff' : '#6b6b8a';
      hud.text(x, y + 12 + i * TABLE_ROW, this.tableRows[i], color);
    }
  }

  /** A number that changes whenever the best does (for the memo of the best row). */
  private bestKey(): number {
    const b = this.run.best;
    return b.score * 1e6 + b.distance;
  }

  /** "BEST 12,480  1,250 M" (the best score on this course on this device, and the distance it was set at), or a nudge before the first run. */
  bestText(): string {
    const b = this.run.best;
    if (b.score <= 0) return 'BEST  NO RUN YET';
    return b.distance > 0 ? `BEST  ${withCommas(b.score)}  ${withCommas(b.distance)} M` : `BEST  ${withCommas(b.score)}`;
  }

  /** A results row: the label, the value in the big digits (and a unit), and a gold star when it is a new best. */
  private statRow(i: number, x: number, y: number, w: number, label: string, value: string, stops: Stops, unit: string, best: boolean): void {
    const hud = this.hud;
    hud.blit(this.panel(STAT_ROW_KEYS[i], w, 15, 20 + i), x, y);
    hud.text(x + 9, y + 4, label, best ? '#ffe14d' : HUD_COLORS.dim, TIGHT);
    if (best) hud.blit(this.star, x + 12 + hud.textWidth(label, 1, true), y + 3 - (Math.floor(this.run.time * 4) % 2));
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
    if (LOGO.complete && LOGO.naturalWidth > 0) hud.blit(LOGO, TITLE.logoX, TITLE.logoY);
    const colW = TITLE.columnW;
    const colX = Math.round(TITLE.columnX - colW / 2);
    // PLAY: the highlighted row.
    this.yellowRow('play', colX + 20, TITLE.playY, colW - 40, 'PLAY', touch ? '' : 'SPACE');
    // The character select: the name between arrows, the title, the stat bars.
    const row = TITLE.rowY;
    const panelH = 64;
    // A tall panel with a small fixed lean, so the stat bars stay inside its slanted edges.
    let charPanel = this.panels.get('character');
    if (!charPanel) {
      charPanel = brushPanel(colW, panelH, HUD_COLORS.panel, 0.85, { slant: 4, seed: 7 });
      this.panels.set('character', charPanel);
    }
    hud.blit(charPanel, colX, row - 9);
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
    // Two by two (SPEED and TURN over POWER and RAGE), so a full bar never runs into the next label.
    const cols = 2;
    const cw = IS_PORTRAIT ? 100 : 84;
    for (let i = 0; i < 4; i++) {
      const value = i === 0 ? spec.speed : i === 1 ? spec.turn : i === 2 ? spec.power : spec.rage;
      // Upright the two columns are centred as drawn (label and bar, 66 px).
      const sx = (IS_PORTRAIT ? Math.round(TITLE.columnX - (cw + 66) / 2) : Math.round(TITLE.columnX - (cols * cw) / 2) + 3) + (i % cols) * cw;
      const sy = row + 26 + Math.floor(i / cols) * 11;
      const filled = Math.max(1, Math.min(5, Math.round(value * 5)));
      const slot = (i === 3 ? 6 : 0) + filled;
      const bar = (this.statArt[slot] ??= statBar(5, filled, STAT_COLORS[i]));
      hud.text(sx, sy, STAT_LABELS[i], HUD_COLORS.dim, TIGHT);
      if (bar) hud.blit(bar, sx + 33, sy + 1);
    }
    // Which of the seven, as pips along the panel's bottom row.
    const pipsY = row - 9 + panelH - 7;
    for (let i = 0; i < CHARACTER_ORDER.length; i++) {
      const on = i === run.characterIndex;
      hud.rect(TITLE.columnX - CHARACTER_ORDER.length * 4 + i * 8 + 2, pipsY - (on ? 1 : 0), 4, on ? 3 : 2, on ? 0xffe14d : 0x8a82b0, 1);
    }
    // The best run on this course on this device: the score and its distance.
    const bestY = IS_PORTRAIT ? H - 44 : row - 9 + panelH + 12;
    hud.blit(this.panel('best', 168, 13, 8), Math.round(TITLE.columnX - 84), bestY - 3);
    const best = this.bestRow.get(this.bestKey());
    const bw = hud.textWidth(best, 1, true);
    const bx = Math.round(TITLE.columnX - (bw + this.trophy.width + 4) / 2);
    hud.blit(this.trophy, bx, bestY - 1);
    hud.text(bx + this.trophy.width + 4, bestY, best, this.run.best.score <= 0 ? HUD_COLORS.dim : '#ffe14d', TIGHT);
    // The controls, then the prompt pill.
    hud.text(W / 2, H - 29, touch ? 'SWIPE: CARVE   UP: JUMP   TAP: PUNCH' : 'RIGHT RIGHT UP: BARREL ROLL   UP UP: BOOST   ARROWS: RIDER', HUD_COLORS.label, TIGHT_CENTER_OUTLINE);
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

const STAT_ROW_KEYS = ['stat0', 'stat1', 'stat2'];

/** A jagged comic burst behind contact words: red-orange, or gold behind red lettering (damage) so it still reads. */
function withBurst(text: HTMLCanvasElement, gold: boolean): HTMLCanvasElement {
  const w = text.width + 16;
  const h = text.height + 12;
  const { canvas, ctx } = makeCanvas(w, h, true); // read back by hardenAlpha: CPU-backed, so no GPU sync
  ctx.fillStyle = gold ? '#ffd23a' : '#ff5a3a';
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
