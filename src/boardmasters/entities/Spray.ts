import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { createPS1Material, paintGeometry } from '../engine/PS1Material';
import { rgb } from '../engine/math';
import { THREE } from '../engine/three';
import { PALETTE, WATER } from '../game/constants';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  z: number;
  size: number;
  age: number;
}

/** Seconds a particle lives (scaled per particle a little). */
const LIFE = 0.45;
const GRAVITY = 11;
/** Air drag on the spray, per second. */
const DRAG = 1.6;
const RINGS = 8;
const RING_SEGMENTS = 18;
const RING_LIFE = 0.8;
/** Rings sit this far above the water they were thrown on (the swell moves under them). */
const RING_LIFT = 0.22;
/** Clumps closer to the camera than NEAR_SKIP metres are not drawn, and shrink in over the next NEAR_FADE metres. */
const NEAR_SKIP = 1.2;
const NEAR_FADE = 2.5;

/**
 * Crunchy spray: a pool of small camera-facing pixel clumps (a square,
 * white on top shading to the foam's pale cyan underneath, with a smaller
 * satellite, so every particle reads as a droplet of whitewater rather than
 * a tile) thrown from the boards, drawn as one instanced mesh. A clump bursts
 * to full size and then dissolves through the screen door (a per-instance
 * `dissolve` amount, PS1_DISSOLVE) instead of shrinking to a dot. Plus a
 * small pool of expanding foam rings on the water for big splashes
 * (`splash`), drawn as a second mesh with the PS1_WATER foam block so they
 * dissolve into dithered pixels. Two draw calls, no allocations per frame.
 */
export class Spray {
  readonly mesh: THREE.InstancedMesh;
  private readonly particles: Particle[] = [];
  private next = 0;
  private readonly rings: Ring[] = [];
  private nextRing = 0;
  private readonly ringPositions: Float32Array;
  private readonly ringFoam: Float32Array;
  private readonly ringGeometry: THREE.BufferGeometry;
  /** Whether any ring was drawn last step (its buffers then need one more upload, to clear it). */
  private ringsLive = true;
  private readonly dissolve: Float32Array;
  private readonly dissolveAttribute: THREE.InstancedBufferAttribute;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();

