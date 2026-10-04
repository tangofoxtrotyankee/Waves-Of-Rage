import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { createPS1Material } from '../engine/PS1Material';
import { clamp, mixRgb, mulberry32, rgb, smoothstep } from '../engine/math';
import { ATLAS, festivalAtlas, waterfallTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { CAMERA, PALETTE } from '../game/constants';

type Rgb = [number, number, number];
type Kind = 'solid' | 'glow' | 'atlas' | 'falls';
const KINDS: readonly Kind[] = ['solid', 'glow', 'atlas', 'falls'];

/** Metres of coastline built at once; two copies leapfrog ahead of the camera so it never ends. */
const SPAN = 1200;
/** Each span is merged in chunks this long, so the camera's frustum drops what is out of range. */
const CHUNK = 100;
const CHUNKS = SPAN / CHUNK;
/** How far a chunk's parts can reach beyond its stretch of coast (a cliff stack's length, a stage). */
const CHUNK_SPILL = 25;
/** The cliffs rise at world +x (screen-left), their foot this far from the centre line. */
const CLIFF_X = 20;
/** The pier runs along world -x (screen-right): its centre line, width, deck height and extent along each span. */
const PIER = { x: -23.5, width: 16, deck: 3.3, start: 40, end: 470 } as const;
/** Festival stages on the pier, metres into the span. */
const STAGES = [118, 345] as const;
/** Fog for the shore: later than the sea's, so the cliffs and the pier stay vivid, fading out by the camera's far plane (130 m). */
const SHORE_FOG = { near: 45, far: 128 } as const;
/** Spans start with the waterfall the mockup shows, just ahead of the start line. */
const FIRST_FALLS_Z = 95;

const C = {
  cliffDeep: rgb(0x2a1450),
  cliff: rgb(PALETTE.cliff),
  cliffLit: rgb(PALETTE.cliffLit),
  rim: rgb(PALETTE.cliffRim),
  rock: rgb(PALETTE.rock),
  sand: rgb(PALETTE.sand),
  wetSand: rgb(0xb07050),
  palm: rgb(PALETTE.palm),
  palmLit: rgb(PALETTE.palmLit),
  trunk: rgb(0x6a4228),
  wood: rgb(PALETTE.wood),
  darkWood: rgb(0x4a2a1e),
  outline: rgb(PALETTE.outline),
} as const;

const HOUSE_WALLS = [0xf0d8c0, 0xe8a8b8, 0xd8b080, 0xc8b8e8, 0xf4c890].map(rgb);
const ROOFS = [0x9a3a3a, 0x4a2a5e, 0xb0583a, 0x2e3a7a].map(rgb);
const WINDOWS = [0xffc45a, 0xffe08a, 0xff9a4a].map(rgb);
const BULBS = [0xffe08a, 0xff8fb0, 0x8ff6ff, 0xffc45a, 0xffffff].map(rgb);
const SHIRTS = [0xff4fa3, 0x7ff6ff, 0xffd166, 0xf8fbff, 0x45cbe6, 0xff8c42, 0x9b5de5, 0xe63946, 0x2d4fd6].map(rgb);
const SKINS = [0xf4a261, 0xc68642, 0x8d5524, 0xffdbac, 0xe0ac69].map(rgb);
const TENTS: [Rgb, Rgb][] = [
  [rgb(0xe63946), rgb(0xf8fbff)],
  [rgb(0x2d4fd6), rgb(0xf8fbff)],
  [rgb(0xe63946), rgb(0x2d4fd6)],
];

/** Non-indexed, flat normals (faceted under Gouraud), and every attribute the merge needs. */
function finish(g: THREE.BufferGeometry, paint: (x: number, y: number, z: number, nx: number, ny: number, nz: number, i: number) => Rgb): THREE.BufferGeometry {
  const geometry = g.index ? g.toNonIndexed() : g;
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!geometry.getAttribute('uv')) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(position.count * 2), 2));
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const c = paint(position.getX(i), position.getY(i), position.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i), i);
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

const solid = (g: THREE.BufferGeometry, c: Rgb) => finish(g, () => c);

