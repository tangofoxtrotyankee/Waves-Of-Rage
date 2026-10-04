import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { clamp, damp } from '../engine/math';
import { THREE } from '../engine/three';
import { statMultipliers, type RiderSpec } from '../game/characters';
import { BOOST, COMBAT, PALETTE, PHYSICS, RIDER_ANIM, TRICKS } from '../game/constants';
import type { Ocean } from '../world/Ocean';
import { RiderAnimator, type AnimInput, type Splash } from './RiderAnimator';
import { buildFoamGeometry, createFoamMaterial } from './RiderFoam';
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
/** A settling spin aims to land this close to upright (radians), inside the landing tolerance. */
const SPIN_AIM = ((TRICKS.landingToleranceDeg - 15) * Math.PI) / 180;

/** Every rider, so a punch can turn towards the nearest one before the run has resolved it. */
const RIDERS: Rider[] = [];

const UP = new THREE.Vector3(0, 1, 0);
const _camera = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _tilt = new THREE.Quaternion();
const _turn = new THREE.Quaternion();
/** The shadow disc lies in its own xy plane; this lays it flat. */
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/** Seconds for a fall starting at vertical speed `vy` to drop `height` metres. */
const fallTime = (vy: number, height: number): number => (vy + Math.sqrt(Math.max(0, vy * vy + 2 * PHYSICS.gravity * Math.max(0, height)))) / PHYSICS.gravity;

