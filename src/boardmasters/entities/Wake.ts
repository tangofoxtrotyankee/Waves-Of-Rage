import { createPS1Material } from '../engine/PS1Material';
import { THREE } from '../engine/three';
import type { Ocean } from '../world/Ocean';

/** Seconds a stretch of wake lasts. */
const LIFE = 1.5;
/** A new stretch is laid each time a rider has moved this far (metres) since its last one. */
const SPACING = 0.7;
/** Stretches in the ring buffer: enough for eight riders at a good pace for LIFE seconds (at top speed the oldest go a little early). */
const POOL = 320;
/** Strips per stretch: the two arms of the V and the churned trail between them. Each strip is two quads across (6 vertices), foamy down the middle and clear at the edges, so it dithers out softly. */
const PARTS = 3;
const VERTS = 6;
/** How many riders the emitter tells apart (by position, nearest within TRACK_RADIUS). */
const TRACKERS = 16;
const TRACK_RADIUS = 2.5;
/** Height above the water, so the foam never sinks into the facets. */
const LIFT = 0.1;
const DYNAMIC = ['position', 'foam'] as const;

interface Stretch {
  x: number;
  z: number;
  sin: number;
  cos: number;
  speed: number;
  strength: number;
  age: number;
}

interface Tracker {
  x: number;
  z: number;
  lastX: number;
  lastZ: number;
  used: number;
}

/**
 * Foam wakes for every rider, in one mesh: each stretch is three strips
 * lying on the water (two arms spreading back and out from the tail, and a
 * churned central trail that widens), foamy down the middle and clear at
 * the edges, drawn with the PS1_WATER foam block so they dissolve into
 * dithered pixels as they age instead of blending. A ring
 * buffer of stretches; the live ones are packed into the front of the
 * buffers each step and only they are drawn. `emit` is called per
 * rider per step and lays a stretch every SPACING metres (riders are told
 * apart by position), `update` ages them and re-seats them on the swell.
 */
export class Wake {
  readonly mesh: THREE.Mesh;
  private readonly stretches: Stretch[] = [];
  private readonly trackers: Tracker[] = [];
  private next = 0;
  private clock = 0;
  private readonly positions: Float32Array;
  private readonly foam: Float32Array;
  private readonly geometry: THREE.BufferGeometry;

