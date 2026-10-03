import { clamp } from '../engine/math';
import { PHYSICS } from '../game/constants';
import type { RiderSpec } from '../game/characters';
import { Rider, type RiderControl } from './Rider';

/**
 * An AI rider. It follows a wavy racing line, pumps when it falls behind
 * and eases off when far ahead so it stays in the race, and rides ramps like
 * anyone else (the physics launches it). Blocking, shoulder checks and the
 * other rival behaviours from the original game come with combat.
 */
export class Rival extends Rider {
  private readonly phase: number;

  constructor(spec: RiderSpec, readonly index: number) {
    super(spec);
    this.phase = index * 2.1;
  }

  think(player: Rider, time: number): RiderControl {
    const line = 4.5 * Math.sin(this.z / 30 + this.phase);
    const steer = clamp((line - this.x) * 0.3 - this.heading * 1.2, -1, 1);
    const gap = player.z - this.z; // positive: behind the player
    const cruise = PHYSICS.baseSpeed * this.stats.speed * (1 + 0.06 * Math.sin(time * 0.6 + this.phase));
    this.targetSpeed = cruise + clamp(gap * 0.25, -4, 6);
    return { steer, pump: gap > 6, brake: false, jump: false };
  }
}
