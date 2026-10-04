import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material, paintGeometry, skyColorAt } from '../engine/PS1Material';
import { clamp, mixRgb, mulberry32, rgb, smoothstep } from '../engine/math';
import { THREE } from '../engine/three';
import { FOG, PALETTE, SUN } from '../game/constants';

type Rgb = [number, number, number];

/** Spherical point at `distance` from the origin: azimuth 0 is dead ahead (+z), positive towards +x (screen-left). */
function onSphere(azimuth: number, elevation: number, distance: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(azimuth) * Math.cos(elevation) * distance);
}

/**
 * Distant mountains: three ridgelines that fall towards the sun, so the bay
 * closes in a V at the vanishing point. Each is a strip of triangles from
 * below the horizon to a jagged crest; the far ridges are paler and hazier
 * (blended towards the fog), the near ones darker purple with a warm rim on
 * the crest.
 */
function mountains(): THREE.BufferGeometry {
  const rng = mulberry32(31);
  const fog = rgb(FOG.color);
  const layers: { distance: number; base: Rgb; top: Rgb; rise: number; jag: number; steps: number }[] = [
    { distance: 97, base: mixRgb(rgb(PALETTE.mountainFar), fog, 0.6), top: mixRgb(rgb(PALETTE.mountainFar), fog, 0.15), rise: 0.16, jag: 0.012, steps: 64 },
    { distance: 94, base: mixRgb(rgb(PALETTE.mountain), fog, 0.5), top: mixRgb(rgb(PALETTE.mountainFar), rgb(PALETTE.mountain), 0.5), rise: 0.12, jag: 0.014, steps: 56 },
    { distance: 91, base: mixRgb(rgb(PALETTE.island), fog, 0.4), top: rgb(PALETTE.mountain), rise: 0.075, jag: 0.012, steps: 48 },
  ];
  const rim = rgb(PALETTE.cliffRim);
  const parts: THREE.BufferGeometry[] = [];
  const p = new THREE.Vector3();
  for (const [li, layer] of layers.entries()) {
    const positions: number[] = [];
    const colors: number[] = [];
    const span = 1.45; // radians either side of dead ahead
    let prevA = -span;
    let prevE = 0;
    for (let i = 0; i <= layer.steps; i++) {
      const a = -span + (i / layer.steps) * span * 2;
      const side = Math.abs(a);
      // The V: low beside the sun, climbing steeply to each side, with ragged peaks.
      const climb = Math.pow(Math.min(1, side / 0.3), 0.8) + 0.3 * Math.max(0, side - 0.3);
      const peaks = Math.pow(Math.abs(Math.sin(a * (7 + li * 3) + li * 1.3)), 3);
      const e = 0.008 + layer.rise * climb * (0.7 + 0.3 * peaks) + layer.jag * (rng() - 0.3) * Math.min(1, side * 4);
      if (i > 0) {
        const bottom = -0.06;
        const quad: [number, number][] = [
          [prevA, bottom],
          [a, bottom],
          [a, e],
          [prevA, bottom],
          [a, e],
          [prevA, prevE],
        ];
        for (const [qa, qe] of quad) {
          onSphere(qa, qe, layer.distance, p);
          positions.push(p.x, p.y, p.z);
          const t = clamp((qe - bottom) / (layer.rise + 0.05), 0, 1);
          let c = mixRgb(layer.base, layer.top, smoothstep(0, 0.9, t));
          if (qe !== bottom && i % 3 === 0) c = mixRgb(c, rim, 0.3);
          colors.push(...c);
        }
      }
      prevA = a;
      prevE = e;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length).fill(0), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((positions.length / 3) * 2).fill(0), 2));
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/**
 * Sunset clouds: long flattened bands at several heights, merged into one
 * mesh. Low bands burn orange and gold; higher ones are lit pink from below
 * with purple tops; the highest are dark purple streaks.
 */
function clouds(): THREE.BufferGeometry {
  const rng = mulberry32(17);
  const parts: THREE.BufferGeometry[] = [];
  const p = new THREE.Vector3();
  const gold = rgb(PALETTE.cloudLit);
  const orange = rgb(PALETTE.cloud);
  const pink = rgb(0xff4f8f);
  const red = rgb(0x9a2a5a);
  const purple = rgb(PALETTE.cloudDark);
  const deep = rgb(0x2a0e44);
  for (let i = 0; i < 34; i++) {
    const elevation = 0.06 + Math.pow(rng(), 1.1) * 0.48;
    const azimuth = (rng() - 0.5) * Math.PI * 0.95;
    const high = smoothstep(0.08, 0.45, elevation);
    const blobs = 3 + Math.floor(rng() * 4);
    const length = 14 + rng() * 26 * (1 - high * 0.4);
    // Underside and top colours by height in the sky.
    const under: Rgb = high < 0.4 ? mixRgb(gold, orange, high / 0.4) : mixRgb(orange, pink, (high - 0.4) / 0.6);
    const top: Rgb = high < 0.5 ? mixRgb(red, purple, high * 2) : mixRgb(purple, deep, (high - 0.5) * 2);
    const pieces: THREE.BufferGeometry[] = [];
    for (let b = 0; b < blobs; b++) {
      const r = 3 + rng() * 4;
      const blob = new THREE.SphereGeometry(r, 6, 3);
      blob.scale(length / (blobs * r) * 1.4, 0.32 + rng() * 0.15, 0.6);
      blob.translate(((b + 0.5) / blobs - 0.5) * length, (rng() - 0.5) * 1.2, (rng() - 0.5) * 3);
      const h = r * 0.4;
      pieces.push(paintGeometry(blob, (_x, y) => mixRgb(under, top, clamp((y + h) / (2 * h) - 0.15, 0, 1))));
    }
    const cloud = mergeGeometries(pieces.map((g) => g.toNonIndexed()));
    onSphere(azimuth, elevation, 86, p);
    const m = new THREE.Matrix4().lookAt(p, new THREE.Vector3(0, p.y, 0), new THREE.Vector3(0, 1, 0));
    m.setPosition(p);
    cloud.applyMatrix4(m);
    parts.push(cloud);
  }
  return mergeGeometries(parts);
}

