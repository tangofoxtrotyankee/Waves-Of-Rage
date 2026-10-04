import { colorGeometry } from '../engine/PS1Material';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';
import type { Ocean } from '../world/Ocean';

/** The skull buoy from the hazards sheet: a red drum with a cap and a light, bobbing on the water. Hitting it costs a heart. */
export class Buoy {
  readonly group = new THREE.Group();
  x = 0;
  z = 0;
  /** Smashed through in RAGE mode: gone until it is placed again. */
  smashed = false;
  /** Pooled: an inactive buoy is hidden and free to be placed ahead. */
  active = false;

  constructor(drumMaterial: THREE.Material, plainMaterial: THREE.Material) {
    const drumGeometry = new THREE.CylinderGeometry(0.55, 0.65, 1.1, 8);
    const uv = drumGeometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 3); // three skulls around
    const drum = new THREE.Mesh(colorGeometry(drumGeometry, 0xffffff), drumMaterial);
    drum.position.y = 0.55;
    const cap = new THREE.Mesh(colorGeometry(new THREE.ConeGeometry(0.5, 0.5, 8), PALETTE.outline), plainMaterial);
    cap.position.y = 1.32;
    const mast = new THREE.Mesh(colorGeometry(new THREE.BoxGeometry(0.08, 0.5, 0.08), PALETTE.outline), plainMaterial);
    mast.position.y = 1.7;
    const light = new THREE.Mesh(colorGeometry(new THREE.BoxGeometry(0.18, 0.18, 0.18), PALETTE.gold), plainMaterial);
    light.position.y = 1.98;
    this.group.add(drum, cap, mast, light);
    this.group.visible = false;
  }

  /** Put the buoy at a spot on the course. */
  place(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.smashed = false;
    this.active = true;
    this.group.visible = true;
    this.group.position.set(x, 0, z);
  }

  retire(): void {
    this.active = false;
    this.group.visible = false;
  }

  smash(): void {
    this.smashed = true;
    this.group.visible = false;
  }

  update(time: number, ocean: Ocean): void {
    if (!this.active) return;
    this.group.position.y = ocean.height(this.x, this.z) - 0.2 + 0.1 * Math.sin(time * 2.5 + this.x);
    this.group.rotation.z = 0.08 * Math.sin(time * 2 + this.z);
    this.group.rotation.x = 0.06 * Math.sin(time * 1.7 + this.x);
  }
}
