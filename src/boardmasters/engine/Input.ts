import { clamp } from './math';

/** What the game reads each fixed step. Booleans ending in a verb are edge-triggered (true for one step). */
export interface InputState {
  /** -1 (left) to 1 (right). */
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
  /** Where the tap landed, in internal pixels (touch only). */
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

/**
 * Keyboard (arrows/WASD, Space, X/J, Shift, Esc, Enter) merged with a touch
 * surface over the whole page: a held finger is a horizontal stick (steer
 * follows how far it moved from where it landed), a short tap jumps or
 * starts. Attack and barge are keyboard-only until the on-screen buttons
 * from the gameplay mockup arrive with combat.
 */
export class Input {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private pointer: { id: number; downX: number; x: number; downAt: number; moved: number } | null = null;
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
    window.addEventListener('blur', () => this.held.clear());

    if (!touch) return;
    parent.addEventListener('pointerdown', (e) => {
      if (this.pointer) return; // one steering finger at a time
      this.pointer = { id: e.pointerId, downX: e.clientX, x: e.clientX, downAt: performance.now(), moved: 0 };
    });
    parent.addEventListener('pointermove', (e) => {
      if (!this.pointer || e.pointerId !== this.pointer.id) return;
      this.pointer.x = e.clientX;
      this.pointer.moved = Math.max(this.pointer.moved, Math.abs(e.clientX - this.pointer.downX));
    });
    const end = (e: PointerEvent) => {
      if (!this.pointer || e.pointerId !== this.pointer.id) return;
      const quick = performance.now() - this.pointer.downAt <= TOUCH.tapMaxMs;
      if (quick && this.pointer.moved <= TOUCH.tapMaxMovePx) this.tap = this.toInternal(e.clientX, e.clientY);
      this.pointer = null;
    };
    parent.addEventListener('pointerup', end);
    parent.addEventListener('pointercancel', end);
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
    if (this.pointer && this.pointer.moved > TOUCH.tapMaxMovePx) steer = clamp((this.pointer.x - this.pointer.downX) / TOUCH.stickPx, -1, 1);
    const tap = this.tap;
    const state: InputState = {
      steer,
      pump: this.down('ArrowUp', 'KeyW'),
      brake: this.down('ArrowDown', 'KeyS'),
      jump: this.hit('Space') || tap !== null,
      attack: this.hit('KeyX', 'KeyJ'),
      barge: this.hit('ShiftLeft', 'ShiftRight'),
      start: this.hit('Space', 'Enter') || tap !== null,
      back: this.hit('Escape'),
      tapX: tap ? tap.x : null,
      tapY: tap ? tap.y : null,
    };
    this.pressed.clear();
    this.tap = null;
    return state;
  }
}
