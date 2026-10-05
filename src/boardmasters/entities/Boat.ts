import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { THREE } from '../engine/three';
import { BOAT, PALETTE, PHYSICS } from '../game/constants';
import type { Ocean } from '../world/Ocean';

const HULL = 0xe63946;
const DECK = 0xf8f4e8;
const TRIM = 0xffd166;
const DARK = 0x1a1a2e;

let shared: THREE.BufferGeometry | null = null;

/**
 * The lifeguard boat as one geometry (shared): a red hull with a white
 * deck and gunwale stripe, pointed at the bow (+x: it is built travelling
 * towards +x and turned round for the other way), a small white cabin with
 * a dark windscreen, an orange rescue float on the stern and a flag on a
 * pole, plus a ring of foam at the waterline. About 4.6 m long.
 */
function boatGeometry(): THREE.BufferGeometry {
  if (shared) return shared;
  const parts: THREE.BufferGeometry[] = [];
  const hull = new THREE.BoxGeometry(3.4, 0.8, 1.7);
  hull.translate(-0.3, 0.35, 0);
  parts.push(colorGeometry(hull, HULL));
  // The bow: a wedge (a four-sided cone on its side) ahead of the hull.
  const bow = new THREE.ConeGeometry(0.85, 1.3, 4);
  bow.rotateY(Math.PI / 4);
  bow.scale(1, 1, 1.0);
  bow.rotateZ(-Math.PI / 2); // the point towards +x
  bow.translate(2.05, 0.35, 0);
  parts.push(colorGeometry(bow, HULL));
  const deck = new THREE.BoxGeometry(3.5, 0.08, 1.5);
  deck.translate(-0.3, 0.78, 0);
  parts.push(colorGeometry(deck, DECK));
  const stripe = new THREE.BoxGeometry(3.42, 0.14, 1.74);
  stripe.translate(-0.3, 0.62, 0);
  parts.push(colorGeometry(stripe, DECK));
  // The cabin and its windscreen, forward of the middle.
  const cabin = new THREE.BoxGeometry(1.2, 0.75, 1.1);
  cabin.translate(0.4, 1.18, 0);
  parts.push(colorGeometry(cabin, DECK));
  const screen = new THREE.BoxGeometry(0.12, 0.4, 1.0);
  screen.translate(1.02, 1.3, 0);
  parts.push(colorGeometry(screen, DARK));
  const roof = new THREE.BoxGeometry(1.4, 0.08, 1.3);
  roof.translate(0.4, 1.58, 0);
  parts.push(colorGeometry(roof, HULL));
  // The rescue float on the stern, the flag pole and flag.
  const float = new THREE.TorusGeometry(0.32, 0.1, 6, 10);
  float.rotateY(Math.PI / 2);
  float.translate(-1.6, 1.15, 0);
  parts.push(colorGeometry(float, 0xff8c42));
  const pole = new THREE.BoxGeometry(0.06, 1.3, 0.06);
  pole.translate(-0.9, 1.45, 0.5);
  parts.push(colorGeometry(pole, DARK));
  const flag = new THREE.BoxGeometry(0.5, 0.32, 0.04);
  flag.translate(-1.17, 1.95, 0.5);
  parts.push(colorGeometry(flag, TRIM));
  // Foam at the waterline.
  const ring = new THREE.RingGeometry(1.0, 1.4, 12, 1);
  ring.scale(2.1, 1, 1);
  ring.rotateX(-Math.PI / 2);
  ring.translate(-0.1, 0.02, 0);
  parts.push(colorGeometry(ring, PALETTE.foam));
  shared = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  return shared;
}

/** The boats' material (one for the pool). */
export function boatMaterial(): THREE.ShaderMaterial {
  return createPS1Material({});
}

/**
 * The lifeguard boat from the original game, in 3D: it crosses the course
 * sideways from one edge to the other (BOAT.speed), drifting slowly up the
 * course towards the rider, holds its line and cannot be jumped (it is
 * tall): steer round its bow or stern. A hit costs HEALTH.boat. Pooled.
 */
export class Boat {
  readonly group = new THREE.Group();
  x = 0;
  z = 0;
  direction: 1 | -1 = 1;
  active = false;

  constructor(material: THREE.Material) {
    this.group.add(new THREE.Mesh(boatGeometry(), material));
    this.group.visible = false;
  }

  /** Start a crossing at `z`, from the edge opposite to `direction` (+1 travels towards +x, screen-left). */
  place(z: number, direction: 1 | -1): void {
    this.direction = direction;
    this.x = -direction * (PHYSICS.trackHalfWidth + BOAT.margin);
    this.z = z;
    this.active = true;
    this.group.visible = true;
    this.group.position.set(this.x, 0, z);
  }

  retire(): void {
    this.active = false;
    this.group.visible = false;
  }

  update(dt: number, time: number, ocean: Ocean): void {
    if (!this.active) return;
    this.x += this.direction * BOAT.speed * dt;
    this.z -= BOAT.drift * dt;
    if (Math.abs(this.x) > PHYSICS.trackHalfWidth + BOAT.margin) {
      this.retire();
      return;
    }
    this.group.position.set(this.x, ocean.height(this.x, this.z) - 0.25 + 0.06 * Math.sin(time * 2.2 + this.z), this.z);
    const slope = ocean.slope(this.x, this.z);
    // The bow leads; it rolls on the swell it is crossing and pitches a little into its own motion.
    this.group.rotation.set(Math.atan(slope.dz) * 0.5 + 0.05 * Math.sin(time * 1.8 + this.x), this.direction > 0 ? 0 : Math.PI, -this.direction * Math.atan(slope.dx) * 0.4);
  }
}
