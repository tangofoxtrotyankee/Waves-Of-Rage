import { PALETTE, VIEW } from '../game/constants';
import type { ComboKey } from '../game/Combos';

export type ButtonId = 'carveLeft' | 'forward' | 'carveRight' | 'jump' | 'attack' | 'barge';

export interface TouchButton {
  id: ButtonId;
  /** Centre and radius in internal pixels. */
  x: number;
  y: number;
  r: number;
  label: string;
  color: number;
  /** What a press feeds the combo reader. */
  key: ComboKey;
  /** The word on the pill under (or over) the button; the CARVE pair shares one, drawn by the left button. */
  caption: string;
  /** Where the caption pill sits: below the button, above it, or none. */
  captionAt: 'below' | 'above' | 'none';
}

const R = 18;
const ROW = VIEW.height - 32;
const ROW2 = VIEW.height - 74;

/**
 * The on-screen controls for phones. Left thumb: a pad of LEFT, UP and
 * RIGHT (hold LEFT/RIGHT to carve, hold UP to pump; taps feed combos).
 * Right thumb: JUMP, HIT and BRG. Drawn by the HUD (game/HudView.ts, with
 * pixel icons and caption pills), hit-tested by Input.
 */
export const TOUCH_BUTTONS: TouchButton[] = [
  { id: 'carveLeft', x: 28, y: ROW, r: R, label: '<', color: 0xc8d2e8, key: 'L', caption: 'CARVE', captionAt: 'below' },
  { id: 'carveRight', x: 76, y: ROW, r: R, label: '>', color: 0xc8d2e8, key: 'R', caption: '', captionAt: 'none' },
  { id: 'forward', x: 52, y: ROW2, r: R, label: 'UP', color: PALETTE.gold, key: 'F', caption: 'PUMP', captionAt: 'above' },
  { id: 'jump', x: VIEW.width - 34, y: ROW, r: 22, label: 'JUMP', color: PALETTE.foam, key: 'J', caption: 'JUMP', captionAt: 'below' },
  { id: 'attack', x: VIEW.width - 84, y: ROW, r: R, label: 'HIT', color: PALETTE.red, key: 'H', caption: 'ATTACK', captionAt: 'below' },
  { id: 'barge', x: VIEW.width - 59, y: ROW2, r: R, label: 'BRG', color: 0x3aa8ff, key: 'B', caption: 'BARGE', captionAt: 'above' },
];

/** The button under a point, with a little slack around each. */
export function buttonAt(x: number, y: number): TouchButton | null {
  for (const b of TOUCH_BUTTONS) if (Math.hypot(x - b.x, y - b.y) <= b.r + 5) return b;
  return null;
}
