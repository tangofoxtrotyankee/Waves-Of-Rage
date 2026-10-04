import { createPS1Material } from '../engine/PS1Material';
import { clamp, mulberry32, rgb } from '../engine/math';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';

/**
 * The white water a riding board throws, like the foam round the mockup's
 * boards: jagged foam hugging both rails from the front foot back, a churn
 * behind the squash tail and the two arms of the wake spreading behind it.
 * One small faceted mesh per rider (one draw call), built at water level in
 * the rider's frame (x across, y up, z forward, metres before the build
 * scale). The rider sets it on the water under the board each step,
 * stretches it with speed, throws more off the outside rail in a carve and
 * hides it in the air (Rider.updateVisuals).
 */

/** The wetted half of the board's planform: half-width at z (tail at -1.02). */
const railHalfWidth = (z: number): number => 0.17 + 0.11 * Math.sin(clamp((z + 1.02) / 0.95, 0, 1) * (Math.PI / 2)) - 0.04 * clamp((z - 0.1) / 0.4, 0, 1);

export function buildFoamGeometry(seed = 7): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const white = rgb(PALETTE.foam);
  const cyan = rgb(0xa8ecf8);
  const pale = rgb(0xdcf6ff);
  const tri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, ca: number[], cb: number[], cc: number[], y = 0) => {
    // Wound to face up (counter-clockwise seen from above, +y).
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const flip = cross > 0;
    pos.push(ax, y, az, flip ? cx : bx, y, flip ? cz : bz, flip ? bx : cx, y, flip ? bz : cz);
    col.push(...ca, ...(flip ? cc : cb), ...(flip ? cb : cc));
  };

  // Rails: from the front foot to the tail, widening towards the back, with a jagged outer edge.
  const N = 9;
  for (const s of [1, -1]) {
    let prev: [number, number, number, number] | null = null;
    for (let i = 0; i <= N; i++) {
      const z = 0.45 - (i / N) * 1.47;
      const hw = railHalfWidth(z);
      const w = 0.04 + 0.2 * (i / N) + (i % 2 === 1 ? 0.06 : -0.02) + rng() * 0.04;
      const cur: [number, number, number, number] = [s * (hw - 0.015), z, s * (hw + w), z - (i % 2 === 1 ? 0.06 : 0)];
      if (prev) {
        tri(prev[0], prev[1], cur[0], cur[1], prev[2], prev[3], pale, pale, white);
        tri(cur[0], cur[1], cur[2], cur[3], prev[2], prev[3], pale, i % 3 === 0 ? cyan : white, white);
      }
      prev = cur;
    }
  }
  // The churn behind the tail: a jagged fan.
  const cz = -1.2;
  const M = 10;
  for (let i = 0; i < M; i++) {
    const a0 = (i / M) * Math.PI * 2;
    const a1 = ((i + 1) / M) * Math.PI * 2;
    const r0 = (i % 2 === 0 ? 0.27 : 0.17) + rng() * 0.05;
    const r1 = ((i + 1) % 2 === 0 ? 0.27 : 0.17) + rng() * 0.05;
    tri(0, cz, Math.sin(a0) * r0, cz + Math.cos(a0) * r0 * 1.2, Math.sin(a1) * r1, cz + Math.cos(a1) * r1 * 1.2, white, i % 3 === 0 ? cyan : white, white);
  }
  // The wake: two arms spreading back from the tail, thinning, broken into dashes towards the end.
  const K = 7;
  for (const s of [1, -1]) {
    for (let i = 0; i < K; i++) {
      if (i >= 4 && i % 2 === 1) continue;
      const t0 = i / K;
      const t1 = (i + 1) / K;
      const x0 = s * (0.18 + 0.55 * t0);
      const x1 = s * (0.18 + 0.55 * t1);
      const z0 = -1.06 - 1.05 * t0;
      const z1 = -1.06 - 1.05 * t1;
      const w0 = 0.14 * (1 - t0) + 0.03;
      const w1 = 0.14 * (1 - t1) + 0.03;
      const j = (i % 2 === 0 ? 0.05 : -0.02) + rng() * 0.03;
      tri(x0, z0, x1, z1, x1 + s * w1, z1 + 0.04 + j, pale, cyan, white);
      tri(x0, z0, x1 + s * w1, z1 + 0.04 + j, x0 + s * w0, z0 + 0.04, pale, white, white);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: pos.length / 3 }, () => [0, 1, 0]).flat(), 3));
  return g;
}

/** The foam's material: unlit (it is lit by its own whiteness), faceted so the patches sparkle a little. */
export function createFoamMaterial(): THREE.ShaderMaterial {
  return createPS1Material({ unlit: true, flat: 0.14 });
}
