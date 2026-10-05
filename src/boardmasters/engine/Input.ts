import type { ComboKey } from '../game/Combos';

/** What the game reads each fixed step. Booleans for actions are edge-triggered (true for one step). */
export interface InputState {
  /** -1 (screen-left) to 1 (screen-right); analogue from the touch stick. */
  steer: number;
  pump: boolean;
  brake: boolean;
  jump: boolean;
  attack: boolean;
  barge: boolean;
  /** Space, Enter, or a tap. */
  start: boolean;
  /** Escape. */
  back: boolean;
  /** Left/Right pressed this step (menus); on touch, a sideways swipe. */
  menuLeft: boolean;
  menuRight: boolean;
  /** M: main menu from the pause panel. */
  menu: boolean;
  /** Every key press this step, in order, for the combo reader (keyboard only). */
  presses: ComboKey[];
  /** Where a tap landed, in internal pixels (touch only). */
  tapX: number | null;
  tapY: number | null;
  /** A swipe that completed this step (touch only). */
  swipe: Swipe | null;
}

export type Swipe = 'up' | 'down' | 'left' | 'right';

/**
 * Touch feel, in CSS pixels (about the same size on every phone).
 *
 *  - A press shorter than `tapMaxMs` that moved less than `tapMaxMovePx` is
 *    a tap.
 *  - The steering stick floats under the first finger: the steer is the
 *    finger's offset from an anchor, full at `throwPx` past a dead zone of
 *    `deadPx`; the anchor is dragged along behind the finger, so reversing
 *    takes effect at once and lifting the finger straightens up.
 *  - A swipe is `swipePx` of travel in one direction (mostly along one
 *    axis) without a pause longer than `swipeMs` or a reversal; another
 *    cannot follow within `swipeGapMs`, and the stroke back the other way
 *    is not one within `swipeReturnMs` (a steering thumb that flicks up
 *    comes back down without barging). Measured by travel, not speed, so a
 *    slow device that delivers pointer events late still reads a flick.
 */
export const TOUCH = {
  tapMaxMs: 250,
  tapMaxMovePx: 12,
  deadPx: 5,
  throwPx: 34,
  swipePx: 32,
  swipeMs: 260,
  swipeGapMs: 300,
  swipeReturnMs: 550,
} as const;

const OPPOSITE: Record<Swipe, Swipe> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const PREVENT_DEFAULT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

/** Keyboard codes that count as combo presses. */
const KEY_PRESSES: Record<string, ComboKey> = {
  ArrowLeft: 'L',
  KeyA: 'L',
  ArrowRight: 'R',
  KeyD: 'R',
  ArrowUp: 'F',
  KeyW: 'F',
  Space: 'J',
  KeyX: 'H',
  KeyJ: 'H',
  ShiftLeft: 'B',
  ShiftRight: 'B',
};

interface Pointer {
  downX: number;
  downY: number;
  downAt: number;
  moved: number;
  /** The stick's anchor (the first finger steers). */
  anchorX: number;
  x: number;
  /** Where the current stroke started (reset by a pause or a reversal), and the last position and time seen. */
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
  lastAt: number;
  swipedAt: number;
  swiped: boolean;
  /** The last swipe's direction (the way back is not another swipe for a moment). */
  lastSwipe: Swipe | null;
}

