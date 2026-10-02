import Phaser from 'phaser';

import { Obstacle, type HazardContext, type HazardKind } from '../entities/Obstacle';
import { PLAYER_BOUNDS } from '../entities/Player';
import { RivalSurfer } from '../entities/RivalSurfer';
import { Rock } from '../entities/Rock';
import { Shark } from '../entities/Shark';
import { WaveRamp } from '../entities/WaveRamp';
import { DIFFICULTY } from '../game/gameplay';
import { HORIZON_Y } from './OceanScroller';

export const SPAWN = {
  /** World pixels travelled between spawns (random within this range). */
  minGap: 80,
  maxGap: 150,
  /** Keep this many pixels of horizontal clearance from the previous spawn. */
  minLateralClearance: 48,
  /** Chance that a non-shark spawn is a rival surfer rather than a rock. */
  rivalChance: 0.35,
  /** Never have more than this many obstacles alive at once. */
  maxActive: 8,
  /** Where new obstacles appear (just below the horizon, drawn small). */
  spawnY: HORIZON_Y + 6,
  /** Horizontal padding so obstacles never hug the very edge. */
  edgePadding: 10,
} as const;

export const RAMP_SPAWN = {
  /** World pixels travelled between ramps (random within this range). */
  minGap: 380,
  maxGap: 680,
  /** For this much travel after a ramp, hazards keep this much lateral clearance from it. */
  hazardClearanceDistance: 110,
  hazardClearanceX: 56,
  /** Hazards are also held back for at least this much travel after a ramp spawns. */
  hazardHoldOff: 50,
} as const;

/**
 * Spawns hazards as the player travels.
 *
 * Spacing is measured in distance travelled rather than time, so the spawn
 * rate scales naturally with game speed, and the gap shrinks over run time
 * (DIFFICULTY). Sharks unlock after a survival threshold. Consecutive spawns
 * are kept apart horizontally so there is always a way through.
 */
export class ObstacleSpawner {
  private readonly obstacles: Phaser.GameObjects.Group;
  private travelledSinceSpawn = 0;
  private nextGap: number = SPAWN.minGap;
  private lastX = Number.NaN;
  private spawning = true;

