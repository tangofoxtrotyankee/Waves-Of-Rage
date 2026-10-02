import Phaser from 'phaser';

import { Obstacle } from '../entities/Obstacle';
import { PLAYER_BOUNDS } from '../entities/Player';
import { RivalSurfer } from '../entities/RivalSurfer';
import { Rock } from '../entities/Rock';
import { HORIZON_Y } from './OceanScroller';

export const SPAWN = {
  /** World pixels travelled between spawns (random within this range). */
  minGap: 80,
  maxGap: 150,
  /** Keep this many pixels of horizontal clearance from the previous spawn. */
  minLateralClearance: 48,
  /** Chance that a spawn is a rival surfer rather than a rock. */
  rivalChance: 0.35,
  /** Never have more than this many obstacles alive at once. */
  maxActive: 8,
  /** Where new obstacles appear (just below the horizon, drawn small). */
  spawnY: HORIZON_Y + 6,
  /** Horizontal padding so obstacles never hug the very edge. */
  edgePadding: 10,
} as const;

/**
 * Spawns rocks and rival surfers as the player travels.
 *
 * Spacing is measured in distance travelled rather than time, so the spawn
 * rate scales naturally with game speed. Consecutive spawns are kept apart
 * horizontally so there is always a way through.
 */
export class ObstacleSpawner {
  private readonly obstacles: Phaser.GameObjects.Group;
  private travelledSinceSpawn = 0;
  private nextGap: number = SPAWN.minGap;
  private lastX = Number.NaN;

  constructor(private readonly scene: Phaser.Scene) {
    this.obstacles = scene.add.group();
    this.nextGap = this.rollGap();
  }

  /** Live obstacles (destroyed ones are removed from the group automatically). */
  get active(): Obstacle[] {
    return this.obstacles.getChildren() as Obstacle[];
  }

  /** Seconds until the next spawn at the given speed (debug readout). */
  secondsUntilNext(gameSpeed: number): number {
    return Math.max(0, this.nextGap - this.travelledSinceSpawn) / Math.max(gameSpeed, 1);
  }

  update(delta: number, gameSpeed: number): void {
    const dt = delta / 1000;
    this.travelledSinceSpawn += gameSpeed * dt;

    for (const obstacle of this.active) {
      obstacle.update(delta, gameSpeed);
    }

    if (this.travelledSinceSpawn >= this.nextGap && this.active.length < SPAWN.maxActive) {
      this.spawn();
      this.travelledSinceSpawn = 0;
      this.nextGap = this.rollGap();
    }
  }

  private spawn(): void {
    const x = this.rollX();
    const obstacle =
      Math.random() < SPAWN.rivalChance
        ? new RivalSurfer(this.scene, x, SPAWN.spawnY)
        : new Rock(this.scene, x, SPAWN.spawnY);
    this.obstacles.add(obstacle);
    this.lastX = x;
  }

  private rollGap(): number {
    return Phaser.Math.Between(SPAWN.minGap, SPAWN.maxGap);
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