/**
 * Keyboard (arrows/WASD, Space, X/J, Shift, Esc, Enter, M) merged with the
 * phone's gestures, the original game's way: the whole screen is the
 * control surface. The first finger down steers (a floating stick: drag and
 * hold to carve, lift to straighten), a flick up is JUMP, a flick down is
 * BARGE, and a tap is HIT (a grab in the air). Any finger may tap or flick,
 * so one thumb can steer while the other punches. Sideways flicks are
 * reported for menus (the character select). Key presses are also reported
 * in order for the combo reader; gestures are not combos.
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly pointers = new Map<number, Pointer>();
  private stickId: number | null = null;
  private presses: ComboKey[] = [];
  private tap: { x: number; y: number } | null = null;
  private swipe: Swipe | null = null;
  /** The steer the stick reads right now (-1..1, screen-right positive). */
  private stick = 0;

  constructor(
    parent: HTMLElement,
    readonly touch: boolean,
    private readonly toInternal: (clientX: number, clientY: number) => { x: number; y: number },
  ) {
    window.addEventListener('keydown', (e) => {
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressed.add(e.code);
      const key = KEY_PRESSES[e.code];
      if (key) this.presses.push(key);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.pointers.clear();
      this.stickId = null;
      this.stick = 0;
    });

    if (!touch) return;
    parent.addEventListener('pointerdown', (e) => {
      try {
        parent.setPointerCapture(e.pointerId);
      } catch {
        /* not a capturable pointer */
      }
      const now = performance.now();
      this.pointers.set(e.pointerId, {
        downX: e.clientX, downY: e.clientY, downAt: now, moved: 0, anchorX: e.clientX, x: e.clientX,
        originX: e.clientX, originY: e.clientY, lastX: e.clientX, lastY: e.clientY, lastAt: now, swipedAt: -1e9, swiped: false, lastSwipe: null,
      });
      if (this.stickId === null) this.stickId = e.pointerId;
    });
    window.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const now = performance.now();
      p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.downX, e.clientY - p.downY));
      p.x = e.clientX;
      // The stick: the anchor trails the finger by at most the throw, so the steer never saturates far from where the finger turns back.
      if (e.pointerId === this.stickId) {
        if (p.x - p.anchorX > TOUCH.throwPx) p.anchorX = p.x - TOUCH.throwPx;
        else if (p.anchorX - p.x > TOUCH.throwPx) p.anchorX = p.x + TOUCH.throwPx;
        this.stick = Input.stickValue(p.x - p.anchorX);
      }
      // Swipes: the stroke's travel since its origin, which moves up to the last position after a pause or a reversal.
      const stepX = e.clientX - p.lastX;
      const stepY = e.clientY - p.lastY;
      if (now - p.lastAt > TOUCH.swipeMs || stepX * (p.lastX - p.originX) + stepY * (p.lastY - p.originY) < 0) {
        p.originX = p.lastX;
        p.originY = p.lastY;
      }
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      p.lastAt = now;
      if (now - p.swipedAt < TOUCH.swipeGapMs) return;
      const dx = e.clientX - p.originX;
      const dy = e.clientY - p.originY;
      let swipe: Swipe | null = null;
      if (Math.abs(dy) >= TOUCH.swipePx && Math.abs(dy) > Math.abs(dx) * 1.2) swipe = dy < 0 ? 'up' : 'down';
      else if (Math.abs(dx) >= TOUCH.swipePx && Math.abs(dx) > Math.abs(dy) * 1.2) swipe = dx < 0 ? 'left' : 'right';
      if (!swipe) return;
      if (now - p.swipedAt < TOUCH.swipeReturnMs && swipe === OPPOSITE[p.lastSwipe as Swipe]) return;
      this.swipe = swipe;
      p.swipedAt = now;
      p.swiped = true;
      p.lastSwipe = swipe;
      p.originX = e.clientX;
      p.originY = e.clientY;
    });
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (e.pointerId === this.stickId) {
        // The next finger still down takes the stick, anchored where it is now.
        this.stickId = null;
        this.stick = 0;
        for (const [id, other] of this.pointers) {
          this.stickId = id;
          other.anchorX = other.x;
          break;
        }
      }
      const quick = performance.now() - p.downAt <= TOUCH.tapMaxMs;
      if (!quick || p.swiped || p.moved > TOUCH.tapMaxMovePx) return;
      this.tap = this.toInternal(e.clientX, e.clientY);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** The stick's steer for a finger `offset` CSS pixels from its anchor: a dead zone, then linear to the full throw. */
  static stickValue(offset: number): number {
    const a = Math.abs(offset);
    if (a <= TOUCH.deadPx) return 0;
    return Math.sign(offset) * Math.min(1, (a - TOUCH.deadPx) / (TOUCH.throwPx - TOUCH.deadPx));
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  private hit(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** True while a finger is steering (the HUD's hint fades once it has been). */
  get steering(): boolean {
    return this.stickId !== null;
  }

  /** Read the state for one fixed step; edge flags, presses, the tap and the swipe are consumed. */
  poll(): InputState {
    let steer = (this.down('ArrowLeft', 'KeyA') ? -1 : 0) + (this.down('ArrowRight', 'KeyD') ? 1 : 0);
    if (this.stick !== 0) steer = this.stick;
    const tap = this.tap;
    const swipe = this.swipe;
    const state: InputState = {
      steer,
      pump: this.down('ArrowUp', 'KeyW'),
      brake: this.down('ArrowDown', 'KeyS'),
      jump: this.hit('Space') || swipe === 'up',
      attack: this.hit('KeyX', 'KeyJ') || tap !== null,
      barge: this.hit('ShiftLeft', 'ShiftRight') || swipe === 'down',
      start: this.hit('Space', 'Enter') || tap !== null,
      back: this.hit('Escape'),
      menuLeft: this.hit('ArrowLeft', 'KeyA') || swipe === 'left',
      menuRight: this.hit('ArrowRight', 'KeyD') || swipe === 'right',
      menu: this.hit('KeyM'),
      presses: this.presses,
      tapX: tap ? tap.x : null,
      tapY: tap ? tap.y : null,
      swipe,
    };
    this.pressed.clear();
    this.presses = [];
    this.tap = null;
    this.swipe = null;
    return state;
  }
}
