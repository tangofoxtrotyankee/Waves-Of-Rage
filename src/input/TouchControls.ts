/**
 * Touch input: drag anywhere to steer, tap to jump.
 *
 * Playtesting showed that on-screen buttons do not work for a portrait
 * phone, so the whole page is one touch surface. Movement is relative: the
 * surfer follows the finger's deltas (so a thumb in the black band below
 * the canvas never covers the action). A short tap with little movement is
 * a jump (and a grab while in big air; a start on the title screen).
 *
 * Deltas are converted from screen pixels to game pixels using the canvas'
 * current scale and exposed through `touchState`, which `Controls` merges
 * with the keyboard. Combat (punch, barge) is keyboard-only.
 */
import { GAME_WIDTH } from '../game/constants';

export interface TouchState {
  /** Accumulated drag since last consumed, in game pixels. */
  dragX: number;
  dragY: number;
  /** Set by a tap; consumed by the player (jump/grab) or a scene (start/restart). */
  tapRequested: boolean;
  /** True once touch input has been installed (used for on-screen wording). */
  enabled: boolean;
}

export const touchState: TouchState = { dragX: 0, dragY: 0, tapRequested: false, enabled: false };

/** Drag feel. Finger movement is multiplied by this before being applied in game pixels. */
export const TOUCH = {
  sensitivity: 1.15,
  /** A press shorter than this with less movement than `tapMaxMovePx` is a tap. */
  tapMaxMs: 250,
  tapMaxMovePx: 10,
} as const;

/** True on phones/tablets, or when forced with `?touch=1`. */
export function shouldUseTouch(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('touch') === '1') return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

/** Take the drag accumulated since the last call (game pixels) and reset it. */
export function consumeDrag(): { x: number; y: number } {
  const out = { x: touchState.dragX, y: touchState.dragY };
  touchState.dragX = 0;
  touchState.dragY = 0;
  return out;
}

/** True once per tap; reading it clears the request. */
export function consumeTap(): boolean {
  const tapped = touchState.tapRequested;
  touchState.tapRequested = false;
  return tapped;
}

/** Install the drag/tap surface over the game's parent element. Safe to call once. */
export function installTouchControls(parentId = 'game'): void {
  const parent = document.getElementById(parentId);
  if (!parent || parent.dataset.touchInstalled) return;
  parent.dataset.touchInstalled = '1';

  const hint = document.createElement('div');
  hint.id = 'touch-hint';
  hint.textContent = 'DRAG TO MOVE · TAP TO JUMP';
  parent.appendChild(hint);

  let activeId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let moved = 0;

  /** Screen pixels per game pixel, from the canvas' rendered size. */
  const scale = () => {
    const canvas = parent.querySelector('canvas');
    return canvas ? canvas.getBoundingClientRect().width / GAME_WIDTH : 1;
  };

  parent.addEventListener('pointerdown', (e) => {
    if (activeId !== null) return; // one steering finger at a time
    activeId = e.pointerId;
    lastX = startX = e.clientX;
    lastY = startY = e.clientY;
    startTime = performance.now();
    moved = 0;
    parent.classList.add('touch--used');
  });

  parent.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    const s = scale();
    touchState.dragX += ((e.clientX - lastX) / s) * TOUCH.sensitivity;
    touchState.dragY += ((e.clientY - lastY) / s) * TOUCH.sensitivity;
    lastX = e.clientX;
    lastY = e.clientY;
    moved = Math.max(moved, Math.hypot(e.clientX - startX, e.clientY - startY));
  });

  const end = (e: PointerEvent) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    const quick = performance.now() - startTime <= TOUCH.tapMaxMs;
    if (quick && moved <= TOUCH.tapMaxMovePx) touchState.tapRequested = true;
  };
  parent.addEventListener('pointerup', end);
  parent.addEventListener('pointercancel', end);

  touchState.enabled = true;
}

/** Best-effort fullscreen + landscape lock for phones. Never throws. */
export async function requestImmersiveMode(): Promise<void> {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* unsupported or refused: carry on windowed */
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.('landscape');
  } catch {
    /* iOS and desktop: not supported */
  }
}
