import { createPS1Material } from '../engine/PS1Material';
import { clamp, rgb } from '../engine/math';
import { THREE } from '../engine/three';
import type { RiderLook, RiderSpec } from '../game/characters';
import { PALETTE } from '../game/constants';
import { ATLAS, ATLAS_SIZE, BOARD_REGIONS, BOARD_TEX, boardDeckTexture, mixColor, regionUv, riderAtlas, type UvRect } from './riderTextures';

/**
 * The rider as a low-poly, faceted humanoid on a real surfboard, built in
 * code from tapered tubes and icosahedra:
 *
 *  - one THREE.SkinnedMesh for the whole body with rigid skinning (every
 *    vertex 100 % on one bone), so a rider is one draw call for the body
 *    and one for the board; the bones are animated by RiderAnimator
 *  - vertex colours with baked shading (dark undersides and inner faces,
 *    light tops, a warm rim on the upper back) times a 64 px atlas (face,
 *    board-shorts print, vest), drawn with PS1Material's flat option so the
 *    facets show, like the mockup's surfers
 *  - heroic proportions (broad shoulders and lats, narrow waist, strong
 *    forearms, a slightly large head) varied by the look's body type
 *  - the board: a planform with a pointed or round nose and a squash tail,
 *    rocker, rounded rails, a thicker middle, three fins, and deck art
 *
 * The bind pose stands upright facing +z with the arms hanging and the
 * legs straight; every bone starts unrotated, so a bone's local axes are
 * the model's axes and the animator's angles read the same on every bone.
 */

export const BONE = {
  hips: 0,
  spine: 1,
  chest: 2,
  neck: 3,
  head: 4,
  hair: 5,
  upperArmL: 6,
  forearmL: 7,
  handL: 8,
  upperArmR: 9,
  forearmR: 10,
  handR: 11,
  thighL: 12,
  shinL: 13,
  footL: 14,
  thighR: 15,
  shinR: 16,
  footR: 17,
} as const;
const BONE_COUNT = 18;
const PARENT: number[] = [-1, 0, 1, 2, 3, 4, 2, 6, 7, 2, 9, 10, 0, 12, 13, 0, 15, 16];

/** Skeleton lengths and the stance, in metres before the character's build scale. */
export interface RigDims {
  /** Deck top above the board's origin. */
  deckY: number;
  ankle: number;
  shin: number;
  thigh: number;
  hipHalfW: number;
  hipDrop: number;
  hipsY: number;
  upperArm: number;
  forearm: number;
  shoulderX: number;
  shoulderY: number;
  /** Feet on the deck: front (left) and back (right) foot positions. */
  frontFoot: THREE.Vector3;
  backFoot: THREE.Vector3;
  /** Where the body pivots when it tumbles (hips height). */
  pivotY: number;
}

export interface RiderModel {
  readonly body: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[];
  readonly board: THREE.Mesh;
  readonly dims: RigDims;
  readonly bodyMaterial: THREE.ShaderMaterial;
  readonly boardMaterial: THREE.ShaderMaterial;
  /** Both materials, for uniforms set on the whole rider (flash). */
  readonly materials: THREE.ShaderMaterial[];
  dispose(): void;
}

