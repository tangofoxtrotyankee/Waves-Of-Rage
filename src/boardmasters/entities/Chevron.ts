import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';
import type { Ocean } from '../world/Ocean';

/** The gate's centre, metres ahead of its spot (the run's pickup test uses the same offset). */
const CENTRE_Z = 1.9;
/** Hover height of the sign's centre above the water: high enough that riders (and the chase camera behind them) pass under it, like a gate. */
const HOVER = 3.5;
/** The sign's scale, pulsing by PULSE. */
const SCALE = 1.35;
const PULSE = 0.1;

let shared: THREE.BufferGeometry | null = null;

/** One arm of a chevron: a bar from (x0, y0) to (x1, y1) in the sign's plane, `thick` across and `depth` deep. */
function arm(x0: number, y0: number, x1: number, y1: number, thick: number, depth: number, z: number, color: number): THREE.BufferGeometry {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const g = new THREE.BoxGeometry(length + thick * 0.7, thick, depth);
  g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
  return colorGeometry(g, color);
}

/** The ">>" sign: two chunky cyan chevrons with a pale top edge and a dark outline behind, facing down the course (world -x is screen-right, where they point). */
function chevronGeometry(): THREE.BufferGeometry {
  if (shared) return shared;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const tipX = -0.55 - i * 1.0; // the tip, towards screen-right
    const backX = tipX + 0.8;
    const color = i === 0 ? 0x5fe8ff : PALETTE.cyan;
    parts.push(arm(backX, 0.55, tipX, 0, 0.36, 0.3, 0, color));
    parts.push(arm(backX, -0.55, tipX, 0, 0.36, 0.3, 0, color));
    parts.push(arm(backX - 0.04, 0.68, tipX - 0.08, 0.12, 0.08, 0.32, -0.02, 0xe6ffff));
    parts.push(arm(backX, 0.55, tipX, 0, 0.62, 0.2, 0.14, 0x14205a));
    parts.push(arm(backX, -0.55, tipX, 0, 0.62, 0.2, 0.14, 0x14205a));
  }
  const g = mergeGeometries(parts);
  g.translate(0.55, 0, 0);
  shared = g;
  return g;
}

/** A boost gate: a glowing cyan ">>" hovering over the water, bobbing and pulsing; ride under it for a BOOST. Pooled like the buoys. */
export class Chevron {
  /** The gate's root (the sign hangs off it); named `mesh` for the run, which adds it to the scene. */
  readonly mesh = new THREE.Group();
  x = 0;
  z = 0;
  active = false;
  private readonly sign: THREE.Mesh;

  constructor(material: THREE.Material) {
    this.sign = new THREE.Mesh(chevronGeometry(), material);
    this.sign.position.set(0, HOVER, CENTRE_Z);
    this.mesh.add(this.sign);
    this.mesh.visible = false;
  }

  place(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.active = true;
    this.mesh.visible = true;
    this.mesh.position.set(x, 0, z);
  }

  retire(): void {
    this.active = false;
    this.mesh.visible = false;
  }

  update(time: number, ocean: Ocean): void {
    if (!this.active) return;
    this.mesh.position.y = ocean.height(this.x, this.z + CENTRE_Z) + 0.15 * Math.sin(time * 3 + this.z);
    const s = SCALE + PULSE * Math.sin(time * 8 + this.z);
    this.sign.scale.set(s, s, 1);
  }
}

export function chevronMaterial(): THREE.ShaderMaterial {
  return createPS1Material({ unlit: true });
}