  private travelledSinceRamp = 0;
  private nextRampGap: number = RAMP_SPAWN.minGap;
  private lastRampX = Number.NaN;
  private rampCount = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.obstacles = scene.add.group();
    this.nextGap = this.rollGap(0);
    this.nextRampGap = Phaser.Math.Between(RAMP_SPAWN.minGap, RAMP_SPAWN.maxGap);
  }

  /** Ramps spawned so far this run (debug readout). */
  get rampsSpawned(): number {
    return this.rampCount;
  }

  static rampsUnlocked(elapsedSeconds: number): boolean {
    return elapsedSeconds >= DIFFICULTY.rampAfterSeconds;
  }

  /** Live obstacles (destroyed ones are removed from the group automatically). */
  get active(): Obstacle[] {
    return this.obstacles.getChildren() as Obstacle[];
  }

  /** Seconds until the next spawn at the given speed (debug readout). */
  secondsUntilNext(gameSpeed: number): number {
    if (!this.spawning) return Infinity;
    return Math.max(0, this.nextGap - this.travelledSinceSpawn) / Math.max(gameSpeed, 1);
  }

  /** Whether sharks are currently in the spawn pool. */
  static sharksUnlocked(elapsedSeconds: number): boolean {
    return elapsedSeconds >= DIFFICULTY.sharkAfterSeconds;
  }

  /** Current multiplier on spawn gaps: 1 at the start, shrinking over time. */
  static gapMultiplier(elapsedSeconds: number): number {
    const t = Phaser.Math.Clamp(elapsedSeconds / DIFFICULTY.spawnRampSeconds, 0, 1);
    return Phaser.Math.Linear(1, DIFFICULTY.spawnGapMultiplierMin, t);
  }

  /** Stop producing new hazards (existing ones keep moving). */
  stop(): void {
    this.spawning = false;
  }

  update(delta: number, gameSpeed: number, elapsedSeconds: number, ctx: HazardContext): void {
    const dt = delta / 1000;
    const travelled = gameSpeed * dt;
    this.travelledSinceSpawn += travelled;
    this.travelledSinceRamp += travelled;

    for (const obstacle of this.active) {
      obstacle.update(delta, gameSpeed, ctx);
    }

    if (!this.spawning) return;

    if (ObstacleSpawner.rampsUnlocked(elapsedSeconds) && this.travelledSinceRamp >= this.nextRampGap) {
      this.spawnRamp();
      this.travelledSinceRamp = 0;
      this.nextRampGap = Phaser.Math.Between(RAMP_SPAWN.minGap, RAMP_SPAWN.maxGap);
      // Give the player a clear row after the ramp before the next hazard.
      this.travelledSinceSpawn = Math.min(this.travelledSinceSpawn, this.nextGap - RAMP_SPAWN.hazardHoldOff);
    }

    if (this.travelledSinceSpawn >= this.nextGap && this.hazardCount < SPAWN.maxActive) {
      this.spawn(elapsedSeconds);
      this.travelledSinceSpawn = 0;
      this.nextGap = this.rollGap(elapsedSeconds);
    }
  }

  /**
   * Debug / test helper: spawn a specific kind right now at `x` (random if
   * omitted). Not used by normal gameplay.
   */
  debugSpawn(kind: HazardKind, x = this.rollX()): Obstacle {
    const y = SPAWN.spawnY;
    let obstacle: Obstacle;
    switch (kind) {
      case 'rock':
        obstacle = new Rock(this.scene, x, y);
        break;
      case 'rival':
        obstacle = new RivalSurfer(this.scene, x, y);
        break;
      case 'shark':
        obstacle = new Shark(this.scene, x, y);
        break;
      case 'ramp':
        obstacle = new WaveRamp(this.scene, x, y);
        this.rampCount++;
        break;
    }
    this.obstacles.add(obstacle);
    return obstacle;
  }

  private get hazardCount(): number {
    return this.active.filter((o) => o.kind !== 'ramp').length;
  }

  private spawnRamp(): void {
    const min = PLAYER_BOUNDS.minX + SPAWN.edgePadding;
    const max = PLAYER_BOUNDS.maxX - SPAWN.edgePadding;
    const x = Phaser.Math.Between(min, max);
    this.obstacles.add(new WaveRamp(this.scene, x, SPAWN.spawnY));
    this.lastRampX = x;
    this.rampCount++;
  }

  private spawn(elapsedSeconds: number): void {
    const x = this.rollX();
    const obstacle = this.pick(elapsedSeconds, x);
    this.obstacles.add(obstacle);
    this.lastX = x;
  }

  private pick(elapsedSeconds: number, x: number): Obstacle {
    if (ObstacleSpawner.sharksUnlocked(elapsedSeconds) && Math.random() < DIFFICULTY.sharkChance) {
      return new Shark(this.scene, x, SPAWN.spawnY);
    }
    return Math.random() < SPAWN.rivalChance
      ? new RivalSurfer(this.scene, x, SPAWN.spawnY)
      : new Rock(this.scene, x, SPAWN.spawnY);
  }

  private rollGap(elapsedSeconds: number): number {
    return Phaser.Math.Between(SPAWN.minGap, SPAWN.maxGap) * ObstacleSpawner.gapMultiplier(elapsedSeconds);
  }

  private rollX(): number {
    const min = PLAYER_BOUNDS.minX + SPAWN.edgePadding;
    const max = PLAYER_BOUNDS.maxX - SPAWN.edgePadding;
    const nearRamp = this.travelledSinceRamp < RAMP_SPAWN.hazardClearanceDistance;
    const tooClose = (x: number) =>
      Math.abs(x - this.lastX) < SPAWN.minLateralClearance || (nearRamp && Math.abs(x - this.lastRampX) < RAMP_SPAWN.hazardClearanceX);

    let x = Phaser.Math.Between(min, max);
    for (let attempt = 0; attempt < 8 && tooClose(x); attempt++) {
      x = Phaser.Math.Between(min, max);
    }
    return x;
  }
}
