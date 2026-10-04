import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material, paintGeometry, skyColorAt } from '../engine/PS1Material';
import { clamp, mixRgb, mulberry32, rgb, smoothstep } from '../engine/math';
import { THREE } from '../engine/three';
import { CAMERA, FOG, PALETTE, SUN } from '../game/constants';

type Rgb = [number, number, number];

/**
 * Distances from the camera. The dome, the sun and the clouds sit just inside
 * the far plane, behind everything in the world, and are drawn after it, so
 * only the pixels the world leaves uncovered are shaded (the depth test
 * rejects the rest). The mountains sit nearer, are drawn first and write
 * depth, so the far end of the shore and the sea disappears behind them
 * rather than showing as fogged shapes in front of them.
 */
const DOME_R = CAMERA.far * 0.995;
const CLOUD_R = CAMERA.far * 0.94;
const RIDGES = [0.89, 0.86, 0.83].map((k) => CAMERA.far * k);
/** Drawn after the opaque world (which is at the default 0, the sea and the foam on it at up to 1). */
const AFTER_WORLD = 10;

/** Spherical point at `distance` from the origin: azimuth 0 is dead ahead (+z), positive towards +x (screen-left). */
function onSphere(azimuth: number, elevation: number, distance: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(azimuth) * Math.cos(elevation) * distance);
}

/**
 * The dome: rows packed where the sky's colour changes fastest (the glow band
 * just above the horizon) and columns packed round the sun, so the elevation
 * ramp and the sun's glow halo are painted in with few vertices (about 900
 * triangles). It stops a little below the horizon: the sea and the clear
 * colour (the fog's) cover the rest.
 */
