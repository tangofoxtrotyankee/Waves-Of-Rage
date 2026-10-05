import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { clamp } from '../engine/math';
import { THREE } from '../engine/three';
import { PALETTE, PHYSICS, SHARK } from '../game/constants';
import type { Ocean } from '../world/Ocean';

const BODY = 0x4a5c84;
const BELLY = 0xb8c6dc;
const FIN = 0x303f62;
const FIN_EDGE = 0xd8e2f4;

let shared: THREE.BufferGeometry | null = null;

/**
 * The shark as one geometry (shared by the pool): a tapered body just under
 * the surface with a pale belly, a tall dorsal fin leaning back (a pale
 * leading edge so it reads against the sea), a tail fin, and a wake of foam
 * where the fin cuts the water. It faces -z (up the
 * course, towards the rider); about 3.2 m long.
 */
function sharkGeometry(): THREE.BufferGeometry {
  if (shared) return shared;
  const parts: THREE.BufferGeometry[] = [];
  // The body: a cylinder tapering to the tail, lying along z (nose at -z), mostly under the water.
  const body = new THREE.CylinderGeometry(0.16, 0.42, 2.4, 7, 1, false);
  body.rotateX(Math.PI / 2); // along z, the narrow end at +z (the tail)
  body.translate(0, -0.22, 0.2);
  parts.push(colorGeometry(body, BODY));
  const belly = new THREE.CylinderGeometry(0.12, 0.3, 1.8, 6, 1, true);
  belly.rotateX(Math.PI / 2);
  belly.translate(0, -0.42, 0.1);
  parts.push(colorGeometry(belly, BELLY));
  const nose = new THREE.ConeGeometry(0.42, 0.9, 7);
  nose.rotateX(-Math.PI / 2); // the point towards -z
  nose.translate(0, -0.22, -1.45);
  parts.push(colorGeometry(nose, BODY));
  // The dorsal fin: a thin triangular prism, swept back, tall enough to read from far off, with a pale leading edge.
  const fin = new THREE.ConeGeometry(0.62, 1.35, 3);
  fin.scale(0.22, 1, 1);
  fin.rotateX(-0.45);
  fin.translate(0, 0.6, 0.1);
  parts.push(colorGeometry(fin, FIN));
  const edge = new THREE.ConeGeometry(0.62, 1.35, 3);
  edge.scale(0.08, 1, 0.5);
  edge.rotateX(-0.45);
  edge.translate(0, 0.6, -0.2);
  parts.push(colorGeometry(edge, FIN_EDGE));
  // The tail fin, upright at the tail.
  const tail = new THREE.ConeGeometry(0.4, 0.75, 3);
  tail.scale(0.18, 1, 1);
  tail.rotateX(-0.2);
  tail.translate(0, 0.08, 1.45);
  parts.push(colorGeometry(tail, FIN));
  // Foam where the fin cuts the surface.
  const ring = new THREE.RingGeometry(0.35, 0.95, 10, 1);
  ring.scale(1, 1, 1.8);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, 0.02, 0.3);
  parts.push(colorGeometry(ring, PALETTE.foam));
  shared = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  return shared;
}

/** The sharks' material (one for the pool). */
export function sharkMaterial(): THREE.ShaderMaterial {
  return createPS1Material({});
}

/**
 * A shark from the original game, in 3D: it swims up the course at the
 * rider (SHARK.speed) and lunges a few metres sideways now and then, so it
 * must be read and dodged; a hit costs HEALTH.shark. Pooled like the buoys.
 */
export class Shark {
  readonly group = new THREE.Group();
  x = 0;
  z = 0;
  active = false;
  private targetX = 0;
  private nextLungeAt = 0;
  /** The sideways motion this step (for the lean). */
  private vx = 0;

  constructor(material: THREE.Material) {
    this.group.add(new THREE.Mesh(sharkGeometry(), material));
    this.group.visible = false;
  }

  /** Put the shark on the course at (x, z), swimming at the rider. */
  place(x: number, z: number, time: number): void {
    this.x = x;
    this.z = z;
    this.targetX = x;
    this.nextLungeAt = time + SHARK.lungeGap[0] + Math.random() * SHARK.lungeGap[1];
    this.vx = 0;
    this.active = true;
    this.group.visible = true;
    this.group.position.set(x, 0, z);
  }

  retire(): void {
    this.active = false;
    this.group.visible = false;
  }

  update(dt: number, time: number, ocean: Ocean): void {
    if (!this.active) return;
    this.z -= SHARK.speed * dt;
    if (time >= this.nextLungeAt) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      const edge = PHYSICS.trackHalfWidth - 1.5;
      this.targetX = clamp(this.x + dir * SHARK.lungeDistance, -edge, edge);
      this.nextLungeAt = time + SHARK.lungeGap[0] + Math.random() * SHARK.lungeGap[1];
    }
    const step = SHARK.lateralSpeed * dt;
    const diff = this.targetX - this.x;
    const move = Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    this.x += move;
    this.vx = move / Math.max(dt, 1e-6);
    this.group.position.set(this.x, ocean.height(this.x, this.z) + 0.04 * Math.sin(time * 4 + this.z), this.z);
    const slope = ocean.slope(this.x, this.z);
    // Faces the way it swims (up the course, veering into a lunge), banks into the lunge and lies on the swell.
    this.group.rotation.set(-Math.atan(slope.dz) * 0.5, Math.atan2(-this.vx, SHARK.speed) + Math.PI, -this.vx * 0.08);
  }
}