/** A geometry from raw triangles (x, y, z triples) with one colour per vertex. */
function triangles(points: number[], colors: Rgb[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return finish(g, (_x, _y, _z, _nx, _ny, _nz, i) => colors[i % colors.length]);
}

/**
 * Collects parts by material and by chunk along the span, then merges each
 * pile into one geometry.
 */
class Builder {
  private readonly piles = new Map<string, THREE.BufferGeometry[]>();

  add(kind: Kind, z: number, g: THREE.BufferGeometry): void {
    const chunk = clamp(Math.floor(z / CHUNK), 0, CHUNKS - 1);
    const key = `${kind}:${chunk}`;
    let pile = this.piles.get(key);
    if (!pile) this.piles.set(key, (pile = []));
    pile.push(g);
  }

  box(kind: Kind, w: number, h: number, d: number, x: number, y: number, z: number, color: Rgb, ry = 0): void {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.add(kind, z, solid(g, color));
  }

  /** A square post, sides only (no caps): pilings, poles, truss towers. */
  post(kind: Kind, w: number, h: number, x: number, y: number, z: number, color: Rgb): void {
    const g = new THREE.CylinderGeometry(w * 0.7071, w * 0.7071, h, 4, 1, true);
    g.rotateY(Math.PI / 4);
    g.translate(x, y, z);
    this.add(kind, z, solid(g, color));
  }

  merged(): { kind: Kind; chunk: number; geometry: THREE.BufferGeometry }[] {
    const out: { kind: Kind; chunk: number; geometry: THREE.BufferGeometry }[] = [];
    for (const kind of KINDS) {
      for (let chunk = 0; chunk < CHUNKS; chunk++) {
        const pile = this.piles.get(`${kind}:${chunk}`);
        if (!pile || pile.length === 0) continue;
        const geometry = mergeGeometries(pile);
        for (const g of pile) g.dispose();
        geometry.computeBoundingSphere();
        out.push({ kind, chunk, geometry });
      }
    }
    return out;
  }
}

/** A quad facing direction `ry` (0 faces +z... rotated about y), w by h, its bottom centre at (x, y, z), mapped to an atlas region. */
function atlasQuad(w: number, h: number, region: readonly [number, number, number, number], x: number, y: number, z: number, ry: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.getAttribute('uv');
  const [u0, v0, u1, v1] = region;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  g.translate(0, h / 2, 0);
  g.rotateY(ry);
  g.translate(x, y, z);
  return finish(g, () => [1, 1, 1]);
}

/** Lit things drawn with the unlit (double-sided) material take this much of their colour, so they sit with the lit ones. */
const SHADE = 0.82;
const shade = (c: Rgb, k = SHADE): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** A palm: a curved, tapering trunk and drooping two-tone fronds (double-sided, so in the unlit pile). About 34 triangles. */
function palm(b: Builder, x: number, y: number, z: number, rng: () => number, scale = 1): void {
  const height = (6 + rng() * 4) * scale;
  const leanX = (rng() - 0.5) * 3 * scale;
  const leanZ = (rng() - 0.5) * 2 * scale;
  const trunk = new THREE.CylinderGeometry(0.2 * scale, 0.36 * scale, height, 3, 2, true);
  const pos = trunk.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + height / 2) / height;
    pos.setXYZ(i, pos.getX(i) + leanX * t * t + x, pos.getY(i) + height / 2 + y, pos.getZ(i) + leanZ * t * t + z);
  }
  b.add('solid', z, finish(trunk, (_x, py) => mixRgb(C.trunk, rgb(0xa06a40), Math.sin((py - y) * 3) * 0.5 + 0.5)));
  const tx = x + leanX;
  const ty = y + height;
  const tz = z + leanZ;
  const points: number[] = [];
  const colors: Rgb[] = [];
  const dark = shade(C.palm);
  const lit = shade(C.palmLit);
  const fronds = 6;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rng() * 0.6;
    const len = (3 + rng() * 1.4) * scale;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // Base, a raised and widest middle, a drooping tip.
    const at = (along: number, lift: number, half: number): [number, number, number] => [tx + ca * along - sa * half, ty + lift, tz + sa * along + ca * half];
    const b0 = at(0, 0, -0.1 * scale);
    const b1 = at(0, 0, 0.1 * scale);
    const m0 = at(len * 0.5, len * 0.18, -0.6 * scale);
    const m1 = at(len * 0.5, len * 0.18, 0.6 * scale);
    const tip = at(len, -len * 0.42, 0);
    points.push(...b0, ...b1, ...m1, ...b0, ...m1, ...m0, ...m0, ...m1, ...tip);
    colors.push(dark, dark, lit, dark, lit, lit, lit, lit, dark);
  }
  b.add('glow', z, triangles(points, colors));
}