function dome(): THREE.BufferGeometry {
  const rows = [-11, -3, 0, 1.2, 2.9, 4.5, 6.5, 8.6, 12, 17, 24, 33, 45, 60, 75, 89.9].map((d) => (d * Math.PI) / 180);
  const columns = 34;
  const sunDir = new THREE.Vector3(...SUN.dir).normalize();
  const glowNear = rgb(0xfff0b0);
  const glowFar = rgb(PALETTE.horizon);
  const positions: number[] = [];
  const colors: number[] = [];
  const p = new THREE.Vector3();
  const vertex = (a: number, e: number) => {
    onSphere(a, e, DOME_R, p);
    positions.push(p.x, p.y, p.z);
    const angle = Math.acos(clamp(p.dot(sunDir) / DOME_R, -1, 1));
    const glow = 0.55 * Math.pow(1 - smoothstep(0, 0.65, angle), 1.6) + 0.25 * (1 - smoothstep(0.08, 0.3, angle));
    colors.push(...mixRgb(skyColorAt(Math.sin(e)), mixRgb(glowFar, glowNear, 1 - smoothstep(0.1, 0.45, angle)), glow));
  };
  // Columns warped towards azimuth 0 (the sun): about 2 degrees apart there, 25 behind the camera.
  const azimuth = (i: number) => {
    const u = (i / columns) * 2 - 1;
    return Math.PI * Math.sign(u) * Math.pow(Math.abs(u), 1.7);
  };
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < columns; c++) {
      const a0 = azimuth(c);
      const a1 = azimuth(c + 1);
      const e0 = rows[r];
      const e1 = rows[r + 1];
      // Seen from inside: wind so the faces point at the centre (BackSide not needed).
      vertex(a0, e0);
      vertex(a0, e1);
      vertex(a1, e0);
      vertex(a1, e0);
      vertex(a0, e1);
      vertex(a1, e1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  return g;
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
    { distance: RIDGES[0], base: mixRgb(rgb(PALETTE.mountainFar), fog, 0.6), top: mixRgb(rgb(PALETTE.mountainFar), fog, 0.15), rise: 0.16, jag: 0.012, steps: 64 },
    { distance: RIDGES[1], base: mixRgb(rgb(PALETTE.mountain), fog, 0.5), top: mixRgb(rgb(PALETTE.mountainFar), rgb(PALETTE.mountain), 0.5), rise: 0.12, jag: 0.014, steps: 56 },
    { distance: RIDGES[2], base: mixRgb(rgb(PALETTE.island), fog, 0.4), top: rgb(PALETTE.mountain), rise: 0.075, jag: 0.012, steps: 48 },
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
        const bottom = -0.03;
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
          // The foot (below the horizon, where a high camera sees past the end of the sea) dissolves into the haze.
          let c = qe === bottom ? fog : mixRgb(layer.base, layer.top, smoothstep(0, 0.9, t));
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
 * A heavy sunset cloud deck: long flattened bands at many heights, merged
 * into one mesh. Low bands burn gold and orange round the sun; higher up
 * they are lit pink and orange from below with purple tops, long enough to
 * cross the top of the frame; the highest are dark purple streaks.
 */
function clouds(): THREE.BufferGeometry {
  const rng = mulberry32(17);
  const parts: THREE.BufferGeometry[] = [];
  const p = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4();
  const gold = rgb(PALETTE.cloudLit);
  const orange = rgb(PALETTE.cloud);
  const pink = rgb(0xff4f8f);
  const red = rgb(0x9a2a5a);
  const purple = rgb(PALETTE.cloudDark);
  const deep = rgb(0x2a0e44);
  const scale = CLOUD_R / 86; // the bands were laid out on an 86 m sphere
  for (let i = 0; i < 46; i++) {
    const elevation = 0.04 + Math.pow(rng(), 0.8) * 0.5;
    // Low bands crowd round the sun; higher ones spread across the whole view.
    const high = smoothstep(0.06, 0.45, elevation);
    const azimuth = (rng() - 0.5) * (0.9 + high * 1.6);
    const blobs = 2 + Math.floor(rng() * 3);
    const length = (18 + rng() * 26 + high * (12 + rng() * 24)) * scale;
    // Underside and top colours by height in the sky: gold and orange low down, pink under purple higher up.
    const under: Rgb = high < 0.4 ? mixRgb(gold, orange, high / 0.4) : mixRgb(orange, pink, (high - 0.4) / 0.6);
    const top: Rgb = high < 0.5 ? mixRgb(red, purple, high * 2) : mixRgb(purple, deep, (high - 0.5) * 2);
    const thick = (0.35 + rng() * 0.25) * (1 - high * 0.35);
    const pieces: THREE.BufferGeometry[] = [];
    for (let b = 0; b < blobs; b++) {
      const r = (3 + rng() * 4) * scale;
      const blob = new THREE.SphereGeometry(r, 5, 2);
      blob.scale((length / (blobs * r)) * 1.4, thick, 0.25);
      blob.translate(((b + 0.5) / blobs - 0.5) * length, (rng() - 0.5) * 1.2 * scale, 0);
      const h = r * thick;
      pieces.push(paintGeometry(blob, (_x, y) => mixRgb(under, top, clamp((y + h) / (2 * h) - 0.1, 0, 1))));
    }
    const cloud = mergeGeometries(pieces.map((g) => g.toNonIndexed()));
    onSphere(azimuth, elevation, CLOUD_R, p);
    m.lookAt(p, centre.set(0, p.y, 0), up);
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
 * blend into it at every elevation, with the sun's glow halo painted in; the
 * sun dead ahead (SUN.dir, which the sea's glitter path also uses) with
 * slowly turning rays; a deck of sunset clouds lit from below; and distant
 * mountains closing the bay at the vanishing point. Five draw calls.
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
    this.dome = new THREE.Mesh(dome(), createPS1Material({ unlit: true, fog: false, side: THREE.DoubleSide, depthWrite: false }));
    this.dome.renderOrder = AFTER_WORLD + 2; // last: only where the world, the clouds and the sun leave sky showing
    this.group.add(this.dome);

    // The sun: slowly turning rays and the disc, sized for a 92 m distance and scaled out to SUN.distance.
    this.sun = new THREE.Group();
    this.sun.scale.setScalar(SUN.distance / 92);
    const disc = new THREE.Mesh(colorGeometry(new THREE.CircleGeometry(11, 14), PALETTE.sun), createPS1Material({ unlit: true, fog: false }));
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
    // The rays are blended, so drawn with the transparent things after everything opaque (behind the clouds and the world).
    this.rays = new THREE.Mesh(mergeGeometries(rayParts), createPS1Material({ unlit: true, fog: false, depthWrite: false, opacity: 0.16, side: THREE.DoubleSide }));
    this.rays.position.z = -1;
    this.rays.renderOrder = -3;
    disc.renderOrder = AFTER_WORLD + 1;
    this.sun.add(this.rays, disc);
    this.group.add(this.sun);

    this.clouds = new THREE.Mesh(clouds(), createPS1Material({ unlit: true, fog: false, flat: 0.12, side: THREE.DoubleSide }));
    this.clouds.renderOrder = AFTER_WORLD; // nearer than the sun and writing depth, so they streak across it
    this.group.add(this.clouds);

    // The mountains go first and write depth: anything of the world beyond them stays hidden behind them.
    this.mountains = new THREE.Mesh(mountains(), createPS1Material({ unlit: true, fog: false, side: THREE.DoubleSide, flat: 0.08 }));
    this.mountains.renderOrder = -1;
    this.group.add(this.mountains);
    for (const child of [this.dome, this.sun, this.rays, disc, this.clouds, this.mountains]) child.frustumCulled = false;
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
