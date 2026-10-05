import { clamp, smoothstep } from '../engine/math';
import type { RiderSpec } from '../game/characters';
import { COMBAT, PHYSICS, RACE } from '../game/constants';
import { Rider, type RiderControl } from './Rider';

const IDLE: RiderControl = { steer: 0, pump: false, brake: false, jump: false, attack: false, barge: false };

/** What the run tells the rivals each step (one object, reused). */
export interface RivalContext {
  /** A race is on (the rules apply): rivals may attack the surfer. */
  fight: boolean;
  /** No other rival has just started an attack (the run staggers them, COMBAT.rivalStagger): this one may. */
  attackOpen: boolean;
  /** The race's length in metres (the pace rises with progress, and the field races for the line at the end). */
  length: number;
}

/**
 * An AI rider. It follows a wavy racing line in its own lane, steers round
 * buoys, and rides ramps like anyone else (the physics launches it). It
 * races at its own pace (SPEED, rising with race progress like everyone's)
 * while near the surfer, catches up (pumping) when far behind and eases off
 * when far ahead so the pack stays in the race; over the last part of the
 * race the leaders stop waiting and the catch-up fades (RACE), so places
 * are earned. Rivals with enough POWER fight back: with an attack ready
 * they close in alongside the surfer and throw a telegraphed punch (a long
 * wind-up the surfer can read, Rider.telegraphPunch) or a shoulder check,
 * on a cooldown of their own and staggered by the run so two rarely attack
 * at once.
 */