/** Little string lights: a sagging line of bulbs (crossed quads, unlit) from a to b. */
function stringLights(b: Builder, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number, rng: () => number): void {
  const length = Math.hypot(bx - ax, by - ay, bz - az);
  const n = Math.max(2, Math.floor(length / 2));
  const points: number[] = [];
  const colors: Rgb[] = [];
  const s = 0.17;
  const offset = Math.floor(rng() * BULBS.length);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t - sag * 4 * t * (1 - t);
    const z = az + (bz - az) * t;
    points.push(x - s, y - s, z, x + s, y - s, z, x, y + s, z, x, y - s, z - s, x, y - s, z + s, x, y + s, z);
    const c = BULBS[(i + offset) % BULBS.length];
    for (let k = 0; k < 6; k++) colors.push(c);
  }
  b.add('glow', (az + bz) / 2, triangles(points, colors));
}

/** A person facing the course: a shirt-and-legs quad and a head, turned by `ry`. Four triangles. */
function person(points: number[], colors: Rgb[], x: number, y: number, z: number, ry: number, rng: () => number): void {
  const h = 1.5 + rng() * 0.3;
  const w = 0.24;
  const cx = Math.cos(ry);
  const sx = Math.sin(ry);
  const at = (u: number, v: number): [number, number, number] => [x + cx * u, y + v, z - sx * u];
  const shirt = shade(SHIRTS[Math.floor(rng() * SHIRTS.length)], 0.9);
  const skin = shade(SKINS[Math.floor(rng() * SKINS.length)]);
  const legs: Rgb = rng() < 0.5 ? skin : C.outline;
  const top = h - 0.34;
  points.push(...at(-w, 0), ...at(w, 0), ...at(w, top), ...at(-w, 0), ...at(w, top), ...at(-w, top));
  colors.push(legs, legs, shirt, legs, shirt, shirt);
  const hw = 0.15;
  points.push(...at(-hw, top), ...at(hw, top), ...at(hw, h), ...at(-hw, top), ...at(hw, h), ...at(-hw, h));
  colors.push(skin, skin, skin, skin, skin, skin);
  if (rng() < 0.3) {
    // An arm in the air.
    const side = rng() < 0.5 ? -1 : 1;
    points.push(...at(side * w, top - 0.3), ...at(side * (w + 0.12), top - 0.25), ...at(side * (w + 0.2), h + 0.35));
    colors.push(skin, skin, skin);
  }
}

/** A crowd of `count` people scattered over a rectangle (centre x, z; half sizes), standing at height y, facing direction ry. */
function crowd(b: Builder, x: number, y: number, z: number, hx: number, hz: number, count: number, ry: number, rng: () => number): void {
  const points: number[] = [];
  const colors: Rgb[] = [];
  for (let i = 0; i < count; i++) person(points, colors, x + (rng() * 2 - 1) * hx, y, z + (rng() * 2 - 1) * hz, ry + (rng() - 0.5) * 0.5, rng);
  b.add('glow', z, triangles(points, colors));
}

