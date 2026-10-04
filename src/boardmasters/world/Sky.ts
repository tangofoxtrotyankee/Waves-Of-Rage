import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material, paintGeometry, skyColorAt } from '../engine/PS1Material';
import { mixRgb, mulberry32, rgb } from '../engine/math';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';

/**
 * The sunset: a vertex-coloured dome that follows the camera, painted with
 * the same elevation ramp the shader's fog uses (fog orange at and below
 * the horizon, a yellow glow, orange, purple overhead) so fogged things
 * blend into it at every elevation; a flat sun disc ahead with slowly
 * turning rays; and low-poly clouds lit from below that drift across the
 * dome.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly sun: THREE.Group;
  private readonly rays: THREE.Mesh;
  private readonly clouds: THREE.Group;

  constructor() {
    // Enough latitude rows (48 over 180 degrees) for the narrow glow band above the horizon to exist.
    const domeGeometry = paintGeometry(new THREE.SphereGeometry(100, 16, 48), (_x, y) => skyColorAt(y / 100));
    this.dome = new THREE.Mesh(domeGeometry, createPS1Material({ unlit: true, fog: false, side: THREE.BackSide, depthWrite: false }));
    this.dome.renderOrder = -3;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // The sun and its rays: thin triangles fanned around the disc, faint and slowly turning.
    this.sun = new THREE.Group();
    const disc = new THREE.Mesh(colorGeometry(new THREE.CircleGeometry(13, 10), PALETTE.sun), createPS1Material({ unlit: true, fog: false, depthWrite: false }));
    const rayParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const ray = new THREE.PlaneGeometry(4, 60);
      ray.translate(0, 38, 0);
      ray.rotateZ((i / 7) * Math.PI * 2);
      rayParts.push(colorGeometry(ray, PALETTE.sun));
    }
    this.rays = new THREE.Mesh(mergeGeometries(rayParts), createPS1Material({ unlit: true, fog: false, depthWrite: false, opacity: 0.22, side: THREE.DoubleSide }));
    this.rays.renderOrder = -2;
    disc.renderOrder = -1;
    this.sun.add(this.rays, disc);
    this.sun.frustumCulled = false;
    this.group.add(this.sun);

    // Clouds: a few flattened blobs each, pink underneath and lit on top, scattered round the dome.
    this.clouds = new THREE.Group();
    const rng = mulberry32(17);
    const under = rgb(PALETTE.cloud);
    const lit = rgb(PALETTE.cloudLit);
    const cloudMaterial = createPS1Material({ unlit: true, fog: false, depthWrite: false, flat: 0.1 });
    for (let i = 0; i < 12; i++) {
      const blobs: THREE.BufferGeometry[] = [];
      const n = 3 + Math.floor(rng() * 3);
      for (let b = 0; b < n; b++) {
        const r = 4 + rng() * 5;
        const blob = new THREE.SphereGeometry(r, 7, 4);
        blob.scale(1.6, 0.45, 1);
        blob.translate((b - n / 2) * 5.5 + rng() * 3, rng() * 1.5, (rng() - 0.5) * 4);
        blobs.push(paintGeometry(blob, (_x, y) => mixRgb(under, lit, Math.max(0, Math.min(1, y / (r * 0.45) * 0.5 + 0.5)))));
      }
      const cloud = new THREE.Mesh(mergeGeometries(blobs), cloudMaterial);
      const azimuth = (rng() - 0.5) * Math.PI * 1.4; // mostly ahead
      const elevation = 0.12 + rng() * 0.3;
      const d = 88;
      cloud.position.set(Math.sin(azimuth) * d * Math.cos(elevation), Math.sin(elevation) * d, Math.cos(azimuth) * d * Math.cos(elevation));
      cloud.lookAt(0, cloud.position.y, 0);
      cloud.frustumCulled = false;
      this.clouds.add(cloud);
    }
    this.group.add(this.clouds);
  }

  update(camera: THREE.Camera, time: number): void {
    this.dome.position.copy(camera.position);
    this.clouds.position.copy(camera.position);
    this.clouds.rotation.y = time * 0.004;
    this.sun.position.set(camera.position.x * 0.3, camera.position.y + 7, camera.position.z + 92);
    this.sun.lookAt(camera.position);
    this.rays.rotation.z = time * 0.08;
  }
}