/**
 * The sunset: a vertex-coloured dome that follows the camera, painted with
 * the same elevation ramp the shader's fog uses (fog orange at and below
 * the horizon, a yellow glow, orange, purple overhead) so fogged things
 * blend into it at every elevation; the sun dead ahead (SUN.dir, which the
 * sea's glitter path also uses) with a glow halo and slowly turning rays;
 * banded sunset clouds lit from below; and distant mountains closing the bay
 * at the vanishing point. Six draw calls.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly sun: THREE.Group;
  private readonly rays: THREE.Mesh;
  private readonly clouds: THREE.Mesh;
  private readonly mountains: THREE.Mesh;
  private readonly sunOffset = new THREE.Vector3(...SUN.dir).normalize().multiplyScalar(SUN.distance);

  constructor() {
    // Enough latitude rows (48 over 180 degrees) for the narrow glow band above the horizon to exist.
    const domeGeometry = paintGeometry(new THREE.SphereGeometry(100, 16, 48), (_x, y) => skyColorAt(y / 100));
    this.dome = new THREE.Mesh(domeGeometry, createPS1Material({ unlit: true, fog: false, side: THREE.BackSide, depthWrite: false }));
    this.dome.renderOrder = -4;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // The sun: a glow halo (stacked translucent discs), slowly turning rays, the disc.
    this.sun = new THREE.Group();
    const disc = new THREE.Mesh(colorGeometry(new THREE.CircleGeometry(11, 14), PALETTE.sun), createPS1Material({ unlit: true, fog: false, depthWrite: false }));
    const haloParts = [34, 24, 16.5].map((r, i) => colorGeometry(new THREE.CircleGeometry(r, 16).translate(0, 0, -0.1 * (3 - i)), i === 2 ? 0xfff0b0 : PALETTE.horizon));
    const halo = new THREE.Mesh(mergeGeometries(haloParts), createPS1Material({ unlit: true, fog: false, depthWrite: false, opacity: 0.14 }));
    const rayParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const ray = new THREE.BufferGeometry();
      // A thin wedge: narrow at the disc, wider at the tip.
      ray.setAttribute('position', new THREE.Float32BufferAttribute([-1, 12, 0, 1, 12, 0, 4.5, 85, 0, -1, 12, 0, 4.5, 85, 0, -4.5, 85, 0], 3));
      ray.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(0), 3));
      ray.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
      ray.rotateZ((i / 9) * Math.PI * 2 + (i % 2) * 0.2);
      rayParts.push(colorGeometry(ray, PALETTE.sun));
    }
    this.rays = new THREE.Mesh(mergeGeometries(rayParts), createPS1Material({ unlit: true, fog: false, depthWrite: false, opacity: 0.16, side: THREE.DoubleSide }));
    this.rays.renderOrder = -3;
    halo.renderOrder = -3;
    disc.renderOrder = -2;
    this.sun.add(this.rays, halo, disc);
    this.group.add(this.sun);

    this.clouds = new THREE.Mesh(clouds(), createPS1Material({ unlit: true, fog: false, depthWrite: false, flat: 0.12, side: THREE.DoubleSide }));
    this.clouds.renderOrder = -1.5; // after the disc, so they streak across the sun
    this.group.add(this.clouds);

    // Mountains write depth so the world drawn after them sorts against them like anything else at that distance.
    this.mountains = new THREE.Mesh(mountains(), createPS1Material({ unlit: true, fog: false, side: THREE.DoubleSide, flat: 0.08 }));
    this.mountains.renderOrder = -1;
    this.group.add(this.mountains);
    for (const child of [this.sun, this.rays, halo, disc, this.clouds, this.mountains]) child.frustumCulled = false;
  }

  update(camera: THREE.Camera, time: number): void {
    this.dome.position.copy(camera.position);
    this.clouds.position.copy(camera.position);
    this.clouds.rotation.y = Math.sin(time * 0.01) * 0.04;
    this.mountains.position.copy(camera.position);
    this.mountains.position.y = 0;
    this.sun.position.copy(camera.position).add(this.sunOffset);
    this.sun.lookAt(camera.position);
    this.rays.rotation.z = time * 0.06;
  }
}
