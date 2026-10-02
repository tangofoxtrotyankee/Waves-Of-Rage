/**
 * Platform detection, evaluated once at module load so the internal
 * resolution and every layout constant derived from it agree.
 *
 * - Touch devices (phones, tablets) get the portrait field: the game is a
 *   one-thumb avoidance game held upright.
 * - Everything else gets the landscape field.
 *
 * Overrides for testing: `?touch=1` forces touch, `?portrait=1` /
 * `?landscape=1` force a field orientation.
 */
const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (params.get('touch') === '1') return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export function usePortraitLayout(): boolean {
  if (params.get('portrait') === '1') return true;
  if (params.get('landscape') === '1') return false;
  return isTouchDevice();
}
