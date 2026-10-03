import { clamp } from '../engine/math';
import type { RiderSpec } from '../game/characters';
import { COMBAT, PHYSICS } from '../game/constants';
import { Rider, type RiderControl } from './Rider';

const IDLE: RiderControl = { steer: 0, pump: false, brake: false, jump: false, attack: false, barge: false };

/**
 * An AI rider. It follows a wavy racing line in its own lane, steers round
 * buoys, pumps when it falls behind and eases off when far ahead so the
 * pack stays in the race, and rides ramps like anyone else (the physics
 * launches it). Rivals with enough POWER shoulder-check the player when
 * alongside, on a cooldown, like the original game's rivals.
 */
export class Rival extends Rider {
  private readonly phase: number;
  private readonly laneOffset: number;
  private nextCheckAt = 0;
  private checkingUntil = 0;

  constructor(spec: RiderSpec, readonly index: number) {
    super(spec);
    this.phase = index * 2.1;
    this.laneOffset = ((index % 4) - 1.5) * 2.2;
  }

  think(player: Rider, buoys: { x: number; z: number }[], time: number): RiderControl {
    if (this.wiped) return IDLE;
    let lane = 4.5 * Math.sin(this.z / 30 + this.phase) + this.laneOffset;
    for (const b of buoys) {
      const dz = b.z - this.z;
      if (dz > 0 && dz < 14 && Math.abs(b.x - this.x) < 2.4) lane = this.x + (this.x >= b.x ? 3 : -3);
    }
    const alongside = !player.wiped && Math.abs(player.z - this.z) < 3 && Math.abs(player.x - this.x) < 3.2;
    if (this.spec.power >= COMBAT.rivalAggression && alongside && time >= this.nextCheckAt) {
      this.checkingUntil = time + COMBAT.rivalCheckSeconds;
      this.nextCheckAt = time + COMBAT.rivalCheckCooldown;
    }
    const checking = time < this.checkingUntil;
    if (checking) lane = player.x;
    lane = clamp(lane, -PHYSICS.trackHalfWidth + 1.5, PHYSICS.trackHalfWidth - 1.5);
    const steer = clamp((lane - this.x) * 0.3 - this.heading * 1.2, -1, 1);
    const gap = player.z - this.z; // positive: behind the player
    const cruise = PHYSICS.baseSpeed * this.stats.speed * (1 + 0.06 * Math.sin(time * 0.6 + this.phase));
    this.targetSpeed = cruise + clamp(gap * 0.25, -4, 6);
    const barge = checking && Math.abs(player.x - this.x) < 1.4 && Math.abs(player.z - this.z) < 2.2;
    return { steer, pump: gap > 6, brake: false, jump: false, attack: false, barge };
  }
}