/** A tent: a box body and a four-sided pointed roof striped in two colours. */
function tent(b: Builder, x: number, y: number, z: number, size: number, colors: [Rgb, Rgb]): void {
  const body = new THREE.BoxGeometry(size, size * 0.55, size);
  body.translate(x, y + size * 0.275, z);
  b.add('solid', z, solid(body, mixRgb(colors[1], [1, 1, 1], 0.4)));
  const roof = new THREE.ConeGeometry(size * 0.78, size * 0.6, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(x, y + size * 0.55 + size * 0.3, z);
  b.add('solid', z, finish(roof, (_x, _y, _z, nx, _ny, nz) => (Math.abs(nx) > Math.abs(nz) ? colors[0] : colors[1])));
}

/** A house on a ledge: walls, a hipped roof and warm lit windows on the sides facing the course (`side` -1 or 1 is the shore's side) and the camera. */
function house(b: Builder, side: number, x: number, y: number, z: number, rng: () => number): void {
  const w = 2.4 + rng() * 1.6;
  const h = 2 + rng() * 1.6;
  const d = 2.4 + rng() * 1.6;
  const wall = HOUSE_WALLS[Math.floor(rng() * HOUSE_WALLS.length)];
  const body = new THREE.BoxGeometry(w, h, d);
  body.translate(x, y + h / 2, z);
  b.add('solid', z, solid(body, wall));
  const roof = new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.2 + rng() * 0.6, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(w / Math.max(w, d), 1, d / Math.max(w, d));
  roof.translate(x, y + h + 0.6, z);
  b.add('solid', z, solid(roof, ROOFS[Math.floor(rng() * ROOFS.length)]));
  const win = WINDOWS[Math.floor(rng() * WINDOWS.length)];
  const faceX = x - side * (w / 2 + 0.05);
  for (let i = 0; i < 2; i++) {
    const wz = z + (i - 0.5) * d * 0.45;
    if (rng() < 0.85) b.add('glow', z, solid(new THREE.PlaneGeometry(0.5, 0.6).rotateY(Math.PI / 2).translate(faceX, y + h * 0.55, wz), win));
    const wx = x + (i - 0.5) * w * 0.45;
    if (rng() < 0.85) b.add('glow', z, solid(new THREE.PlaneGeometry(0.5, 0.6).translate(wx, y + h * 0.55, z - d / 2 - 0.05), win));
  }
}

interface Ledge {
  /** Distance of the ledge's front edge from the centre line, its height, centre z and length along z, and its depth back to the next layer. */
  u: number;
  y: number;
  z: number;
  length: number;
  depth: number;
}

/**
 * A stretch of cliff: irregular prisms stacked in strata, each a little set
 * back (a ledge) or now and then jutting out (an overhang), dark purple at
 * the foot of each stratum to lilac at its lip with a warm sunset rim on the
 * faces towards the course and the sun. `side` 1 builds at +x (screen-left),
 * -1 at -x; `u0` is the foot's distance from the centre line.
 */
function cliffStack(b: Builder, side: number, u0: number, z: number, rng: () => number, layers: number, scale = 1): { ledges: Ledge[]; top: Ledge } {
  const ledges: Ledge[] = [];
  let u = u0;
  let y = -5;
  let top: Ledge = { u, y, z, length: 0, depth: 0 };
  for (let i = 0; i < layers; i++) {
    const h = ((i === 0 ? 10 : 6) + rng() * 7) * scale;
    const depth = (16 + rng() * 14) * scale;
    const length = (24 + rng() * 16) * scale;
    const zc = z + (rng() - 0.5) * 6;
    const sides = 6 + Math.floor(rng() * 2);
    const taper = 0.86 + rng() * 0.22; // over 1 is an overhang
    const prism = new THREE.CylinderGeometry(taper, 1, h, sides, 1, false);
    // Drop the bottom cap (groups: sides, top, bottom); nobody sees under a cliff.
    const keep = prism.groups[1].start + prism.groups[1].count;
    prism.setIndex(Array.from(prism.getIndex()!.array).slice(0, keep));
    prism.clearGroups();
    prism.rotateY(rng() * Math.PI);
    prism.scale(depth / 2, 1, length / 2);
    prism.translate(side * (u + depth / 2), y + h / 2, zc);
    // Knock the vertices about (by position, so shared corners stay shared).
    const pos = prism.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const px = pos.getX(k);
      const py = pos.getY(k);
      const pz = pos.getZ(k);
      const hash = Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719) * 43758.5453;
      const r = hash - Math.floor(hash);
      pos.setXYZ(k, px + (r - 0.5) * 2.2, py + (r - 0.5) * 1.2 * (py > y + h / 2 ? 1 : 0), pz + (Math.sin(hash) * 0.5) * 2);
    }
    const band = clamp(i / Math.max(1, layers - 1), 0, 1);
    const foot = mixRgb(C.cliffDeep, C.cliff, band * 0.7);
    const lip = mixRgb(C.cliff, C.cliffLit, 0.4 + band * 0.6);
    const yBottom = y;
    b.add(
      'solid',
      zc,
      finish(prism, (_x, py, _z, nx, ny, nz) => {
        const t = clamp((py - yBottom) / h, 0, 1);
        let c = mixRgb(foot, lip, smoothstep(0.05, 1, t));
        // Warm rim: on the upper part of faces turned towards the course or the camera, and on the ledge tops.
        const facing = Math.max(-nx * side, -nz * 0.8, 0);
        c = mixRgb(c, C.rim, smoothstep(0.55, 1, t) * facing * 0.65 + (ny > 0.7 ? 0.25 : 0));
        return c;
      }),
    );
    const step = i === 0 ? 2 + rng() * 5 : rng() < 0.2 ? -1.5 : 1.5 + rng() * 5;
    y += h;
    if (i < layers - 1) ledges.push({ u, y, z: zc, length, depth: step });
    top = { u, y, z: zc, length, depth };
    u += step;
  }
  return { ledges, top };
}