type RGB = [number, number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** The baked key and fill light directions in the rider's frame (it faces +z; the chase camera sees its back, -z; +x is screen-left). */
const KEY = V(-0.6, 0.62, -0.5).normalize();
const FILL = V(0.8, 0.1, -0.35).normalize();

/** Body proportions per type. */
interface Proportions {
  shoulderX: number;
  chestRx: number;
  chestRz: number;
  latRx: number;
  waistRx: number;
  waistRz: number;
  hipRx: number;
  arm: number;
  leg: number;
  head: number;
  belly: number;
}

const PROPORTIONS: Record<RiderLook['body'], Proportions> = {
  athletic: { shoulderX: 0.245, chestRx: 0.262, chestRz: 0.138, latRx: 0.235, waistRx: 0.14, waistRz: 0.105, hipRx: 0.165, arm: 1.08, leg: 1, head: 1, belly: 0 },
  heavy: { shoulderX: 0.25, chestRx: 0.265, chestRz: 0.16, latRx: 0.245, waistRx: 0.215, waistRz: 0.16, hipRx: 0.2, arm: 1.2, leg: 1.18, head: 0.95, belly: 1 },
  slim: { shoulderX: 0.205, chestRx: 0.2, chestRz: 0.115, latRx: 0.175, waistRx: 0.125, waistRz: 0.095, hipRx: 0.165, arm: 0.82, leg: 0.88, head: 1.02, belly: 0 },
};

/**
 * Accumulates flat-shaded, non-indexed triangles with baked colours, atlas
 * UVs and one bone each, then becomes one BufferGeometry.
 */
class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly uv: number[] = [];
  readonly bone: number[] = [];
  /** Current paint: the bone, base colour, UV rectangle and whether the texture carries the colour (then the vertex colour is the shade alone). */
  b = 0;
  color: RGB = [1, 1, 1];
  rect: UvRect;
  textured = false;
  /** Darken faces that point towards the body's centre line on this side (+1 left, -1 right, 0 none). */
  side = 0;
  private readonly ab = new THREE.Vector3();
  private readonly ac = new THREE.Vector3();
  private readonly n = new THREE.Vector3();

  constructor(private readonly white: UvRect) {
    this.rect = white;
  }

  paint(bone: number, color: number, rect: UvRect | null = null, side = 0): this {
    this.b = bone;
    this.color = rgb(color);
    this.rect = rect ?? this.white;
    this.textured = rect !== null;
    this.side = side;
    return this;
  }

  /** One triangle; `out` is a point the face should face away from (it fixes the winding). UVs are local 0..1 within the current rect. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, inside: THREE.Vector3 | null, ua = 0.5, va = 0.5, ub = 0.5, vb = 0.5, uc = 0.5, vc = 0.5): void {
    const n = this.n.crossVectors(this.ab.subVectors(b, a), this.ac.subVectors(c, a));
    if (n.lengthSq() < 1e-14) return;
    n.normalize();
    if (inside) {
      const cx = (a.x + b.x + c.x) / 3 - inside.x;
      const cy = (a.y + b.y + c.y) / 3 - inside.y;
      const cz = (a.z + b.z + c.z) / 3 - inside.z;
      if (n.x * cx + n.y * cy + n.z * cz < 0) {
        n.negate();
        [b, c] = [c, b];
        [ub, uc] = [uc, ub];
        [vb, vc] = [vc, vb];
      }
    }
    const shade = this.shade(n);
    const base: RGB = this.textured ? [1, 1, 1] : this.color;
    const r = this.rect;
    for (const [p, u, v] of [[a, ua, va], [b, ub, vb], [c, uc, vc]] as [THREE.Vector3, number, number][]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(base[0] * shade[0], base[1] * shade[1], base[2] * shade[2]);
      this.uv.push(r.u0 + (r.u1 - r.u0) * clamp(u, 0, 1), r.v0 + (r.v1 - r.v0) * clamp(v, 0, 1));
      this.bone.push(this.b);
    }
  }

  /**
   * Baked light on top of the shader's sun, which is ahead of the riders
   * and so leaves the back the camera sees in ambient: a warm sunset key
   * from above and behind the right shoulder (the mockup's hero is lit
   * that way) picks out the facets of the back, shoulders and arms in
   * orange; a weaker, cooler fill from the left; undersides dark and cool;
   * faces turned in towards the body darker still.
   */
  private shade(n: THREE.Vector3): RGB {
    const key = Math.max(0, n.x * KEY.x + n.y * KEY.y + n.z * KEY.z);
    const fill = Math.max(0, n.x * FILL.x + n.y * FILL.y + n.z * FILL.z);
    const under = Math.max(0, -n.y);
    let s = 0.64 + 0.56 * key + 0.16 * fill + 0.1 * n.y;
    if (this.side !== 0) s -= 0.16 * Math.max(0, -n.x * this.side);
    const k = key * key;
    return [s + 0.26 * k + 0.03 - 0.05 * under, s + 0.04 * k - 0.03 - 0.06 * under, s - 0.14 * k - 0.04 + 0.05 * under + 0.06 * fill];
  }

  /**
   * A tube along `axis` from `origin`: rings of elliptical cross-section
   * (rx across, rz towards `front`), with optional offsets, `sides` facets,
   * capped at either end unless a ring closes to a point. u runs round
   * from the front (0) by +x (0.25) to the back (0.5); v along the rings.
   */
  tube(origin: THREE.Vector3, axis: THREE.Vector3, front: THREE.Vector3, rings: [number, number, number, number?, number?][], sides: number, caps = true, phase = 0): void {
    const A = axis.clone().normalize();
    const W = front.clone().sub(A.clone().multiplyScalar(front.dot(A))).normalize();
    const U = new THREE.Vector3().crossVectors(A, W);
    // Keep +x on the u = 0.25 side for upright tubes so the prints wrap the same way on every part.
    if (U.x < -0.5) U.negate();
    const t0 = rings[0][0];
    const t1 = rings[rings.length - 1][0];
    const pts: THREE.Vector3[][] = rings.map(([t, rx, rz, ox = 0, oz = 0]) => {
      const row: THREE.Vector3[] = [];
      for (let j = 0; j <= sides; j++) {
        const th = (j / sides) * Math.PI * 2 + phase;
        row.push(origin.clone().addScaledVector(A, t).addScaledVector(U, ox + rx * Math.sin(th)).addScaledVector(W, oz + rz * Math.cos(th)));
      }
      return row;
    });
    const centre = (i: number) => origin.clone().addScaledVector(A, rings[i][0]).addScaledVector(U, rings[i][3] ?? 0).addScaledVector(W, rings[i][4] ?? 0);
    for (let i = 0; i < rings.length - 1; i++) {
      const v0 = (rings[i][0] - t0) / (t1 - t0 || 1);
      const v1 = (rings[i + 1][0] - t0) / (t1 - t0 || 1);
      const mid = centre(i).lerp(centre(i + 1), 0.5);
      for (let j = 0; j < sides; j++) {
        const u0 = j / sides;
        const u1 = (j + 1) / sides;
        const a = pts[i][j];
        const b = pts[i][j + 1];
        const c = pts[i + 1][j + 1];
        const d = pts[i + 1][j];
        if (rings[i][1] > 0 || rings[i][2] > 0) this.tri(a, b, c, mid, u0, v0, u1, v0, u1, v1);
        if (rings[i + 1][1] > 0 || rings[i + 1][2] > 0) this.tri(a, c, d, mid, u0, v0, u1, v1, u0, v1);
      }
    }
    if (!caps) return;
    for (const [i, dir] of [[0, -1], [rings.length - 1, 1]] as [number, number][]) {
      if (rings[i][1] <= 0 && rings[i][2] <= 0) continue;
      const c = centre(i);
      const inside = c.clone().addScaledVector(A, -dir * 0.05);
      const v = i === 0 ? 0 : 1;
      for (let j = 0; j < sides; j++) this.tri(c, pts[i][j], pts[i][j + 1], inside, 0.5, v, j / sides, v, (j + 1) / sides, v);
    }
  }

  /** An icosahedron (detail 0 or 1) scaled to radii and bent by `shape`, centred at `c`. `keep` filters faces by their centroid and normal (relative to c); `uvOf` maps local positions into the current rect. */
  blob(c: THREE.Vector3, rx: number, ry: number, rz: number, detail = 1, shape?: (p: THREE.Vector3) => void, keep?: (centroid: THREE.Vector3, normal: THREE.Vector3) => boolean, uvOf?: (p: THREE.Vector3) => [number, number]): void {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const p = g.getAttribute('position');
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i < p.count; i++) {
      const v = V(p.getX(i) * rx, p.getY(i) * ry, p.getZ(i) * rz);
      shape?.(v);
      verts.push(v);
    }
    g.dispose();
    const n = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    for (let i = 0; i < verts.length; i += 3) {
      const a = verts[i];
      const b = verts[i + 1];
      const d = verts[i + 2];
      const centroid = a.clone().add(b).add(d).divideScalar(3);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(d, a)).normalize();
      if (n.dot(centroid) < 0) n.negate();
      if (keep && !keep(centroid, n)) continue;
      const ua = uvOf?.(a);
      const ub = uvOf?.(b);
      const ud = uvOf?.(d);
      this.tri(a.clone().add(c), b.clone().add(c), d.clone().add(c), c, ua?.[0], ua?.[1], ub?.[0], ub?.[1], ud?.[0], ud?.[1]);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const count = this.bone.length;
    const index = new Uint16Array(count * 4);
    const weight = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      index[i * 4] = this.bone[i];
      weight[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    return g;
  }
}

