import { clamp, damp, smoothstep } from '../engine/math';
import { THREE } from '../engine/three';
import { PHYSICS, RIDER_ANIM, TRICKS } from '../game/constants';
import type { Ocean } from '../world/Ocean';
import { BONE, type RiderModel } from './RiderModel';

/**
 * Joint-based procedural animation for a rider, in layers, at the fixed
 * 60 Hz step:
 *
 *  1. a target pose from the riding state (the surf stance, carving lean,
 *     pumping, the boost tuck, braking, the air tuck, grabs, spins, the
 *     stunned stagger), eased towards each step
 *  2. additive motion on top (idle sway, the pump cycle, knees absorbing
 *     the water's vertical motion, the landing absorb)
 *  3. combat clips keyed in time (punch and barge: anticipation, strike,
 *     hold, recovery) blended over that
 *  4. the flinch (a hit taken), additive and decaying
 *  5. whole-body motion: the bad-landing stumble, the wipeout (pitching over
 *     the board into the water), and the knockout (launched, tumbling, a
 *     splash, floating) with the board flying off on its own
 *
 * A pose is a flat array of channels (below). Legs are solved with two-bone
 * IK so the feet stay planted on the deck whatever the hips do; arms, spine
 * and head are forward kinematics. Nothing here allocates per step.
 */

/** Pose channels. Angles in radians; hip offsets in metres. Arms: pitch swings forward, roll raises out to the side, swing moves a raised arm forward, elbow bends. */
const C = {
  crouch: 0,
  hipX: 1,
  hipZ: 2,
  hipYaw: 3,
  hipPitch: 4,
  hipRoll: 5,
  spineYaw: 6,
  spinePitch: 7,
  spineRoll: 8,
  chestYaw: 9,
  chestPitch: 10,
  chestRoll: 11,
  headYaw: 12,
  headPitch: 13,
  headRoll: 14,
  lPitch: 15,
  lRoll: 16,
  lSwing: 17,
  lElbow: 18,
  rPitch: 19,
  rRoll: 20,
  rSwing: 21,
  rElbow: 22,
  /** Feet on the deck (IK) at 1, legs free (FK) at 0. */
  plant: 23,
  lThigh: 24,
  lThighRoll: 25,
  lKnee: 26,
  rThigh: 27,
  rThighRoll: 28,
  rKnee: 29,
  /** Extra roll of the rider and board together (positive leans towards world +x). */
  bank: 30,
  /** Extra pitch of the rider and board together (positive tips the nose down). */
  tilt: 31,
} as const;
const N = 32;
type Pose = Float32Array;

/** Per-arm channel indices, so clips can name "the punching arm" and "the other arm". */
interface Arm {
  readonly pitch: number;
  readonly roll: number;
  readonly swing: number;
  readonly elbow: number;
}
const ARM: { readonly l: Arm; readonly r: Arm } = {
  l: { pitch: C.lPitch, roll: C.lRoll, swing: C.lSwing, elbow: C.lElbow },
  r: { pitch: C.rPitch, roll: C.rRoll, swing: C.rSwing, elbow: C.rElbow },
};
const ARMS: readonly Arm[] = [ARM.l, ARM.r];

const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function setArm(p: Pose, arm: Arm, pitch: number, roll: number, swing: number, elbow: number): void {
  p[arm.pitch] = pitch;
  p[arm.roll] = roll;
  p[arm.swing] = swing;
  p[arm.elbow] = elbow;
}

/** What the animator reads from its rider each step (filled by Rider without allocating). */
export interface AnimInput {
  time: number;
  /** World position of the rider on the water (the group's position). */
  x: number;
  y: number;
  z: number;
  speed: number;
  heading: number;
  build: number;
  airborne: boolean;
  airTime: number;
  vy: number;
  spinVel: number;
  rolling: boolean;
  grabbing: boolean;
  steer: number;
  pump: boolean;
  brake: boolean;
  boosting: boolean;
  /** Carve lean, -1..1 (positive towards world +x). */
  lean: number;
  stunned: boolean;
  crashing: boolean;
  wiped: boolean;
  knockedOut: boolean;
  /** World-x sign of the punch or barge target (0: not known). */
  strikeDir: number;
}