/** A waterfall down the cliff face from `top` metres into the sea, with mist where it lands. */
function waterfall(b: Builder, u: number, top: number, z: number, rng: () => number): void {
  const width = 3 + rng() * 2.5;
  const x = u - 0.6;
  const ry = -Math.PI / 2 - 0.75; // facing the course and the camera coming up the coast
  const g = new THREE.PlaneGeometry(width, top + 1, 1, 3);
  const pos = g.getAttribute('position');
  const uv = g.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + (top + 1) / 2) / (top + 1);
    // Narrower at the lip, spreading as it falls.
    pos.setX(i, pos.getX(i) * (0.65 + (1 - t) * 0.5));
    uv.setXY(i, uv.getX(i) * (width / 4), uv.getY(i) * ((top + 1) / 5));
  }
  g.translate(0, (top + 1) / 2 - 1, 0);
  g.rotateY(ry);
  g.translate(x, 0, z);
  b.add('falls', z, finish(g, (_x, py) => mixRgb([1, 1, 1], [0.8, 0.9, 1], clamp(py / top, 0, 1) * 0.3)));
  // Mist: pale blobs where it hits the water.
  for (let i = 0; i < 4; i++) {
    const r = 1.4 + rng() * 1.6;
    const blob = new THREE.IcosahedronGeometry(r, 0);
    blob.scale(1.3, 0.75, 1.1);
    blob.translate(x - 1 - rng() * 2.5, 0.6 + rng() * 1.6 + i * 0.4, z + (rng() - 0.5) * width * 1.4);
    b.add('glow', z, finish(blob, (_x, _y, _z, _nx, ny) => mixRgb(rgb(0xd8f0ff), [1, 1, 1], clamp(ny, 0, 1))));
  }
}

/**
 * The world beside the course, after the mockup: towering stratified cliffs
 * at +x (screen-left) with villages of lit houses and string lights on their
 * ledges, palms, waterfalls with mist and a sand and rock strip at the
 * water's edge; at -x (screen-right) a long festival pier on pilings with a
 * dense crowd, red, blue and white tents, feather flags with the wave logo,
 * string lights and two stages with light rigs under a big BOARDMASTERS
 * banner, then a beach with palms and lower hills behind. Built once,
 * merged per material (lit, glowing, the festival atlas, the scrolling
 * falls) and per 100 m chunk, and shared by two spans that leapfrog ahead
 * of the camera, so the endless course always has a shore.
 */
export class Scenery {
  readonly group = new THREE.Group();
  private readonly spans: THREE.Group[] = [];
  /** Every chunk mesh with its span and where its stretch of coast starts within the span. */
  private readonly chunks: { span: THREE.Group; mesh: THREE.Mesh; start: number }[] = [];
  private readonly falls: THREE.ShaderMaterial;

  constructor() {
    const rng = mulberry32(5);
    const b = new Builder();
    this.buildCliffs(b, rng);
    this.buildPier(b, rng);
    this.buildBeach(b, rng);
    this.falls = createPS1Material({ map: waterfallTexture(), unlit: true, side: THREE.DoubleSide });
    const materials: Record<Kind, THREE.ShaderMaterial> = {
      solid: createPS1Material(),
      glow: createPS1Material({ unlit: true, side: THREE.DoubleSide }),
      atlas: createPS1Material({ map: festivalAtlas(), unlit: true, side: THREE.DoubleSide }),
      falls: this.falls,
    };
    // The shore keeps its colour further out than the sea: its own fog runs out to the camera's far plane.
    for (const material of Object.values(materials)) {
      material.uniforms.uFogNear = { value: SHORE_FOG.near };
      material.uniforms.uFogFar = { value: SHORE_FOG.far };
    }
    const merged = b.merged();
    for (let copy = 0; copy < 2; copy++) {
      const span = new THREE.Group();
      for (const { kind, chunk, geometry } of merged) {
        const mesh = new THREE.Mesh(geometry, materials[kind]);
        // Culled by the stretch of coast in range below; the bounding spheres are too wide (cliffs to hills) to drop much.
        mesh.frustumCulled = false;
        span.add(mesh);
        this.chunks.push({ span, mesh, start: chunk * CHUNK });
      }
      span.position.z = copy * SPAN;
      this.spans.push(span);
      this.group.add(span);
    }
  }

