import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

const LIFE = 0.3;

/** Crunchy spray: a small pool of white camera-facing quads thrown from the board's tail. */
export class Spray {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private next = 0;

  constructor(count = 28) {
    const geometry = colorGeometry(new THREE.PlaneGeometry(0.16, 0.16), PALETTE.foam);
    const material = createPS1Material({ unlit: true, opacity: 0.75, depthWrite: false });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.particles.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0 });
    }
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const p = this.particles[this.next];
    this.next = (this.next + 1) % this.particles.length;
    p.mesh.position.set(x, y, z);
    p.mesh.visible = true;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = LIFE;
  }

  update(dt: number, camera: THREE.Camera): void {
    for (const p of this.particles) {
      if (!p.mesh.visible) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.vy -= 9 * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.scale.setScalar(0.5 + (p.life / LIFE) * 0.7);
      p.mesh.quaternion.copy(camera.quaternion);
    }
  }
}
