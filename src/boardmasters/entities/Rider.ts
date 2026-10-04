import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { clamp, damp } from '../engine/math';
import { THREE } from '../engine/three';
import { statMultipliers, type RiderSpec } from '../game/characters';
import { BOOST, COMBAT, PALETTE, PHYSICS, RIDER_ANIM, TRICKS } from '../game/constants';
import type { Ocean } from '../world/Ocean';
import { RiderAnimator, type AnimInput, type Splash } from './RiderAnimator';
import { buildRiderModel, type RiderModel } from './RiderModel';

/** The animation set from the character sheet, plus `punch` (the sheet's HIT, delivered rather than taken) and `knockout`. */
export type RiderPose = 'idle' | 'carveLeft' | 'carveRight' | 'accelerate' | 'jump' | 'airTrick' | 'hit' | 'punch' | 'barge' | 'wipeout' | 'knockout';

/** What drives a rider for one step: the player's input, or a rival's AI. */
export interface RiderControl {
  steer: number;
  pump: boolean;
  brake: boolean;
  jump: boolean;
  attack: boolean;
  barge: boolean;
}

export interface Landing {
  airTime: number;
  /** Total rotation in the air, degrees. */
  spinDeg: number;
  grabbed: boolean;
  /** A barrel roll completed in the air. */
  rolled: boolean;
  /** Landed within the tolerance of upright (and not mid-roll). */
  clean: boolean;
}

const CONTROL_IDLE: RiderControl = { steer: 0, pump: false, brake: false, jump: false, attack: false, barge: false };
const TWO_PI = Math.PI * 2;

/** Every rider, so a punch can turn towards the nearest one before the run has resolved it. */
const RIDERS: Rider[] = [];

const moveTowards = (value: number, target: number, step: number): number => (value < target ? Math.min(target, value + step) : Math.max(target, value - step));

/**
 * A surfer on a board: track-space physics plus the low-poly skinned model
 * (RiderModel: one draw call for the body, one for the board, one for the
 * shadow) and its procedural animation (RiderAnimator). The player's Surfer
 * and the AI Rival both extend it; only the control source differs.
 *
 * Physics runs on the course: x across, z along, y from the ocean. The
 * rider leaves the water when ballistic motion would carry it above the
 * surface (a steep-backed ramp, or a crest taken fast) or when it jumps,
 * spins and grabs in the air, and lands clean or crashes. Carving eases in
 * and out (PHYSICS.carveResponse); the air spin builds while the steer is
 * held and settles to the nearest upright when it is released (TRICKS).
 * Punches and barges are requested here (cooldowns, poses, the swing) and
 * resolved by the run; a hit taken lands a moment later, when the
 * attacker's strike reaches it (RIDER_ANIM.impactDelay).
 */
export class Rider {
  readonly group = new THREE.Group();
  readonly shadow: THREE.Mesh;
  spec: RiderSpec;
  stats: ReturnType<typeof statMultipliers>;
  x = 0;
  z = 0;
  y = 0;
  vy = 0;
  speed: number = PHYSICS.baseSpeed;
  heading = 0;
  /** Turn rate, radians per second, easing towards the steer. */
  headingRate = 0;
  /** Visual carve lean, -1..1 (positive banks towards world +x); a camera can roll with it. */
  lean = 0;
  airborne = false;
  airTime = 0;
  /** Sideways velocity from contact, decaying. */
  shoveVx = 0;
  /** Controls are ignored until this time (seconds on the run clock). */
  stunnedUntil = 0;
  /** A bad landing: tumbling until this time. */
  crashUntil = 0;
  wiped = false;
  /** Knocked out by combat; the run respawns it after `respawnAt`. */
  knockedOut = false;
  respawnAt = 0;
  health: number = COMBAT.rivalHealth;
  maxHealth: number = COMBAT.rivalHealth;
  pose: RiderPose = 'idle';
  /** When set (rivals), the speed the rider relaxes towards instead of its base speed. */
  targetSpeed: number | null = null;
  /** Rotation accumulated in the air, radians, and its rate (radians per second). */
  spin = 0;
  spinVel = 0;
  grabbing = false;
  /** A barrel roll in progress: direction, 0..1 progress, and the roll angle shown. */
  rolling = false;
  rollDir = 1;
  rollProgress = 0;
  rollAngle = 0;
  /** The BOOST burst: extra spray and the pump pose until this time, and the next time one is allowed. */
  boostUntil = 0;
  boostCooldownUntil = 0;
  /** Set for the one step in which a punch or barge starts; the run resolves it. */
  attacking = false;
  barging = false;
  /** World-x sign of the punch or barge target. The rider picks the nearest rider in reach when an attack starts; the run may set it when it resolves one. */
  strikeDir = 0;
  /** How hard the rider was sliding when it hit the course edge this step (0 if it did not). */
  edgeShove = 0;
  /** Recently shoved by a punch or barge: whatever it hits before this time knocks it out. */
  shovedUntil = 0;

