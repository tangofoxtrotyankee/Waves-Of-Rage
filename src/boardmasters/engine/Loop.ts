/**
 * Fixed-step simulation (60 Hz) with a render each animation frame. Long
 * gaps (a hidden tab, a hitch) are clamped to MAX_CATCH_UP steps so the
 * game never tries to catch up with a burst of work.
 */
/**
 * Six steps (100 ms) keep the game at full speed down to 10 frames per
 * second (a slow phone, or software rendering in tests): a step costs well
 * under a millisecond, so this cannot spiral. Longer gaps play as a moment of
 * slow motion.
 */
const MAX_CATCH_UP = 6;
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
    let elapsed = (now - this.last) / 1000;
    this.last = now;
    // rAF timestamps jitter around the step; snap them so frames run one step, not 0 then 2.
    if (Math.abs(elapsed - this.dt) < this.dt * 0.2) elapsed = this.dt;
    // At most MAX_CATCH_UP steps of catch-up; a moment of slow motion beats a spiral of work.
    this.accumulator = Math.min(this.accumulator + elapsed, this.dt * MAX_CATCH_UP);
    while (this.accumulator >= this.dt) {
      this.step(this.dt);
      this.accumulator -= this.dt;
    }
    this.draw();
    this.frame = requestAnimationFrame(this.tick);
  };
}
