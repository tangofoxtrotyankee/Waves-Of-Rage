import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { clamp, damp } from '../engine/math';
import { boardTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { statMultipliers, type RiderSpec } from '../game/characters';
import { PALETTE, PHYSICS } from '../game/constants';
import type { Ocean } from '../world/Ocean';

/** The animation set from the character sheet. The prototype uses the first seven; airTrick and barge arrive with tricks and combat. */
export type RiderPose = 'idle' | 'carveLeft' | 'carveRight' | 'accelerate' | 'jump' | 'airTrick' | 'hit' | 'barge' | 'wipeout';

/** What drives a rider for one step: the player's input, or a rival's AI. */
export interface RiderControl {
  steer: number;
  pump: boolean;
  brake: boolean;
  jump: boolean;
}

export interface Landing {
  airTime: number;
}

/** A pose is a handful of joint values the rig eases towards. */
interface PoseParams {
  lean: number;
  roll: number;
  crouch: number;
  armL: number;
  armR: number;
  legBend: number;
  rigRoll: number;
  sink: number;
}

const POSES: Record<RiderPose, PoseParams> = {
  idle: { lean: 0.15, roll: 0, crouch: 0, armL: 0.5, armR: 0.5, legBend: 0.1, rigRoll: 0, sink: 0 },
  carveLeft: { lean: 0.2, roll: 0.45, crouch: 0.1, armL: 0.1, armR: 1.3, legBend: 0.25, rigRoll: 0, sink: 0 },
  carveRight: { lean: 0.2, roll: -0.45, crouch: 0.1, armL: 1.3, armR: 0.1, legBend: 0.25, rigRoll: 0, sink: 0 },
  accelerate: { lean: 0.45, roll: 0, crouch: 0.3, armL: -0.4, armR: -0.4, legBend: 0.45, rigRoll: 0, sink: 0 },
  jump: { lean: -0.1, roll: 0, crouch: 0.2, armL: 2.4, armR: 2.4, legBend: 0.5, rigRoll: 0, sink: 0 },
  airTrick: { lean: -0.3, roll: 0.3, crouch: 0.3, armL: 2.0, armR: -0.8, legBend: 0.6, rigRoll: 0, sink: 0 },
  hit: { lean: -0.6, roll: 0.2, crouch: 0, armL: 2.6, armR: 2.6, legBend: 0, rigRoll: 0, sink: 0 },
  barge: { lean: 0.5, roll: 0.6, crouch: 0.2, armL: -0.6, armR: 1.6, legBend: 0.3, rigRoll: 0, sink: 0 },
  wipeout: { lean: -1.2, roll: 0.8, crouch: 0, armL: 2.8, armR: 2.0, legBend: 0.2, rigRoll: 1.3, sink: 0.7 },
};

const box = (w: number, h: number, d: number, color: number, material: THREE.Material): THREE.Mesh => new THREE.Mesh(colorGeometry(new THREE.BoxGeometry(w, h, d), color), material);

/** A box whose origin is at its top, so scaling it bends from the joint. */
const limb = (w: number, h: number, d: number, color: number, material: THREE.Material): THREE.Mesh => {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(0, -h / 2, 0);
  return new THREE.Mesh(colorGeometry(geometry, color), material);
};

/**
 * A surfer on a board: track-space physics plus a low-poly rig built from
 * boxes in the rider's colours (about 150 triangles, big hands, big hair).
 * The player's Surfer and the AI Rival both extend it; only the control
 * source differs.
 *
 * Physics runs on the course: x across, z along, y from the ocean. The
 * rider leaves the water when ballistic motion would carry it above the
 * surface (a steep-backed ramp, or a crest taken fast) or when it jumps,
 * and lands when it meets the water again.
 */
export class Rider {
  readonly group = new THREE.Group();
  readonly shadow: THREE.Mesh;
  readonly stats;
  x = 0;
  z = 0;
  y = 0;
  vy = 0;
  speed: number = PHYSICS.baseSpeed;
  heading = 0;
  airborne = false;
  airTime = 0;
  /** Sideways velocity from contact, decaying. */
  shoveVx = 0;
  /** Controls are ignored until this time (seconds on the run clock). */
  stunnedUntil = 0;
  wiped = false;
  pose: RiderPose = 'idle';
  /** When set (rivals), the speed the rider relaxes towards instead of its base speed. */
  targetSpeed: number | null = null;

  private readonly rig = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly current: PoseParams = { ...POSES.idle };
  private slopeDz = 0;
  private landing: Landing | null = null;

  constructor(readonly spec: RiderSpec) {
    this.stats = statMultipliers(spec);
    const c = spec.colors;
    const body = createPS1Material();
    const boardMaterial = createPS1Material({ map: boardTexture(c.board, c.boardStripe) });

    // Board: a flat box with the nose tapered.
    const boardGeometry = new THREE.BoxGeometry(0.58, 0.08, 2.2, 1, 1, 3);
    const pos = boardGeometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z > 0.3) pos.setX(i, pos.getX(i) * (1 - 0.7 * ((z - 0.3) / 0.8)));
      if (z < -0.7) pos.setX(i, pos.getX(i) * 0.8);
    }
    const board = new THREE.Mesh(colorGeometry(boardGeometry, 0xffffff), boardMaterial);
    board.position.y = 0.06;
    this.group.add(board);

    // Rig: legs, shorts, torso, head, hair, arms, hands. Y is up from the board.
    this.legL = limb(0.16, 0.55, 0.16, c.skin, body);
    this.legR = limb(0.16, 0.55, 0.16, c.skin, body);
    this.legL.position.set(-0.1, 0.62, 0.32);
    this.legR.position.set(0.1, 0.62, -0.32);
    const shorts = box(0.5, 0.24, 0.72, c.shorts, body);
    shorts.position.y = 0.72;
    const chest = box(0.5, 0.52, 0.3, c.skin, body);
    chest.position.y = 0.28;
    const head = box(0.26, 0.26, 0.26, c.skin, body);
    head.position.y = 0.7;
    const hair = box(0.34, 0.16, 0.34, c.hair, body);
    hair.position.y = 0.88;
    this.armL = limb(0.13, 0.5, 0.13, c.skin, body);
    this.armR = limb(0.13, 0.5, 0.13, c.skin, body);
    this.armL.position.set(-0.33, 0.5, 0);
    this.armR.position.set(0.33, 0.5, 0);
    for (const arm of [this.armL, this.armR]) {
      const hand = box(0.17, 0.17, 0.17, c.skin, body);
      hand.position.y = -0.56;
      arm.add(hand);
    }
    this.torso.add(chest, head, hair, this.armL, this.armR);
    this.torso.position.y = 0.84;
    this.rig.add(this.legL, this.legR, shorts, this.torso);
    this.group.add(this.rig);
    this.group.scale.setScalar(spec.build);

    this.shadow = new THREE.Mesh(colorGeometry(new THREE.CircleGeometry(0.7, 8), PALETTE.deepWater), createPS1Material({ unlit: true, opacity: 0.45, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
  }

  /** Put the rider on the water at a course position with default motion. */
  reset(x: number, z: number, ocean: Ocean): void {
    this.x = x;
    this.z = z;
    this.y = ocean.height(x, z);
    this.vy = 0;
    this.speed = PHYSICS.baseSpeed * this.stats.speed;
    this.heading = 0;
    this.airborne = false;
    this.airTime = 0;
    this.shoveVx = 0;
    this.stunnedUntil = 0;
    this.wiped = false;
    this.pose = 'idle';
    this.landing = null;
    this.group.visible = true;
    Object.assign(this.current, POSES.idle);
    this.updateVisuals(1, ocean);
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

  update(dt: number, control: RiderControl, ocean: Ocean, time: number): void {
    this.landing = null;
    if (this.wiped) {
      this.speed = Math.max(0, this.speed - 10 * dt);
      this.z += this.speed * dt;
      this.y = ocean.height(this.x, this.z);
      this.airborne = false;
      this.pose = 'wipeout';
      this.updateVisuals(dt, ocean);
      return;
    }
    const stunned = time < this.stunnedUntil;
    const steer = stunned ? 0 : this.airborne ? control.steer * PHYSICS.airSteer : control.steer;
    const pump = control.pump && !stunned;
    const brake = control.brake && !stunned;
    const jump = control.jump && !stunned;

    // Speed: pumping and braking, slopes (downhill gains, uphill loses), relaxing towards cruise.
    if (!this.airborne) {
      if (pump) this.speed += PHYSICS.pumpAccel * dt;
      if (brake) this.speed -= PHYSICS.brakeDecel * dt;
      this.speed -= this.slopeDz * PHYSICS.slopeGain * dt;
    }
    const cruise = this.targetSpeed ?? PHYSICS.baseSpeed * this.stats.speed;
    this.speed += (cruise - this.speed) * damp(PHYSICS.drag, dt);
    this.speed = clamp(this.speed, PHYSICS.minSpeed, PHYSICS.maxSpeed * this.stats.speed);

    // Heading: carve towards the steer, straighten when released.
    const carve = PHYSICS.carveRate * this.stats.carve * (brake ? PHYSICS.hardCarveMul : 1);
    if (Math.abs(steer) > 0.05) this.heading += steer * carve * dt;
    else this.heading -= Math.sign(this.heading) * Math.min(Math.abs(this.heading), PHYSICS.headingReturn * dt);
    this.heading = clamp(this.heading, -PHYSICS.maxHeading, PHYSICS.maxHeading);

    // Move along the course; the whitewater at the edges pushes back.
    this.z += this.speed * Math.cos(this.heading) * dt;
    this.x += (this.speed * Math.sin(this.heading) + this.shoveVx) * dt;
    this.shoveVx *= Math.exp(-PHYSICS.shoveDecay * dt);
    const limit = PHYSICS.trackHalfWidth;
    if (this.x > limit) {
      this.x = limit;
      this.heading = Math.min(this.heading, 0);
      this.shoveVx = -2.5;
      this.speed *= 0.98;
    } else if (this.x < -limit) {
      this.x = -limit;
      this.heading = Math.max(this.heading, 0);
      this.shoveVx = 2.5;
      this.speed *= 0.98;
    }

    // Vertical: ride the surface, leave it when the water drops away faster than a ballistic path, or jump.
    const h = ocean.height(this.x, this.z);
    this.slopeDz = ocean.slope(this.x, this.z).dz;
    if (!this.airborne) {
      const surfaceVy = (h - this.y) / dt;
      const ballisticVy = this.vy - PHYSICS.gravity * dt;
      const ballisticY = this.y + ballisticVy * dt;
      if (jump) {
        this.vy = PHYSICS.jumpVelocity + Math.max(0, surfaceVy);
        this.y = h + 0.01;
        this.airborne = true;
        this.airTime = 0;
      } else if (ballisticY > h + 0.03) {
        this.vy = ballisticVy;
        this.y = ballisticY;
        this.airborne = true;
        this.airTime = 0;
      } else {
        this.y = h;
        this.vy = surfaceVy;
      }
    } else {
      if (jump && this.vy <= 0 && this.y - h < PHYSICS.coyoteHeight) this.vy = PHYSICS.jumpVelocity;
      this.vy -= PHYSICS.gravity * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      if (this.y <= h) {
        this.y = h;
        this.vy = 0;
        this.airborne = false;
        this.landing = { airTime: this.airTime };
        this.airTime = 0;
      }
    }

    this.pose = stunned ? 'hit' : this.airborne ? 'jump' : steer < -0.3 ? 'carveLeft' : steer > 0.3 ? 'carveRight' : pump ? 'accelerate' : 'idle';
    this.updateVisuals(dt, ocean);
  }

  /** Place the mesh and ease the rig towards the current pose. */
  private updateVisuals(dt: number, ocean: Ocean): void {
    const target = POSES[this.pose];
    const k = damp(10, dt);
    const c = this.current;
    for (const key of Object.keys(c) as (keyof PoseParams)[]) c[key] += (target[key] - c[key]) * k;

    this.group.position.set(this.x, this.y - c.sink * this.spec.build, this.z);
    this.group.rotation.set(0, 0, 0);
    const pitch = this.airborne ? clamp(-this.vy * 0.05, -0.4, 0.4) : clamp(-Math.atan(this.slopeDz) * 0.6, -0.4, 0.4);
    this.group.rotateY(this.heading);
    this.group.rotateX(pitch);
    this.group.rotateZ(-this.heading * 0.45 + c.rigRoll);

    this.rig.position.y = -c.crouch * 0.35;
    this.torso.rotation.set(c.lean, 0, c.roll);
    this.armL.rotation.z = -c.armL;
    this.armR.rotation.z = c.armR;
    this.legL.scale.y = this.legR.scale.y = 1 - c.legBend * 0.4;

    const water = ocean.height(this.x, this.z);
    const above = Math.max(0, this.y - water);
    this.shadow.position.set(this.x, water + 0.04, this.z);
    this.shadow.scale.setScalar(Math.max(0.3, 1 - above * 0.18));
    this.shadow.visible = this.group.visible && !this.wiped;
  }
}