export interface Splash {
  x: number;
  y: number;
  z: number;
  size: number;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _hipsQ = new THREE.Quaternion();
const _hipsInv = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _u = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _target = new THREE.Vector3();
const _hipsPos = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class RiderAnimator {
  /** The body pivots here (hip height) for the wipeout and the knockout's tumble. */
  readonly bodyPivot = new THREE.Group();
  /** This step's extra roll and pitch for the rider's group, radians (the punch's lean, the barge's lunge, the flinch's wobble, the brake). */
  bank = 0;
  tilt = 0;
  private model: RiderModel;
  private time = 0;
  private readonly cur: Pose = new Float32Array(N);
  private readonly target: Pose = new Float32Array(N);
  private readonly out: Pose = new Float32Array(N);
  private readonly keyA: Pose = new Float32Array(N);
  private readonly keyB: Pose = new Float32Array(N);
  private pumpPhase = 0;
  private lag = 0;
  private lagV = 0;
  private prevY = 0;
  private prevVy = 0;
  private landAt = -10;
  private landHard = 0;
  private punchAt = -10;
  private bargeAt = -10;
  private flinchAt = -10;
  private flinchDir = 1;
  private flinchK = 0;
  private crashAt = -10;
  private wasCrashing = false;
  private wipeAt = -10;
  private wasWiped = false;
  private wipeSplashed = false;
  private stunW = 0;
  private airW = 0;
  // Knockout: the body and the board fly separately, in world space.
  private koActive = false;
  private koDir = 1;
  private koSplashAt = -10;
  private readonly koBody = new THREE.Vector3();
  private readonly koBodyV = new THREE.Vector3();
  private readonly koBoard = new THREE.Vector3();
  private readonly koBoardV = new THREE.Vector3();
  private koRoll = 0;
  private koPitch = 0;
  private koYaw = 0;
  private koBoardSpin = 0;
  private koBoardFlip = 0;
  private koBoardDown = false;
  private readonly splashes: Splash[] = [];

  constructor(model: RiderModel) {
    this.model = model;
    this.attach(model);
    this.reset();
  }

  /** Use a new model (another character); the pose carries over. */
  setModel(model: RiderModel): void {
    this.bodyPivot.remove(this.model.body);
    this.model = model;
    this.attach(model);
  }

  private attach(model: RiderModel): void {
    this.bodyPivot.position.set(0, model.dims.pivotY, 0);
    model.body.position.set(0, -model.dims.pivotY, 0);
    this.bodyPivot.add(model.body);
  }

  reset(): void {
    this.stance(this.cur);
    this.pumpPhase = 0;
    this.lag = 0;
    this.lagV = 0;
    this.prevY = Number.NaN;
    this.prevVy = 0;
    this.landAt = this.punchAt = this.bargeAt = this.flinchAt = this.crashAt = this.wipeAt = this.koSplashAt = -10;
    this.flinchK = 0;
    this.wasCrashing = false;
    this.wasWiped = false;
    this.wipeSplashed = false;
    this.stunW = 0;
    this.airW = 0;
    this.koActive = false;
    this.bank = 0;
    this.tilt = 0;
    this.splashes.length = 0;
    this.bodyPivot.position.set(0, this.model.dims.pivotY, 0);
    this.bodyPivot.rotation.set(0, 0, 0);
    this.model.board.position.set(0, 0, 0);
    this.model.board.rotation.set(0, 0, 0);
  }

  // --- events from the rider ---

  punch(time: number): void {
    this.punchAt = time;
  }

  barge(time: number): void {
    this.bargeAt = time;
  }

  land(time: number, impactVy: number): void {
    this.landAt = time;
    this.landHard = clamp(-impactVy / 7, 0.35, 1.2);
  }

  /** A hit taken: `dir` is the world-x sign the rider is pushed towards, `strength` about 1 for a punch. */
  flinch(dir: number, strength: number, time: number): void {
    this.flinchAt = time;
    this.flinchDir = dir >= 0 ? 1 : -1;
    this.flinchK = clamp(strength, 0.2, 1.6);
  }

  /** The knockout launch: thrown up and towards `dir`, the board flying off on its own. */
  knockOut(dir: number, input: AnimInput): void {
    this.koActive = true;
    this.koDir = dir >= 0 ? 1 : -1;
    this.koSplashAt = -10;
    const b = input.build;
    const pivot = this.model.dims.pivotY * b;
    const fx = Math.sin(input.heading);
    const fz = Math.cos(input.heading);
    this.koBody.set(input.x, input.y + pivot, input.z);
    // The flight keeps up with the field (the hit has already slowed the rider), so the tumble plays out beside the attacker, not in the camera's face.
    const forward = Math.max(input.speed, PHYSICS.baseSpeed);
    this.koBodyV.set(this.koDir * RIDER_ANIM.koSide + fx * forward * 0.92, RIDER_ANIM.koUp, fz * forward * 0.92);
    // The board flies out on the shove side too (never back through the attacker), a little slower than the body, flipping.
    this.koBoard.set(input.x + this.koDir * 0.3 * b, input.y, input.z);
    this.koBoardV.set(this.koDir * RIDER_ANIM.boardSide + fx * forward * 0.88, RIDER_ANIM.boardUp, fz * forward * 0.88);
    this.koRoll = 0;
    this.koPitch = 0;
    this.koYaw = input.heading;
    this.koBoardSpin = input.heading;
    this.koBoardFlip = 0;
    this.koBoardDown = false;
  }

  get knockedOutBody(): boolean {
    return this.koActive;
  }

  /** Where the knocked-out body is on the water (the rider's x, z follow it). */
  get koX(): number {
    return this.koBody.x;
  }

  get koZ(): number {
    return this.koBody.z;
  }

  takeSplash(): Splash | null {
    return this.splashes.shift() ?? null;
  }

  private splash(x: number, y: number, z: number, size: number): void {
    if (this.splashes.length < 4) this.splashes.push({ x, y, z, size });
  }

  // --- the step ---

  update(dt: number, input: AnimInput, ocean: Ocean): void {
    const t = input.time;
    this.time = t;
    // Events the rider does not announce: a crash (bad landing) and the wipeout begin when their flags rise.
    if (input.crashing && !this.wasCrashing) this.crashAt = t;
    this.wasCrashing = input.crashing;
    if (input.wiped && !input.knockedOut && !this.wasWiped) {
      this.wipeAt = t;
      this.wipeSplashed = false;
    }
    this.wasWiped = input.wiped;

    this.riding(this.target, input, dt);
    const k = damp(13, dt);
    for (let i = 0; i < N; i++) this.cur[i] += (this.target[i] - this.cur[i]) * k;
    this.out.set(this.cur);
    this.additive(this.out, input, dt);
    this.clips(this.out, input);
    this.flinchLayer(this.out, t);
    this.bodyMotion(this.out, input, dt, ocean);
    this.bank = this.out[C.bank];
    this.tilt = this.out[C.tilt];
    this.apply(this.out);
  }

  /**
   * The surf stance (the mockup's hero): side-on hips (left foot forward),
   * shoulders turned back towards the camera, knees well bent, the back
   * leaning forward over the front foot, and both arms spread wide for
   * balance, the front one reaching forward, the back one trailing.
   */
  private stance(p: Pose): void {
    p.fill(0);
    p[C.crouch] = 0.6;
    p[C.hipYaw] = -0.5;
    p[C.hipPitch] = 0.3;
    p[C.spineYaw] = 0.14;
    p[C.spinePitch] = 0.28;
    p[C.chestYaw] = 0.24;
    p[C.chestPitch] = 0.32;
    p[C.headYaw] = 0.12;
    p[C.headPitch] = -0.78;
    setArm(p, ARM.l, 0.45, 1.32, 0.2, 0.6);
    setArm(p, ARM.r, -0.2, 1.08, 0.0, 0.45);
    p[C.plant] = 1;
  }

  /** Layer 1: the target pose from the riding state. */
  private riding(p: Pose, s: AnimInput, dt: number): void {
    this.stance(p);
    const t = s.time;
    this.airW += ((s.airborne ? 1 : 0) - this.airW) * damp(10, dt);
    this.stunW += ((s.stunned && !s.crashing ? 1 : 0) - this.stunW) * damp(12, dt);

    // Carving: hips into the turn, the inside hand reaching for the water, the outside arm up, the head level.
    const L = s.airborne ? 0 : s.lean;
    const aL = Math.abs(L);
    const hard = s.brake && aL > 0.3 ? 1 : 0;
    p[C.hipX] += 0.07 * L;
    p[C.chestRoll] -= 0.16 * L;
    p[C.spineRoll] -= 0.06 * L;
    p[C.headRoll] += 0.28 * L;
    p[C.crouch] += 0.14 * aL + 0.25 * hard;
    // The inside (trailing) hand reaches out and back towards the water; on a hard carve (braking into the turn) it trails in it.
    const inside = L >= 0 ? ARM.l : ARM.r;
    const outside = L >= 0 ? ARM.r : ARM.l;
    p[inside.roll] += aL * (-0.15 + 0.1 * hard);
    p[inside.pitch] -= aL * (0.3 + 0.4 * hard);
    p[inside.elbow] -= aL * (0.35 + 0.3 * hard);
    p[outside.roll] += aL * 0.35;
    p[outside.elbow] += aL * 0.35;
    p[C.bank] += hard * 0.22 * Math.sign(L);

    // Braking: lean back on the tail, front arm forward.
    if (s.brake && !s.airborne) {
      p[C.hipZ] -= 0.07;
      p[C.chestPitch] -= 0.28;
      p[C.spinePitch] -= 0.1;
      p[C.crouch] += 0.12;
      p[C.lPitch] += 0.55;
      p[C.lRoll] += 0.1;
      p[C.tilt] -= 0.08;
    }
    // Boost: a deep tuck, arms swept back.
    if (s.boosting && !s.airborne) {
      p[C.crouch] = Math.max(p[C.crouch], 0.82);
      p[C.chestPitch] += 0.42;
      p[C.spinePitch] += 0.22;
      p[C.headPitch] -= 0.35;
      setArm(p, ARM.l, -0.7, 0.42, -0.2, 0.35);
      setArm(p, ARM.r, -0.75, 0.42, -0.2, 0.35);
    }

    // In the air: tuck, arms out; spins wrap the arms in; grabs reach for the rail; rolls tuck tight.
    if (this.airW > 0.01) {
      const w = this.airW;
      const tuck = smoothstep(0, 0.25, s.airTime);
      const falling = clamp(-s.vy / 8, 0, 1);
      p[C.crouch] = lerp(p[C.crouch], 0.55 + 0.25 * tuck - 0.2 * falling, w);
      p[C.lRoll] = lerp(p[C.lRoll], 1.15, w);
      p[C.rRoll] = lerp(p[C.rRoll], 1.05, w);
      p[C.lElbow] = lerp(p[C.lElbow], 0.45, w);
      p[C.rElbow] = lerp(p[C.rElbow], 0.55, w);
      const spin = clamp(Math.abs(s.spinVel) / TRICKS.spinRate, 0, 1) * w;
      if (spin > 0.01) {
        setArm(this.keyA, ARM.l, 0.9, 0.3, 0.6, 2.0);
        setArm(this.keyA, ARM.r, 0.9, 0.3, 0.6, 2.0);
        for (const a of ARMS) {
          p[a.pitch] = lerp(p[a.pitch], this.keyA[a.pitch], spin);
          p[a.roll] = lerp(p[a.roll], this.keyA[a.roll], spin);
          p[a.swing] = lerp(p[a.swing], this.keyA[a.swing], spin);
          p[a.elbow] = lerp(p[a.elbow], this.keyA[a.elbow], spin);
        }
        p[C.chestPitch] += 0.15 * spin;
        p[C.headYaw] += Math.sign(s.spinVel) * 0.45 * spin;
      }
      if (s.rolling) {
        p[C.crouch] = Math.max(p[C.crouch], 0.88);
        setArm(p, ARM.l, 0.9, 0.35, 0.5, 1.9);
        setArm(p, ARM.r, 0.9, 0.35, 0.5, 1.9);
      }
      if (s.grabbing) {
        p[C.crouch] = 0.95;
        p[C.chestPitch] += 0.45;
        p[C.spinePitch] += 0.25;
        p[C.headPitch] += 0.15;
        setArm(p, ARM.l, 0.75, 0.25, 0.1, 0.12);
        setArm(p, ARM.r, -0.35, 1.75, -0.2, 0.25);
      }
    }

    // Stunned: staggering, arms windmilling.
    if (this.stunW > 0.01) {
      const w = this.stunW;
      p[C.lPitch] = lerp(p[C.lPitch], 1.3 * Math.sin(t * 13), w);
      p[C.rPitch] = lerp(p[C.rPitch], 1.3 * Math.sin(t * 13 + Math.PI), w);
      p[C.lRoll] = lerp(p[C.lRoll], 1.0 + 0.4 * Math.sin(t * 9), w);
      p[C.rRoll] = lerp(p[C.rRoll], 1.0 + 0.4 * Math.sin(t * 9 + 2), w);
      p[C.lElbow] = lerp(p[C.lElbow], 0.4, w);
      p[C.rElbow] = lerp(p[C.rElbow], 0.4, w);
      p[C.chestRoll] += 0.18 * Math.sin(t * 7) * w;
      p[C.spinePitch] -= 0.12 * w;
      p[C.headRoll] += 0.2 * Math.sin(t * 9) * w;
      p[C.crouch] += 0.12 * w;
    }
  }

  /** Layer 2: sway, pumping, knees absorbing the water and the landing. */
  private additive(p: Pose, s: AnimInput, dt: number): void {
    const t = s.time;
    p[C.hipX] += 0.018 * Math.sin(t * 1.4);
    p[C.chestRoll] += 0.04 * Math.sin(t * 1.4 + 0.8);
    p[C.lRoll] += 0.08 * Math.sin(t * 1.9);
    p[C.rRoll] += 0.08 * Math.sin(t * 1.9 + 1.3);
    p[C.crouch] += 0.03 * Math.sin(t * 2.1);
    if (s.pump && !s.airborne && !s.boosting) {
      this.pumpPhase += dt * Math.PI * 2 * 2.3;
      const c = Math.sin(this.pumpPhase);
      p[C.crouch] += 0.16 * c;
      p[C.chestPitch] += 0.12 * c;
      p[C.lPitch] += 0.35 * c;
      p[C.rPitch] -= 0.25 * c;
    }
    // The hips lag the board's vertical motion on a spring: knees soak up the chop.
    if (!s.airborne && !s.wiped) {
      if (Number.isNaN(this.prevY) || Math.abs(s.y - this.prevY) > 0.5) {
        this.prevY = s.y;
        this.prevVy = 0;
      }
      const vy = (s.y - this.prevY) / dt;
      const accel = clamp((vy - this.prevVy) / dt, -160, 160);
      this.prevVy = vy;
      this.lagV += (-accel * 0.5 - 140 * this.lag - 16 * this.lagV) * dt;
    } else {
      this.prevVy = s.vy;
      this.lagV += (-140 * this.lag - 16 * this.lagV) * dt;
    }
    this.prevY = s.y;
    this.lag = clamp(this.lag + this.lagV * dt, -0.16, 0.08);
    p[C.crouch] -= this.lag / 0.42;
    // Landing: a deep knee bend for about 0.2 s, chest down, arms out.
    const tl = t - this.landAt;
    const span = RIDER_ANIM.landSeconds;
    if (tl >= 0 && tl < span * 1.8) {
      const env = tl < 0.05 ? easeOut(tl / 0.05) : 1 - smoothstep(span * 0.5, span * 1.8, tl);
      p[C.crouch] += 0.55 * env * this.landHard;
      p[C.chestPitch] += 0.3 * env * this.landHard;
      p[C.lRoll] += 0.4 * env;
      p[C.rRoll] += 0.4 * env;
      p[C.headPitch] -= 0.2 * env;
    }
  }

  /** Layer 3: punch and barge clips, keyed over the pose so far. */
  private clips(p: Pose, s: AnimInput): void {
    // No target known: swing at the screen-right side (world -x), the rider's front.
    const side = s.strikeDir > 0 ? 1 : -1;
    const P = RIDER_ANIM.punch;
    const tp = s.time - this.punchAt;
    if (tp >= 0 && tp < P.windup + P.strike + P.hold + P.recover) this.keyed(p, tp, P, false, side);
    const B = RIDER_ANIM.barge;
    const tb = s.time - this.bargeAt;
    if (tb >= 0 && tb < B.windup + B.strike + B.hold + B.recover) this.keyed(p, tb, B, true, side);
  }

  /** Blend p through anticipation (A) and strike (B) keys and back: ease out of the stance, snap into the strike, hold, recover. */
  private keyed(p: Pose, t: number, phases: { windup: number; strike: number; hold: number; recover: number }, barge: boolean, side: number): void {
    const a = this.keyA;
    const b = this.keyB;
    a.set(p);
    b.set(p);
    if (barge) this.bargeKeys(p, a, b, side);
    else this.punchKeys(p, a, b, side);
    const t1 = phases.windup;
    const t2 = t1 + phases.strike;
    const t3 = t2 + phases.hold;
    if (t < t1) {
      const k = easeOut(t / t1);
      for (let i = 0; i < N; i++) p[i] = lerp(p[i], a[i], k);
    } else if (t < t2) {
      const k = easeOut((t - t1) / phases.strike);
      for (let i = 0; i < N; i++) p[i] = lerp(a[i], b[i], k);
    } else if (t < t3) {
      // Snap past the strike pose and settle back (an overshoot the 60 Hz frames can show), then a shudder on the hold.
      const o = 0.18 * Math.sin(Math.PI * clamp((t - t2) / (phases.hold * 0.6), 0, 1));
      for (let i = 0; i < N; i++) p[i] = b[i] + (b[i] - a[i]) * o;
      p[C.chestRoll] += 0.025 * Math.sin(t * 70);
    } else {
      const k = smoothstep(0, 1, (t - t3) / phases.recover);
      for (let i = 0; i < N; i++) p[i] = lerp(b[i], p[i], easeIn(k) * 0.4 + k * 0.6);
    }
  }

  /**
   * The punch, thrown with the arm on the target's side: wind-up with that
   * shoulder drawn back, the fist cocked behind it and the body leaning
   * away; then the torso snaps round, the weight shifts and the arm whips
   * out straight to the side, the fist well out from the body.
   */
  private punchKeys(base: Pose, a: Pose, b: Pose, side: number): void {
    const hit = side > 0 ? ARM.l : ARM.r;
    const guard = side > 0 ? ARM.r : ARM.l;
    // Anticipation.
    a[C.chestYaw] = base[C.chestYaw] + side * 0.55;
    a[C.spineYaw] = base[C.spineYaw] + side * 0.2;
    a[C.chestRoll] = base[C.chestRoll] + side * 0.22;
    a[C.hipX] = base[C.hipX] - side * 0.07;
    a[C.crouch] = base[C.crouch] + 0.12;
    a[C.headYaw] = base[C.headYaw] + side * 0.2;
    const yawA = a[C.hipYaw] + a[C.spineYaw] + a[C.chestYaw];
    setArm(a, hit, -0.25, 1.0, -0.95 + side * yawA, 2.1);
    setArm(a, guard, 0.5, 0.55, 0.5 + -side * yawA * 0.5, 1.7);
    // Strike.
    b[C.chestYaw] = base[C.chestYaw] - side * 0.42;
    b[C.spineYaw] = base[C.spineYaw] - side * 0.2;
    b[C.chestRoll] = base[C.chestRoll] - side * 0.34;
    b[C.spineRoll] = base[C.spineRoll] - side * 0.18;
    b[C.hipX] = base[C.hipX] + side * 0.2;
    b[C.crouch] = base[C.crouch] + 0.02;
    b[C.chestPitch] = base[C.chestPitch] - 0.08;
    b[C.headYaw] = base[C.headYaw] + side * 0.45;
    b[C.headRoll] = base[C.headRoll] + side * 0.15;
    b[C.bank] = base[C.bank] + side * 0.1;
    const yawB = b[C.hipYaw] + b[C.spineYaw] + b[C.chestYaw];
    // Aim the arm 15 degrees forward of straight out to the side, whatever the stance has done to the chest.
    // Raised past horizontal in the chest's frame, as the chest leans into the punch.
    setArm(b, hit, 0.1, 2.15, 0.26 + side * yawB, 0.0);
    setArm(b, guard, 0.55, 0.45, 0.8 - side * yawB, 2.15);
  }

  /** The barge: a shoulder charge. Torso side-on, the leading shoulder dropped, a lunge towards the target, arms tucked in. */
  private bargeKeys(base: Pose, a: Pose, b: Pose, side: number): void {
    const lead = side > 0 ? ARM.l : ARM.r;
    const trail = side > 0 ? ARM.r : ARM.l;
    // Anticipation: lean away from the target, coiling, arms drawn in.
    a[C.crouch] = base[C.crouch] + 0.18;
    a[C.hipX] = base[C.hipX] - side * 0.12;
    a[C.chestRoll] = base[C.chestRoll] + side * 0.3;
    a[C.bank] = base[C.bank] - side * 0.06;
    setArm(a, ARM.l, 0.45, 0.35, 0.35, 1.9);
    setArm(a, ARM.r, 0.45, 0.35, 0.35, 1.9);
    // Strike: side-on (the chest square to the course so the leading shoulder points at the target), that shoulder
    // dropped and driven in, the hips lunging across, the lead elbow tucked and pointing at the target.
    b[C.chestYaw] = -(base[C.hipYaw] + base[C.spineYaw]) + side * 0.15;
    b[C.chestRoll] = -side * 0.4;
    b[C.spineRoll] = -side * 0.2;
    b[C.chestPitch] = base[C.chestPitch];
    b[C.hipX] = base[C.hipX] + side * 0.35;
    b[C.crouch] = base[C.crouch] + 0.12;
    b[C.headRoll] = side * 0.25;
    b[C.headYaw] = side * 0.3;
    b[C.headPitch] = base[C.headPitch] + 0.1;
    b[C.bank] = base[C.bank] + side * 0.28;
    setArm(b, lead, 0.0, 0.95, 0.0, 1.9);
    setArm(b, trail, -0.3, 0.75, -0.2, 1.1);
  }

  /** Layer 4: a hit taken. The head snaps away, the torso twists and bends away, the arms fly up, the board wobbles. */
  private flinchLayer(p: Pose, time: number): void {
    const t = time - this.flinchAt;
    if (t < 0 || t > RIDER_ANIM.flinchSeconds) return;
    const e = (t < 0.045 ? easeOut(t / 0.045) : Math.exp(-(t - 0.045) * 6.5)) * this.flinchK;
    const d = this.flinchDir;
    p[C.headRoll] -= d * 0.75 * e;
    p[C.headYaw] += d * 0.55 * e;
    p[C.headPitch] -= 0.25 * e;
    p[C.chestRoll] -= d * 0.45 * e;
    p[C.spineRoll] -= d * 0.18 * e;
    p[C.chestYaw] += d * 0.5 * e;
    p[C.spinePitch] -= 0.22 * e;
    p[C.chestPitch] -= 0.18 * e;
    p[C.hipX] += d * 0.12 * e;
    p[C.crouch] -= 0.15 * e;
    p[C.lRoll] += 1.35 * e;
    p[C.rRoll] += 1.35 * e;
    p[C.lPitch] += 0.6 * e * Math.sin(t * 24);
    p[C.rPitch] -= 0.6 * e * Math.sin(t * 24 + 1);
    p[C.lElbow] += 0.5 * e;
    p[C.rElbow] += 0.5 * e;
    p[C.bank] += d * 0.22 * this.flinchK * Math.sin(t * 26) * Math.exp(-t * 5);
  }

  /** Layer 5: the stumble, the wipeout and the knockout move the whole body (and the board). */
  private bodyMotion(p: Pose, s: AnimInput, dt: number, ocean: Ocean): void {
    const t = s.time;
    const pivot = this.model.dims.pivotY;
    const board = this.model.board;
    this.bodyPivot.position.set(0, pivot, 0);
    this.bodyPivot.rotation.set(0, 0, 0);
    if (!this.koActive) {
      board.position.set(0, 0, 0);
      board.rotation.set(0, 0, 0);
    }

    // A bad landing: thrown forward over the nose, hands out into the water to catch the fall, then scrambling back up.
    const tc = t - this.crashAt;
    if (s.crashing && tc >= 0 && !s.wiped) {
      const c = tc < 0.2 ? easeOut(tc / 0.2) : tc < 0.38 ? 1 : 1 - smoothstep(0.38, 0.7, tc);
      this.bodyPivot.rotation.set(0.85 * c, 0, 0.12 * c * Math.sin(tc * 9));
      this.bodyPivot.position.set(0, pivot - 0.3 * c, 0.3 * c);
      p[C.plant] = 1 - 0.7 * c;
      p[C.lThigh] = 0.9;
      p[C.rThigh] = 0.2;
      p[C.lKnee] = 1.5;
      p[C.rKnee] = 1.1;
      p[C.spinePitch] += 0.25 * c;
      p[C.chestPitch] += 0.15 * c;
      p[C.headPitch] -= 0.6 * c;
      p[C.crouch] += 0.3 * c;
      setArm(p, ARM.l, lerp(p[C.lPitch], 1.9 + 0.3 * Math.sin(t * 15), c), lerp(p[C.lRoll], 0.6, c), 0, lerp(p[C.lElbow], 0.3, c));
      setArm(p, ARM.r, lerp(p[C.rPitch], 1.7 + 0.3 * Math.sin(t * 15 + 2.5), c), lerp(p[C.rRoll], 0.7, c), 0, lerp(p[C.rElbow], 0.4, c));
      p[C.tilt] += 0.1 * c;
      if (tc < 0.22 && tc + dt >= 0.22) this.splash(s.x + Math.sin(s.heading) * 0.9 * s.build, s.y, s.z + Math.cos(s.heading) * 0.9 * s.build, 0.8);
    }

    // The last heart: pitch forward off the board into the water and float face down.
    const tw = t - this.wipeAt;
    if (s.wiped && !s.knockedOut && tw >= 0) {
      const fall = smoothstep(0, RIDER_ANIM.wipeoutFall, tw);
      const bob = tw > RIDER_ANIM.wipeoutFall ? 0.04 * Math.sin(tw * 3) : 0;
      this.bodyPivot.rotation.set(1.45 * fall, 0, 0.25 * fall);
      this.bodyPivot.position.set(0, lerp(pivot, 0.1, Math.pow(fall, 1.4)) + bob, 0.75 * fall);
      p[C.plant] = 1 - fall;
      p[C.lThigh] = -0.25;
      p[C.rThigh] = 0.15;
      p[C.lKnee] = 0.4;
      p[C.rKnee] = 0.7;
      setArm(p, ARM.l, lerp(p[C.lPitch], 2.7, fall), lerp(p[C.lRoll], 0.35, fall), 0, lerp(p[C.lElbow], 0.25, fall));
      setArm(p, ARM.r, lerp(p[C.rPitch], 2.5, fall), lerp(p[C.rRoll], 0.4, fall), 0, lerp(p[C.rElbow], 0.35, fall));
      p[C.headPitch] = -0.5 * fall;
      if (!this.wipeSplashed && fall > 0.8) {
        this.wipeSplashed = true;
        const fx = Math.sin(s.heading);
        const fz = Math.cos(s.heading);
        this.splash(s.x + fx * 0.9 * s.build, s.y, s.z + fz * 0.9 * s.build, 1.1);
      }
      board.position.set(0, -0.03 * fall, 0);
      board.rotation.set(-0.08 * fall, 0, 0.12 * fall * Math.sin(tw * 2));
    }

    if (this.koActive) this.knockout(p, s, dt, ocean);
  }

  /** The knockout: launched, tumbling rag-doll, a splash, then floating and sinking; the board tumbles away on its own. */
  private knockout(p: Pose, s: AnimInput, dt: number, ocean: Ocean): void {
    const g = PHYSICS.gravity;
    const build = s.build;
    const board = this.model.board;
    const flying = this.koSplashAt < 0;
    // Body.
    if (flying) {
      this.koBodyV.y -= g * dt;
      this.koBody.addScaledVector(this.koBodyV, dt);
      this.koRoll += -this.koDir * RIDER_ANIM.koTumble * dt;
      this.koPitch += RIDER_ANIM.koTumble * 0.45 * dt;
      const water = ocean.height(this.koBody.x, this.koBody.z);
      if (this.koBodyV.y < 0 && this.koBody.y <= water + 0.25 * build) {
        this.koSplashAt = s.time;
        this.splash(this.koBody.x, water, this.koBody.z, 1.4);
      }
    } else {
      const ts = s.time - this.koSplashAt;
      this.koBodyV.x *= Math.exp(-3 * dt);
      this.koBodyV.z *= Math.exp(-2 * dt);
      this.koBody.x += this.koBodyV.x * dt;
      this.koBody.z += this.koBodyV.z * dt;
      const water = ocean.height(this.koBody.x, this.koBody.z);
      this.koBody.y = water + 0.05 * build - Math.min(RIDER_ANIM.koSink * build, ts * 0.25 * build) + 0.03 * Math.sin(ts * 3);
      // Settle on the back, face up, arms out.
      const k = damp(5, dt);
      this.koRoll += (Math.round(this.koRoll / (Math.PI * 2)) * Math.PI * 2 - this.koRoll) * k;
      const lie = -Math.PI / 2 + Math.round((this.koPitch + Math.PI / 2) / (Math.PI * 2)) * Math.PI * 2;
      this.koPitch += (lie - this.koPitch) * k;
    }
    // Board: its own arc and spin, then floating flat.
    if (!this.koBoardDown) {
      this.koBoardV.y -= g * dt;
      this.koBoard.addScaledVector(this.koBoardV, dt);
      this.koBoardSpin += RIDER_ANIM.boardTumble * 0.4 * this.koDir * dt;
      this.koBoardFlip += RIDER_ANIM.boardTumble * dt;
      const water = ocean.height(this.koBoard.x, this.koBoard.z);
      if (this.koBoardV.y < 0 && this.koBoard.y <= water) {
        this.koBoardDown = true;
        this.splash(this.koBoard.x, water, this.koBoard.z, 0.6);
      }
    } else {
      // The board skids on with the field for a while rather than stopping dead in front of the camera.
      this.koBoardV.x *= Math.exp(-2 * dt);
      this.koBoardV.z *= Math.exp(-0.7 * dt);
      this.koBoard.x += this.koBoardV.x * dt;
      this.koBoard.z += this.koBoardV.z * dt;
      this.koBoard.y = ocean.height(this.koBoard.x, this.koBoard.z) - 0.04;
      const k = damp(6, dt);
      this.koBoardFlip += (Math.round(this.koBoardFlip / Math.PI) * Math.PI - this.koBoardFlip) * k;
    }
    // The rider's group sits on the water under the body; everything else is relative to it, unrotated.
    const gx = s.x;
    const gy = s.y;
    const gz = s.z;
    this.bodyPivot.position.set((this.koBody.x - gx) / build, (this.koBody.y - gy) / build, (this.koBody.z - gz) / build);
    _e.set(this.koPitch, this.koYaw, this.koRoll, 'YXZ');
    this.bodyPivot.rotation.copy(_e);
    board.position.set((this.koBoard.x - gx) / build, (this.koBoard.y - gy) / build, (this.koBoard.z - gz) / build);
    board.rotation.set(0, this.koBoardSpin, this.koBoardFlip, 'YXZ');
    // Limbs: flailing in the air, limp on the water.
    p[C.plant] = 0;
    const flail = flying ? 1 : Math.max(0, 1 - (s.time - this.koSplashAt) * 3);
    const ft = s.time * 17;
    setArm(p, ARM.l, lerp(0.2, 1.6 * Math.sin(ft), flail), lerp(1.3, 1.2 + 0.5 * Math.sin(ft * 0.7), flail), 0, lerp(0.3, 0.6 + 0.5 * Math.sin(ft + 1), flail));
    setArm(p, ARM.r, lerp(0.1, 1.6 * Math.sin(ft + 2.4), flail), lerp(1.2, 1.2 + 0.5 * Math.sin(ft * 0.8 + 1), flail), 0, lerp(0.4, 0.6 + 0.5 * Math.sin(ft + 2), flail));
    p[C.lThigh] = lerp(0.15, 0.9 * Math.sin(ft * 0.9), flail);
    p[C.rThigh] = lerp(-0.1, 0.9 * Math.sin(ft * 0.9 + 2.2), flail);
    p[C.lThighRoll] = 0.25;
    p[C.rThighRoll] = 0.2;
    p[C.lKnee] = lerp(0.3, 0.9 + 0.6 * Math.sin(ft * 1.1), flail);
    p[C.rKnee] = lerp(0.4, 0.9 + 0.6 * Math.sin(ft * 1.1 + 1), flail);
    p[C.crouch] = 0;
    p[C.hipX] = 0;
    p[C.hipZ] = 0;
    p[C.chestRoll] = 0.3 * Math.sin(ft * 0.6) * flail;
    p[C.headRoll] = 0.4 * Math.sin(ft * 0.5) * flail;
    p[C.headPitch] = -0.2;
    p[C.bank] = 0;
    p[C.tilt] = 0;
  }

  /** Write a pose to the bones: hips, spine, chest, head and arms forward; legs by IK onto the deck (blended with FK when the feet leave it). */
  private apply(p: Pose): void {
    const bones = this.model.bones;
    const dims = this.model.dims;
    const hips = bones[BONE.hips];
    _e.set(p[C.hipPitch], p[C.hipYaw], p[C.hipRoll], 'YXZ');
    _hipsQ.setFromEuler(_e);
    _hipsInv.copy(_hipsQ).invert();

    // Hip height: as tall as both legs allow with the feet where they are, then lowered by the crouch.
    const stand = Math.min(this.standHeight(p, BONE.thighL, dims.frontFoot), this.standHeight(p, BONE.thighR, dims.backFoot));
    const crouch = clamp(p[C.crouch], -0.1, 1.15);
    const hipY = lerp(stand, dims.hipsY, 1 - p[C.plant]) - crouch * 0.4;
    _hipsPos.set(p[C.hipX], hipY, p[C.hipZ]);
    hips.position.copy(_hipsPos);
    hips.quaternion.copy(_hipsQ);

    bones[BONE.spine].rotation.set(p[C.spinePitch], p[C.spineYaw], p[C.spineRoll], 'YXZ');
    bones[BONE.chest].rotation.set(p[C.chestPitch], p[C.chestYaw], p[C.chestRoll], 'YXZ');
    bones[BONE.neck].rotation.set(p[C.headPitch] * 0.4, p[C.headYaw] * 0.4, p[C.headRoll] * 0.4, 'YXZ');
    bones[BONE.head].rotation.set(p[C.headPitch] * 0.6, p[C.headYaw] * 0.6, p[C.headRoll] * 0.6, 'YXZ');
    // Long hair lies down the back: it ignores the head's nod (follows the chest's lean) and stands a little off the shoulders, swaying.
    const sway = 0.06 * Math.sin(this.time * 2.3) + (this.airW > 0.5 ? 0.12 * Math.sin(this.time * 17) : 0);
    bones[BONE.hair].rotation.set(clamp(-p[C.headPitch] + 0.18 + sway, -0.5, 1.4), 0, clamp(-p[C.headRoll] * 0.8, -0.8, 0.8));

    bones[BONE.upperArmL].rotation.set(-p[C.lPitch], -p[C.lSwing], p[C.lRoll], 'XYZ');
    bones[BONE.forearmL].rotation.set(-Math.max(0, p[C.lElbow]), 0, 0);
    bones[BONE.handL].rotation.set(0.2, 0, 0);
    bones[BONE.upperArmR].rotation.set(-p[C.rPitch], p[C.rSwing], -p[C.rRoll], 'XYZ');
    bones[BONE.forearmR].rotation.set(-Math.max(0, p[C.rElbow]), 0, 0);
    bones[BONE.handR].rotation.set(0.2, 0, 0);

    const facing = p[C.hipYaw];
    this.leg(BONE.thighL, BONE.shinL, BONE.footL, dims.frontFoot, facing + 0.15, -0.75, p[C.plant], p[C.lThigh], p[C.lThighRoll], p[C.lKnee], 1);
    this.leg(BONE.thighR, BONE.shinR, BONE.footR, dims.backFoot, facing - 0.1, -1.25, p[C.plant], p[C.rThigh], p[C.rThighRoll], p[C.rKnee], -1);
  }

  /** The highest the hips can be with this leg nearly straight and its foot on its spot (uses the hips rotation in _hipsQ). */
  private standHeight(p: Pose, thighI: number, foot: THREE.Vector3): number {
    const dims = this.model.dims;
    const reach = (dims.thigh + dims.shin) * 0.985;
    _v.copy(this.model.bones[thighI].position).applyQuaternion(_hipsQ);
    const dx = foot.x - (p[C.hipX] + _v.x);
    const dz = foot.z - (p[C.hipZ] + _v.z);
    return foot.y + dims.ankle + Math.sqrt(Math.max(0.01, reach * reach - dx * dx - dz * dz)) - _v.y;
  }

  /** Two-bone IK for one leg onto its foot spot on the deck, knee towards `poleYaw`, foot flat at `footYaw`; slerped with the FK angles by `plant`. */
  private leg(thighI: number, shinI: number, footI: number, foot: THREE.Vector3, poleYaw: number, footYaw: number, plant: number, fkPitch: number, fkRoll: number, fkKnee: number, side: number): void {
    const bones = this.model.bones;
    const dims = this.model.dims;
    const thigh = bones[thighI];
    const shin = bones[shinI];
    const footBone = bones[footI];
    const L1 = dims.thigh;
    const L2 = dims.shin;
    // FK first (used alone when the feet are off the board).
    _e.set(-fkPitch, 0, side * fkRoll, 'XYZ');
    const fkThigh = _q2.setFromEuler(_e);
    if (plant <= 0.001) {
      thigh.quaternion.copy(fkThigh);
      shin.quaternion.setFromAxisAngle(X_AXIS, Math.max(0, fkKnee));
      footBone.quaternion.setFromAxisAngle(X_AXIS, -0.3);
      return;
    }
    // Hip joint in model space.
    _p.copy(thigh.position).applyQuaternion(_hipsQ).add(_hipsPos);
    _target.set(foot.x, foot.y + dims.ankle, foot.z);
    _d.subVectors(_target, _p);
    const len = clamp(_d.length(), Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.999);
    _d.normalize();
    const cosA = clamp((L1 * L1 + len * len - L2 * L2) / (2 * L1 * len), -1, 1);
    const a = Math.acos(cosA);
    const cosK = clamp((L1 * L1 + L2 * L2 - len * len) / (2 * L1 * L2), -1, 1);
    const knee = Math.PI - Math.acos(cosK);
    _pole.set(Math.sin(poleYaw), 0, Math.cos(poleYaw));
    _pole.addScaledVector(_d, -_pole.dot(_d));
    if (_pole.lengthSq() < 1e-6) _pole.set(0, 0, 1);
    _pole.normalize();
    _u.copy(_d).multiplyScalar(Math.cos(a)).addScaledVector(_pole, Math.sin(a));
    _y.copy(_u).negate();
    _z.copy(_pole).multiplyScalar(Math.cos(a)).addScaledVector(_d, -Math.sin(a)).normalize();
    _x.crossVectors(_y, _z);
    _m.makeBasis(_x, _y, _z);
    const thighModel = _q.setFromRotationMatrix(_m);
    // Local to the hips.
    _q3.copy(_hipsInv).multiply(thighModel);
    if (plant < 0.999) _q3.slerp(fkThigh, 1 - plant);
    thigh.quaternion.copy(_q3);
    shin.quaternion.setFromAxisAngle(X_AXIS, lerp(Math.max(0, fkKnee), knee, plant));
    // The foot flat on the deck at its stance angle.
    _q3.copy(_hipsQ).multiply(thigh.quaternion).multiply(shin.quaternion).invert();
    _q2.setFromAxisAngle(Y_AXIS, footYaw);
    footBone.quaternion.copy(_q3.multiply(_q2));
    if (plant < 0.999) footBone.quaternion.slerp(_q2.setFromAxisAngle(X_AXIS, -0.3), 1 - plant);
  }
}
