/**
 * On-screen touch controls, rendered as DOM buttons over the game canvas.
 *
 * Shown automatically on touch devices (or with `?touch=1` for desktop
 * testing). Button state is exposed through `touchState`, which the
 * keyboard-oriented `Controls` class merges in, so the rest of the game
 * never knows which input device is in use. Taps on the canvas itself are
 * handled by the scenes (they act like Space).
 */

export interface TouchState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  attackRequested: boolean;
  bargeRequested: boolean;
  /** True once the overlay has been installed (used for on-screen hints). */
  enabled: boolean;
}

export const touchState: TouchState = {
  left: false,
  right: false,
  up: false,
  down: false,
  attackRequested: false,
  bargeRequested: false,
  enabled: false,
};

/** True on phones/tablets, or when forced with `?touch=1`. */
export function shouldUseTouch(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('touch') === '1') return true;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

type Held = keyof Pick<TouchState, 'left' | 'right' | 'up' | 'down'>;

interface ButtonSpec {
  id: string;
  label: string;
  className?: string;
  style?: Partial<CSSStyleDeclaration>;
  hold?: Held;
  press?: 'attack' | 'barge';
}

const BUTTONS: ButtonSpec[] = [
  { id: 'touch-up', label: '▲', hold: 'up', style: { gridColumn: '2', gridRow: '1' } },
  { id: 'touch-left', label: '◀', hold: 'left', style: { gridColumn: '1', gridRow: '2' } },
  { id: 'touch-right', label: '▶', hold: 'right', style: { gridColumn: '3', gridRow: '2' } },
  { id: 'touch-down', label: '▼', hold: 'down', style: { gridColumn: '2', gridRow: '3' } },
  { id: 'touch-barge', label: 'BARGE', press: 'barge', className: 'touch-btn--round' },
  { id: 'touch-attack', label: 'HIT', press: 'attack', className: 'touch-btn--round' },
];

/** Build the overlay inside the game's parent element. Safe to call once. */
export function installTouchControls(parentId = 'game'): void {
  const parent = document.getElementById(parentId);
  if (!parent || document.getElementById('touch')) return;

  const root = document.createElement('div');
  root.id = 'touch';

  const pad = document.createElement('div');
  pad.className = 'touch-pad';
  const actions = document.createElement('div');
  actions.className = 'touch-actions';

  for (const spec of BUTTONS) {
    const el = document.createElement('div');
    el.id = spec.id;
    el.className = `touch-btn ${spec.className ?? ''}`.trim();
    el.textContent = spec.label;
    Object.assign(el.style, spec.style ?? {});
    bind(el, spec);
    (spec.hold ? pad : actions).appendChild(el);
  }

  const hint = document.createElement('div');
  hint.className = 'touch-hint';
  hint.textContent = 'TAP = JUMP / START';

  root.append(hint, pad, actions);
  parent.appendChild(root);
  touchState.enabled = true;

  // Fade the hint out once the player has tapped the canvas.
  parent.addEventListener('pointerdown', () => root.classList.add('touch--used'), { once: true });
}

/** Wire one button: held directions track pointer down/up, actions latch a request. */
function bind(el: HTMLElement, spec: ButtonSpec): void {
  const activePointers = new Set<number>();

  const down = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    activePointers.add(event.pointerId);
    el.classList.add('is-down');
    if (spec.hold) touchState[spec.hold] = true;
    if (spec.press === 'attack') touchState.attackRequested = true;
    if (spec.press === 'barge') touchState.bargeRequested = true;
  };

  const up = (event: PointerEvent) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size > 0) return;
    el.classList.remove('is-down');
    if (spec.hold) touchState[spec.hold] = false;
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
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
