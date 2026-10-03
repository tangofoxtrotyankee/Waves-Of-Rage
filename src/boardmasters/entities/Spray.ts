import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
}

const LIFE = 0.3;

/** Crunchy spray: a pool of white camera-facing quads thrown from the board's tail, drawn as one instanced mesh. */
export class Spray {
  readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor(count = 32) {
    const geometry = colorGeometry(new THREE.PlaneGeometry(0.16, 0.16), PALETTE.foam);
    const material = createPS1Material({ unlit: true, opacity: 0.75, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < count; i++) this.particles.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const p = this.particles[this.next];
    this.next = (this.next + 1) % this.particles.length;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = LIFE;
  }

  update(dt: number, camera: THREE.Camera): void {
    let n = 0;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= 9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const size = 0.5 + (p.life / LIFE) * 0.7;
      this.matrix.compose(this.position.set(p.x, p.y, p.z), camera.quaternion, this.scale.set(size, size, size));
      this.mesh.setMatrixAt(n++, this.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
