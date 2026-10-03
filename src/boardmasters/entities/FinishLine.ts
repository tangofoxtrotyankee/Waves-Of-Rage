import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { checkerTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';
import type { Ocean } from '../world/Ocean';

/** Two posts and a chequered banner across the course at the finish. */
export class FinishLine {
  readonly group = new THREE.Group();

  constructor(readonly z: number) {
    const post = createPS1Material();
    for (const x of [-12.5, 12.5]) {
      const mesh = new THREE.Mesh(colorGeometry(new THREE.CylinderGeometry(0.18, 0.22, 6, 6), PALETTE.gold), post);
      mesh.position.set(x, 3, z);
      this.group.add(mesh);
    }
    const bannerGeometry = new THREE.BoxGeometry(25, 1.6, 0.12);
    const uv = bannerGeometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 12);
    const banner = new THREE.Mesh(colorGeometry(bannerGeometry, 0xffffff), createPS1Material({ map: checkerTexture(), side: THREE.DoubleSide }));
    banner.position.set(0, 5.2, z);
    this.group.add(banner);
  }

  update(time: number, ocean: Ocean): void {
    this.group.position.y = ocean.height(0, this.z) * 0.3 + 0.1 * Math.sin(time);
  }
}