/** Bind-pose bone positions in model space, from the proportions. */
function skeletonPositions(dims: RigDims, pr: Proportions): THREE.Vector3[] {
  const hips = V(0, dims.hipsY, 0);
  const spine = hips.clone().add(V(0, 0.07, 0));
  const chest = spine.clone().add(V(0, 0.14, 0));
  const neck = chest.clone().add(V(0, 0.34, -0.015));
  const head = neck.clone().add(V(0, 0.075, 0.01));
  const hair = head.clone().add(V(0, 0.12 * pr.head, -0.06));
  const shoulderL = chest.clone().add(V(dims.shoulderX, dims.shoulderY, -0.01));
  const shoulderR = chest.clone().add(V(-dims.shoulderX, dims.shoulderY, -0.01));
  const elbowL = shoulderL.clone().add(V(0, -dims.upperArm, 0));
  const elbowR = shoulderR.clone().add(V(0, -dims.upperArm, 0));
  const wristL = elbowL.clone().add(V(0, -dims.forearm, 0));
  const wristR = elbowR.clone().add(V(0, -dims.forearm, 0));
  const hipL = hips.clone().add(V(dims.hipHalfW, -dims.hipDrop, 0));
  const hipR = hips.clone().add(V(-dims.hipHalfW, -dims.hipDrop, 0));
  const kneeL = hipL.clone().add(V(0, -dims.thigh, 0));
  const kneeR = hipR.clone().add(V(0, -dims.thigh, 0));
  const ankleL = kneeL.clone().add(V(0, -dims.shin, 0));
  const ankleR = kneeR.clone().add(V(0, -dims.shin, 0));
  return [hips, spine, chest, neck, head, hair, shoulderL, elbowL, wristL, shoulderR, elbowR, wristR, hipL, kneeL, ankleL, hipR, kneeR, ankleR];
}

/** Body proportions for a look: the body type's, narrowed in the shoulders and arms for a female figure. */
function proportions(look: RiderLook): Proportions {
  const pr = PROPORTIONS[look.body];
  if (!look.female) return pr;
  return { ...pr, shoulderX: pr.shoulderX * 0.84, chestRx: pr.chestRx * 0.86, chestRz: pr.chestRz * 0.95, latRx: pr.latRx * 0.84, arm: pr.arm * 0.85 };
}

export function rigDims(look: RiderLook): RigDims {
  const pr = proportions(look);
  const deckY = 0.1;
  const ankle = 0.07;
  const shin = 0.39;
  const thigh = 0.4;
  const hipDrop = 0.05;
  const hipsY = deckY + ankle + shin + thigh + hipDrop;
  return {
    deckY,
    ankle,
    shin,
    thigh,
    hipHalfW: look.female ? 0.1 : 0.095 * (look.body === 'heavy' ? 1.15 : 1),
    hipDrop,
    hipsY,
    upperArm: 0.27,
    forearm: 0.25,
    shoulderX: pr.shoulderX,
    shoulderY: 0.265,
    frontFoot: V(0.06, deckY, 0.34),
    backFoot: V(-0.09, deckY, -0.36),
    pivotY: hipsY - 0.15,
  };
}

