import { IS_PORTRAIT, VIEW } from './constants';

/**
 * Where the HUD's tappable things sit, shared by the drawing (HudView) and
 * the rules that hit-test taps (Run.update). Internal pixels of the HUD
 * canvas, which is always VIEW-sized (the 3D resolution may differ).
 */

/** The pause button at the top centre of the HUD on touch screens; taps within 6px of it count. */
export const PAUSE_ZONE = { w: 28, h: 14 } as const;

/** Distance from the character column's centre to the select arrows on the title. */
export const ARROW_DX = IS_PORTRAIT ? 92 : 74;

/**
 * The title's menu column: upright, under the logo and centred; landscape,
 * to the right of the logo. `rowY` is the character name row (the arrows'
 * row), `playY` the highlighted PLAY row.
 */
export const TITLE = IS_PORTRAIT
  ? {
      logoX: (VIEW.width - 236) / 2,
      logoY: 22,
      columnX: VIEW.width / 2,
      columnW: 220,
      playY: 144,
      rowY: 172,
    }
  : { logoX: 4, logoY: 30, columnX: VIEW.width - 92, columnW: 176, playY: 30, rowY: 62 };

/** Y of the character name row on the title (the arrows' tap zones are centred on it). */
export function titleRow(): number {
  return TITLE.rowY;
}

/** Left and right character arrows' centres on the title. */
export function titleArrowX(direction: -1 | 1): number {
  return TITLE.columnX + direction * ARROW_DX;
}
