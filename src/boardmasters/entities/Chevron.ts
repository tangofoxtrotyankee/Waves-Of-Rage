import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';
import type { Ocean } from '../world/Ocean';

/** A boost gate: two cyan chevrons lying on the water, pulsing; ride over them for a BOOST. Pooled like the buoys. */
export class Chevron {
  readonly mesh: THREE.Mesh;
  x = 0;
  z = 0;
  active = false;

  constructor(material: THREE.Material) {
    const parts: THREE.BufferGeometry[] = [];
    // Three wide chevrons pointing down the course, the far ones paler.
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const arm = new THREE.BoxGeometry(2.4, 0.26, 0.5);
        arm.translate(side * 1.0, 0, 0);
        arm.rotateY(side * 0.65);
        arm.translate(0, 0, i * 1.9);
        parts.push(colorGeometry(arm, i === 0 ? PALETTE.cyan : i === 1 ? 0xa8f9ff : PALETTE.foam));
      }
    }
    this.mesh = new THREE.Mesh(mergeGeometries(parts), material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 1; // after the water it lies on
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
    this.mesh.position.y = ocean.height(this.x, this.z + 1.9) + 0.2;
    const s = 1 + 0.08 * Math.sin(time * 6 + this.z);
    this.mesh.scale.set(s, 1, s);
  }
}

export function chevronMaterial(): THREE.ShaderMaterial {
  return createPS1Material({ unlit: true });
}