/** The body: torso, head and hair, arms, legs, clothes and accessories, one bone per part. */
function buildBody(spec: RiderSpec, dims: RigDims, J: THREE.Vector3[]): THREE.BufferGeometry {
  const { look, colors } = spec;
  const pr = proportions(look);
  const white = regionUv(ATLAS.white, ATLAS_SIZE, ATLAS_SIZE);
  const faceRect = regionUv(ATLAS.face, ATLAS_SIZE, ATLAS_SIZE);
  const shortsRect = regionUv(ATLAS.shorts, ATLAS_SIZE, ATLAS_SIZE);
  const topRect = regionUv(ATLAS.top, ATLAS_SIZE, ATLAS_SIZE);
  const g = new Builder(white);
  const skin = colors.skin;
  const hair = colors.hair;
  const up = V(0, 1, 0);
  const down = V(0, -1, 0);
  const fwd = V(0, 0, 1);
  const wetsuit = look.top === 'wetsuit';
  const [hips, spine, chest, neck, head, hairJ] = J;

  // --- torso: abdomen (spine bone) and the V-tapered chest and back (chest bone) ---
  g.paint(BONE.spine, skin);
  const wx = pr.waistRx;
  const wz = pr.waistRz;
  g.tube(spine.clone().add(V(0, -0.06, 0)), up, fwd, [
    [0, wx * 1.04, wz, 0, 0.004],
    [0.1, wx * 0.98, wz * 1.02, 0, 0.008],
    [0.17, wx * 1.04, wz * 1.04, 0, 0.004],
  ], 8, false);
  if (pr.belly > 0) g.blob(spine.clone().add(V(0, 0.04, 0.06)), wx * 0.92, 0.16, wz * 0.95, 1);
  g.paint(BONE.chest, skin, wetsuit ? topRect : null);
  const cRx = pr.chestRx;
  const cRz = pr.chestRz;
  g.tube(chest.clone().add(V(0, -0.04, 0)), up, fwd, [
    [0, wx * 1.06, wz * 1.04, 0, 0.004],
    [0.1, pr.latRx, cRz * 0.92, 0, -0.008],
    [0.2, cRx, cRz, 0, 0.012],
    [0.28, cRx * 1.0, cRz * 0.95, 0, 0.0],
    [0.33, cRx * 0.78, cRz * 0.8, 0, -0.012],
    [0.37, cRx * 0.42, cRz * 0.62, 0, -0.012],
    [0.41, 0.065, 0.06, 0, -0.012],
  ], 8, true);
  // Pecs (a bust on a female figure) on the chest, and the shoulder blades on the back, give the facets something to catch.
  for (const sx of [1, -1]) {
    g.paint(BONE.chest, skin, wetsuit ? topRect : null, sx);
    if (!look.female) g.blob(chest.clone().add(V(sx * cRx * 0.42, 0.17, cRz * 0.78)), cRx * 0.42, 0.075, 0.05, 0);
    else if (look.top !== 'bikini') {
      if (look.top !== 'none' && look.top !== 'wetsuit') g.paint(BONE.chest, look.topColor);
      g.blob(chest.clone().add(V(sx * 0.068, 0.165, cRz * 0.82)), 0.064, 0.058, 0.05, 0);
    }
    g.paint(BONE.chest, skin, wetsuit ? topRect : null, sx);
    g.blob(chest.clone().add(V(sx * cRx * 0.45, 0.2, -cRz * 0.72)), cRx * 0.4, 0.09, 0.045, 0);
  }
  // Neck and trapezius.
  g.paint(BONE.neck, skin);
  g.tube(neck.clone().add(V(0, -0.04, 0)), up, fwd, [
    [0, 0.07, 0.065],
    [0.12, 0.058, 0.058, 0, 0.005],
  ], 6, false);

  // --- head (head bone): a faceted skull with a jaw, the face from the atlas, ears ---
  const hs = pr.head;
  const hc = head.clone().add(V(0, 0.11 * hs, 0.015));
  const hrx = 0.112 * hs;
  const hry = 0.138 * hs;
  const hrz = 0.124 * hs;
  g.paint(BONE.head, skin);
  g.blob(hc, hrx, hry, hrz, 1, (p) => {
    jaw(p, hry);
    if (p.z < 0) p.z *= 1.06;
  });
  faceShell(g, hc, hrx, hry, hrz, faceRect);
  for (const sx of [1, -1]) g.blob(hc.clone().add(V(sx * hrx * 0.98, -0.005, -0.01)), 0.022, 0.036, 0.028, 0);

  // --- hair and hats (head bone; long hair on the hair bone so it can swing) ---
  buildHair(g, look, hair, hc, hrx, hry, hrz, hairJ);

  // --- arms: deltoid, upper arm, elbow, forearm, wristband, fist ---
  const armK = pr.arm;
  for (const [sx, ua, fa, hd] of [[1, BONE.upperArmL, BONE.forearmL, BONE.handL], [-1, BONE.upperArmR, BONE.forearmR, BONE.handR]] as [number, number, number, number][]) {
    const sh = J[ua];
    const el = J[fa];
    const wr = J[hd];
    g.paint(ua, skin, null, sx);
    const delt = look.female ? 0.9 : 1;
    g.blob(sh.clone().add(V(sx * 0.03 * delt, 0.0, 0)), 0.1 * armK * delt, 0.095 * armK * delt, 0.1 * armK * delt, 1, (p) => {
      if (p.y < 0) p.x *= 0.85;
    });
    g.tube(sh.clone().add(V(sx * 0.005, -0.04, 0)), down, fwd, [
      [0, 0.072 * armK, 0.078 * armK],
      [0.1, 0.07 * armK, 0.082 * armK, 0, 0.012],
      [dims.upperArm - 0.04, 0.05 * armK, 0.052 * armK],
    ], 6, false);
    g.paint(fa, skin, null, sx);
    g.blob(el, 0.052 * armK, 0.05 * armK, 0.052 * armK, 0);
    g.tube(el.clone(), down, fwd, [
      [0, 0.054 * armK, 0.052 * armK],
      [0.07, 0.066 * armK, 0.06 * armK, 0, 0.006],
      [dims.forearm - 0.01, 0.04 * armK, 0.034 * armK],
    ], 6, false);
    if (look.wristbands !== null) {
      g.paint(fa, look.wristbands);
      g.tube(wr.clone().add(V(0, 0.07, 0)), down, fwd, [
        [0, 0.048 * armK, 0.042 * armK],
        [0.05, 0.046 * armK, 0.04 * armK],
      ], 6, false);
    }
    g.paint(hd, wetsuit ? mixColor(skin, 0x000000, 0.2) : skin, null, sx);
    g.tube(wr.clone().add(V(0, 0.005, 0.005)), down, fwd, [
      [0, 0.042 * armK, 0.036 * armK],
      [0.035, 0.064 * armK, 0.056 * armK],
      [0.11, 0.058 * armK, 0.052 * armK, 0, 0.006],
    ], 5, true);
  }

  // --- legs: thigh, knee, shin with calf, foot ---
  const legK = pr.leg;
  for (const [sx, th, sn, ft] of [[1, BONE.thighL, BONE.shinL, BONE.footL], [-1, BONE.thighR, BONE.shinR, BONE.footR]] as [number, number, number, number][]) {
    const hipJ = J[th];
    const knee = J[sn];
    const ankle = J[ft];
    g.paint(th, skin, null, sx);
    g.tube(hipJ.clone().add(V(0, 0.06, 0)), down, fwd, [
      [0, 0.112 * legK, 0.118 * legK],
      [0.2, 0.108 * legK, 0.118 * legK, 0, 0.014],
      [dims.thigh + 0.04, 0.066 * legK, 0.07 * legK],
    ], 7, false);
    g.paint(sn, skin, null, sx);
    g.blob(knee.clone().add(V(0, 0, 0.012)), 0.068 * legK, 0.064 * legK, 0.072 * legK, 0);
    g.tube(knee.clone(), down, fwd, [
      [0, 0.064 * legK, 0.068 * legK],
      [0.12, 0.074 * legK, 0.088 * legK, 0, -0.018],
      [dims.shin - 0.02, 0.044 * legK, 0.046 * legK],
    ], 6, false);
    if (wetsuit) {
      g.paint(sn, look.topColor);
      g.tube(ankle.clone().add(V(0, 0.06, 0)), down, fwd, [
        [0, 0.046, 0.048],
        [0.04, 0.044, 0.046],
      ], 6, false);
    }
    g.paint(ft, wetsuit ? mixColor(skin, 0x000000, 0.2) : skin, null, sx);
    g.tube(ankle.clone().add(V(0, -0.04, -0.03)), fwd, up, [
      [-0.04, 0.042, 0.036],
      [0.06, 0.05, 0.03, 0, -0.006],
      [0.19, 0.046, 0.016, 0, -0.018],
    ], 4, true, Math.PI / 4);
  }

  // --- shorts: the pelvis wrap (hips bone) and a tube on each thigh, printed from the atlas ---
  const bikini = look.shorts === 'bikini';
  const hipRx = pr.hipRx * (look.female ? 1.08 : 1);
  g.paint(BONE.hips, colors.shorts, shortsRect);
  if (bikini) {
    g.tube(hips.clone().add(V(0, -0.1, 0)), up, fwd, [
      [0, hipRx * 0.55, wz * 0.75],
      [0.06, hipRx * 0.95, wz * 1.08],
      [0.12, hipRx * 0.98, wz * 1.08],
    ], 8, true);
    // Skin above the bikini, up to the waist.
    g.paint(BONE.hips, skin);
    g.tube(hips.clone().add(V(0, 0.02, 0)), up, fwd, [
      [0, hipRx * 0.97, wz * 1.06],
      [0.07, wx * 1.04, wz * 1.0],
    ], 8, false);
    // Hip and thigh tops in skin so the legs join the pelvis.
    for (const [sx, th] of [[1, BONE.thighL], [-1, BONE.thighR]] as [number, number][]) {
      g.paint(th, skin, null, sx);
      g.blob(J[th].clone().add(V(sx * 0.01, 0.03, 0)), 0.1 * legK, 0.09, 0.105 * legK, 0);
    }
  } else {
    g.tube(hips.clone().add(V(0, -0.11, 0)), up, fwd, [
      [0, hipRx * 0.7, wz * 0.95, 0, -0.005],
      [0.08, hipRx, wz * 1.18],
      [0.15, hipRx * 0.98, wz * 1.12],
      [0.19, wx * 1.1, wz * 1.08, 0, 0.004],
    ], 8, true);
    for (const [sx, th] of [[1, BONE.thighL], [-1, BONE.thighR]] as [number, number][]) {
      g.paint(th, colors.shorts, shortsRect, sx);
      const top = J[th].clone().add(V(sx * 0.008, 0.07, 0));
      const len = look.shorts === 'denim' ? 0.14 : 0.27;
      // Built bottom-up (hem to top) so the print's v runs the same way as on the pelvis.
      g.tube(top.clone().add(V(0, -len, 0)), up, fwd, [
        [0, 0.124 * legK, 0.13 * legK, 0, 0.004],
        [len * 0.6, 0.13 * legK, 0.134 * legK],
        [len, 0.132 * legK, 0.134 * legK],
      ], 7, false);
    }
  }

  // --- tops ---
  if (look.top === 'vest') {
    g.paint(BONE.chest, look.topColor, topRect);
    const e = 0.016;
    g.tube(chest.clone().add(V(0, -0.05, 0)), up, fwd, [
      [0, wx * 1.06 + e, wz * 1.04 + e],
      [0.11, pr.latRx + e, cRz * 0.92 + e, 0, -0.008],
      [0.21, cRx + e, cRz + e + 0.01, 0, 0.012],
      [0.29, cRx + e, cRz * 0.95 + e],
      [0.34, cRx * 0.8 + e, cRz * 0.8 + e, 0, -0.012],
      [0.38, cRx * 0.45 + e, cRz * 0.64 + e, 0, -0.012],
    ], 8, false);
  } else if (look.top === 'crop') {
    g.paint(BONE.chest, look.topColor, topRect);
    const e = 0.012;
    g.tube(chest.clone().add(V(0, 0.08, 0)), up, fwd, [
      [0, pr.latRx * 1.02 + e, cRz * 0.95 + e, 0, 0],
      [0.1, cRx + e, cRz + e + 0.012, 0, 0.012],
      [0.2, cRx + e, cRz * 0.95 + e],
      [0.25, cRx * 0.8 + e, cRz * 0.8 + e, 0, -0.012],
    ], 8, false);
  } else if (look.top === 'bikini') {
    g.paint(BONE.chest, look.topColor);
    for (const sx of [1, -1]) g.blob(chest.clone().add(V(sx * 0.07, 0.17, cRz * 0.85)), 0.068, 0.062, 0.05, 0);
    g.tube(chest.clone().add(V(0, 0.16, 0)), up, fwd, [
      [0, cRx * 0.98 + 0.01, cRz + 0.012, 0, 0.012],
      [0.035, cRx * 0.99 + 0.01, cRz + 0.012, 0, 0.012],
    ], 8, false);
  }

  // --- accessories ---
  if (look.necklace !== null) {
    g.paint(BONE.chest, look.necklace);
    for (let i = 0; i < 7; i++) {
      const a = ((i - 3) / 3) * 1.15;
      const y = 0.31 - 0.05 * Math.cos(a * 0.8);
      g.blob(chest.clone().add(V(Math.sin(a) * cRx * 0.5, y, Math.cos(a) * (cRz + 0.03))), 0.02, 0.02, 0.02, 0);
    }
  }
  return g.build();
}

