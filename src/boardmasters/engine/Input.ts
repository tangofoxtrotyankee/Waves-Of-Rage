import type { ComboKey } from '../game/Combos';
import { VIEW } from '../game/constants';
import { buttonAt, CONTROLS_BAND, type ButtonId } from './TouchButtons';

/** What the game reads each fixed step. Booleans for actions are edge-triggered (true for one step). */
export interface InputState {
  /** -1 (screen-left) to 1 (screen-right). */
  steer: number;
  pump: boolean;
  brake: boolean;
  jump: boolean;
  attack: boolean;
  barge: boolean;
  /** Space, Enter, the JUMP button or a tap. */
  start: boolean;
  /** Escape. */
  back: boolean;
  /** Left/Right pressed this step (menus). */
  menuLeft: boolean;
  menuRight: boolean;
  /** M: main menu from the pause panel. */
  menu: boolean;
  /** Every press this step, in order, for the combo reader. */
  presses: ComboKey[];
  /** Where a tap landed, in internal pixels (touch only). */
  tapX: number | null;
  tapY: number | null;
}

/** A press shorter than this with less movement is a tap. */
const TOUCH = { tapMaxMs: 250, tapMaxMovePx: 10 } as const;

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
  button: ButtonId | null;
}

/**
 * Keyboard (arrows/WASD, Space, X/J, Shift, Esc, Enter) merged with the
 * phone's buttons (TouchButtons.ts) while `buttonsActive`: LEFT/RIGHT held
 * carve, UP held pumps, JUMP/HIT/BRG fire on press, and several fingers
 * work at once. Outside the buttons a short tap jumps or starts (in play,
 * not one among the controls at the bottom edge: CONTROLS_BAND). Every
 * press, from either source, is also reported for the combo reader.
 */
export class Input {
  /** The run sets this while playing so the buttons claim their corners. */
  buttonsActive = false;
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly pointers = new Map<number, Pointer>();
  private readonly buttonPresses = new Set<ButtonId>();
  private presses: ComboKey[] = [];
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
      const key = KEY_PRESSES[e.code];
      if (key) this.presses.push(key);
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
      const button = this.buttonsActive ? buttonAt(p.x, p.y) : null;
      if (button) {
        this.buttonPresses.add(button.id); // JUMP, HIT and BRG fire on press; LEFT/RIGHT/UP act while held
        this.presses.push(button.key);
      }
      this.pointers.set(e.pointerId, { downX: e.clientX, downY: e.clientY, downAt: performance.now(), moved: 0, button: button?.id ?? null });
    });
    window.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p) p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.downX, e.clientY - p.downY));
    });
    const end = (e: PointerEvent) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      if (p.button) return;
      const quick = performance.now() - p.downAt <= TOUCH.tapMaxMs;
      if (!quick || p.moved > TOUCH.tapMaxMovePx) return;
      const at = this.toInternal(e.clientX, e.clientY);
      // A thumb that just misses a button (between the CARVE pair, under one) must not jump: in play, taps among the controls do nothing.
      if (this.buttonsActive && at.y > VIEW.height - CONTROLS_BAND) return;
      this.tap = at;
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

  /** True while a finger is on this on-screen button (the HUD lights it). */
  holding(id: ButtonId): boolean {
    for (const p of this.pointers.values()) if (p.button === id) return true;
    return false;
  }

  /** Read the state for one fixed step; edge flags, presses and the tap are consumed. */
  poll(): InputState {
    let steer = (this.down('ArrowLeft', 'KeyA') ? -1 : 0) + (this.down('ArrowRight', 'KeyD') ? 1 : 0);
    if (this.holding('carveLeft')) steer = -1;
    if (this.holding('carveRight')) steer = 1;
    const tap = this.tap;
    const state: InputState = {
      steer,
      pump: this.down('ArrowUp', 'KeyW') || this.holding('forward'),
      brake: this.down('ArrowDown', 'KeyS'),
      jump: this.hit('Space') || this.buttonPresses.has('jump') || tap !== null,
      attack: this.hit('KeyX', 'KeyJ') || this.buttonPresses.has('attack'),
      barge: this.hit('ShiftLeft', 'ShiftRight') || this.buttonPresses.has('barge'),
      start: this.hit('Space', 'Enter') || this.buttonPresses.has('jump') || tap !== null,
      back: this.hit('Escape'),
      menuLeft: this.hit('ArrowLeft', 'KeyA'),
      menuRight: this.hit('ArrowRight', 'KeyD'),
      menu: this.hit('KeyM'),
      presses: this.presses,
      tapX: tap ? tap.x : null,
      tapY: tap ? tap.y : null,
    };
    this.pressed.clear();
    this.buttonPresses.clear();
    this.presses = [];
    this.tap = null;
    return state;
  }
}