  private model: RiderModel;
  private readonly animator: RiderAnimator;
  private readonly shadowMaterial: THREE.ShaderMaterial;
  private readonly anim: AnimInput = {
    time: 0, x: 0, y: 0, z: 0, speed: 0, heading: 0, build: 1, airborne: false, airTime: 0, vy: 0, spinVel: 0, rolling: false, grabbing: false,
    steer: 0, pump: false, brake: false, boosting: false, lean: 0, stunned: false, crashing: false, wiped: false, knockedOut: false, strikeDir: 0,
  };
  private steerIn = 0;
  private pumpIn = false;
  private brakeIn = false;
  private slopeDz = 0;
  private landing: Landing | null = null;
  private punchUntil = 0;
  private bargeUntil = 0;
  private attackCooldownUntil = 0;
  private bargeCooldownUntil = 0;
  /** A press that could not fire (airborne, stunned) is kept for a moment, so it is not lost to a shove. */
  private attackBufferedUntil = 0;
  private bargeBufferedUntil = 0;
  private flashFrom = 0;
  private flashUntil = 0;
  private flash = 0;
  private fade = 0;
  /** A hit's shove waits for the attacker's strike to land. */
  private pendingShove = 0;
  private pendingShoveAt = -1;
  /** The knockout launch, likewise. */
  private koLaunchAt = -1;
  private koDir = 1;

