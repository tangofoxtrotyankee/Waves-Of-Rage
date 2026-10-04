import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry } from '../engine/PS1Material';
import { SKULL_BODY_V, SKULL_PLAIN_V } from '../engine/Textures';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';
import type { Ocean } from '../world/Ocean';

/** Point every uv of a part at the skull texture's plain white rows, so its vertex colour shows as is. */
function plain<T extends THREE.BufferGeometry>(geometry: T, color: number): T {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, SKULL_PLAIN_V);
  return colorGeometry(geometry, color);
}

let shared: THREE.BufferGeometry | null = null;

/**
 * One bell buoy as a single geometry (shared by the whole pool): a tapered
 * red bell wrapped in the skull texture (two skulls round it) on a dark
 * fender, an open cage of dark bars on top with a gold bell and a lamp, and
 * a ring of foam where it sits in the water. About 2.8 m tall.
 */
function buoyGeometry(): THREE.BufferGeometry {
  if (shared) return shared;
  const profile = [
    new THREE.Vector2(0.98, 0.2),
    new THREE.Vector2(0.92, 0.42),
    new THREE.Vector2(0.8, 0.75),
    new THREE.Vector2(0.66, 1.25),
    new THREE.Vector2(0.56, 1.58),
    new THREE.Vector2(0.4, 1.68),
    new THREE.Vector2(0.0, 1.7),
  ];
  const bell = new THREE.LatheGeometry(profile, 10);
  bell.rotateY(Math.PI / 2); // the two skulls face down the course and back up it
  const uv = bell.getAttribute('uv');
  const [v0, v1] = SKULL_BODY_V;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, v0 + (v1 - v0) * Math.min(1, uv.getY(i) * 1.2));
  colorGeometry(bell, 0xffffff);
  const fender = plain(new THREE.CylinderGeometry(1.05, 1.0, 0.32, 10, 1, true).translate(0, 0.2, 0), 0x2a2140);
  const parts: THREE.BufferGeometry[] = [bell, fender];
  // The cage: four bars leaning in to a cap, with a ring of bars half way.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bar = new THREE.BoxGeometry(0.09, 1.15, 0.09);
    bar.rotateZ(0.32);
    bar.translate(0.32, 0, 0);
    bar.rotateY(a);
    bar.translate(0, 2.2, 0);
    parts.push(plain(bar, 0x3a3048));
    const rail = new THREE.BoxGeometry(0.62, 0.08, 0.08);
    rail.translate(0, 0, 0.31);
    rail.rotateY(a + Math.PI / 4);
    rail.translate(0, 2.15, 0);
    parts.push(plain(rail, 0x3a2a50));
  }
  parts.push(plain(new THREE.BoxGeometry(0.5, 0.1, 0.5).translate(0, 2.76, 0), PALETTE.outline));
  parts.push(plain(new THREE.ConeGeometry(0.22, 0.34, 6).translate(0, 2.0, 0), PALETTE.gold));
  parts.push(plain(new THREE.BoxGeometry(0.22, 0.22, 0.22).translate(0, 2.92, 0), 0xffe9a0));
  // Foam round the waterline.
  const ring = new THREE.RingGeometry(1.0, 1.55, 12, 1);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, 0.32, 0);
  parts.push(plain(ring, PALETTE.foam));
  shared = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  return shared;
}

/** The skull bell buoy from the hazards sheet: one mesh, bobbing on the water. Hitting it costs a heart. */
export class Buoy {
  readonly group = new THREE.Group();
  x = 0;
  z = 0;
  /** Smashed through in RAGE mode: gone until it is placed again. */
  smashed = false;
  /** Pooled: an inactive buoy is hidden and free to be placed ahead. */
  active = false;

  /** `skullMaterial` maps skullTexture(); the plain parts use its white rows, so the second material is no longer needed. */
  constructor(skullMaterial: THREE.Material, _plainMaterial?: THREE.Material) {
    // Half lit: the buoys face away from the low sun, and the mockup's read bright red from the course.
    const uniforms = (skullMaterial as THREE.ShaderMaterial).uniforms;
    if (uniforms?.uUnlit) uniforms.uUnlit.value = 0.45;
    this.group.add(new THREE.Mesh(buoyGeometry(), skullMaterial));
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
    this.group.position.y = ocean.height(this.x, this.z) - 0.3 + 0.1 * Math.sin(time * 2.5 + this.x);
    this.group.rotation.z = 0.08 * Math.sin(time * 2 + this.z);
    this.group.rotation.x = 0.06 * Math.sin(time * 1.7 + this.x);
  }
}