/** The near fade for a point: 0 beyond `start` metres from the camera, rising to 1 (gone) at `full` metres and nearer. */
const nearFadeAt = (camera: THREE.Vector3, x: number, y: number, z: number, start: number, full: number): number => {
  const dx = x - camera.x;
  const dy = y - camera.y;
  const dz = z - camera.z;
  return clamp((start - Math.sqrt(dx * dx + dy * dy + dz * dz)) / (start - full), 0, 1);
};

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
  /** Steering in the air spins this rider (the AI's lane-keeping steer does not). */
  spinsInAir = true;
  /** Screen-door this rider out when it comes close to the camera that draws it (rivals; never the player). See fadeNear. */
  autoNearFade = false;
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
  /** White water round the board (RiderFoam), riding on the shadow so it lies on the water. */
  private readonly foam: THREE.Mesh;
  private readonly foamMaterial: THREE.ShaderMaterial;
  private readonly anim: AnimInput = {
    time: 0, x: 0, y: 0, z: 0, speed: 0, heading: 0, build: 1, airborne: false, airTime: 0, vy: 0, spinVel: 0, rolling: false, grabbing: false,
    steer: 0, pump: false, brake: false, boosting: false, lean: 0, stunned: false, crashing: false, wiped: false, knockedOut: false, strikeDir: 0,
  };
  private steerIn = 0;
  /** The steer carried off the water (its sign), and whether a press in the air may spin yet (the steer has been let go or reversed since). */
  private takeOffSteer = 0;
  private spinArmed = false;
  private pumpIn = false;
  private brakeIn = false;
  private slopeDx = 0;
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
  /** Screen-door fade of the body (and shadow) and of the board, which can fly off on its own. */
  private fade = 0;
  private boardFade = 0;
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
    this.shadow.quaternion.copy(FLAT);
    this.foamMaterial = createFoamMaterial();
    this.foam = new THREE.Mesh(buildFoamGeometry(spec.id.length + 3), this.foamMaterial);
    // Undo the shadow's lay-flat turn, so the foam is in the rider's frame on the water, a little above the shadow.
    this.foam.quaternion.copy(FLAT).invert();
    this.foam.position.set(0, 0, 0.02);
    this.shadow.add(this.foam);
    this.model = buildRiderModel(spec);
    this.model.body.onBeforeRender = this.beforeBodyRender;
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
    this.model.body.onBeforeRender = this.beforeBodyRender;
    this.animator.setModel(this.model);
    this.group.add(this.model.board);
    this.group.scale.setScalar(spec.build);
    this.setFlash(this.flash);
    this.applyFade(this.fade, this.boardFade);
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
    this.takeOffSteer = 0;
    this.spinArmed = false;
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
    const fade = clamp(amount, 0, 1);
    this.applyFade(fade, fade);
  }

  /**
   * The near fade: solid beyond `start` metres from the camera, screen-
   * doored away to nothing at `full` metres. The body is measured at its
   * middle and the board at the board, so a knocked-out rider's board
   * skidding past the camera fades on its own. Rivals (autoNearFade) run it
   * on every frame they are drawn, with the camera drawing them; it is
   * public for other uses. Returns the body's fade.
   */
  fadeNear(camera: THREE.Vector3, start = 3.6, full = 1.5): number {
    const b = this.spec.build;
    const pivot = this.animator.bodyPivot.position;
    const board = this.model.board.position;
    const body = nearFadeAt(camera, this.x + pivot.x * b, this.y + (pivot.y + 0.2) * b, this.z + pivot.z * b, start, full);
    const deck = nearFadeAt(camera, this.x + board.x * b, this.y + board.y * b, this.z + board.z * b, start, full);
    if (body !== this.fade || deck !== this.boardFade) this.applyFade(body, deck);
    return body;
  }

  /** Runs as the body is about to be drawn: the near fade against the camera actually drawing it (no per-frame call from the run needed). */
  private readonly beforeBodyRender = (_renderer: THREE.WebGLRenderer, _scene: THREE.Scene, camera: THREE.Camera): void => {
    if (this.autoNearFade) this.fadeNear(_camera.setFromMatrixPosition(camera.matrixWorld));
  };

  private applyFade(body: number, board: number): void {
    this.fade = body;
    this.boardFade = board;
    this.model.bodyMaterial.uniforms.uFade.value = body;
    this.model.boardMaterial.uniforms.uFade.value = board;
    this.shadowMaterial.uniforms.uFade.value = body;
    this.foamMaterial.uniforms.uFade.value = body;
  }

  /** Leave the game for good: forget this rider (punches no longer aim at it) and free its GPU resources. */
  dispose(): void {
    const i = RIDERS.indexOf(this);
    if (i >= 0) RIDERS.splice(i, 1);
    this.group.removeFromParent();
    this.shadow.removeFromParent();
    this.model.dispose();
    this.shadow.geometry.dispose();
    this.shadowMaterial.dispose();
    this.foam.geometry.dispose();
    this.foamMaterial.dispose();
  }

  /** BARREL ROLL: launch (if on the water) and roll a full turn about the board. False if the rider cannot right now. */
  barrelRoll(dir: number, time: number): boolean {
    if (this.wiped || time < this.stunnedUntil || this.rolling) return false;
    if (!this.airborne) {
      this.vy = PHYSICS.jumpVelocity * 0.95 + Math.max(0, this.vy);
      this.y += 0.01;
      this.takeOff();
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
    const slope = ocean.slope(this.x, this.z);
    this.slopeDx = slope.dx;
    this.slopeDz = slope.dz;
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
      this.airSpin(control.steer, ocean, h, dt);
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
    // A steer carried off the water (a carve over the lip) does not spin until it is let go or reversed.
    this.takeOffSteer = Math.abs(this.steerIn) > 0.05 ? Math.sign(this.steerIn) : 0;
    this.spinArmed = this.takeOffSteer === 0;
  }

  /**
   * The air spin (TRICKS). Only a press made in the air spins, after the
   * first moment of air; holding it builds the rate up to spinRate. When the
   * next upright can still be reached by touchdown only by turning faster,
   * the held spin is helped round (up to spinSettleMul times as fast), so a
   * 360 held on a big air lands; a completed turn that cannot become another
   * in time is held there and landed. Released (or not armed), the rider settles
   * to an upright by the time it lands: the one its momentum points at, or
   * the other if only that one can still be reached. `water` is the
   * surface height under the rider, for the time to touchdown.
   */
  private airSpin(steer: number, ocean: Ocean, water: number, dt: number): void {
    const pressed = Math.abs(steer) > 0.05;
    if (!pressed || Math.sign(steer) !== this.takeOffSteer) this.spinArmed = true;
    if (!this.spinsInAir && this.spin === 0 && this.spinVel === 0) return;
    const accel = TRICKS.spinRate / TRICKS.spinRampSeconds;
    const brake = accel * TRICKS.spinBrakeMul;
    const fastest = TRICKS.spinRate * TRICKS.spinSettleMul;
    const toLand = this.timeToLand(ocean, water);
    const T = Math.max(toLand - TRICKS.spinLandingMargin, 0.06);
    if (pressed && this.spinArmed && this.spinsInAir && this.airTime > TRICKS.spinDelay) {
      const dir = Math.sign(steer);
      const ahead = (dir > 0 ? Math.floor(this.spin / TWO_PI + 1e-6) + 1 : Math.ceil(this.spin / TWO_PI - 1e-6) - 1) * TWO_PI;
      const behind = ahead - dir * TWO_PI;
      const dist = Math.abs(ahead - this.spin);
      const boost = accel * TRICKS.spinAssistMul;
      let target = steer * TRICKS.spinRate;
      let rate = this.spinVel * dir < 0 ? brake : accel;
      if (this.spinShortfall(dist, dir, T, boost, fastest) <= SPIN_AIM) {
        // The next upright can still be made by touchdown: turn faster if that is what it takes.
        if (dist / T > TRICKS.spinRate) {
          target = dir * Math.min(dist / T, fastest);
          rate = boost;
        }
      } else if (Math.abs(behind) > 0.1 && Math.abs(this.spin - behind) <= SPIN_AIM) {
        // A completed turn that cannot become another before touchdown is held there and landed, not over-rotated into a crash.
        target = clamp((behind - this.spin) * Math.max(1 / T, TRICKS.spinSettleGain), -fastest, fastest);
        rate = brake;
      }
      this.spinVel = moveTowards(this.spinVel, target, rate * dt);
    } else {
      let upright = Math.round((this.spin + this.spinVel * Math.min(toLand, TRICKS.spinSettleLead)) / TWO_PI) * TWO_PI;
      const d = upright - this.spin;
      if (Math.abs(d) > 0.07) {
        const miss = this.spinShortfall(Math.abs(d), Math.sign(d), T, brake, fastest);
        const other = d > 0 ? upright - TWO_PI : upright + TWO_PI;
        const od = other - this.spin;
        if (miss > SPIN_AIM && this.spinShortfall(Math.abs(od), Math.sign(od), T, brake, fastest) < miss) upright = other;
      }
      const settle = clamp((upright - this.spin) * Math.max(1 / T, TRICKS.spinSettleGain), -fastest, fastest);
      this.spinVel = moveTowards(this.spinVel, settle, brake * dt);
    }
    this.spin += this.spinVel * dt;
  }

  /**
   * Seconds until the rider meets the water: the fall to the surface under
   * it, then again to the surface where that fall would carry it (a rising
   * face ahead lands it sooner; the earlier of the two is kept).
   */
  private timeToLand(ocean: Ocean, water: number): number {
    const t = fallTime(this.vy, this.y - water);
    const ahead = ocean.height(this.x + (this.speed * Math.sin(this.heading) + this.shoveVx) * t, this.z + this.speed * Math.cos(this.heading) * t);
    return ahead > water ? fallTime(this.vy, this.y - ahead) : t;
  }

  /** How far short of turning `dist` radians towards `dir` the spin would fall in `T` seconds, turning as hard as it may. */
  private spinShortfall(dist: number, dir: number, T: number, accel: number, fastest: number): number {
    const w = this.spinVel;
    const top = dir * fastest;
    const t1 = Math.abs(top - w) / accel;
    const travel = t1 >= T ? w * T + 0.5 * dir * accel * T * T : ((w + top) / 2) * t1 + top * (T - t1);
    return Math.max(0, dist - dir * travel);
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
    // Shadow and foam lie on the water's slope, turned with the board.
    _tilt.setFromUnitVectors(UP, _normal.set(-this.slopeDx, 1, -this.slopeDz).normalize());
    _turn.setFromAxisAngle(UP, this.heading);
    this.shadow.quaternion.copy(_tilt).multiply(_turn).multiply(FLAT);
    // Foam while planing: longer with speed (and a boost), heavier off the outside rail in a carve, boiling a little.
    const foaming = !this.airborne && !this.wiped && this.speed > 4;
    this.foam.visible = foaming;
    if (foaming) {
      const b = this.spec.build;
      const pace = clamp((this.speed - 5) / 14, 0, 1);
      const boil = 1 + 0.06 * Math.sin(time * 29 + this.z * 0.9);
      const surge = time < this.boostUntil ? 1.3 : 1;
      this.foam.scale.set(b * (1 + 0.3 * Math.abs(this.lean)) * boil, b, b * (0.6 + 0.6 * pace) * surge * (2 - boil));
      this.foam.position.set(-this.lean * 0.1 * b, 0, 0.02);
    }
  }
}
