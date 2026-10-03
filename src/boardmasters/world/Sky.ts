import { colorGeometry, createPS1Material, paintGeometry } from '../engine/PS1Material';
import { mixRgb, mulberry32, rgb, smoothstep } from '../engine/math';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';

const TOP = rgb(PALETTE.skyTop);
const MID = rgb(PALETTE.skyMid);
const HORIZON = rgb(PALETTE.horizon);
const FOG = rgb(0xf7a04b);

/**
 * The sunset: a vertex-coloured dome that follows the camera (purple
 * overhead, orange, then the fog colour at the horizon so the fogged sea
 * blends into it), a flat sun disc ahead, and low-poly island silhouettes
 * along both sides of the course that loom out of the fog.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly sun: THREE.Mesh;

  constructor(courseLength: number) {
    const domeGeometry = paintGeometry(new THREE.SphereGeometry(100, 16, 10), (_x, y) => {
      const t = y / 100;
      if (t > 0.08) return mixRgb(MID, TOP, smoothstep(0.08, 0.6, t));
      if (t > -0.02) return mixRgb(HORIZON, MID, smoothstep(-0.02, 0.08, t));
      return mixRgb(FOG, HORIZON, smoothstep(-0.4, -0.02, t));
    });
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
    for (let z = 40; z < courseLength + 200; z += 90 + rng() * 60) {
      for (const side of [-1, 1]) {
        if (rng() < 0.3) continue;
        const radius = 22 + rng() * 16;
        const height = 14 + rng() * 16;
        const island = new THREE.Mesh(colorGeometry(new THREE.ConeGeometry(radius, height, 5), PALETTE.island), islandMaterial);
        island.position.set(side * (52 + rng() * 25), height / 2 - 2.5, z + rng() * 40);
        island.rotation.y = rng() * Math.PI;
        this.group.add(island);
      }
    }
  }

  update(camera: THREE.Camera): void {
    this.dome.position.copy(camera.position);
    this.sun.position.set(camera.position.x * 0.3, camera.position.y + 7, camera.position.z + 92);
    this.sun.lookAt(camera.position);
  }
}
