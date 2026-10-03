import { clamp } from './math';
import { buttonAt, type ButtonId } from './TouchButtons';

/** What the game reads each fixed step. Booleans for actions are edge-triggered (true for one step). */
export interface InputState {
  /** -1 (screen-left) to 1 (screen-right). */
  steer: number;
  pump: boolean;
  brake: boolean;
  jump: boolean;
  attack: boolean;
  barge: boolean;
  /** Space, Enter or a tap. */
  start: boolean;
  /** Escape. */
  back: boolean;
  /** Left/Right pressed this step (menus). */
  menuLeft: boolean;
  menuRight: boolean;
  /** M: main menu from the pause panel. */
  menu: boolean;
  /** Where a tap landed, in internal pixels (touch only). */
  tapX: number | null;
  tapY: number | null;
}

/** Touch feel: a press shorter than this with less movement is a tap; a held finger steers like a stick. */
const TOUCH = {
  tapMaxMs: 250,
  tapMaxMovePx: 10,
  /** CSS pixels of horizontal travel from the touch-down point for full steer. */
  stickPx: 70,
} as const;

const PREVENT_DEFAULT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

interface Pointer {
  downX: number;
  x: number;
  downAt: number;
  moved: number;
  button: ButtonId | null;
}

/**
 * Keyboard (arrows/WASD, Space, X/J, Shift, Esc, Enter) merged with touch.
 * Touch: the on-screen buttons (TouchButtons.ts) while `buttonsActive`,
 * with CARVE held and HIT/BARGE pressed; elsewhere a held finger is a
 * horizontal stick (steer follows how far it moved from where it landed)
 * and a short tap jumps or starts. Several fingers at once are fine: one
 * can hold CARVE while another taps HIT.
 */
export class Input {
  /** The run sets this while playing so the buttons claim their corners. */
  buttonsActive = false;
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly pointers = new Map<number, Pointer>();
  private readonly buttonPresses = new Set<ButtonId>();
  private tap: { x: number; y: number } | null = null;

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
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.pointers.clear();
    });

    if (!touch) return;
    parent.addEventListener('pointerdown', (e) => {
      try {
        parent.setPointerCapture(e.pointerId);
      } catch {
        /* not a capturable pointer */
      }
      const p = this.toInternal(e.clientX, e.clientY);
      const button = this.buttonsActive ? buttonAt(p.x, p.y)?.id ?? null : null;
      if (button === 'attack' || button === 'barge') this.buttonPresses.add(button); // fire on press
      this.pointers.set(e.pointerId, { downX: e.clientX, x: e.clientX, downAt: performance.now(), moved: 0, button });
    });
    window.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.moved = Math.max(p.moved, Math.abs(e.clientX - p.downX));
    });
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (p.button) return;
      const quick = performance.now() - p.downAt <= TOUCH.tapMaxMs;
      if (quick && p.moved <= TOUCH.tapMaxMovePx) this.tap = this.toInternal(e.clientX, e.clientY);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  private hit(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** Read the state for one fixed step; edge flags and the tap are consumed. */
  poll(): InputState {
    let steer = (this.down('ArrowLeft', 'KeyA') ? -1 : 0) + (this.down('ArrowRight', 'KeyD') ? 1 : 0);
    for (const p of this.pointers.values()) {
      if (p.button === 'carveLeft') steer = -1;
      else if (p.button === 'carveRight') steer = 1;
      else if (!p.button && p.moved > TOUCH.tapMaxMovePx) steer = clamp((p.x - p.downX) / TOUCH.stickPx, -1, 1);
    }
    const tap = this.tap;
    const state: InputState = {
      steer,
      pump: this.down('ArrowUp', 'KeyW'),
      brake: this.down('ArrowDown', 'KeyS'),
      jump: this.hit('Space') || tap !== null,
      attack: this.hit('KeyX', 'KeyJ') || this.buttonPresses.has('attack'),
      barge: this.hit('ShiftLeft', 'ShiftRight') || this.buttonPresses.has('barge'),
      start: this.hit('Space', 'Enter') || tap !== null,
      back: this.hit('Escape'),
      menuLeft: this.hit('ArrowLeft', 'KeyA'),
      menuRight: this.hit('ArrowRight', 'KeyD'),
      menu: this.hit('KeyM'),
      tapX: tap ? tap.x : null,
      tapY: tap ? tap.y : null,
    };
    this.pressed.clear();
    this.buttonPresses.clear();
    this.tap = null;
    return state;
  }
}
