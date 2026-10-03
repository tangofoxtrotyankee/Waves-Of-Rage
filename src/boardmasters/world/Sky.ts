import { colorGeometry, createPS1Material, paintGeometry, skyColorAt } from '../engine/PS1Material';
import { mulberry32 } from '../engine/math';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';

/** Metres of coastline laid out at once; islands recycle past it. */
const ISLAND_SPAN = 2400;

/**
 * The sunset: a vertex-coloured dome that follows the camera, painted with
 * the same elevation ramp the shader's fog uses (fog orange at and below the
 * horizon, a yellow glow, orange, purple overhead) so the fogged sea and
 * fogged islands blend into it at every elevation; a flat sun disc ahead;
 * and low-poly island silhouettes along both sides of the course.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly sun: THREE.Mesh;
  private readonly islands: THREE.Mesh[] = [];

  constructor() {
    // Enough latitude rows (48 over 180 degrees) for the narrow glow band above the horizon to exist.
    const domeGeometry = paintGeometry(new THREE.SphereGeometry(100, 16, 48), (_x, y) => skyColorAt(y / 100));
    this.dome = new THREE.Mesh(domeGeometry, createPS1Material({ unlit: true, fog: false, side: THREE.BackSide, depthWrite: false }));
    this.dome.renderOrder = -2;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    this.sun = new THREE.Mesh(colorGeometry(new THREE.CircleGeometry(13, 10), PALETTE.sun), createPS1Material({ unlit: true, fog: false, depthWrite: false }));
    this.sun.renderOrder = -1;
    this.sun.frustumCulled = false;
    this.group.add(this.sun);

    const rng = mulberry32(11);
    const islandMaterial = createPS1Material({ unlit: true });
    for (let z = 40; z < ISLAND_SPAN; z += 90 + rng() * 60) {
      for (const side of [-1, 1]) {
        if (rng() < 0.3) continue;
        const radius = 22 + rng() * 16;
        const height = 14 + rng() * 16;
        const island = new THREE.Mesh(colorGeometry(new THREE.ConeGeometry(radius, height, 5), PALETTE.island), islandMaterial);
        island.position.set(side * (52 + rng() * 25), height / 2 - 2.5, z + rng() * 40);
        island.rotation.y = rng() * Math.PI;
        this.group.add(island);
        this.islands.push(island);
      }
    }
  }

  update(camera: THREE.Camera): void {
    // The course is endless: islands left behind move ahead by one span of the coastline.
    for (const island of this.islands) if (island.position.z < camera.position.z - 150) island.position.z += ISLAND_SPAN;
    this.dome.position.copy(camera.position);
    this.sun.position.set(camera.position.x * 0.3, camera.position.y + 7, camera.position.z + 92);
    this.sun.lookAt(camera.position);
  }
}
