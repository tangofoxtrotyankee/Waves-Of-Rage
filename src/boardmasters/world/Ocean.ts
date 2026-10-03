import { createPS1Material } from '../engine/PS1Material';
import { rgb, smoothstep } from '../engine/math';
import { waterTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { PALETTE, PHYSICS } from '../game/constants';

/** Authored shapes the course places on the swell: a ramp (steep-backed bump that launches) or a trough (slows). */
export interface OceanFeature {
  kind: 'ramp' | 'trough';
  /** Start of the feature along the course, metres. */
  z: number;
  /** Centre line across the course, metres. */
  x: number;
  length: number;
  /** Half-width across the course. */
  width: number;
  height: number;
}

/**
 * Grid: 1 m cells across the course (x from -22 to 22), then coarse columns
 * out to +/-124 m so the water reaches past the fog in every direction, and
 * 110 rows along, 12 of them behind the rider.
 */
const OUTER = [26, 32, 40, 50, 64, 80, 100, 124];
const COLUMN_X: number[] = [...OUTER.map((x) => -x).reverse(), ...Array.from({ length: 45 }, (_, i) => i - 22), ...OUTER];
const COLS = COLUMN_X.length - 1;
const ROWS = 110;
const BEHIND = 12;
/** The sampled height grid carries one extra ring so every vertex has neighbours for its normal. */
const GW = COLS + 3;
const GH = ROWS + 3;
const GRID_X: number[] = [COLUMN_X[0] - (COLUMN_X[1] - COLUMN_X[0]), ...COLUMN_X, COLUMN_X[COLS] + (COLUMN_X[COLS] - COLUMN_X[COLS - 1])];

/**
 * The swells travel towards the rider (crests move to -z); the cross chop
 * just wobbles. Short swells launch a fast rider off their crests, which is
 * deliberate (go faster, get air); the long ground swell only shapes the sea.
 */
const GROUND_SWELL = { amp: 1.2, length: 60, speed: 2.5 };
const SWELL = { amp: 0.8, length: 26, speed: 3.0 };
const SWELL2 = { amp: 0.12, length: 11, speed: 2.2 };
const CHOP = { amp: 0.18 };
/** Beyond the rideable width the water rises into churning whitewater, a visible boundary. */
const EDGE = { rise: 1.6, fade: 6 };

const DEEP = rgb(PALETTE.deepWater);
const MID = rgb(PALETTE.water);
const LIGHT = rgb(PALETTE.lightWater);
const FOAM = rgb(PALETTE.foam);

/**
 * The sea as terrain. A heightfield mesh that follows the rider in whole
 * cells and is resampled from `height(x, z)` once per rendered frame
 * (`rebuild()`), while the simulation only advances the swell and the
 * window (`advance()`). Riders sample the same function, so what you see is
 * what you ride. Vertex colours go from deep blue in the troughs to light
 * blue and foam on crests and steep faces; normals come from neighbouring
 * samples for the shader's per-vertex lighting.
 */
export class Ocean {
  readonly mesh: THREE.Mesh;
  /** Metres ahead of the rider that the mesh covers. */
  readonly ahead = ROWS - BEHIND;
  time = 0;
  originZ = 0;
  private features: OceanFeature[] = [];
  private active: OceanFeature[] = [];
  private dirty = true;
  private readonly heights = new Float32Array(GW * GH);
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const count = (COLS + 1) * (ROWS + 1);
    this.positions = new Float32Array(count * 3);
    this.normals = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const index = new Uint32Array(COLS * ROWS * 6);
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * (COLS + 1) + c;
        const b = a + 1;
        const d = a + COLS + 1;
        const e = d + 1;
        // Alternate the diagonal so the facets do not all lean one way.
        if ((r + c) % 2 === 0) index.set([a, d, b, b, d, e], i);
        else index.set([a, d, e, a, e, b], i);
        i += 6;
      }
    }
    // Texture coordinates never change: the window's z offset is a uniform.
    let uv = 0;
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        uvs[uv++] = COLUMN_X[c] / 4;
        uvs[uv++] = r / 4;
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.material = createPS1Material({ map: waterTexture(), flat: 0.22 }); // faceted, like the mockup's crystal water
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.advance(0, 0);
    this.rebuild();
  }

  setFeatures(features: OceanFeature[]): void {
    this.features = [...features].sort((a, b) => a.z - b.z);
    this.active = this.features;
    this.dirty = true;
  }

  /** Water height at a point on the course, metres. */
  height(x: number, z: number): number {
    const t = this.time;
    let h =
      GROUND_SWELL.amp * Math.sin((z + GROUND_SWELL.speed * t) * ((2 * Math.PI) / GROUND_SWELL.length)) +
      SWELL.amp * Math.sin((z + SWELL.speed * t) * ((2 * Math.PI) / SWELL.length)) +
      SWELL2.amp * Math.sin((z + SWELL2.speed * t) * ((2 * Math.PI) / SWELL2.length) + x * 0.15) +
      CHOP.amp * Math.sin(x * 1.1 + t * 2 + z * 0.25);
    for (const f of this.active) {
      if (z < f.z || z > f.z + f.length) continue;
      const v = Math.abs(x - f.x) / f.width;
      if (v >= 1) continue;
      const lateral = 1 - smoothstep(0.55, 1, v);
      const u = (z - f.z) / f.length;
      if (f.kind === 'ramp') h += f.height * smoothstep(0, 0.78, u) * (1 - smoothstep(0.78, 1, u)) * lateral;
      else h -= f.height * Math.sin(Math.PI * u) * lateral;
    }
    const ax = Math.abs(x);
    if (ax > PHYSICS.trackHalfWidth) {
      const w = smoothstep(PHYSICS.trackHalfWidth, PHYSICS.trackHalfWidth + EDGE.fade, ax);
      h += EDGE.rise * w + 0.35 * w * Math.sin(z * 0.9 + t * 6 + ax);
    }
    return h;
  }

  /** Slope (dh/dx, dh/dz) at a point, for the riders. */
  slope(x: number, z: number): { dx: number; dz: number } {
    const e = 0.3;
    return {
      dx: (this.height(x + e, z) - this.height(x - e, z)) / (2 * e),
      dz: (this.height(x, z + e) - this.height(x, z - e)) / (2 * e),
    };
  }

  /** One simulation step: move the swell and the window around `centreZ`. */
  advance(dt: number, centreZ: number): void {
    this.time += dt;
    this.originZ = Math.floor(centreZ) - BEHIND;
    const lo = this.originZ - 5;
    const hi = this.originZ + ROWS + 5;
    this.active = this.features.filter((f) => f.z + f.length >= lo && f.z <= hi);
    this.dirty = true;
  }

  /** Resample the mesh for the current time and window; once per rendered frame, however many steps ran. */
  rebuild(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const heights = this.heights;
    for (let gr = 0; gr < GH; gr++) {
      const z = this.originZ + gr - 1;
      const row = gr * GW;
      for (let gc = 0; gc < GW; gc++) heights[row + gc] = this.height(GRID_X[gc], z);
    }
    const halfWidth = PHYSICS.trackHalfWidth;
    let p = 0;
    for (let r = 0; r <= ROWS; r++) {
      const z = this.originZ + r;
      const row = (r + 1) * GW;
      // Foam fades out towards the horizon, where the facets are a pixel wide and would sparkle.
      const far = 1 - smoothstep(22, 70, r);
      for (let c = 0; c <= COLS; c++) {
        const gc = c + 1;
        const g = row + gc;
        const x = COLUMN_X[c];
        const h = heights[g];
        const dx = (heights[g + 1] - heights[g - 1]) / (GRID_X[gc + 1] - GRID_X[gc - 1]);
        const dz = (heights[g + GW] - heights[g - GW]) * 0.5;
        // Normals flatten towards the horizon too, so the low sun does not light every distant facet differently.
        const ndx = dx * far;
        const ndz = dz * far;
        const nl = 1 / Math.hypot(ndx, 1, ndz);
        this.positions[p] = x;
        this.positions[p + 1] = h;
        this.positions[p + 2] = z;
        this.normals[p] = -ndx * nl;
        this.normals[p + 1] = nl;
        this.normals[p + 2] = -ndz * nl;

        // Deep -> mid -> light by height, then towards foam on crests, steep faces and the edges. No allocations.
        let t = (h + 2) / 4;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const low = t < 0.5;
        const t2 = low ? t * 2 : (t - 0.5) * 2;
        const a = low ? DEEP : MID;
        const b = low ? MID : LIGHT;
        const ax = x < 0 ? -x : x;
        const edge = ax > halfWidth ? smoothstep(halfWidth, halfWidth + EDGE.fade, ax) : 0;
        let foam = (smoothstep(1.3, 2.1, h) + smoothstep(0.7, 1.15, Math.hypot(dx, dz)) + edge * 0.9) * far;
        if (foam > 1) foam = 1;
        for (let k = 0; k < 3; k++) {
          // The deep-to-light ramp flattens towards mid blue in the distance, for the same reason.
          const ramp = a[k] + (b[k] - a[k]) * t2;
          const base = ramp + (MID[k] - ramp) * (1 - far) * 0.7;
          this.colors[p + k] = base + (FOAM[k] - base) * foam;
        }
        p += 3;
      }
    }
    for (const name of ['position', 'normal', 'color']) this.geometry.getAttribute(name).needsUpdate = true;
    (this.material.uniforms.uUvOffset.value as THREE.Vector2).set(0, this.originZ / 4);
  }
}
