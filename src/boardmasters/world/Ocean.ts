import { createPS1Material } from '../engine/PS1Material';
import { clamp, mixRgb, rgb, smoothstep } from '../engine/math';
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

/** Grid: 1 m cells, 44 across (x from -22 to 22) and 110 along, 12 of them behind the rider. */
const COLS = 44;
const ROWS = 110;
const BEHIND = 12;

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
 * cells and is resampled every frame from `height(x, z)`; riders sample the
 * same function, so what you see is what you ride. Vertex colours go from
 * deep blue in the troughs to light blue and foam on crests and steep faces;
 * normals come from the analytic slope for the shader's per-vertex lighting.
 */
export class Ocean {
  readonly mesh: THREE.Mesh;
  /** Metres ahead of the rider that the mesh covers. */
  readonly ahead = ROWS - BEHIND;
  time = 0;
  originZ = 0;
  private features: OceanFeature[] = [];
  private active: OceanFeature[] = [];
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly colors: Float32Array;
  private readonly uvs: Float32Array;
  private readonly geometry: THREE.BufferGeometry;

  constructor() {
    const count = (COLS + 1) * (ROWS + 1);
    this.positions = new Float32Array(count * 3);
    this.normals = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.uvs = new Float32Array(count * 2);
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
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    for (const [name, array, size] of [
      ['position', this.positions, 3],
      ['normal', this.normals, 3],
      ['color', this.colors, 3],
      ['uv', this.uvs, 2],
    ] as const) {
      this.geometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    }
    this.mesh = new THREE.Mesh(this.geometry, createPS1Material({ map: waterTexture() }));
    this.mesh.frustumCulled = false;
    this.update(0, 0);
  }

  setFeatures(features: OceanFeature[]): void {
    this.features = [...features].sort((a, b) => a.z - b.z);
    this.active = this.features;
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

  /** Slope (dh/dx, dh/dz) at a point. */
  slope(x: number, z: number): { dx: number; dz: number } {
    const e = 0.3;
    return {
      dx: (this.height(x + e, z) - this.height(x - e, z)) / (2 * e),
      dz: (this.height(x, z + e) - this.height(x, z - e)) / (2 * e),
    };
  }

  /** Advance the swell and rebuild the mesh around `centreZ`. */
  update(dt: number, centreZ: number): void {
    this.time += dt;
    this.originZ = Math.floor(centreZ) - BEHIND;
    const lo = this.originZ - 5;
    const hi = this.originZ + ROWS + 5;
    this.active = this.features.filter((f) => f.z + f.length >= lo && f.z <= hi);

    const foamColor = FOAM;
    let p = 0;
    let uv = 0;
    for (let r = 0; r <= ROWS; r++) {
      const z = this.originZ + r;
      for (let c = 0; c <= COLS; c++) {
        const x = c - COLS / 2;
        const h = this.height(x, z);
        const s = this.slope(x, z);
        // Normal of the surface y = h(x, z).
        const nl = 1 / Math.hypot(s.dx, 1, s.dz);
        this.positions[p] = x;
        this.positions[p + 1] = h;
        this.positions[p + 2] = z;
        this.normals[p] = -s.dx * nl;
        this.normals[p + 1] = nl;
        this.normals[p + 2] = -s.dz * nl;

        const t = clamp((h + 2.0) / 4.0, 0, 1);
        const base = t < 0.5 ? mixRgb(DEEP, MID, t * 2) : mixRgb(MID, LIGHT, (t - 0.5) * 2);
        const steep = Math.hypot(s.dx, s.dz);
        const edge = Math.abs(x) > PHYSICS.trackHalfWidth ? smoothstep(PHYSICS.trackHalfWidth, PHYSICS.trackHalfWidth + EDGE.fade, Math.abs(x)) : 0;
        const foam = clamp(smoothstep(1.6, 2.4, h) + smoothstep(0.8, 1.3, steep) + edge * 0.9, 0, 1);
        const col = mixRgb(base, foamColor, foam);
        this.colors[p] = col[0];
        this.colors[p + 1] = col[1];
        this.colors[p + 2] = col[2];
        p += 3;

        this.uvs[uv] = x / 4;
        this.uvs[uv + 1] = z / 4;
        uv += 2;
      }
    }
    for (const name of ['position', 'normal', 'color', 'uv']) this.geometry.getAttribute(name).needsUpdate = true;
  }
}
