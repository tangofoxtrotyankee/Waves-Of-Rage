import { createPS1Material, waterUniforms } from '../engine/PS1Material';
import { rgb, smoothstep } from '../engine/math';
import { waterTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { PALETTE, PHYSICS, WATER } from '../game/constants';

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
 * Grid: 1 m cells across the course and its whitewater edges (x from -17 to
 * 17), 2 m cells out to 22 m under the shore break, then coarse columns out
 * to +/-124 m so the water reaches past the fog in every direction. Along
 * the course, 1 m rows from 9 m behind the rider (the chase camera sees
 * the water from about 3 m behind the rider) to 40 m ahead, then 2 m
 * rows (on even metres, so they do not swim as the window moves) to about
 * 99 m ahead, where the fog has it all.
 */
const OUTER = [26, 32, 40, 50, 64, 80, 100, 124];
const INNER = [18, 20, 22];
const COLUMN_X: number[] = [...OUTER.map((x) => -x).reverse(), ...INNER.map((x) => -x).reverse(), ...Array.from({ length: 35 }, (_, i) => i - 17), ...INNER, ...OUTER];
const COLS = COLUMN_X.length - 1;
const BEHIND = 9;
/** Rows of vertices 1 m apart from the back edge, then rows 2 m apart. */
const NEAR_ROWS = 49;
const FAR_ROWS = 30;
const ROWS = NEAR_ROWS + FAR_ROWS;
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
/** Ramps: the lip, as a fraction of the length (the face steepens to it, then drops away), and how much of the long swells calm over one, from metres before it to metres after. */
const RAMP = { lip: 0.85, calm: 0.6, calmBefore: 8, calmAfter: 12 };
/** Beyond the rideable width the water rises into churning whitewater, a visible boundary. */
const EDGE = { rise: 1.6, fade: 6 };
/** Beyond `from` (riders never get past PHYSICS.trackHalfWidth) the sea settles to `1 - damp` of the swell at sea level by `to`, so the beaches stay dry. */
const SHORE = { from: 15, to: 22, damp: 0.75 };

/** Rewritten every rebuild; `uv` only when the window's row spacing shifts (see rebuild). */
const ATTRIBUTES = ['position', 'normal', 'color', 'foam'] as const;
/** Per column, how much of the whitewater rise is left under the shore (see height()). */
const SHORE_KEEP = COLUMN_X.map((x) => 1 - smoothstep(SHORE.from, SHORE.to, Math.abs(x)));
/** The foam's lateral break-up and drifting patches, as sines of x (per column, fixed) times sines of z (per row): sin(a + b) = sin a cos b + cos a sin b. */
const FOAM_WAVES = [0.9, 0.43, 0.17].map((k) => ({ sin: COLUMN_X.map((x) => Math.sin(x * k)), cos: COLUMN_X.map((x) => Math.cos(x * k)) }));
const DEEP = rgb(PALETTE.deepWater);
const MID = rgb(PALETTE.water);
const LIGHT = rgb(PALETTE.lightWater);

/**
 * The sea as terrain. A heightfield mesh that follows the rider in whole
 * cells and is resampled from `height(x, z)` once per rendered frame
 * (`rebuild()`), while the simulation only advances the swell and the
 * window (`advance()`). Riders sample the same function, so what you see is
 * what you ride. Vertex colours go from deep blue in the troughs to
 * turquoise on the crests; a per-vertex foam amount (crests, the breaking
 * faces travelling towards the rider, steep ramps, the edges and drifting
 * patches) becomes dithered whitewater in the shader's PS1_WATER block,
 * which also tints by distance and draws the sun's glitter path. Normals
 * come from neighbouring samples for the lighting and the glitter.
 */
export class Ocean {
  readonly mesh: THREE.Mesh;
  /** Metres ahead of the rider that the mesh covers (at least). */
  readonly ahead = NEAR_ROWS + FAR_ROWS * 2 - BEHIND;
  time = 0;
  originZ = 0;
  private features: OceanFeature[] = [];
  private active: OceanFeature[] = [];
  private dirty = true;
  private readonly heights = new Float32Array(GW * GH);
  /** World z of each row of the height grid (the mesh's rows are 1 to ROWS + 1). */
  private readonly gridZ = new Float64Array(GH);
  private readonly uvs: Float32Array;
  /** The far rows' offset from the window's origin when the uv rows were last written (they only change with it). */
  private uvFar = -1;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colors: Float32Array;
  private readonly foam: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    const count = (COLS + 1) * (ROWS + 1);
    this.positions = new Float32Array(count * 3);
    this.normals = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.foam = new Float32Array(count);
    const uvs = (this.uvs = new Float32Array(count * 2));
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
    // Texture coordinates across never change; along, they follow the rows (the window's z offset is a uniform).
    for (let v = 0; v < count; v++) uvs[v * 2] = COLUMN_X[v % (COLS + 1)] / 4;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('foam', new THREE.BufferAttribute(this.foam, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
    this.material = createPS1Material({ map: waterTexture(), flat: 0.22, water: 'sea' }); // faceted, like the mockup's crystal water
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // After the other opaque things (riders, buoys, the shore): the sea's shader is the costliest, and the depth test then
    // skips the water hidden behind the cliffs, the beaches and the pier.
    this.mesh.renderOrder = 0.5;
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
    return this.heightOn(x, z, this.swellAt(z));
  }

  /** The two long swells at `z` (they do not vary across the course): rebuild works them out once per row. */
  private swellAt(z: number): number {
    const t = this.time;
    return (
      GROUND_SWELL.amp * Math.sin((z + GROUND_SWELL.speed * t) * ((2 * Math.PI) / GROUND_SWELL.length)) +
      SWELL.amp * Math.sin((z + SWELL.speed * t) * ((2 * Math.PI) / SWELL.length))
    );
  }

  /**
   * height() given swellAt(z), so the mesh and the riders agree exactly. A
   * ramp rises ever steeper (H times (u / RAMP.lip) squared) to its lip and
   * drops away sharply behind it, so it throws the rider up (about 0.47 m
   * up per metre along at the lip: some 6 m/s up at cruising speed) rather
   * than letting it roll off a flat top; the long swells calm over it so a
   * trough cannot swallow the lip.
   */
  private heightOn(x: number, z: number, swell: number): number {
    const t = this.time;
    let shape = 0;
    let calm = 1;
    for (const f of this.active) {
      const ramp = f.kind === 'ramp';
      if (z < f.z - (ramp ? RAMP.calmBefore : 0) || z > f.z + f.length + (ramp ? RAMP.calmAfter : 0)) continue;
      const v = Math.abs(x - f.x) / f.width;
      if (v >= 1) continue;
      const lateral = 1 - smoothstep(0.55, 1, v);
      const u = (z - f.z) / f.length;
      if (ramp) {
        // The calm eases in before the ramp and out well past it, so it never makes a step of its own and the landing is calm too.
        calm -= RAMP.calm * lateral * smoothstep(f.z - RAMP.calmBefore, f.z + 2, z) * (1 - smoothstep(f.z + f.length, f.z + f.length + RAMP.calmAfter, z));
        if (u < 0 || u > 1) continue;
        const k = u / RAMP.lip;
        shape += f.height * (u <= RAMP.lip ? k * k : 1 - smoothstep(RAMP.lip, 1, u)) * lateral;
      } else shape -= f.height * Math.sin(Math.PI * u) * lateral;
    }
    let h =
      swell * (calm > 0.2 ? calm : 0.2) +
      SWELL2.amp * Math.sin((z + SWELL2.speed * t) * ((2 * Math.PI) / SWELL2.length) + x * 0.15) +
      CHOP.amp * Math.sin(x * 1.1 + t * 2 + z * 0.25) +
      shape;
    const ax = Math.abs(x);
    if (ax > PHYSICS.trackHalfWidth) {
      const w = smoothstep(PHYSICS.trackHalfWidth, PHYSICS.trackHalfWidth + EDGE.fade, ax);
      h += EDGE.rise * w + 0.35 * w * Math.sin(z * 0.9 + t * 6 + ax);
      // Towards the shore (well outside the rideable water) the whitewater drops back and the swell dies down to a lap
      // on the beach under the cliffs and the pier.
      if (ax > SHORE.from) {
        const k = smoothstep(SHORE.from, SHORE.to, ax);
        h = h * (1 - SHORE.damp * k) - (1 - SHORE.damp) * k * EDGE.rise * w;
      }
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
    const hi = this.originZ + NEAR_ROWS + FAR_ROWS * 2 + 6;
    this.active = this.features.filter((f) => f.z + f.length + RAMP.calmAfter >= lo && f.z - RAMP.calmBefore <= hi);
    this.dirty = true;
  }

  /** Resample the mesh for the current time and window; once per rendered frame, however many steps ran. */
  rebuild(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const heights = this.heights;
    const gridZ = this.gridZ;
    const origin = this.originZ;
    // Mesh rows: 1 m apart, then 2 m apart on even metres; the grid adds a row before and after.
    let farZ = origin + NEAR_ROWS + 1;
    if (farZ % 2 !== 0) farZ += 1;
    for (let r = 0; r <= ROWS; r++) gridZ[r + 1] = r <= NEAR_ROWS ? origin + r : farZ + (r - NEAR_ROWS - 1) * 2;
    gridZ[0] = origin - 1;
    gridZ[GH - 1] = gridZ[GH - 2] + 2;
    for (let gr = 0; gr < GH; gr++) {
      const z = gridZ[gr];
      const row = gr * GW;
      const swell = this.swellAt(z);
      for (let gc = 0; gc < GW; gc++) heights[row + gc] = this.heightOn(GRID_X[gc], z, swell);
    }
    // The uv rows follow the rows' offsets from the origin, which only change when the far rows' parity does.
    const writeUv = farZ - origin !== this.uvFar;
    this.uvFar = farZ - origin;
    const halfWidth = PHYSICS.trackHalfWidth;
    const time = this.time;
    let p = 0;
    for (let r = 0; r <= ROWS; r++) {
      const z = gridZ[r + 1];
      const row = (r + 1) * GW;
      const dzSpan = gridZ[r + 2] - gridZ[r];
      const v = z - origin;
      if (writeUv) for (let c = 0, o = (p / 3) * 2 + 1; c <= COLS; c++, o += 2) this.uvs[o] = v / 4;
      // Foam fades out towards the horizon, where the facets are a pixel wide and would sparkle.
      const far = 1 - smoothstep(22, 70, v);
      const zz = z + SWELL.speed * time;
      const s1 = Math.sin(zz * 0.35);
      const c1 = Math.cos(zz * 0.35);
      const s2 = Math.sin(zz * 0.19);
      const c2 = Math.cos(zz * 0.19);
      const s3 = Math.sin(1.7 - zz * 0.31);
      const c3 = Math.cos(1.7 - zz * 0.31);
      for (let c = 0; c <= COLS; c++) {
        const gc = c + 1;
        const g = row + gc;
        const x = COLUMN_X[c];
        const h = heights[g];
        const dx = (heights[g + 1] - heights[g - 1]) / (GRID_X[gc + 1] - GRID_X[gc - 1]);
        const dz = (heights[g + GW] - heights[g - GW]) / dzSpan;
        // Normals flatten towards the horizon too, so the low sun does not light every distant facet differently.
        const ndx = dx * far;
        const ndz = dz * far;
        const nl = 1 / Math.sqrt(ndx * ndx + 1 + ndz * ndz);
        this.positions[p] = x;
        this.positions[p + 1] = h;
        this.positions[p + 2] = z;
        this.normals[p] = -ndx * nl;
        this.normals[p + 1] = nl;
        this.normals[p + 2] = -ndz * nl;

        const ax = x < 0 ? -x : x;
        const edge = ax > halfWidth ? smoothstep(halfWidth, halfWidth + EDGE.fade, ax) : 0;
        // Deep -> mid -> light by height (the rise at the edges does not count). No allocations.
        let t = (h - EDGE.rise * edge * SHORE_KEEP[c] + 1.8) / 3.6;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const low = t < 0.5;
        const t2 = low ? t * 2 : (t - 0.5) * 2;
        const a = low ? DEEP : MID;
        const b = low ? MID : LIGHT;
        // Whitewater: crests, the faces travelling towards the rider, steep ramps, the edges and drifting patches, broken up along the crest.
        const lateral = 0.55 + 0.45 * (FOAM_WAVES[0].sin[c] * c1 + FOAM_WAVES[0].cos[c] * s1);
        const patch = (FOAM_WAVES[1].sin[c] * c2 + FOAM_WAVES[1].cos[c] * s2) * (FOAM_WAVES[2].sin[c] * c3 + FOAM_WAVES[2].cos[c] * s3);
        let foam =
          (smoothstep(WATER.crest, WATER.crestFull, h) + smoothstep(WATER.face, WATER.faceFull, dz) * smoothstep(0.1, 1.0, h)) * lateral +
          smoothstep(0.7, 1.15, Math.sqrt(dx * dx + dz * dz)) +
          smoothstep(0.1, 0.8, edge) * (0.3 + 0.5 * lateral) +
          WATER.patches * smoothstep(0.3, 0.85, patch);
        foam = (foam > 1 ? 1 : foam) * far;
        this.foam[p / 3] = foam;
        for (let k = 0; k < 3; k++) {
          // The deep-to-light ramp flattens towards mid blue in the distance, for the same reason; foamy water is paler underneath.
          const ramp = a[k] + (b[k] - a[k]) * t2;
          const base = ramp + (MID[k] - ramp) * (1 - far) * 0.7;
          this.colors[p + k] = base + (LIGHT[k] - base) * foam * 0.2;
        }
        p += 3;
      }
    }
    for (const name of ATTRIBUTES) this.geometry.getAttribute(name).needsUpdate = true;
    if (writeUv) this.geometry.getAttribute('uv').needsUpdate = true;
    waterUniforms.uTime.value = time;
    (this.material.uniforms.uUvOffset.value as THREE.Vector2).set(0, this.originZ / 4);
  }
}
