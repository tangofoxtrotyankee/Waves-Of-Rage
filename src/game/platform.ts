/**
 * Platform detection, evaluated once at module load so the internal
 * resolution and every layout constant derived from it agree.
 *
 * - Phones and tablets get touch play and the portrait field: the game is
 *   a one-thumb avoidance game held upright.
 * - Everything else, including touchscreen laptops and desktop monitors
 *   whose primary input is a mouse or trackpad, gets the landscape field
 *   and keyboard play.
 *
 * Overrides for testing: `?touch=1` forces touch, `?portrait=1` /
 * `?landscape=1` force a field orientation.
 */
const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

/** Screens whose shorter side is at most this many CSS pixels count as handheld. */
const HANDHELD_MAX_SHORT_SIDE = 820;

/**
 * True for a phone/tablet form factor, not merely "has a touchscreen".
 * A hybrid laptop reports touch points but its primary pointer is fine
 * and hover-capable, so it stays on the desktop layout.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (params.get('touch') === '1') return true;

  const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  if (!hasTouch) return false;

  const handheldPointer = window.matchMedia?.('(pointer: coarse) and (hover: none)').matches ?? false;
  const shortSide = Math.min(window.screen?.width ?? Infinity, window.screen?.height ?? Infinity);
  return handheldPointer || shortSide <= HANDHELD_MAX_SHORT_SIDE;
}

export function usePortraitLayout(): boolean {
  if (params.get('portrait') === '1') return true;
  if (params.get('landscape') === '1') return false;
  return isTouchDevice();
}

/**
 * The testing overrides in force (`touch`, `portrait`, `landscape`), as a
 * query string to carry across a navigation between the two games' pages,
 * so `?touch=1` on the title still applies in the sequel and on the way back.
 */
export function platformOverrideQuery(): string {
  const carried = new URLSearchParams();
  for (const key of ['touch', 'portrait', 'landscape']) {
    const value = params.get(key);
    if (value !== null) carried.set(key, value);
  }
  return carried.toString();
}