  constructor(count = 256) {
    // White on top, the foam's pale cyan underneath: a droplet catching the light, not a flat tile.
    const top = rgb(PALETTE.foam);
    const under = rgb(WATER.foamShade);
    const big = paintGeometry(new THREE.PlaneGeometry(0.13, 0.13), (_x, y) => (y > 0 ? top : under));
    const a = paintGeometry(new THREE.PlaneGeometry(0.06, 0.06).translate(0.11, 0.06, 0), (_x, y) => (y > 0.06 ? top : under));
    const geometry = mergeGeometries([big, a]);
    this.dissolve = new Float32Array(count);
    this.dissolveAttribute = new THREE.InstancedBufferAttribute(this.dissolve, 1).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('dissolve', this.dissolveAttribute);
    const material = createPS1Material({ unlit: true, dissolve: true });
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    for (let i = 0; i < count; i++) this.particles.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: LIFE, size: 1 });

    // Foam rings: RINGS bands of RING_SEGMENTS quads, a child of the spray mesh so they join the scene with it.
    const vertices = RINGS * RING_SEGMENTS * 4;
    this.ringPositions = new Float32Array(vertices * 3);
    this.ringFoam = new Float32Array(vertices);
    const normals = new Float32Array(vertices * 3);
    for (let i = 0; i < vertices; i++) normals[i * 3 + 1] = 1;
    const index = new Uint16Array(RINGS * RING_SEGMENTS * 6);
    for (let q = 0; q < RINGS * RING_SEGMENTS; q++) index.set([q * 4, q * 4 + 2, q * 4 + 1, q * 4 + 1, q * 4 + 2, q * 4 + 3], q * 6);
    this.ringGeometry = new THREE.BufferGeometry();
    this.ringGeometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.ringGeometry.setAttribute('position', new THREE.BufferAttribute(this.ringPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.ringGeometry.setAttribute('foam', new THREE.BufferAttribute(this.ringFoam, 1).setUsage(THREE.DynamicDrawUsage));
    this.ringGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertices * 3).fill(1), 3));
    this.ringGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.ringGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vertices * 2), 2));
    const ringMaterial = createPS1Material({ water: 'foam', unlit: true, depthWrite: false, side: THREE.DoubleSide });
    ringMaterial.polygonOffset = true;
    ringMaterial.polygonOffsetFactor = -2;
    ringMaterial.polygonOffsetUnits = -2;
    const ringMesh = new THREE.Mesh(this.ringGeometry, ringMaterial);
    ringMesh.frustumCulled = false;
    ringMesh.renderOrder = 1;
    this.mesh.add(ringMesh);
    for (let i = 0; i < RINGS; i++) this.rings.push({ x: 0, y: 0, z: 0, size: 1, age: RING_LIFE });
  }

  /** Throw one clump from (x, y, z) at this velocity; `size` scales it (1 is a 0.13 m clump with its satellite). */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size = 1): void {
    const p = this.particles[this.next];
    this.next = (this.next + 1) % this.particles.length;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.maxLife = LIFE * (0.75 + Math.random() * 0.5);
    p.life = p.maxLife;
    p.size = size * (0.7 + Math.random() * 0.8);
  }

  /**
   * A big splash on the water at (x, y, z): a radial burst of many small
   * clumps (about 5 to 25 cm, emit's own jitter included, so the riders in
   * it stay visible) and an expanding foam ring. `size` about 1 for a
   * landing, 2 for a knockout.
   */
  splash(x: number, y: number, z: number, size = 1): void {
    const n = Math.min(64, Math.round(30 * size));
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const out = (1.5 + Math.random() * 3) * size;
      this.emit(x + Math.cos(angle) * 0.4 * size, y + 0.1, z + Math.sin(angle) * 0.4 * size, Math.cos(angle) * out, (3 + Math.random() * 4.5) * Math.sqrt(size), Math.sin(angle) * out, 0.5 + Math.random() * (0.3 + 0.15 * size));
    }
    // A column in the middle.
    for (let i = 0; i < Math.round(8 * size); i++) this.emit(x + (Math.random() - 0.5) * 0.6, y + 0.2, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.5, 6 + Math.random() * 4 * size, (Math.random() - 0.5) * 1.5, 0.65 + Math.random() * 0.4);
    const r = this.rings[this.nextRing];
    this.nextRing = (this.nextRing + 1) % RINGS;
    r.x = x;
    r.y = y + RING_LIFT;
    r.z = z;
    r.size = size;
    r.age = 0;
  }

  /** Clear every clump and ring (a restart or a respawn on the same water). */
  reset(): void {
    for (const p of this.particles) p.life = 0;
    for (const r of this.rings) r.age = RING_LIFE;
    this.mesh.count = 0;
    this.updateRings(0);
  }

  update(dt: number, camera: THREE.Camera): void {
    let n = 0;
    const drag = Math.exp(-DRAG * dt);
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= GRAVITY * dt;
      p.vx *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      // Next to the camera a clump would fill the screen as a flat white square: shrink it away inside NEAR_FADE metres.
      const dx = p.x - camera.position.x;
      const dy = p.y - camera.position.y;
      const dz = p.z - camera.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < NEAR_SKIP * NEAR_SKIP) continue;
      const near = d2 < (NEAR_SKIP + NEAR_FADE) * (NEAR_SKIP + NEAR_FADE) ? (Math.sqrt(d2) - NEAR_SKIP) / NEAR_FADE : 1;
      // Grows as it bursts, then holds its size and dissolves through the screen door (and so does one close to the lens).
      const f = p.life / p.maxLife;
      const size = p.size * near * (f > 0.75 ? 0.7 + (1 - f) * 1.2 : 1);
      this.matrix.compose(this.position.set(p.x, p.y, p.z), camera.quaternion, this.scale.set(size, size, size));
      this.dissolve[n] = Math.max(Math.min(1, (0.6 - f) / 0.6), (1 - near) * 0.75);
      this.mesh.setMatrixAt(n++, this.matrix);
    }
    if (n > 0 || this.mesh.count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dissolveAttribute.needsUpdate = true;
    }
    this.mesh.count = n;
    this.updateRings(dt);
  }

  private updateRings(dt: number): void {
    const pos = this.ringPositions;
    const foam = this.ringFoam;
    let live = false;
    for (let i = 0; i < RINGS; i++) {
      const r = this.rings[i];
      const v = i * RING_SEGMENTS * 4;
      if (r.age >= RING_LIFE) {
        if (foam[v] !== 0) {
          foam.fill(0, v, v + RING_SEGMENTS * 4);
          pos.fill(0, v * 3, (v + RING_SEGMENTS * 4) * 3);
        }
        continue;
      }
      live = true;
      r.age += dt;
      const t = Math.min(1, r.age / RING_LIFE);
      const radius = r.size * (0.5 + 2.6 * Math.sqrt(t));
      const band = r.size * (0.35 + 0.5 * t);
      const f = r.age >= RING_LIFE ? 0 : 1.25 * (1 - t);
      let o = v * 3;
      for (let s = 0; s < RING_SEGMENTS; s++) {
        const a0 = (s / RING_SEGMENTS) * Math.PI * 2;
        const a1 = ((s + 1) / RING_SEGMENTS) * Math.PI * 2;
        for (let k = 0; k < 4; k++) {
          const a = k < 2 ? a0 : a1;
          const rr = k % 2 === 0 ? radius - band : radius;
          pos[o] = r.x + Math.cos(a) * rr;
          pos[o + 1] = r.y;
          pos[o + 2] = r.z + Math.sin(a) * rr;
          o += 3;
        }
      }
      foam.fill(f, v, v + RING_SEGMENTS * 4);
    }
    // Upload only while a ring is drawn, and once more as the last one ends (its cleared band).
    if (live || this.ringsLive) {
      this.ringGeometry.getAttribute('position').needsUpdate = true;
      this.ringGeometry.getAttribute('foam').needsUpdate = true;
    }
    this.ringsLive = live;
  }
}
