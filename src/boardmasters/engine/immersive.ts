import { IS_PORTRAIT } from '../game/constants';

/** Best-effort fullscreen plus an orientation lock matching the field, for phones. Never throws. */
export async function requestImmersiveMode(): Promise<void> {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* unsupported or refused: carry on windowed */
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.(IS_PORTRAIT ? 'portrait' : 'landscape');
  } catch {
    /* iOS and desktop: not supported */
  }
}
