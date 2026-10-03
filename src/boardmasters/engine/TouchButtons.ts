import { PALETTE, VIEW } from '../game/constants';

export type ButtonId = 'carveLeft' | 'carveRight' | 'attack' | 'barge';

export interface TouchButton {
  id: ButtonId;
  /** Centre and radius in internal pixels. */
  x: number;
  y: number;
  r: number;
  label: string;
  color: number;
}

const R = 17;
const Y = VIEW.height - 30;

/** The on-screen buttons from the gameplay mockup: CARVE < > bottom-left, HIT and BARGE bottom-right. Drawn by the HUD, hit-tested by Input. */
export const TOUCH_BUTTONS: TouchButton[] = [
  { id: 'carveLeft', x: 26, y: Y, r: R, label: '<', color: PALETTE.cyan },
  { id: 'carveRight', x: 68, y: Y, r: R, label: '>', color: PALETTE.cyan },
  { id: 'attack', x: VIEW.width - 68, y: Y, r: R, label: 'HIT', color: PALETTE.red },
  { id: 'barge', x: VIEW.width - 26, y: Y, r: R, label: 'BRG', color: PALETTE.gold },
];

/** The button under a point, with a little slack around each. */
export function buttonAt(x: number, y: number): TouchButton | null {
  for (const b of TOUCH_BUTTONS) if (Math.hypot(x - b.x, y - b.y) <= b.r + 6) return b;
  return null;
}