  constructor() {
    const vertices = POOL * PARTS * VERTS;
    this.positions = new Float32Array(vertices * 3);
    this.foam = new Float32Array(vertices);
    const colors = new Float32Array(vertices * 3).fill(1);
    const normals = new Float32Array(vertices * 3);
    for (let i = 0; i < vertices; i++) normals[i * 3 + 1] = 1;
    const uvs = new Float32Array(vertices * 2);
    // Vertices per strip: front left, centre, right, then back left, centre, right.
    const index = new Uint16Array(POOL * PARTS * 12);
    for (let q = 0; q < POOL * PARTS; q++) {
      const o = q * VERTS;
      index.set([o, o + 3, o + 1, o + 1, o + 3, o + 4, o + 1, o + 4, o + 2, o + 2, o + 4, o + 5], q * 12);
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('foam', new THREE.BufferAttribute(this.foam, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    const material = createPS1Material({ water: 'foam', unlit: true, depthWrite: false, side: THREE.DoubleSide });
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // after the sea it lies on
    for (let i = 0; i < POOL; i++) this.stretches.push({ x: 0, z: 0, sin: 0, cos: 1, speed: 0, strength: 0, age: LIFE });
    for (let i = 0; i < TRACKERS; i++) this.trackers.push({ x: 1e9, z: 1e9, lastX: 1e9, lastZ: 1e9, used: -1 });
  }

  /** A rider at (x, z) on the water with this heading and speed; strength 0..1+ (harder carves and speed churn more). */
  emit(x: number, _y: number, z: number, heading: number, speed: number, strength: number): void {
    // Which rider is this? The nearest tracker within reach, else the least recently used one.
    let tracker = this.trackers[0];
    let best = TRACK_RADIUS * TRACK_RADIUS;
    let found = false;
    let oldest = this.trackers[0];
    for (const t of this.trackers) {
      const d = (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z);
      if (d < best) {
        best = d;
        tracker = t;
        found = true;
      }
      if (t.used < oldest.used) oldest = t;
    }
    if (!found) {
      tracker = oldest;
      tracker.lastX = 1e9;
      tracker.lastZ = 1e9;
    }
    tracker.x = x;
    tracker.z = z;
    tracker.used = this.clock;
    const moved = (tracker.lastX - x) * (tracker.lastX - x) + (tracker.lastZ - z) * (tracker.lastZ - z);
    if (moved < SPACING * SPACING) return;
    tracker.lastX = x;
    tracker.lastZ = z;
    const s = this.stretches[this.next];
    this.next = (this.next + 1) % POOL;
    s.x = x;
    s.z = z;
    s.sin = Math.sin(heading);
    s.cos = Math.cos(heading);
    s.speed = speed;
    s.strength = strength;
    s.age = 0;
  }

  update(dt: number, ocean: Ocean): void {
    this.clock += dt;
    // Live stretches are packed at the front of the buffers and only those are drawn.
    let live = 0;
    for (let i = 0; i < POOL; i++) {
      const s = this.stretches[i];
      if (s.age >= LIFE) continue;
      s.age += dt;
      if (s.age >= LIFE) continue;
      const v = live * PARTS * VERTS;
      live++;
      const life = 1 - s.age / LIFE;
      const age = s.age;
      // Forward along the heading and across it (right-handed: +x is screen-left).
      const fx = s.sin;
      const fz = s.cos;
      const rx = s.cos;
      const rz = -s.sin;
      const y = ocean.height(s.x, s.z) + LIFT;
      // The arms: spreading out at a fraction of the rider's speed, thinning as they go.
      const spread = 0.35 + age * (0.6 + s.speed * 0.07);
      const armHalfW = 0.26 + age * 0.16;
      const half = SPACING * 0.75;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        const cx = s.x + rx * spread * sign;
        const cz = s.z + rz * spread * sign;
        const ay = ocean.height(cx, cz) + LIFT;
        // Arms angle outwards: the back end further out than the front.
        const outB = 0.18 * sign;
        this.strip(v + side * VERTS, cx, ay, cz, fx, fz, rx, rz, half, armHalfW, outB, Math.min(1.35, s.strength * 1.2) * life);
      }
      // The churned trail: wide and thick at first, dissolving.
      const trailHalfW = 0.4 + age * 0.45;
      this.strip(v + 2 * VERTS, s.x, y, s.z, fx, fz, rx, rz, half * 1.1, trailHalfW, 0, Math.min(1.2, s.strength) * life * life * life);
    }
    this.geometry.setDrawRange(0, live * PARTS * 12);
    for (const name of DYNAMIC) {
      const attribute = this.geometry.getAttribute(name) as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, live * PARTS * VERTS * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }

  /** Write one strip (6 vertices) centred on (cx, y, cz), `half` along the heading and `halfW` across, its back end shifted `outB` across; foam `f` down the middle, none at the edges. */
  private strip(v: number, cx: number, y: number, cz: number, fx: number, fz: number, rx: number, rz: number, half: number, halfW: number, outB: number, f: number): void {
    const p = this.positions;
    const foam = this.foam;
    let o = v * 3;
    for (let end = 0; end < 2; end++) {
      const along = end === 0 ? half : -half;
      const shift = end === 0 ? 0 : outB;
      for (let edge = -1; edge <= 1; edge++) {
        const across = edge * halfW + shift;
        p[o] = cx + fx * along + rx * across;
        p[o + 1] = y;
        p[o + 2] = cz + fz * along + rz * across;
        o += 3;
        foam[v + end * 3 + edge + 1] = edge === 0 ? f : 0;
      }
    }
  }
}