  /** Cliffs all along +x, with their villages, lights, palms and waterfalls, and the sand and rocks at their foot. */
  private buildCliffs(b: Builder, rng: () => number): void {
    let fallsDue = FIRST_FALLS_Z;
    for (let z = -10; z < SPAN + 10; z += 18 + rng() * 12) {
      const u0 = CLIFF_X + rng() * 4;
      const layers = 4 + Math.floor(rng() * 3);
      const { ledges, top } = cliffStack(b, 1, u0, z, rng, layers);
      // A second, taller wall behind, for depth.
      if (rng() < 0.4) cliffStack(b, 1, top.u + 8 + rng() * 10, z + (rng() - 0.5) * 10, rng, 3 + Math.floor(rng() * 2), 1.2);
      for (const ledge of ledges) {
        if (ledge.depth >= 3 && rng() < 0.38) {
          // A village: a row of houses near the lip, string lights in front of them.
          const n = 2 + Math.floor(rng() * 2);
          for (let i = 0; i < n; i++) house(b, 1, ledge.u + 1.6 + rng() * Math.min(3, ledge.depth - 2.5), ledge.y - 0.4, ledge.z + ((i + 0.5) / n - 0.5) * ledge.length * 0.6, rng);
          stringLights(b, ledge.u + 0.6, ledge.y + 2.4, ledge.z - ledge.length * 0.32, ledge.u + 0.6, ledge.y + 2.4, ledge.z + ledge.length * 0.32, 0.9, rng);
        } else if (ledge.depth >= 2 && rng() < 0.6) {
          palm(b, ledge.u + 1 + rng() * (ledge.depth - 1), ledge.y - 0.3, ledge.z + (rng() - 0.5) * ledge.length * 0.4, rng, 0.8);
        }
      }
      // Palms on the top.
      for (let i = 0; i < 1 + Math.floor(rng() * 2); i++) palm(b, top.u + 1.5 + rng() * 5, top.y - 0.4, top.z + (rng() - 0.5) * top.length * 0.5, rng);
      if (z >= fallsDue && ledges.length > 1) {
        const ledge = ledges[Math.min(ledges.length - 1, 1 + Math.floor(rng() * (ledges.length - 1)))];
        waterfall(b, u0, ledge.y, ledge.z - ledge.length * 0.1, rng);
        fallsDue = z + 150 + rng() * 140;
      }
    }
    // Sand and rocks at the waterline, palms and lamp posts with string lights on the sand.
    for (let z = -10; z < SPAN + 10; z += 30) {
      for (let k = 0; k < 2; k++) {
        // Ragged pieces of beach, so the waterline is not one straight edge.
        const sand = new THREE.BoxGeometry(8 + rng() * 4, 3, 15.6);
        sand.rotateZ(0.1 + rng() * 0.06); // low at the water, rising to the cliffs
        sand.rotateY((rng() - 0.5) * 0.16);
        sand.translate(CLIFF_X - 1 + rng() * 1.5, -0.35 + rng() * 0.3, z + 7.5 + k * 15);
        b.add('solid', z + 7.5 + k * 15, finish(sand, (px, py) => mixRgb(C.wetSand, C.sand, clamp((px - CLIFF_X + 3) / 4 + (py > 0.8 ? 0.3 : 0), 0, 1))));
      }
      for (let i = 0; i < 2; i++) {
        const r = 0.8 + rng() * 1.6;
        const rock = new THREE.OctahedronGeometry(r, 0);
        rock.scale(1, 0.7, 1.2);
        rock.translate(CLIFF_X - 2 + rng() * 3, 0.5, z + rng() * 30);
        b.add('solid', z, finish(rock, (_x, _y, _z, _nx, ny) => mixRgb(C.rock, C.cliffLit, clamp(ny, 0, 1) * 0.5)));
      }
      if (rng() < 0.7) palm(b, CLIFF_X + rng() * 2, 1.4, z + rng() * 30, rng, 0.9);
      // Lamp posts every 30 m with lights strung between them.
      b.post('solid', 0.15, 4, CLIFF_X - 0.5, 2.6, z, C.darkWood);
      stringLights(b, CLIFF_X - 0.5, 4.5, z, CLIFF_X - 0.5, 4.5, z + 30, 0.8, rng);
    }
  }