/** Narrow the lower half of the head into a jaw and bring the chin forward. */
function jaw(p: THREE.Vector3, hry: number): void {
  if (p.y >= 0) return;
  const k = -p.y / hry;
  p.x *= 1 - 0.28 * k;
  p.z = p.z * (1 - 0.1 * k) + 0.02 * k;
}

/** A slightly larger, front-only shell over the skull carries the face from the atlas, so the features sit just proud of the skin. */
function faceShell(g: Builder, hc: THREE.Vector3, hrx: number, hry: number, hrz: number, faceRect: UvRect): void {
  g.paint(BONE.head, 0xffffff, faceRect);
  g.blob(
    hc,
    hrx * 1.015,
    hry * 1.015,
    hrz * 1.03,
    1,
    (p) => jaw(p, hry * 1.015),
    (c, n) => n.z > 0.5 && c.y < hry * 0.6 && c.y > -hry * 0.85,
    (p) => [0.5 + p.x / (hrx * 2.1), 0.5 + (p.y - 0.005) / (hry * 1.9)],
  );
}

/** Spikes, quiff, mohawk, long hair or dreads, buzz, hood; then caps. */
function buildHair(g: Builder, look: RiderLook, hair: number, hc: THREE.Vector3, hrx: number, hry: number, hrz: number, hairJ: THREE.Vector3): void {
  const scalp = (scale: number, keep: (c: THREE.Vector3, n: THREE.Vector3) => boolean) => g.blob(hc, hrx * scale, hry * scale, hrz * scale, 1, (p) => {
    if (p.z < 0) p.z *= 1.06;
  }, keep);
  const hairline = (c: THREE.Vector3) => c.y > (c.z > hrz * 0.3 ? hry * 0.42 : c.z > 0 ? hry * 0.12 : -hry * 0.35);
  /** A four-sided cone out of the scalp; `flat` < 1 thins it across (mohawk fins), > 1 widens it (a quiff). */
  const spike = (dir: THREE.Vector3, len: number, r: number, flat = 1) => {
    const d = dir.clone().normalize();
    const base = hc.clone().addScaledVector(d, hry * 0.78);
    const side = Math.abs(d.y) > 0.9 ? V(0, 0, 1) : V(0, 1, 0);
    g.tube(base, d, side, [
      [0, r * flat, r],
      [len, 0, 0],
    ], 4, false, Math.PI / 4);
  };
  g.paint(BONE.head, hair);
  switch (look.hair) {
    case 'spiky':
    case 'quiff': {
      scalp(1.07, hairline);
      // Spikes radiating over the crown and down the back (SAM's mane).
      const rings: [number, number, number][] = [[1.35, 1, 0.13], [0.95, 6, 0.15], [0.5, 8, 0.14], [0.05, 7, 0.12]];
      for (const [elev, count, len] of rings) {
        for (let k = 0; k < count; k++) {
          const az = (k / count) * Math.PI * 2 + elev;
          const dir = V(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
          if (dir.z > 0.55 && elev < 0.6) continue; // keep the face clear
          dir.z -= 0.25;
          dir.y += 0.15;
          spike(dir, len * (look.hair === 'quiff' ? 0.75 : 1), 0.05);
        }
      }
      if (look.hair === 'quiff') spike(V(0, 0.75, 0.75), 0.17, 0.06, 1.6);
      break;
    }
    case 'mohawk':
      // A crest of tall flat spikes from the forehead to the nape.
      for (let k = 0; k < 7; k++) {
        const a = -0.55 + k * 0.36;
        spike(V(0, Math.cos(a), -Math.sin(a) - 0.15), 0.2 - Math.abs(k - 2.5) * 0.018, 0.065, 0.5);
      }
      break;
    case 'buzz':
      scalp(1.03, hairline);
      break;
    case 'long':
    case 'dreads':
    case 'ponytail': {
      scalp(1.07, hairline);
      g.paint(BONE.hair, hair);
      const base = V(hairJ.x, hc.y + hry * 0.15, hc.z - hrz * 0.55);
      if (look.hair === 'long') {
        g.tube(base, V(0, -1, -0.12), V(0, 0, -1), [
          [0, hrx * 1.0, hrz * 0.55, 0, 0.02],
          [0.18, hrx * 1.25, hrz * 0.45, 0, 0.04],
          [0.4, hrx * 1.15, hrz * 0.3, 0, 0.05],
          [0.5, hrx * 0.7, hrz * 0.15, 0, 0.05],
        ], 6, true);
      } else if (look.hair === 'dreads') {
        for (let k = 0; k < 7; k++) {
          const a = ((k - 3) / 3) * 1.3;
          const o = V(Math.sin(a) * hrx * 0.8, -0.02 - Math.abs(a) * 0.02, -Math.cos(a) * hrz * 0.3);
          g.tube(base.clone().add(o), V(Math.sin(a) * 0.25, -1, -0.15), V(0, 0, -1), [
            [0, 0.026, 0.026],
            [0.3 - Math.abs(a) * 0.05, 0.018, 0.018],
          ], 4, true);
        }
      } else {
        g.tube(base.clone().add(V(0, 0.06, -0.02)), V(0, -0.6, -1), V(0, 1, 0), [
          [0, 0.04, 0.05],
          [0.1, 0.055, 0.06],
          [0.3, 0.02, 0.025],
        ], 5, true);
      }
      g.paint(BONE.head, hair);
      break;
    }
    case 'hood':
      // A hood round the head, open at the face, and drawn down to the shoulders.
      g.blob(hc.clone().add(V(0, 0.01, -0.012)), hrx * 1.28, hry * 1.18, hrz * 1.22, 1, undefined, (c, n) => !(n.z > 0.42 && c.y > -hry * 0.9 && c.y < hry * 0.7));
      break;
    case 'bald':
      break;
  }
  // Caps (a dome and a brim) and visors (a band and a brim).
  if (look.hat !== 'none') {
    g.paint(BONE.head, look.hatColor);
    if (look.hat === 'visor') {
      g.tube(hc.clone().add(V(0, hry * 0.3, 0)), V(0, 1, 0), V(0, 0, 1), [
        [0, hrx * 1.06, hrz * 1.08],
        [0.035, hrx * 1.04, hrz * 1.06],
      ], 8, false);
    } else {
      g.blob(hc.clone().add(V(0, hry * 0.32, -0.004)), hrx * 1.12, hry * 0.78, hrz * 1.1, 1, undefined, (c) => c.y > -hry * 0.05);
    }
    const dir = look.hat === 'capBack' ? -1 : 1;
    g.paint(BONE.head, mixColor(look.hatColor, 0x000000, 0.25));
    g.tube(hc.clone().add(V(0, hry * 0.33, dir * hrz * 0.85)), V(0, -0.15, dir), V(0, 1, 0), [
      [0, hrx * 0.95, 0.012],
      [0.12, hrx * 0.8, 0.01],
    ], 4, true, Math.PI / 4);
  }
}

/** Half-width of the board along its length, t = 0 at the tail to 1 at the nose. */
function boardHalfWidth(t: number, round: boolean): number {
  if (t < 0.46) return 0.62 + 0.38 * Math.sin((t / 0.46) * (Math.PI / 2));
  const u = (t - 0.46) / 0.54;
  return round ? Math.pow(Math.max(0, 1 - Math.pow(u, 2.6)), 0.5) : Math.pow(Math.max(0, Math.cos(u * (Math.PI / 2))), 0.85);
}

/** The board's rocker: the nose and tail curve up. */
export function boardRocker(z: number, length = BOARD_LENGTH): number {
  const t = z / length + 0.5;
  if (t > 0.62) return 0.15 * Math.pow((t - 0.62) / 0.38, 2.1);
  if (t < 0.22) return 0.045 * Math.pow((0.22 - t) / 0.22, 2);
  return 0;
}

const BOARD_LENGTH = 2.05;

/** A surfboard: planform, rocker, rounded rails, thick in the middle, three fins, deck art on top. */
function buildBoard(spec: RiderSpec, deckY: number): THREE.BufferGeometry {
  const L = BOARD_LENGTH;
  const maxHW = 0.28;
  const maxT = 0.075;
  const round = spec.look.roundNose;
  const deck = regionUv(BOARD_REGIONS.deck, BOARD_TEX.w, BOARD_TEX.h);
  const hull = regionUv(BOARD_REGIONS.hull, BOARD_TEX.w, BOARD_TEX.h);
  const white = regionUv(BOARD_REGIONS.white, BOARD_TEX.w, BOARD_TEX.h);
  const g = new Builder(white);
  // Cross-section, unit half-width and half-thickness: domed deck, rounded rails, a flat hull.
  const section: [number, number][] = [[0, 1], [0.5, 0.94], [0.84, 0.66], [1, 0.08], [0.9, -0.55], [0.5, -0.92], [0, -1], [-0.5, -0.92], [-0.9, -0.55], [-1, 0.08], [-0.84, 0.66], [-0.5, 0.94]];
  const N = 17;
  const yMid = deckY - maxT / 2;
  const rows: THREE.Vector3[][] = [];
  const tOf: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const z = -L / 2 + t * L;
    const hw = Math.max(0.006, maxHW * boardHalfWidth(t, round));
    const th = maxT * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * clamp(t * 0.96 + 0.02, 0, 1)), 0.6));
    const y = yMid + boardRocker(z);
    rows.push(section.map(([sx, sy]) => V(sx * hw, y + (sy * th) / 2, z)));
    tOf.push(t);
  }
  const uvAcross = (x: number) => 0.5 + x / (2 * maxHW);
  const shades = (rect: UvRect, color: number) => g.paint(0, color, rect);
  const S = section.length;
  for (let i = 0; i < N - 1; i++) {
    const axis = V(0, (rows[i][0].y + rows[i][6].y) / 2, rows[i][0].z).lerp(V(0, (rows[i + 1][0].y + rows[i + 1][6].y) / 2, rows[i + 1][0].z), 0.5);
    for (let j = 0; j < S; j++) {
      const k = (j + 1) % S;
      const a = rows[i][j];
      const b = rows[i][k];
      const c = rows[i + 1][k];
      const d = rows[i + 1][j];
      const top = section[j][1] > 0.3 && section[k][1] > 0.3;
      shades(top ? deck : hull, 0xffffff);
      g.tri(a, b, c, axis, uvAcross(a.x), tOf[i], uvAcross(b.x), tOf[i], uvAcross(c.x), tOf[i + 1]);
      g.tri(a, c, d, axis, uvAcross(a.x), tOf[i], uvAcross(c.x), tOf[i + 1], uvAcross(d.x), tOf[i + 1]);
    }
  }
  // The squash tail: a flat end cap.
  g.paint(0, mixColor(spec.colors.board, 0x000000, 0.25));
  const tail = rows[0];
  const tc = tail.reduce((acc, p) => acc.add(p), V(0, 0, 0)).divideScalar(S);
  for (let j = 0; j < S; j++) g.tri(tc, tail[j], tail[(j + 1) % S], tc.clone().add(V(0, 0, 0.05)));
  // Three fins under the tail: a centre fin and two canted side fins.
  g.paint(0, mixColor(spec.colors.boardStripe, PALETTE.outline, 0.4));
  const fin = (x: number, z: number, cant: number, size: number) => {
    const base = V(x, yMid - maxT * 0.3 + boardRocker(z), z);
    const a = base.clone().add(V(0, 0, 0.06 * size));
    const b = base.clone().add(V(0, 0, -0.06 * size));
    const tip = base.clone().add(V(Math.sin(cant) * 0.1 * size, -0.1 * size, -0.08 * size));
    const off = V(0.008, 0, 0);
    g.tri(a, b, tip, base.clone().sub(off));
    g.tri(a, b, tip, base.clone().add(off));
  };
  fin(0, -L / 2 + 0.12, 0, 1.1);
  for (const sx of [1, -1]) fin(sx * maxHW * 0.55, -L / 2 + 0.3, sx * 0.15, 0.9);
  const geometry = g.build();
  geometry.deleteAttribute('skinIndex');
  geometry.deleteAttribute('skinWeight');
  return geometry;
}

