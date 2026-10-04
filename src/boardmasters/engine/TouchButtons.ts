import { PALETTE, VIEW } from '../game/constants';
import type { ComboKey } from '../game/Combos';

export type ButtonId = 'carveLeft' | 'forward' | 'carveRight' | 'jump' | 'attack' | 'barge';

export interface TouchButton {
  id: ButtonId;
  /** Centre and radius in internal pixels (y follows the HUD's height: layoutTouchButtons). */
  x: number;
  y: number;
  r: number;
  /** The centre's height above the HUD's bottom edge. */
  fromBottom: number;
  label: string;
  color: number;
  /** What a press feeds the combo reader. */
  key: ComboKey;
  /** The word on the pill under (or over) the button; the CARVE pair shares one, drawn by the left button. */
  caption: string;
  /** Where the caption sits: on a pill below the button or above it, lettered inside the disc's lower rim, or none. */
  captionAt: 'below' | 'above' | 'inside' | 'none';
}

const R = 18;
/** The rows' heights above the HUD's bottom edge: the bottom row, and the row above it. */
const ROW = 32;
const ROW2 = 74;

/**
 * The on-screen controls for phones. Left thumb: a pad of LEFT, UP and
 * RIGHT (hold LEFT/RIGHT to carve, hold UP to pump; taps feed combos).
 * Right thumb: JUMP, HIT and BRG. Drawn by the HUD (game/HudView.ts, with
 * pixel icons and caption pills), hit-tested by Input. They sit at the
 * HUD's bottom edge, which upright is the screen's (VIEW.height follows the
 * screen; Renderer.fit calls layoutTouchButtons when it changes).
 */
export const TOUCH_BUTTONS: TouchButton[] = [
  { id: 'carveLeft', x: 28, y: VIEW.height - ROW, fromBottom: ROW, r: R, label: '<', color: 0xc8d2e8, key: 'L', caption: 'CARVE', captionAt: 'below' },
  { id: 'carveRight', x: 76, y: VIEW.height - ROW, fromBottom: ROW, r: R, label: '>', color: 0xc8d2e8, key: 'R', caption: '', captionAt: 'none' },
  { id: 'forward', x: 52, y: VIEW.height - ROW2, fromBottom: ROW2, r: R, label: 'UP', color: PALETTE.gold, key: 'F', caption: 'PUMP', captionAt: 'above' },
  { id: 'jump', x: VIEW.width - 34, y: VIEW.height - ROW, fromBottom: ROW, r: 22, label: 'JUMP', color: PALETTE.foam, key: 'J', caption: 'JUMP', captionAt: 'inside' },
  { id: 'attack', x: VIEW.width - 84, y: VIEW.height - ROW, fromBottom: ROW, r: R, label: 'HIT', color: PALETTE.red, key: 'H', caption: 'ATTACK', captionAt: 'below' },
  { id: 'barge', x: VIEW.width - 59, y: VIEW.height - ROW2, fromBottom: ROW2, r: R, label: 'BRG', color: 0x3aa8ff, key: 'B', caption: 'BARGE', captionAt: 'above' },
];

/** Put the buttons on the HUD's bottom edge again after VIEW.height changed. */
export function layoutTouchButtons(): void {
  for (const b of TOUCH_BUTTONS) b.y = VIEW.height - b.fromBottom;
}

/** Slack round a button's disc that still presses it (internal pixels); the left thumb's pad gets more, so the gaps between its buttons press the nearest. */
const SLACK = 5;
const PAD_SLACK = 12;

/** The nearest button under a point, with a little slack around each (more round the left thumb's pad). */
export function buttonAt(x: number, y: number): TouchButton | null {
  let best: TouchButton | null = null;
  let bestD = Infinity;
  for (const b of TOUCH_BUTTONS) {
    const d = Math.hypot(x - b.x, y - b.y);
    const pad = b.id === 'carveLeft' || b.id === 'carveRight' || b.id === 'forward';
    if (d <= b.r + (pad ? PAD_SLACK : SLACK) && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

/** The band at the HUD's bottom edge, internal pixels tall, where the buttons sit: a tap that misses them there is not a jump. */
export const CONTROLS_BAND = 100;