  /** The festival pier along -x: pilings, deck, rail, bleachers packed with people, tents, flags, string lights and two stages. */
  private buildPier(b: Builder, rng: () => number): void {
    const { x: px, width, deck, start, end } = PIER;
    const inner = px + width / 2; // the course-facing edge (the less negative x)
    const outer = px - width / 2;
    const stageAt = (z: number) => STAGES.some((s) => Math.abs(z - s) < 13);
    for (let z = start; z < end; z += 6) {
      const bent = (z - start) % 12 === 0; // a full bent of three pilings and a cross beam every 12 m
      for (const x of bent ? [inner - 0.4, px, outer + 0.4] : [inner - 0.4, outer + 0.4]) b.post('solid', 0.55, 9, x, deck - 4.5, z, C.darkWood);
      if (bent) b.box('solid', width, 0.4, 0.4, px, deck - 0.6, z, C.darkWood);
      b.post('solid', 0.14, 1.1, inner - 0.2, deck + 0.75, z, C.darkWood); // rail post
    }
    for (let z = start; z < end; z += 30) {
      const len = Math.min(30, end - z);
      b.box('solid', width, 0.45, len, px, deck, z + len / 2, C.wood);
      b.box('solid', 0.12, 0.12, len, inner - 0.2, deck + 1.3, z + len / 2, C.darkWood);
      b.box('solid', 0.2, 0.7, len, inner + 0.05, deck - 0.1, z + len / 2, rgb(0x2a1652)); // fascia
    }
    // String lights on poles along the rail.
    for (let z = start; z + 12 <= end; z += 12) {
      b.post('solid', 0.16, 6, inner - 0.3, deck + 3, z, C.outline);
      stringLights(b, inner - 0.3, deck + 5.8, z, inner - 0.3, deck + 5.8, z + 12, 1.1, rng);
    }
    // The crowd: three ranks on stepped bleachers behind the rail, as atlas strips turned a little towards the camera; people at the rail.
    for (let z = start + 2; z < end - 2; z += 4) {
      if (stageAt(z)) continue;
      for (let rank = 0; rank < 3; rank++) {
        const x = inner - 1.6 - rank * 2.2;
        const y = deck + 0.2 + rank * 0.9;
        b.add('atlas', z, atlasQuad(4.1, 2.2, ATLAS.crowd, x, y, z, Math.PI / 2 + 0.45));
      }
      if (rng() < 0.8) crowd(b, inner - 0.7, deck + 0.2, z, 0.3, 1.8, 3, Math.PI / 2 + 0.4, rng);
    }
    // The bleachers' risers, in 12 m runs.
    for (let z = start; z + 12 <= end; z += 12) {
      if (stageAt(z + 1) || stageAt(z + 6) || stageAt(z + 11)) continue;
      for (let rank = 1; rank < 3; rank++) b.box('solid', 2.2, rank * 0.9, 12, inner - 1.6 - rank * 2.2, deck + 0.2 + (rank * 0.9) / 2, z + 6, C.darkWood);
    }
    // Tents behind the bleachers, flags along the rail.
    let t = 0;
    for (let z = start + 8; z < end - 6; z += 13 + rng() * 6) {
      if (stageAt(z)) continue;
      tent(b, outer + 2.8, deck + 0.2, z, 3.4 + rng() * 0.8, TENTS[t++ % TENTS.length]);
    }
    for (let z = start + 6; z < end; z += 22) {
      if (stageAt(z)) continue;
      b.post('solid', 0.12, 9, inner - 0.5, deck + 4.5, z, C.outline);
      b.add('atlas', z, atlasQuad(1.5, 4.6, ATLAS.flag, inner - 1.3, deck + 4.2, z, Math.PI / 2 + 0.6));
    }
    for (const s of STAGES) this.buildStage(b, s, rng);
  }

  /** A festival stage on the pier: platform, truss towers, light rigs, the banner, speakers and tall flags behind. */
  private buildStage(b: Builder, z: number, rng: () => number): void {
    const { x: px, width, deck } = PIER;
    const inner = px + width / 2;
    const floor = deck + 0.2;
    b.box('solid', width - 2, 1.2, 22, px - 1, floor + 0.6, z, rgb(0x2a1840));
    b.box('solid', 0.4, 12, 22, px - width / 2 + 1.2, floor + 7, z, rgb(0x3a2066)); // backdrop
    const top = floor + 15;
    for (const tz of [z - 11, z + 11]) {
      for (const tx of [inner - 0.8, px - width / 2 + 1]) b.post('solid', 0.5, top - floor, tx, floor + (top - floor) / 2, tz, rgb(0x8a8aa0));
      b.box('solid', width - 1, 0.5, 0.5, px, top, tz, rgb(0x8a8aa0));
    }
    for (const tx of [inner - 0.8, px - width / 2 + 1]) b.box('solid', 0.5, 0.5, 22.5, tx, top, z, rgb(0x8a8aa0));
    // Light rigs along the front truss.
    for (let i = 0; i < 14; i++) {
      const lz = z - 10 + (i / 13) * 20;
      b.box('glow', 0.5, 0.45, 0.45, inner - 0.8, top - 0.5, lz, BULBS[i % BULBS.length]);
    }
    // The banner across the front, turned towards the riders coming up the course; speakers either side.
    b.add('atlas', z, atlasQuad(24, 6, ATLAS.banner, inner - 0.2, floor + 7.5, z, Math.PI / 2 + 0.5));
    for (const sz of [z - 13, z + 13]) {
      b.box('solid', 2, 4.5, 2, inner - 1.8, floor + 2.25, sz, C.outline);
      b.box('glow', 0.1, 0.5, 1.4, inner - 0.75, floor + 3.6, sz, rgb(0xff4fa3));
    }
    // Tall feather flags behind the stage, and the crowd packed in front of it.
    for (let i = 0; i < 3; i++) {
      const fz = z - 9 + i * 9;
      b.post('solid', 0.18, 22, px - width / 2 - 1, floor + 11, fz, C.outline);
      b.add('atlas', fz, atlasQuad(2.2, 6.8, ATLAS.flag, px - width / 2 - 2.2, floor + 14.5, fz, Math.PI / 2 + 0.6));
    }
    crowd(b, inner - 1, floor, z, 0.6, 10, 26, Math.PI / 2 + 0.3, rng);
    stringLights(b, inner - 0.5, top - 1, z - 11, inner - 0.5, top - 1, z + 11, 2.5, rng);
  }

