import { clamp } from '../engine/math';
import type { RiderSpec } from '../game/characters';
import { COMBAT, PHYSICS } from '../game/constants';
import { Rider, type RiderControl } from './Rider';

const IDLE: RiderControl = { steer: 0, pump: false, brake: false, jump: false, attack: false, barge: false };

/** What the run tells the rivals each step (one object, reused). */
export interface RivalContext {
  /** A race is on (the rules apply): rivals may attack the surfer. */
  fight: boolean;
  /** No other rival has just started an attack (the run staggers them, COMBAT.rivalStagger): this one may. */
  attackOpen: boolean;
}

/**
 * An AI rider. It follows a wavy racing line in its own lane, steers round
 * buoys, pumps when it falls behind and eases off when far ahead so the
 * pack stays in the race, and rides ramps like anyone else (the physics
 * launches it). Rivals with enough POWER fight back: with an attack ready
 * they close in alongside the surfer and throw a telegraphed punch (a long
 * wind-up the surfer can read, Rider.telegraphPunch) or a shoulder check,
 * on a cooldown of their own and staggered by the run so two rarely attack
 * at once.
 */
export class Rival extends Rider {
  private readonly phase: number;
  private readonly laneOffset: number;
  private nextAttackAt = 0;
  private checkingUntil = 0;
  /** Set by think for the step in which this rival starts an attack (the run closes the gate for the others). */
  startedAttack = false;

  constructor(spec: RiderSpec, readonly index: number) {
    super(spec);
    this.phase = index * 2.1;
    this.laneOffset = ((index % 4) - 1.5) * 2.2;
    // The lane-keeping steer is not a trick: rivals ride their air straight and land clean.
    this.spinsInAir = false;
    // A rival passing the camera screen-doors out instead of filling the screen.
    this.autoNearFade = true;
  }

  /** No attacks before `time` (the start of a run). */
  holdChecks(time: number): void {
    this.nextAttackAt = time;
    this.checkingUntil = 0;
  }

  /** Call off whatever attack is under way: the punch's wind-up, or a shoulder check closing in. */
  override cancelAttack(): void {
    super.cancelAttack();
    this.checkingUntil = 0;
  }

  /** Whether this rival fights back at all (POWER at least COMBAT.rivalAggression). */
  get fighter(): boolean {
    return this.spec.power >= COMBAT.rivalAggression;
  }

  /**
   * This step's control. With a `slot` ([x, metres ahead of the player]),
   * the rival rides parked there instead (the title screen: no racing line,
   * no attacks), still steering round buoys.
   */
  think(player: Rider, buoys: { x: number; z: number }[], time: number, slot: readonly [number, number] | null, ctx: RivalContext): RiderControl {
    this.startedAttack = false;
    if (this.wiped) return IDLE;
    // Punched or barged: ride the shove out in a straight line rather than steering straight back (the reaction stays readable).
    if (time < this.shovedUntil + 0.3) return IDLE;
    let lane = slot ? slot[0] : 4.5 * Math.sin(this.z / 30 + this.phase) + this.laneOffset;
    for (const b of buoys) {
      const dz = b.z - this.z;
      if (dz > 0 && dz < 14 && Math.abs(b.x - this.x) < 2.4) lane = this.x + (this.x >= b.x ? 3 : -3);
    }
    if (slot) {
      this.targetSpeed = player.speed + clamp((player.z + slot[1] - this.z) * 0.6, -3, 3);
      return { steer: clamp((lane - this.x) * 0.3 - this.heading * 1.2, -1, 1), pump: false, brake: false, jump: false, attack: false, barge: false };
    }
    const dx = player.x - this.x;
    const dz = player.z - this.z; // positive: behind the player
    const side = dx >= 0 ? 1 : -1; // the player's side of this rival (world x)
    const punching = this.attackPhase !== 'none';
    let checking = time < this.checkingUntil;
    // Ready to attack: a fighter, the race on, the surfer up and about, this rival on the water and in control, its cooldown over.
    const ready =
      ctx.fight && ctx.attackOpen && this.fighter && !player.wiped && !player.knockedOut && !this.airborne && time >= this.stunnedUntil && time >= this.nextAttackAt && !punching && !checking;
    if (ready && Math.abs(dx) < COMBAT.rivalReachX && Math.abs(dz) < COMBAT.rivalReachZ) {
      if (Math.random() < COMBAT.rivalPunchChance) this.telegraphPunch(time, side);
      else this.checkingUntil = time + COMBAT.rivalCheckSeconds;
      checking = time < this.checkingUntil;
      this.nextAttackAt = time + COMBAT.rivalCooldown[0] + Math.random() * COMBAT.rivalCooldown[1];
      this.startedAttack = true;
    }
    const station = this.attackPhase !== 'none';
    const seeking = ready && Math.abs(dx) < COMBAT.rivalSeekX && Math.abs(dz) < COMBAT.rivalSeekZ;
    // Winding up (or closing in to attack): keep station beside the surfer; a shoulder check steers right into them.
    if (checking) lane = player.x;
    else if (station || seeking) lane = player.x - side * COMBAT.rivalStation;
    else if (Math.abs(dz) < 3 && Math.abs(lane - player.x) < 2.2) lane = player.x - side * 2.2; // otherwise give the surfer room (a bump costs both)
    lane = clamp(lane, -PHYSICS.trackHalfWidth + 1.5, PHYSICS.trackHalfWidth - 1.5);
    const steer = clamp((lane - this.x) * 0.3 - this.heading * 1.2, -1, 1);
    if (station || seeking || checking) {
      this.targetSpeed = player.speed + clamp(dz * 1.2, -3, 3);
    } else {
      const cruise = PHYSICS.baseSpeed * this.stats.speed * (1 + 0.06 * Math.sin(time * 0.6 + this.phase));
      this.targetSpeed = cruise + clamp(dz * 0.25, -4, 6);
    }
    const barge = checking && Math.abs(dx) < 1.4 && Math.abs(dz) < 2.2;
    return { steer, pump: dz > 6, brake: false, jump: false, attack: false, barge };
  }
}