export class Rival extends Rider {
  private readonly phase: number;
  private readonly laneOffset: number;
  private nextAttackAt = 0;
  /** A shoulder check: the tell (drifting out wide) until checkTellUntil, then the lunge in until checkingUntil (0 when none). */
  private checkTellUntil = 0;
  private checkingUntil = 0;
  /** The lane a telegraphed punch is thrown from, fixed as the wind-up starts: carving away opens the gap (NaN when none). */
  private punchLane = Number.NaN;
  /** The run time of the last think (for the getters). */
  private now = 0;
  /** Set by think for the step in which this rival starts an attack (the run closes the gate for the others). */
  startedAttack = false;
  /** Closing in or keeping station beside the surfer for an attack (a bump meanwhile costs the surfer nothing). */
  stationing = false;
  /** One of the field's fastest (the run picks them): it sprints for the line harder over the last part of the race (RACE.sprintPaceFast). */
  sprinter = false;
  /** Run time this rival crossed the finish line, or -1 (the run records it; a respawn keeps it). */
  finishedAt = -1;

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
    this.checkTellUntil = 0;
    this.checkingUntil = 0;
  }

  /** Hit by the surfer (and still in the race): a fighter comes back at them soon (COMBAT.rivalRetaliate), whatever its cooldown said. */
  provoke(time: number): void {
    if (!this.fighter) return;
    const [wait, more] = COMBAT.rivalRetaliate;
    this.nextAttackAt = Math.min(this.nextAttackAt, time + wait + Math.random() * more);
  }

  /** Call off whatever attack is under way: the punch's wind-up, or a shoulder check (its tell or its lunge). */
  override cancelAttack(): void {
    super.cancelAttack();
    this.punchLane = Number.NaN;
    this.checkTellUntil = 0;
    this.checkingUntil = 0;
  }

  /** A shoulder check under way (the tell or the lunge, until the barge goes in): a blow now counters it. */
  get checking(): boolean {
    return this.now < this.checkingUntil;
  }

  /** An attack the surfer can see coming and still answer: a punch's wind-up, or a shoulder check before the barge (the HUD's warning). */
  get threatening(): boolean {
    return this.windingUp || this.checking;
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
    this.now = time;
    this.startedAttack = false;
    this.stationing = false;
    // The race over (or not begun): any attack under way is called off.
    if (!ctx.fight) this.cancelAttack();
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
    if (!punching) this.punchLane = Number.NaN;
    else if (Number.isNaN(this.punchLane)) this.punchLane = this.x; // a wind-up started from outside think holds where it is
    // Ready to attack: a fighter, the race on, the surfer up and about, this rival on the water and in control, its cooldown over.
    const ready =
      ctx.fight && ctx.attackOpen && this.fighter && !player.wiped && !player.knockedOut && !this.airborne && time >= this.stunnedUntil && time >= this.nextAttackAt && !punching && !this.checking;
    if (ready && Math.abs(dx) < COMBAT.rivalReachX && Math.abs(dz) < COMBAT.rivalReachZ) {
      if (Math.random() < COMBAT.rivalPunchChance) {
        this.telegraphPunch(time, side);
        // Thrown from where it stands: the station is not moved with the surfer, so carving away opens the gap.
        this.punchLane = player.x - side * COMBAT.rivalStation;
      } else {
        this.checkTellUntil = time + COMBAT.rivalCheckTell;
        this.checkingUntil = this.checkTellUntil + COMBAT.rivalCheckSeconds;
      }
      this.nextAttackAt = time + COMBAT.rivalCooldown[0] + Math.random() * COMBAT.rivalCooldown[1];
      this.startedAttack = true;
    }
    const station = this.attackPhase !== 'none';
    const checking = this.checking;
    const telling = checking && time < this.checkTellUntil;
    const seeking = ready && Math.abs(dx) < COMBAT.rivalSeekX && Math.abs(dz) < COMBAT.rivalSeekZ;
    this.stationing = station || checking || seeking;
    // A punch winds up from its own lane; a shoulder check first swings out wide (the tell), then steers right into the surfer;
    // closing in for an attack, keep station beside the surfer.
    if (station && !Number.isNaN(this.punchLane)) lane = this.punchLane;
    else if (telling) lane = player.x - side * COMBAT.rivalCheckOut;
    else if (checking) lane = player.x;
    else if (station || seeking) lane = player.x - side * COMBAT.rivalStation;
    else if (Math.abs(dz) < 3 && Math.abs(lane - player.x) < 2.2) lane = player.x - side * 2.2; // otherwise give the surfer room (a bump costs both)
    // Racing, it keeps off the whitewater at the edges; attacking, it follows the surfer nearly to the edge (no safe haven there).
    const edge = PHYSICS.trackHalfWidth - (this.stationing ? 0.5 : 1.5);
    lane = clamp(lane, -edge, edge);
    // An attack steers harder, so the check's swing out and lunge in read as moves.
    const steer = clamp((lane - this.x) * (checking ? 0.7 : 0.3) - this.heading * 1.2, -1, 1);
    const progress = clamp(this.z / ctx.length, 0, 1);
    const sprint = smoothstep(RACE.sprintFrom, 1, progress);
    if (this.stationing) {
      this.targetSpeed = player.speed + clamp(dz * 1.2, -3, 3);
    } else {
      // Its own pace near the surfer; catching up from far back, easing off far ahead (less and less as the line nears).
      const cruise = PHYSICS.baseSpeed * this.stats.speed * (1 + RACE.speedRampMax * progress) * (1 + 0.05 * Math.sin(time * 0.6 + this.phase));
      const catchUp = RACE.catchUp + (RACE.catchUpFinal - RACE.catchUp) * sprint;
      const back = clamp((dz - RACE.packBehind) * RACE.catchUpRate, 0, catchUp);
      const ease = clamp((-dz - RACE.packAhead) * RACE.easeOffRate, 0, RACE.easeOff) * (1 - sprint);
      this.targetSpeed = cruise + back - ease + (this.sprinter ? RACE.sprintPaceFast : RACE.sprintPace) * sprint;
    }
    // The lunge: the barge goes in once alongside (and the check is over: no steering on into the surfer after it).
    const barge = checking && !telling && Math.abs(dx) < 1.4 && Math.abs(dz) < 2.2;
    if (barge) this.checkingUntil = 0;
    // Far behind, it pumps to get back in the race (only from further back as the line nears).
    return { steer, pump: dz > RACE.packBehind + 20 * sprint, brake: false, jump: false, attack: false, barge };
  }
}