/** Build a rider's body (skinned) and board for a spec. */
export function buildRiderModel(spec: RiderSpec): RiderModel {
  const dims = rigDims(spec.look);
  const pr = proportions(spec.look);
  const joints = skeletonPositions(dims, pr);
  const atlas = riderAtlas(spec);
  const deckTex = boardDeckTexture(spec);
  const bodyMaterial = createPS1Material({ map: atlas, flat: 0.22 });
  const boardMaterial = createPS1Material({ map: deckTex, flat: 0.05 });

  const geometry = buildBody(spec, dims, joints);
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    const bone = new THREE.Bone();
    bone.name = Object.keys(BONE)[i];
    const parent = PARENT[i];
    bone.position.copy(joints[i]);
    if (parent >= 0) {
      bone.position.sub(joints[parent]);
      bones[parent].add(bone);
    }
    bones.push(bone);
  }
  const body = new THREE.SkinnedMesh(geometry, bodyMaterial);
  body.add(bones[0]);
  body.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(bones));
  // Bones move the vertices far from the bind pose (tumbles, punches), so cull on a generous fixed sphere.
  body.boundingSphere = new THREE.Sphere(V(0, 1, 0), 1.9);
  body.frustumCulled = true;

  const board = new THREE.Mesh(buildBoard(spec, dims.deckY), boardMaterial);
  const materials = [bodyMaterial, boardMaterial];
  return {
    body,
    bones,
    board,
    dims,
    bodyMaterial,
    boardMaterial,
    materials,
    dispose() {
      geometry.dispose();
      board.geometry.dispose();
      body.skeleton.dispose();
      atlas.dispose();
      deckTex.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
