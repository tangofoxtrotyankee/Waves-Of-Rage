import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { clamp, damp } from '../engine/math';
import { boardTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { statMultipliers, type RiderSpec } from '../game/characters';
import { COMBAT, PALETTE, PHYSICS, TRICKS } from '../game/constants';
import type { Ocean } from '../world/Ocean';

/** The animation set from the character sheet, plus `punch` (the sheet's HIT, delivered rather than taken). */
export type RiderPose = 'idle' | 'carveLeft' | 'carveRight' | 'accelerate' | 'jump' | 'airTrick' | 'hit' | 'punch' | 'barge' | 'wipeout';

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
  /** Landed within the tolerance of upright. */
  clean: boolean;
}

/** A pose is a handful of joint values the rig eases towards. */
interface PoseParams {
  lean: number;
  roll: number;
  crouch: number;
  armL: number;
  armR: number;
  /** Both arms swung forward (negative) or back. */
  armPitch: number;
  legBend: number;
  rigRoll: number;
  sink: number;
}

const POSES: Record<RiderPose, PoseParams> = {
  idle: { lean: 0.15, roll: 0, crouch: 0, armL: 0.5, armR: 0.5, armPitch: 0, legBend: 0.1, rigRoll: 0, sink: 0 },
  // Rolling the torso by -z leans it towards world +x (screen-left), into a left carve.
  carveLeft: { lean: 0.2, roll: -0.3, crouch: 0.1, armL: 0.1, armR: 1.3, armPitch: 0, legBend: 0.25, rigRoll: 0, sink: 0 },
  carveRight: { lean: 0.2, roll: 0.3, crouch: 0.1, armL: 1.3, armR: 0.1, armPitch: 0, legBend: 0.25, rigRoll: 0, sink: 0 },
  accelerate: { lean: 0.45, roll: 0, crouch: 0.3, armL: -0.4, armR: -0.4, armPitch: 0.6, legBend: 0.45, rigRoll: 0, sink: 0 },
  jump: { lean: -0.1, roll: 0, crouch: 0.2, armL: 2.4, armR: 2.4, armPitch: 0, legBend: 0.5, rigRoll: 0, sink: 0 },
  airTrick: { lean: 0.6, roll: 0.3, crouch: 0.5, armL: 0.2, armR: -0.3, armPitch: 0.9, legBend: 0.7, rigRoll: 0, sink: 0 },
  hit: { lean: -0.6, roll: 0.2, crouch: 0, armL: 2.6, armR: 2.6, armPitch: 0, legBend: 0, rigRoll: 0, sink: 0 },
  punch: { lean: 0.35, roll: 0.1, crouch: 0.1, armL: 0.3, armR: 0.2, armPitch: -1.5, legBend: 0.2, rigRoll: 0, sink: 0 },
  barge: { lean: 0.5, roll: 0.6, crouch: 0.2, armL: -0.6, armR: 1.6, armPitch: 0, legBend: 0.3, rigRoll: 0.25, sink: 0 },
  wipeout: { lean: -1.2, roll: 0.8, crouch: 0, armL: 2.8, armR: 2.0, armPitch: 0, legBend: 0.2, rigRoll: 1.3, sink: 0.7 },
};

const CONTROL_IDLE: RiderControl = { steer: 0, pump: false, brake: false, jump: false, attack: false, barge: false };

/** A coloured box translated into place, ready to merge. */
function part(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return colorGeometry(geometry, color);
}