  constructor(spec: RiderSpec) {
    this.spec = spec;
    this.stats = statMultipliers(spec);
    this.shadowMaterial = createPS1Material({ unlit: true, opacity: 0.45, depthWrite: false });
    this.shadow = new THREE.Mesh(colorGeometry(new THREE.CircleGeometry(0.7, 8), PALETTE.deepWater), this.shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.model = buildRiderModel(spec);
    this.animator = new RiderAnimator(this.model);
    this.group.add(this.model.board, this.animator.bodyPivot);
    this.group.scale.setScalar(spec.build);
    RIDERS.push(this);
  }

  /** Rebuild the model for another character; stats follow. */
  setSpec(spec: RiderSpec): void {
    this.spec = spec;
    this.stats = statMultipliers(spec);
    this.group.remove(this.model.board);
    this.model.dispose();
    this.model = buildRiderModel(spec);
    this.animator.setModel(this.model);
    this.group.add(this.model.board);
    this.group.scale.setScalar(spec.build);
    this.setFlash(this.flash);
    this.setNearFade(this.fade);
  }

  /** Put the rider on the water at a course position with default motion. */
  reset(x: number, z: number, ocean: Ocean): void {
    this.x = x;
    this.z = z;
    this.y = ocean.height(x, z);
    this.vy = 0;
    this.speed = PHYSICS.baseSpeed * this.stats.speed;
    this.heading = 0;
    this.headingRate = 0;
    this.lean = 0;
    this.airborne = false;
    this.airTime = 0;
    this.shoveVx = 0;
    this.stunnedUntil = 0;
    this.crashUntil = 0;
    this.wiped = false;
    this.knockedOut = false;
    this.pose = 'idle';
    this.landing = null;
    this.spin = 0;
    this.spinVel = 0;
    this.grabbing = false;
    this.rolling = false;
    this.rollProgress = 0;
    this.rollAngle = 0;
    this.boostUntil = 0;
    this.boostCooldownUntil = 0;
    this.attacking = false;
    this.barging = false;
    this.strikeDir = 0;
    this.edgeShove = 0;
    this.shovedUntil = 0;
    this.punchUntil = 0;
    this.bargeUntil = 0;
    this.attackCooldownUntil = 0;
    this.bargeCooldownUntil = 0;
    this.attackBufferedUntil = 0;
    this.bargeBufferedUntil = 0;
    this.flashFrom = 0;
    this.flashUntil = 0;
    this.pendingShove = 0;
    this.pendingShoveAt = -1;
    this.koLaunchAt = -1;
    this.steerIn = 0;
    this.pumpIn = false;
    this.brakeIn = false;
    this.group.visible = true;
    if (this.flash !== 0) this.setFlash(0);
    this.animator.reset();
    this.updateVisuals(1 / 60, ocean, 0);
  }

  /** Back into the race after a knockout, with full health. */
  respawn(x: number, z: number, ocean: Ocean): void {
    this.reset(x, z, ocean);
    this.health = this.maxHealth;
  }

  /**
   * Take a punch or barge: damage now; the sideways shove, the flinch and
   * the flash a moment later, when the strike lands; a stumble. Returns
   * true if it was a knockout.
   */
  takeHit(damage: number, shove: number, time: number): boolean {
    const impact = time + RIDER_ANIM.impactDelay;
    this.health -= damage;
    this.pendingShove = shove;
    this.pendingShoveAt = impact;
    this.speed *= 0.8;
    this.stunnedUntil = Math.max(this.stunnedUntil, impact + 0.4);
    this.shovedUntil = impact + 0.6;
    this.flashFrom = impact;
    this.flashUntil = impact + 0.12;
    this.flinch(Math.sign(shove) || 1, clamp(Math.abs(shove) / 4, 0.6, 1.5), impact);
    return this.health <= 0;
  }

  /** React to a hit from the `dir` side's opposite (dir: the world-x sign the rider is pushed towards), scaled by `strength` (1: a punch). Takes effect at `time`. */
  flinch(dir: number, strength: number, time: number): void {
    this.animator.flinch(dir, strength, time);
  }

  /** Out of the race until the run respawns it: launched off the board when the hit lands, tumbling into the water. */
  knockOut(time: number): void {
    this.health = 0;
    this.wiped = true;
    this.knockedOut = true;
    this.respawnAt = time + COMBAT.respawnSeconds;
    this.koDir = Math.sign(this.pendingShoveAt >= 0 ? this.pendingShove : this.shoveVx) || 1;
    this.koLaunchAt = Math.max(time, this.pendingShoveAt);
    this.pose = 'knockout';
  }

  /** A splash the run should throw (the knocked-out body or the board hitting the water, a wipeout); each is returned once. */
  takeSplash(): Splash | null {
    return this.animator.takeSplash();
  }

  /** Screen-door transparency, 0 (solid) to 1 (gone), for a rider between the camera and the player. */
  setNearFade(amount: number): void {
    this.fade = clamp(amount, 0, 1);
    for (const m of this.model.materials) m.uniforms.uFade.value = this.fade;
    this.shadowMaterial.uniforms.uFade.value = this.fade;
  }

  /**
   * A ready-made near fade for the run to call each frame on riders that
   * are not the player: solid beyond `start` metres from the camera,
   * screen-doored to 90 % at `full` metres, measured to the rider's chest.
   * Returns the fade it set.
   */
  fadeNear(camera: THREE.Vector3, start = 3.8, full = 1.8): number {
    const dx = this.x - camera.x;
    const dy = this.y + this.spec.build - camera.y;
    const dz = this.z - camera.z;
    const fade = 0.9 * clamp((start - Math.sqrt(dx * dx + dy * dy + dz * dz)) / (start - full), 0, 1);
    if (fade !== this.fade) this.setNearFade(fade);
    return fade;
  }

  /** BARREL ROLL: launch (if on the water) and roll a full turn about the board. False if the rider cannot right now. */
  barrelRoll(dir: number, time: number): boolean {
    if (this.wiped || time < this.stunnedUntil || this.rolling) return false;
    if (!this.airborne) {
      this.vy = PHYSICS.jumpVelocity * 0.95 + Math.max(0, this.vy);
      this.y += 0.01;
      this.airborne = true;
      this.airTime = 0;
    }
    this.rolling = true;
    this.rollDir = dir;
    this.rollProgress = 0;
    return true;
  }

  /** BOOST: a burst of speed. False while on cooldown or wiped. */
  boost(time: number, gate = false): boolean {
    if (this.wiped || (!gate && time < this.boostCooldownUntil)) return false;
    this.speed = Math.min(PHYSICS.maxSpeed * this.stats.speed * 1.1, this.speed + BOOST.gain);
    this.boostUntil = time + BOOST.seconds;
    this.boostCooldownUntil = time + BOOST.cooldown;
    return true;
  }

  /** The landing that happened this step, if any; reading it clears it. */
  takeLanding(): Landing | null {
    const landing = this.landing;
    this.landing = null;
    return landing;
  }

  /** Height above the water. */
  airHeight(ocean: Ocean): number {
    return this.y - ocean.height(this.x, this.z);
  }

  /** Whiten the model (RAGE pulses, hit flashes). */
  setFlash(amount: number): void {
    this.flash = amount;
    for (const m of this.model.materials) m.uniforms.uFlash.value = amount;
  }

  update(dt: number, control: RiderControl, ocean: Ocean, time: number): void {
    this.landing = null;
    this.attacking = false;
    this.barging = false;
    this.edgeShove = 0;
    if (this.pendingShoveAt >= 0 && time >= this.pendingShoveAt) {
      this.shoveVx = this.pendingShove;
      this.pendingShoveAt = -1;
    }
    if (this.wiped) {
      this.updateWiped(dt, ocean, time);
      return;
    }
    if (control.attack) this.attackBufferedUntil = time + 0.25;
    if (control.barge) this.bargeBufferedUntil = time + 0.25;
    const stunned = time < this.stunnedUntil;
    if (stunned) control = CONTROL_IDLE;
    this.steerIn = control.steer;
    this.pumpIn = control.pump;
    this.brakeIn = control.brake;
    const wantsAttack = time < this.attackBufferedUntil;
    const wantsBarge = time < this.bargeBufferedUntil;
    const steer = this.airborne ? control.steer * PHYSICS.airSteer : control.steer;

    // Speed: pumping and braking, slopes (downhill gains, uphill loses), relaxing towards cruise.
    if (!this.airborne) {
      if (control.pump) this.speed += PHYSICS.pumpAccel * dt;
      if (control.brake) this.speed -= PHYSICS.brakeDecel * dt;
      this.speed -= this.slopeDz * PHYSICS.slopeGain * dt;
    }
    const cruise = this.targetSpeed ?? PHYSICS.baseSpeed * this.stats.speed;
    this.speed += (cruise - this.speed) * damp(PHYSICS.drag, dt);
    this.speed = clamp(this.speed, PHYSICS.minSpeed, PHYSICS.maxSpeed * this.stats.speed * (this.targetSpeed ? 1.1 : 1));

    // Heading: the turn rate eases towards the steer (a digital press rolls into the carve), and back to straight when released.
    const nominal = PHYSICS.carveRate * this.stats.carve;
    const carve = nominal * (control.brake ? PHYSICS.hardCarveMul : 1) * (steer * this.heading < 0 ? PHYSICS.counterCarveMul : 1);
    const steering = Math.abs(steer) > 0.05;
    const rateTarget = steering ? steer * carve : clamp(-this.heading * 8, -PHYSICS.headingReturn, PHYSICS.headingReturn);
    this.headingRate += (rateTarget - this.headingRate) * damp(PHYSICS.carveResponse, dt);
    const before = this.heading;
    this.heading += this.headingRate * dt;
    // Released, the board straightens without swinging through: crossing (or sitting on) straight ahead stops the turn.
    if (!steering && before * this.heading <= 0) {
      this.heading = 0;
      this.headingRate = 0;
    }
    if (Math.abs(this.heading) > PHYSICS.maxHeading) {
      this.heading = Math.sign(this.heading) * PHYSICS.maxHeading;
      if (this.headingRate * this.heading > 0) this.headingRate = 0;
    }
    // The bank follows the turn (and the press), not the heading, so holding a line reads as riding, not as the board spinning.
    const leanTarget = this.airborne ? 0 : clamp(this.headingRate / nominal, -1, 1) * 0.75 + clamp(control.steer, -1, 1) * 0.25;
    this.lean += (leanTarget - this.lean) * damp(8, dt);

    // Move along the course; the whitewater at the edges pushes back.
    this.z += this.speed * Math.cos(this.heading) * dt;
    this.x += (this.speed * Math.sin(this.heading) + this.shoveVx) * dt;
    this.shoveVx *= Math.exp(-PHYSICS.shoveDecay * dt);
    const limit = PHYSICS.trackHalfWidth;
    if (this.x > limit || this.x < -limit) {
      this.edgeShove = Math.abs(this.shoveVx);
      const side = this.x > limit ? 1 : -1;
      this.x = side * limit;
      this.heading = side > 0 ? Math.min(this.heading, 0) : Math.max(this.heading, 0);
      if (this.headingRate * side > 0) this.headingRate = 0;
      this.shoveVx = -side * 2.5;
      this.speed *= 0.98;
    }

    // Vertical: ride the surface, leave it when the water drops away faster than a ballistic path, or jump.
    const h = ocean.height(this.x, this.z);
    this.slopeDz = ocean.slope(this.x, this.z).dz;
    if (!this.airborne) {
      const surfaceVy = (h - this.y) / dt;
      const ballisticVy = this.vy - PHYSICS.gravity * dt;
      const ballisticY = this.y + ballisticVy * dt;
      if (control.jump) {
        this.vy = PHYSICS.jumpVelocity + Math.max(0, surfaceVy);
        this.y = h + 0.01;
        this.takeOff();
      } else if (ballisticY > h + PHYSICS.launchAccel * dt * dt) {
        this.vy = ballisticVy;
        this.y = ballisticY;
        this.takeOff();
      } else {
        this.y = h;
        this.vy = surfaceVy;
      }
      // Combat requests, resolved by the run.
      if (!stunned && wantsAttack && time >= this.attackCooldownUntil) {
        this.attacking = true;
        this.attackBufferedUntil = 0;
        this.attackCooldownUntil = time + COMBAT.punchCooldown;
        this.punchUntil = time + COMBAT.punchSeconds;
        this.strikeDir = this.nearestSide(COMBAT.punchRangeX, COMBAT.punchRangeZ);
        this.animator.punch(time);
      }
      if (!stunned && wantsBarge && time >= this.bargeCooldownUntil) {
        this.barging = true;
        this.bargeBufferedUntil = 0;
        this.bargeCooldownUntil = time + COMBAT.bargeCooldown;
        this.bargeUntil = time + COMBAT.bargeSeconds;
        this.speed *= COMBAT.bargeSelfSpeed;
        this.strikeDir = this.nearestSide(COMBAT.bargeRangeX, COMBAT.bargeRangeZ);
        this.animator.barge(time);
      }
    } else {
      if (control.jump && this.vy <= 0 && this.y - h < PHYSICS.coyoteHeight) this.vy = PHYSICS.jumpVelocity;
      this.vy -= PHYSICS.gravity * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      this.airSpin(control.steer, dt);
      // Grab with attack; the barrel roll runs its course.
      if (wantsAttack && this.airTime > 0.1) {
        this.grabbing = true;
        this.attackBufferedUntil = 0;
      }
      if (this.rolling) {
        this.rollProgress = Math.min(1, this.rollProgress + dt / TRICKS.rollSeconds);
        const t = this.rollProgress;
        this.rollAngle = this.rollDir * TWO_PI * (t * t * (3 - 2 * t));
      }
      if (this.y <= h) {
        const impactVy = this.vy;
        this.y = h;
        this.vy = 0;
        this.airborne = false;
        const spinDeg = (Math.abs(this.spin) * 180) / Math.PI;
        const off = spinDeg % 360;
        const rolled = this.rolling && this.rollProgress >= TRICKS.rollLandingFraction;
        const upright = off <= TRICKS.landingToleranceDeg || off >= 360 - TRICKS.landingToleranceDeg;
        const clean = upright && (!this.rolling || rolled);
        this.landing = { airTime: this.airTime, spinDeg, grabbed: this.grabbing, rolled, clean };
        this.airTime = 0;
        this.spin = 0;
        this.spinVel = 0;
        this.grabbing = false;
        this.rolling = false;
        this.rollAngle = 0;
        this.animator.land(time, impactVy);
      }
    }

    this.pose =
      time < this.crashUntil ? 'wipeout'
      : stunned ? 'hit'
      : time < this.bargeUntil ? 'barge'
      : time < this.punchUntil ? 'punch'
      : this.airborne ? (this.grabbing ? 'airTrick' : 'jump')
      : steer > 0.3 ? 'carveLeft'
      : steer < -0.3 ? 'carveRight'
      : control.pump || time < this.boostUntil ? 'accelerate'
      : 'idle';
    this.updateVisuals(dt, ocean, time);
  }

  private takeOff(): void {
    this.airborne = true;
    this.airTime = 0;
    this.spinVel = 0;
  }

  /**
   * The air spin. Held steer builds the rate up to TRICKS.spinRate over
   * spinRampSeconds, but only after spinDelay in the air (a carve carried
   * over a crest does not spin). Released, the rider settles towards the
   * nearest upright (chosen a little ahead, so momentum carries a nearly
   * complete turn round), so short accidental spins unwind.
   */
  private airSpin(steer: number, dt: number): void {
    const ramp = (TRICKS.spinRate / TRICKS.spinRampSeconds) * dt;
    if (this.airTime > TRICKS.spinDelay && Math.abs(steer) > 0.05) {
      this.spinVel = moveTowards(this.spinVel, steer * TRICKS.spinRate, ramp * (this.spinVel * steer < 0 ? 2 : 1));
    } else {
      const upright = Math.round((this.spin + this.spinVel * TRICKS.spinSettleLead) / TWO_PI) * TWO_PI;
      const settle = clamp((upright - this.spin) * TRICKS.spinSettleGain, -TRICKS.spinSettleRate, TRICKS.spinSettleRate);
      this.spinVel = moveTowards(this.spinVel, settle, ramp * 2);
    }
    this.spin += this.spinVel * dt;
  }

  /** Wiped out or knocked out: no control; the animator plays the fall (and the knockout's flight, which the rider's position follows). */
  private updateWiped(dt: number, ocean: Ocean, time: number): void {
    this.airborne = false;
    this.spin = 0;
    this.spinVel = 0;
    this.rolling = false;
    this.rollAngle = 0;
    this.grabbing = false;
    this.headingRate = 0;
    this.lean += (0 - this.lean) * damp(6, dt);
    if (this.knockedOut && this.koLaunchAt >= 0 && time >= this.koLaunchAt) {
      this.koLaunchAt = -1;
      this.fillAnim(time);
      this.animator.knockOut(this.koDir, this.anim);
    }
    if (this.knockedOut && this.animator.knockedOutBody) {
      this.x = this.animator.koX;
      this.z = this.animator.koZ;
      this.speed = 0;
    } else {
      this.speed = Math.max(0, this.speed - 10 * dt);
      this.z += this.speed * dt;
      this.x += this.shoveVx * dt;
      this.shoveVx *= Math.exp(-PHYSICS.shoveDecay * dt);
    }
    this.y = ocean.height(this.x, this.z);
    this.vy = 0;
    this.pose = this.knockedOut ? 'knockout' : 'wipeout';
    this.updateVisuals(dt, ocean, time);
  }

  /** The side (world-x sign) of the nearest other rider in reach, or the rider's front (screen-right, world -x) when nobody is. */
  private nearestSide(rangeX: number, rangeZ: number): number {
    let best = Infinity;
    let dir = 0;
    for (const r of RIDERS) {
      if (r === this || r.knockedOut) continue;
      const dx = r.x - this.x;
      const ax = Math.abs(dx);
      if (ax < rangeX && ax < best && Math.abs(r.z - this.z) < rangeZ && Math.abs(r.y - this.y) < 1.2) {
        best = ax;
        dir = dx >= 0 ? 1 : -1;
      }
    }
    return dir || -1;
  }

  private fillAnim(time: number): void {
    const a = this.anim;
    a.time = time;
    a.x = this.x;
    a.y = this.y;
    a.z = this.z;
    a.speed = this.speed;
    a.heading = this.heading;
    a.build = this.spec.build;
    a.airborne = this.airborne;
    a.airTime = this.airTime;
    a.vy = this.vy;
    a.spinVel = this.spinVel;
    a.rolling = this.rolling;
    a.grabbing = this.grabbing;
    a.steer = this.steerIn;
    a.pump = this.pumpIn;
    a.brake = this.brakeIn;
    a.boosting = time < this.boostUntil;
    a.lean = this.lean;
    a.stunned = time < this.stunnedUntil;
    a.crashing = time < this.crashUntil;
    a.wiped = this.wiped;
    a.knockedOut = this.knockedOut;
    a.strikeDir = this.strikeDir;
  }

  /** Animate the model and place the group: heading and spin, the slope's pitch, the carve's bank and the barrel roll. */
  private updateVisuals(dt: number, ocean: Ocean, time: number): void {
    this.fillAnim(time);
    const anim = this.animator;
    anim.update(dt, this.anim, ocean);

    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.set(0, 0, 0);
    if (!anim.knockedOutBody) {
      const pitch = this.airborne ? clamp(-this.vy * 0.05, -0.4, 0.4) : clamp(-Math.atan(this.slopeDz) * 0.6, -0.4, 0.4);
      this.group.rotateY(this.heading + this.spin);
      this.group.rotateX(pitch + anim.tilt);
      // Positive lean and bank tip the rider towards world +x; the barrel roll turns towards its direction (screen-right is world -x).
      this.group.rotateZ(-(this.lean * PHYSICS.carveLean + anim.bank) - this.rollAngle);
    }
    if (time >= this.flashFrom && time < this.flashUntil) this.setFlash(1);
    else if (this.flashUntil > 0 && time >= this.flashUntil) {
      this.setFlash(0);
      this.flashUntil = 0;
    }

    const water = ocean.height(this.x, this.z);
    const above = Math.max(0, this.y - water);
    this.shadow.position.set(this.x, water + 0.04, this.z);
    this.shadow.scale.setScalar(Math.max(0.3, 1 - above * 0.18));
    this.shadow.visible = this.group.visible && !this.wiped;
  }
}
