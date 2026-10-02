import Phaser from 'phaser';

import { Obstacle, type HazardContext } from '../entities/Obstacle';
import { PLAYER_BOUNDS } from '../entities/Player';
import { RivalSurfer } from '../entities/RivalSurfer';
import { Rock } from '../entities/Rock';
import { Shark } from '../entities/Shark';
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

  constructor(private readonly scene: Phaser.Scene) {
    this.obstacles = scene.add.group();
    this.nextGap = this.rollGap(0);
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
    this.travelledSinceSpawn += gameSpeed * dt;

    for (const obstacle of this.active) {
      obstacle.update(delta, gameSpeed, ctx);
    }

    if (this.spawning && this.travelledSinceSpawn >= this.nextGap && this.active.length < SPAWN.maxActive) {
      this.spawn(elapsedSeconds);
      this.travelledSinceSpawn = 0;
      this.nextGap = this.rollGap(elapsedSeconds);
    }
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
    let x = Phaser.Math.Between(min, max);
    for (let attempt = 0; attempt < 6 && Math.abs(x - this.lastX) < SPAWN.minLateralClearance; attempt++) {
      x = Phaser.Math.Between(min, max);
    }
    return x;
  }
}