/**
 * A surfer on a board: track-space physics plus a low-poly rig built from
 * boxes in the rider's colours (seven draw calls: board, two legs, shorts, a
 * torso with head and hair, two arms with hands). The player's Surfer and
 * the AI Rival both extend it; only the control source differs.
 *
 * Physics runs on the course: x across, z along, y from the ocean. The
 * rider leaves the water when ballistic motion would carry it above the
 * surface (a steep-backed ramp, or a crest taken fast) or when it jumps,
 * spins and grabs in the air, and lands clean or crashes. Punches and
 * barges are requested here (cooldowns, poses) and resolved by the run.
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
  /** Rotation accumulated in the air, radians. */
  spin = 0;
  grabbing = false;
  /** Set for the one step in which a punch or barge starts; the run resolves it. */
  attacking = false;
  barging = false;
  /** How hard the rider was sliding when it hit the course edge this step (0 if it did not). */
  edgeShove = 0;
  /** Recently shoved by a punch or barge: whatever it hits before this time knocks it out. */
  shovedUntil = 0;

  private rig = new THREE.Group();
  private torso = new THREE.Group();
  private armL = new THREE.Mesh();
  private armR = new THREE.Mesh();
  private legL = new THREE.Mesh();
  private legR = new THREE.Mesh();
  private bodyMaterial: THREE.ShaderMaterial | null = null;
  private boardMaterial: THREE.ShaderMaterial | null = null;
  private readonly current: PoseParams = { ...POSES.idle };
  private slopeDz = 0;
  private landing: Landing | null = null;
  private punchUntil = 0;
  private bargeUntil = 0;
  private attackCooldownUntil = 0;
  private bargeCooldownUntil = 0;
  /** A press that could not fire (airborne, stunned) is kept for a moment, so it is not lost to a shove. */
  private attackBufferedUntil = 0;
  private bargeBufferedUntil = 0;
  private flashUntil = 0;

  constructor(spec: RiderSpec) {
    this.spec = spec;
    this.stats = statMultipliers(spec);
    this.shadow = new THREE.Mesh(colorGeometry(new THREE.CircleGeometry(0.7, 8), PALETTE.deepWater), createPS1Material({ unlit: true, opacity: 0.45, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.setSpec(spec);
  }

  /** Rebuild the rig for another character; stats follow. */
  setSpec(spec: RiderSpec): void {
    this.spec = spec;
    this.stats = statMultipliers(spec);
    for (const child of [...this.group.children]) {
      child.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      this.group.remove(child);
    }
    this.bodyMaterial?.dispose();
    this.boardMaterial?.dispose();
    const c = spec.colors;
    this.bodyMaterial = createPS1Material();
    this.boardMaterial = createPS1Material({ map: boardTexture(c.board, c.boardStripe) });

    // Board: a flat box with the nose tapered.
    const boardGeometry = new THREE.BoxGeometry(0.58, 0.08, 2.2, 1, 1, 3);
    const pos = boardGeometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z > 0.3) pos.setX(i, pos.getX(i) * (1 - 0.7 * ((z - 0.3) / 0.8)));
      if (z < -0.7) pos.setX(i, pos.getX(i) * 0.8);
    }
    const board = new THREE.Mesh(colorGeometry(boardGeometry, 0xffffff), this.boardMaterial);
    board.position.y = 0.06;

    // Rig, y up from the board: legs and arms have their origin at the joint so scaling bends them.
    const legGeometry = part(0.16, 0.55, 0.16, c.skin, 0, -0.275, 0);
    this.legL = new THREE.Mesh(legGeometry, this.bodyMaterial);
    this.legR = new THREE.Mesh(legGeometry, this.bodyMaterial);
    this.legL.position.set(-0.1, 0.62, 0.32);
    this.legR.position.set(0.1, 0.62, -0.32);
    const shorts = new THREE.Mesh(part(0.5, 0.24, 0.72, c.shorts, 0, 0.72, 0), this.bodyMaterial);
    const torsoGeometry = mergeGeometries([part(0.5, 0.52, 0.3, c.skin, 0, 0.28, 0), part(0.26, 0.26, 0.26, c.skin, 0, 0.7, 0), part(0.34, 0.16, 0.34, c.hair, 0, 0.88, 0)]);
    this.torso = new THREE.Group();
    this.torso.add(new THREE.Mesh(torsoGeometry, this.bodyMaterial));
    this.torso.position.y = 0.84;
    const armGeometry = mergeGeometries([part(0.13, 0.5, 0.13, c.skin, 0, -0.25, 0), part(0.17, 0.17, 0.17, c.skin, 0, -0.56, 0)]);
    this.armL = new THREE.Mesh(armGeometry, this.bodyMaterial);
    this.armR = new THREE.Mesh(armGeometry, this.bodyMaterial);
    this.armL.position.set(-0.33, 0.5, 0);
    this.armR.position.set(0.33, 0.5, 0);
    this.torso.add(this.armL, this.armR);
    this.rig = new THREE.Group();
    this.rig.add(this.legL, this.legR, shorts, this.torso);
    this.group.add(board, this.rig);
    this.group.scale.setScalar(spec.build);
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
    this.crashUntil = 0;
    this.wiped = false;
    this.knockedOut = false;
    this.pose = 'idle';
    this.landing = null;
    this.spin = 0;
    this.grabbing = false;
    this.attacking = false;
    this.barging = false;
    this.edgeShove = 0;
    this.shovedUntil = 0;
    this.punchUntil = 0;
    this.bargeUntil = 0;
    this.attackCooldownUntil = 0;
    this.bargeCooldownUntil = 0;
    this.attackBufferedUntil = 0;
    this.bargeBufferedUntil = 0;
    this.flashUntil = 0;
    this.group.visible = true;
    Object.assign(this.current, POSES.idle);
    this.updateVisuals(1, ocean, 0);
  }

  /** Back into the race after a knockout, with full health. */
  respawn(x: number, z: number, ocean: Ocean): void {
    this.reset(x, z, ocean);
    this.health = this.maxHealth;
  }

  /** Take a punch or barge: damage, a sideways shove, a stumble and a flash. Returns true if it was a knockout. */
  takeHit(damage: number, shove: number, time: number): boolean {
    this.health -= damage;
    this.shoveVx = shove;
    this.speed *= 0.8;
    this.stunnedUntil = Math.max(this.stunnedUntil, time + 0.4);
    this.shovedUntil = time + 0.6;
    this.flashUntil = time + 0.12;
    return this.health <= 0;
  }

  /** Out of the race until the run respawns it. */
  knockOut(time: number): void {
    this.health = 0;
    this.wiped = true;
    this.knockedOut = true;
    this.respawnAt = time + COMBAT.respawnSeconds;
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

  /** Whiten the rig (RAGE pulses, hit flashes). */
  setFlash(amount: number): void {
    if (this.bodyMaterial) this.bodyMaterial.uniforms.uFlash.value = amount;
    if (this.boardMaterial) this.boardMaterial.uniforms.uFlash.value = amount;
  }

  update(dt: number, control: RiderControl, ocean: Ocean, time: number): void {
    this.landing = null;
    this.attacking = false;
    this.barging = false;
    this.edgeShove = 0;
    if (this.wiped) {
      this.speed = Math.max(0, this.speed - 10 * dt);
      this.z += this.speed * dt;
      this.y = ocean.height(this.x, this.z);
      this.airborne = false;
      this.pose = 'wipeout';
      this.updateVisuals(dt, ocean, time);
      return;
    }
    if (control.attack) this.attackBufferedUntil = time + 0.25;
    if (control.barge) this.bargeBufferedUntil = time + 0.25;
    const stunned = time < this.stunnedUntil;
    if (stunned) control = CONTROL_IDLE;
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

    // Heading: carve towards the steer, straighten when released.
    const carve = PHYSICS.carveRate * this.stats.carve * (control.brake ? PHYSICS.hardCarveMul : 1);
    if (Math.abs(steer) > 0.05) this.heading += steer * carve * dt;
    else this.heading -= Math.sign(this.heading) * Math.min(Math.abs(this.heading), PHYSICS.headingReturn * dt);
    this.heading = clamp(this.heading, -PHYSICS.maxHeading, PHYSICS.maxHeading);

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
        this.airborne = true;
        this.airTime = 0;
      } else if (ballisticY > h + PHYSICS.launchAccel * dt * dt) {
        this.vy = ballisticVy;
        this.y = ballisticY;
        this.airborne = true;
        this.airTime = 0;
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
      }
      if (!stunned && wantsBarge && time >= this.bargeCooldownUntil) {
        this.barging = true;
        this.bargeBufferedUntil = 0;
        this.bargeCooldownUntil = time + COMBAT.bargeCooldown;
        this.bargeUntil = time + COMBAT.bargeSeconds;
        this.speed *= COMBAT.bargeSelfSpeed;
      }
    } else {
      if (control.jump && this.vy <= 0 && this.y - h < PHYSICS.coyoteHeight) this.vy = PHYSICS.jumpVelocity;
      this.vy -= PHYSICS.gravity * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      // Tricks: spin with the steer, grab with attack.
      this.spin += control.steer * TRICKS.spinRate * dt;
      if (wantsAttack && this.airTime > 0.1) {
        this.grabbing = true;
        this.attackBufferedUntil = 0;
      }
      if (this.y <= h) {
        this.y = h;
        this.vy = 0;
        this.airborne = false;
        const spinDeg = (Math.abs(this.spin) * 180) / Math.PI;
        const off = spinDeg % 360;
        const clean = off <= TRICKS.landingToleranceDeg || off >= 360 - TRICKS.landingToleranceDeg;
        this.landing = { airTime: this.airTime, spinDeg, grabbed: this.grabbing, clean };
        this.airTime = 0;
        this.spin = 0;
        this.grabbing = false;
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
      : control.pump ? 'accelerate'
      : 'idle';
    this.updateVisuals(dt, ocean, time);
  }

  /** Place the mesh and ease the rig towards the current pose. */
  private updateVisuals(dt: number, ocean: Ocean, time: number): void {
    const target = POSES[this.pose];
    const k = damp(10, dt);
    const c = this.current;
    for (const key of Object.keys(c) as (keyof PoseParams)[]) c[key] += (target[key] - c[key]) * k;

    this.group.position.set(this.x, this.y - c.sink * this.spec.build, this.z);
    this.group.rotation.set(0, 0, 0);
    const pitch = this.airborne ? clamp(-this.vy * 0.05, -0.4, 0.4) : clamp(-Math.atan(this.slopeDz) * 0.6, -0.4, 0.4);
    this.group.rotateY(this.heading + this.spin);
    this.group.rotateX(pitch);
    this.group.rotateZ(-this.heading * 0.45 + c.rigRoll);

    this.rig.position.y = -c.crouch * 0.35;
    this.torso.rotation.set(c.lean, 0, c.roll);
    this.armL.rotation.set(c.armPitch, 0, -c.armL);
    this.armR.rotation.set(c.armPitch, 0, c.armR);
    this.legL.scale.y = this.legR.scale.y = 1 - c.legBend * 0.4;
    if (time < this.flashUntil) this.setFlash(1);
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
