/**
 * Fixed-step simulation (60 Hz) with a render each animation frame. Long
 * gaps (a hidden tab, a hitch) are clamped so the game never tries to catch
 * up with a burst of steps.
 */
export class Loop {
  private last = 0;
  private accumulator = 0;
  private frame = 0;
  running = false;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly draw: () => void,
    readonly dt = 1 / 60,
  ) {
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
      this.accumulator = 0;
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.accumulator += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    while (this.accumulator >= this.dt) {
      this.step(this.dt);
      this.accumulator -= this.dt;
    }
    this.draw();
    this.frame = requestAnimationFrame(this.tick);
  };
}