  /** The -x shore beyond the pier: sand, palms, tents, beachgoers and lights, with lower hills and a few lit houses behind. */
  private buildBeach(b: Builder, rng: () => number): void {
    for (let z = -10; z < SPAN + 10; z += 30) {
      const sand = new THREE.BoxGeometry(60, 4, 31);
      sand.rotateZ(-0.06); // rising inland
      sand.translate(-51, -1, z + 15);
      b.add('solid', z + 15, finish(sand, (px, py) => mixRgb(C.wetSand, C.sand, clamp((-px - 19) / 4 + (py > 0.5 ? 0.3 : 0), 0, 1))));
      for (let k = 0; k < 2; k++) {
        const front = new THREE.BoxGeometry(6 + rng() * 3, 3, 15.6);
        front.rotateZ(-0.1 - rng() * 0.05);
        front.rotateY((rng() - 0.5) * 0.16);
        front.translate(-22 - rng() * 1.5, -0.6 + rng() * 0.3, z + 7.5 + k * 15);
        b.add('solid', z + 7.5 + k * 15, finish(front, (px, py) => mixRgb(C.wetSand, C.sand, clamp((-px - 19) / 4 + (py > 0.5 ? 0.3 : 0), 0, 1))));
      }
      const onPier = z + 30 > PIER.start && z < PIER.end;
      // Palms, sparser behind the pier.
      for (let i = 0; i < (onPier ? 2 : 3); i++) palm(b, -(onPier ? 33 : 20) - rng() * 18, 1.0, z + rng() * 30, rng, 0.9 + rng() * 0.3);
      if (!onPier) {
        if (rng() < 0.6) tent(b, -23 - rng() * 8, 0.8, z + rng() * 30, 3 + rng(), TENTS[Math.floor(rng() * TENTS.length)]);
        crowd(b, -21 - rng() * 4, 0.7, z + 15, 2.5, 13, 10 + Math.floor(rng() * 14), Math.PI / 2 + 0.3, rng);
        b.post('solid', 0.15, 4, -19.5, 2.2, z, C.darkWood);
        stringLights(b, -19.5, 4.1, z, -19.5, 4.1, z + 30, 0.8, rng);
      }
    }
    // Hills behind, lower than the cliffs, with a few houses lit up.
    for (let z = -10; z < SPAN + 10; z += 34 + rng() * 18) {
      const { ledges, top } = cliffStack(b, -1, 50 + rng() * 14, z, rng, 2 + Math.floor(rng() * 2), 0.9);
      for (const ledge of ledges) if (ledge.depth >= 3 && rng() < 0.35) house(b, -1, -(ledge.u + 2), ledge.y - 0.4, ledge.z, rng);
      if (rng() < 0.7) palm(b, -(top.u + 3), top.y - 0.4, top.z, rng);
    }
  }

  update(cameraZ: number): void {
    for (const span of this.spans) if (span.position.z + SPAN < cameraZ - 60) span.position.z += SPAN * 2;
    // Only the coast from the camera to the far plane is drawn (the camera looks down +z; parts reach CHUNK_SPILL past their chunk).
    for (const c of this.chunks) {
      const start = c.span.position.z + c.start;
      c.mesh.visible = start - CHUNK_SPILL < cameraZ + CAMERA.far && start + CHUNK + CHUNK_SPILL > cameraZ;
    }
    // The waterfalls pour: the texture scrolls down (scenery has no clock of its own, so the page's).
    (this.falls.uniforms.uUvOffset.value as THREE.Vector2).set(0, (performance.now() / 1000) * 0.9);
  }
}
