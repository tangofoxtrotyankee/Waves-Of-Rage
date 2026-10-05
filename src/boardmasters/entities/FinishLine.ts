import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { ATLAS, festivalAtlasShared, finishBannerTexture } from '../engine/Textures';
import { mulberry32 } from '../engine/math';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';
import type { Ocean } from '../world/Ocean';

/**
 * Where the arch stands across the course: its towers just outside the
 * rideable water (PHYSICS.trackHalfWidth is 11), the banner's bottom edge
 * above the biggest jump, its top under the beam.
 */
const TOWER_X = 12.8;
const TOWER_W = 1.5;
const BEAM_Y = 11.2;
const BANNER = { w: 22, h: 5.5, y: 7.75 } as const;
/** The floating stands either side, beyond the towers, with their crowds. */
const PONTOON = { x: 16.6, w: 6, d: 14, h: 0.6 } as const;
/** The chequered strip on the water across the course, metres along (either side of the line) and its cells across. */
const STRIP = { half: 1.0, cells: 24 } as const;
/**
 * Seen from afar: past PROXY metres from the camera the whole line is drawn
 * that much nearer and smaller along the same lines of sight (identical on
 * screen, but inside the camera's 130 m far plane), with its fog scaled to
 * match, so it rises out of the haze from about 150 m. Beyond HIDE metres it
 * is not drawn at all; FOG is its own, much later than the sea's.
 */
const PROXY = 112;
const HIDE = 320;
const FOG = { near: 140, far: 330 } as const;
/** Searchlights from the tower tops: how tall, how wide at the top, and how far they sway (radians). */
const BEAM = { length: 46, base: 0.5, top: 3.4, sway: 0.32 } as const;
/** Fireworks once the surfer is over: bursts, sparks per burst, how long they go on, a burst's life and the sparks' speed and fall. */
const FIREWORKS = { bursts: 10, sparks: 30, seconds: 5.5, life: 1.5, speed: 8, gravity: 5, ahead: 60 } as const;
const FIREWORK_COLORS = [0xffd166, 0x7ff6ff, 0xff4fa3, 0xffffff, 0xff8c42, 0x9bff6a];

/**
 * The searchlights and fireworks use Three's own materials, which convert
 * their colours to sRGB on output; the PS1 materials write display colours
 * as they are. This undoes the conversion so the two agree.
 */
const linear = (c: number): number => c ** 2.2;

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry =>
  colorGeometry(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color).toNonIndexed();

/** A quad facing the riders (down -z), w by h, its bottom centre at (x, y, z), mapped to an atlas region; cut into columns about 2 m wide for the affine warp. */
function facingQuad(w: number, h: number, region: readonly [number, number, number, number], x: number, y: number, z: number, turn = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, Math.max(1, Math.round(w / 2)), 1);
  const uv = g.getAttribute('uv');
  const [u0, v0, u1, v1] = region;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  g.translate(0, h / 2, 0);
  g.rotateY(Math.PI + turn);
  g.translate(x, y, z);
  return colorGeometry(g, 0xffffff);
}

const SHIRTS = [0xff4fa3, 0x7ff6ff, 0xffd166, 0xf8fbff, 0x45cbe6, 0xff8c42, 0x9b5de5, 0xe63946, 0x2d4fd6];
const SKINS = [0xf4a261, 0xc68642, 0x8d5524, 0xffdbac, 0xe0ac69];
const TINTS = [0xffd166, 0x7ff6ff, 0xff4fa3, 0xe63946, 0x9bff6a];

/** Triangles hanging from a sagging line between two points (bunting), coloured in turn; pushed into flat position/colour arrays. */
function bunting(out: number[], colors: number[], a: THREE.Vector3, b: THREE.Vector3, count: number, sag: number, size: number): void {
  for (let i = 0; i < count; i++) {
    const t0 = (i + 0.15) / count;
    const t1 = (i + 0.85) / count;
    const tm = (t0 + t1) / 2;
    const p = (t: number) => new THREE.Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t));
    const p0 = p(t0);
    const p1 = p(t1);
    const tip = p(tm);
    out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, tip.x, tip.y - size, tip.z);
    const c = new THREE.Color(TINTS[i % TINTS.length]);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
}

/**
 * The finish line (entities/FinishLine.ts), at z = the course length, in
 * the pier's festival style: a gantry arch spanning the course (red and
 * white striped towers just outside the rideable water, a gold truss beam
 * with a row of chasing lights, the big chequered FINISH banner, chequered
 * flags on top, pennants along the beam and bunting down to the stands),
 * searchlights sweeping the sky from the tower tops so it shows from far
 * off, floating stands either side with a cheering crowd and the festival's
 * blue wave flags, a chequered strip riding the swell across the line, and
 * fireworks once the surfer is over. update() keeps the floating parts on
 * the water and keeps the arch in view from afar (PROXY).
 */
export class FinishLine {
  /** Everything, in the scene; `arch` is the line itself (drawn nearer and smaller from afar), the fireworks fly over the surfer's way ahead. */
  readonly group = new THREE.Group();
  private readonly arch = new THREE.Group();
  z = 0;
  private readonly materials: THREE.ShaderMaterial[];
  /** The stands (bobbing with the water at their middle), and the two halves of the light row (they chase). */
  private readonly stands: THREE.Group[] = [];
  private readonly lightsA: THREE.Mesh;
  private readonly lightsB: THREE.Mesh;
  private readonly strip: THREE.Mesh;
  private readonly stripHeights: Float32Array;
  private readonly beams: THREE.Mesh;
  /** The fireworks, up while celebrating (tests read whether they show). */
  readonly fireworks: THREE.Points;
  /** Each burst's launch offset (seconds), centre and colour; the sparks' unit directions. */
  private readonly bursts: { at: number; x: number; y: number; z: number; color: THREE.Color }[] = [];
  private readonly sparkDirs: Float32Array;
  /** The run time the celebration started (the surfer over the line), or -Infinity. */
  private celebrateAt = Number.NEGATIVE_INFINITY;

  constructor() {
    const solids = createPS1Material();
    const glow = createPS1Material({ unlit: true, side: THREE.DoubleSide });
    const banner = createPS1Material({ map: finishBannerTexture(), unlit: true, side: THREE.DoubleSide });
    const atlas = createPS1Material({ map: festivalAtlasShared(), unlit: true, side: THREE.DoubleSide });
    this.materials = [solids, glow, banner, atlas];
    for (const m of this.materials) {
      // Its own fog (scaled with the far-away proxy each frame), not the sea's shared one.
      m.uniforms.uFogNear = { value: FOG.near };
      m.uniforms.uFogFar = { value: FOG.far };
    }
    // The strip (in the unlit material) wins against the sea it lies on.
    glow.polygonOffset = true;
    glow.polygonOffsetFactor = -2;
    glow.polygonOffsetUnits = -4;
    // Mostly unlit: the faces the riders see turn away from the low sun ahead, and the arch must stand out against it.
    solids.uniforms.uUnlit.value = 0.6;

    // The arch: striped towers, the gold truss beam, struts to the banner, flag poles.
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const x = side * TOWER_X;
      const towerH = BEAM_Y + 3.5;
      parts.push(box(TOWER_W, towerH, TOWER_W, x, towerH / 2 - 2, 0, 0x22204a));
      for (let k = 0; k < 6; k++) parts.push(box(TOWER_W + 0.08, 0.95, TOWER_W + 0.08, x, 0.2 + k * 1.9, 0, k % 2 === 0 ? 0xe63946 : 0xf8f8f8));
      parts.push(box(TOWER_W + 0.6, 0.45, TOWER_W + 0.6, x, BEAM_Y + 1.3, 0, PALETTE.gold));
      parts.push(box(TOWER_W + 0.9, 0.5, TOWER_W + 0.9, x, -0.1, 0, 0x3a2a50));
      parts.push(box(0.16, 4.2, 0.16, x, BEAM_Y + 3.4, 0, 0xd8d8e8));
      // A gold ball on the pole.
      parts.push(box(0.4, 0.4, 0.4, x, BEAM_Y + 5.6, 0, PALETTE.gold));
    }
    const span = TOWER_X * 2 + TOWER_W;
    parts.push(box(span, 1.5, 1.2, 0, BEAM_Y, 0, 0x2a2858));
    parts.push(box(span, 0.22, 1.28, 0, BEAM_Y + 0.75, 0, PALETTE.gold));
    parts.push(box(span, 0.22, 1.28, 0, BEAM_Y - 0.75, 0, PALETTE.gold));
    // The truss's diagonals on the face the riders see.
    for (let i = 0; i < 14; i++) {
      const x = -span / 2 + 1 + i * ((span - 2) / 13);
      const d = new THREE.BoxGeometry(0.16, 1.5, 0.08).rotateZ(i % 2 === 0 ? 0.7 : -0.7).translate(x, BEAM_Y, -0.62);
      parts.push(colorGeometry(d, PALETTE.gold).toNonIndexed());
    }
    for (const side of [-1, 1]) parts.push(box(0.14, 1.1, 0.14, side * (BANNER.w / 2 - 0.6), BANNER.y + BANNER.h / 2 + 0.25, -0.3, 0x14142a));
    this.arch.add(new THREE.Mesh(mergeGeometries(parts), solids));

    // The banner, facing the riders coming up the course (and readable from behind it too).
    const cloth = new THREE.PlaneGeometry(BANNER.w, BANNER.h, 11, 1);
    cloth.rotateY(Math.PI);
    cloth.translate(0, BANNER.y, -0.7);
    this.arch.add(new THREE.Mesh(colorGeometry(cloth, 0xffffff), banner));

    // Flat, unlit pieces in one pile: chequered flags on the poles, pennants along the beam, bunting down to the stands.
    const flat: number[] = [];
    const flatColors: number[] = [];
    const push = (x: number, y: number, z: number, color: number) => {
      flat.push(x, y, z);
      const c = new THREE.Color(color);
      flatColors.push(c.r, c.g, c.b);
    };
    for (const side of [-1, 1]) {
      // A chequered flag: 6 by 4 cells, flying outwards with a ripple.
      const fw = 4.2;
      const fh = 2.6;
      const top = BEAM_Y + 5.3;
      for (let cy = 0; cy < 4; cy++)
        for (let cx = 0; cx < 6; cx++) {
          const u0 = cx / 6;
          const u1 = (cx + 1) / 6;
          const at = (u: number, v: number): [number, number, number] => [side * (TOWER_X + 0.1 + u * fw), top - v * fh - 0.25 * u, 0.45 * Math.sin(u * 5.5)];
          const color = (cx + cy) % 2 === 0 ? 0xf8f8f8 : 0x14142a;
          const a = at(u0, cy / 4);
          const b = at(u1, cy / 4);
          const c = at(u1, (cy + 1) / 4);
          const d = at(u0, (cy + 1) / 4);
          for (const p of [a, b, c, a, c, d]) push(p[0], p[1], p[2], color);
        }
    }
    const pennants: number[] = [];
    const pennantColors: number[] = [];
    bunting(pennants, pennantColors, new THREE.Vector3(-TOWER_X, BEAM_Y - 0.8, -0.66), new THREE.Vector3(TOWER_X, BEAM_Y - 0.8, -0.66), 16, 0.35, 1.1);
    for (const side of [-1, 1]) {
      bunting(pennants, pennantColors, new THREE.Vector3(side * TOWER_X, BEAM_Y + 1.2, 0), new THREE.Vector3(side * (PONTOON.x + PONTOON.w / 2), 1.2, -PONTOON.d / 2 + 0.5), 10, 1.4, 0.9);
      bunting(pennants, pennantColors, new THREE.Vector3(side * TOWER_X, BEAM_Y + 1.2, 0), new THREE.Vector3(side * (PONTOON.x + PONTOON.w / 2), 1.2, PONTOON.d / 2 - 0.5), 10, 1.4, 0.9);
    }
    for (let i = 0; i < pennants.length; i += 3) flat.push(pennants[i], pennants[i + 1], pennants[i + 2]);
    flatColors.push(...pennantColors);
    const flatGeometry = new THREE.BufferGeometry();
    flatGeometry.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    flatGeometry.setAttribute('color', new THREE.Float32BufferAttribute(flatColors, 3));
    flatGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((flat.length / 3) * 2), 2));
    flatGeometry.computeVertexNormals();
    this.arch.add(new THREE.Mesh(flatGeometry, glow));

    // The row of lights under the beam, in two alternating sets that chase.
    const lamps: THREE.BufferGeometry[][] = [[], []];
    for (let i = 0; i < 20; i++) {
      const x = -TOWER_X + 1.2 + i * ((TOWER_X * 2 - 2.4) / 19);
      lamps[i % 2].push(box(0.5, 0.5, 0.3, x, BEAM_Y - 0.1, -0.78, i % 4 < 2 ? 0xfff3a0 : 0xffffff));
      // And up the towers' inner faces.
      if (i < 10) for (const side of [-1, 1]) lamps[(i + 1) % 2].push(box(0.3, 0.42, 0.42, side * (TOWER_X - TOWER_W / 2 - 0.12), 0.9 + i * 1.0, -0.5, i % 2 === 0 ? 0xff9ad6 : 0x7ff6ff));
    }
    this.lightsA = new THREE.Mesh(mergeGeometries(lamps[0]), glow);
    this.lightsB = new THREE.Mesh(mergeGeometries(lamps[1]), glow);
    this.arch.add(this.lightsA, this.lightsB);

    // The stands: pontoons with a rail, a bleacher of the festival crowd behind, people at the front with arms in the air, and the blue wave flags.
    const rng = mulberry32(11);
    for (const side of [-1, 1]) {
      const stand = new THREE.Group();
      const sp: THREE.BufferGeometry[] = [];
      const top = PONTOON.h / 2;
      sp.push(box(PONTOON.w, PONTOON.h, PONTOON.d, 0, 0, 0, 0x3a2a50));
      sp.push(box(PONTOON.w + 0.1, 0.14, PONTOON.d + 0.1, 0, top, 0, PALETTE.gold));
      sp.push(box(0.12, 0.9, PONTOON.d, -side * (PONTOON.w / 2 - 0.1), top + 0.45, 0, 0xf8f8f8));
      // The bleacher: three steps up away from the course.
      for (let k = 0; k < 3; k++) sp.push(box(1.4, 0.7 + k * 0.7, PONTOON.d - 1, side * (0.9 + k * 1.3), top + (0.7 + k * 0.7) / 2, 0, k % 2 === 0 ? 0x2a1652 : 0x3a2270));
      for (let i = 0; i < 30; i++) {
        const px = side * (-PONTOON.w / 2 + 0.6 + rng() * 1.6);
        const pz = (rng() - 0.5) * (PONTOON.d - 1);
        const shirt = SHIRTS[Math.floor(rng() * SHIRTS.length)];
        const skin = SKINS[Math.floor(rng() * SKINS.length)];
        const h = 1.45 + rng() * 0.35;
        sp.push(box(0.36, h * 0.45, 0.24, px, top + h * 0.22, pz, 0x1a1a2e));
        sp.push(box(0.46, h * 0.36, 0.3, px, top + h * 0.62, pz, shirt));
        sp.push(box(0.26, 0.28, 0.26, px, top + h * 0.92, pz, skin));
        if (rng() < 0.8) {
          sp.push(box(0.1, 0.6, 0.1, px - 0.28, top + h + 0.12, pz, skin));
          if (rng() < 0.6) sp.push(box(0.1, 0.6, 0.1, px + 0.28, top + h + 0.12, pz, skin));
        }
      }
      // Flag poles under the feather flags.
      for (const fz of [-PONTOON.d / 2 + 0.6, PONTOON.d / 2 - 0.6]) sp.push(box(0.14, 9.2, 0.14, side * (PONTOON.w / 2 - 0.4), top + 4.6, fz, 0xd8d8e8));
      stand.add(new THREE.Mesh(mergeGeometries(sp), solids));
      // The festival crowd on the bleacher (turned a little towards the riders), and two feather flags at the stand's outer corners.
      const tex: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 3; k++) tex.push(facingQuad(4.4, 2.2, ATLAS.crowd, side * (0.9 + k * 1.3), top + 0.6 + k * 0.7, -PONTOON.d / 2 + 2 + k * 3.6, side * 0.9));
      for (let k = 0; k < 3; k++) tex.push(facingQuad(4.4, 2.2, ATLAS.crowd, side * (0.9 + k * 1.3), top + 0.6 + k * 0.7, 2.2 + k * 3.4, side * 0.9));
      for (const fz of [-PONTOON.d / 2 + 0.6, PONTOON.d / 2 - 0.6]) tex.push(facingQuad(2.2, 6.8, ATLAS.flag, side * (PONTOON.w / 2 - 0.4), top + 2.2, fz, side * 0.6));
      stand.add(new THREE.Mesh(mergeGeometries(tex), atlas));
      stand.position.set(side * PONTOON.x, 0, 0);
      this.stands.push(stand);
      this.arch.add(stand);
    }

    // The chequered strip on the water: a quad per cell (its own colour), the corners lifted onto the swell each frame.
    const n = STRIP.cells;
    const cellW = (TOWER_X * 2 - TOWER_W) / n;
    const positions = new Float32Array(n * 2 * 4 * 3);
    const colors = new Float32Array(n * 2 * 4 * 3);
    const index: number[] = [];
    const white = new THREE.Color(0xf4f4f4);
    const black = new THREE.Color(0x16162c);
    let v = 0;
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < n; i++) {
        const x0 = -n * cellW * 0.5 + i * cellW;
        const z0 = row === 0 ? -STRIP.half : 0;
        const c = (i + row) % 2 === 0 ? white : black;
        const corners = [[x0, z0], [x0 + cellW, z0], [x0 + cellW, z0 + STRIP.half], [x0, z0 + STRIP.half]];
        for (const [x, z] of corners) {
          positions.set([x, 0, z], v * 3);
          colors.set([c.r, c.g, c.b], v * 3);
          v++;
        }
        const b = v - 4;
        index.push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
    const stripGeometry = new THREE.BufferGeometry();
    stripGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    stripGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    stripGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(v * 2), 2));
    stripGeometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(v * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    stripGeometry.setIndex(index);
    this.strip = new THREE.Mesh(stripGeometry, glow);
    this.strip.frustumCulled = false;
    this.stripHeights = new Float32Array((n + 1) * 3);
    this.arch.add(this.strip);

    // Searchlights: four shafts from the tower tops, warm at the foot fading to nothing (added light), swaying across the sky.
    const beamGeometry = new THREE.BufferGeometry();
    beamGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 12 * 3), 3));
    const beamColors = new Float32Array(4 * 12 * 3);
    for (let b = 0; b < 4; b++)
      for (let k = 0; k < 12; k++) {
        // Per shaft: two crossed quads (6 vertices each, two triangles); vertices 2, 4 and 5 of each quad are at the top.
        const atTop = k % 6 === 2 || k % 6 === 4 || k % 6 === 5;
        // Warm gold from the outer lights, festival cyan from the inner ones; faint, so they colour the sky rather than whiten it.
        const tint = b % 2 === 0 ? [1.0, 0.78, 0.35] : [0.35, 0.9, 1.0];
        const f = atTop ? 0 : 0.42;
        beamColors.set([linear(tint[0] * f), linear(tint[1] * f), linear(tint[2] * f)], (b * 12 + k) * 3);
      }
    beamGeometry.setAttribute('color', new THREE.BufferAttribute(beamColors, 3));
    this.beams = new THREE.Mesh(
      beamGeometry,
      new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 2;
    this.arch.add(this.beams);

    // Fireworks: one cloud of points, the bursts laid out once; positions are worked out each frame while they fly.
    const frng = mulberry32(5);
    for (let i = 0; i < FIREWORKS.bursts; i++) {
      this.bursts.push({
        at: i * (FIREWORKS.seconds - FIREWORKS.life) / (FIREWORKS.bursts - 1) + frng() * 0.2,
        x: (frng() - 0.5) * 22,
        y: 13 + frng() * 10,
        z: (frng() - 0.5) * 16,
        color: (() => {
          const c = new THREE.Color(FIREWORK_COLORS[i % FIREWORK_COLORS.length]);
          return c.setRGB(linear(c.r), linear(c.g), linear(c.b));
        })(),
      });
    }
    const count = FIREWORKS.bursts * FIREWORKS.sparks;
    this.sparkDirs = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = frng() * 2 - 1;
      const a = frng() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * (0.75 + frng() * 0.25);
      this.sparkDirs.set([Math.cos(a) * r, u * (0.75 + frng() * 0.25), Math.sin(a) * r], i * 3);
    }
    const fireGeometry = new THREE.BufferGeometry();
    fireGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    // Colour with alpha (the sparks fade out), drawn over the sky as they are, not added to it (the sunset would wash them white).
    fireGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
    this.fireworks = new THREE.Points(
      fireGeometry,
      new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false }),
    );
    this.fireworks.frustumCulled = false;
    this.fireworks.visible = false;
    this.group.add(this.arch, this.fireworks);
    this.arch.visible = false;
  }

  /** Stand the line at `z` along the course. */
  place(z: number): void {
    this.z = z;
  }

  /** The surfer is over the line (at run time `time`): fireworks. */
  celebrate(time: number): void {
    this.celebrateAt = time;
  }

  /** No fireworks (a new race). */
  calm(): void {
    this.celebrateAt = Number.NEGATIVE_INFINITY;
    this.fireworks.visible = false;
  }

  /**
   * Each frame: hide the line when far away or well behind the camera; else
   * float the stands and the strip on the swell, chase the lights, sway the
   * searchlights, and past PROXY metres draw it nearer and smaller along the
   * camera's lines of sight (with its fog scaled to match) so it shows from
   * afar. Fireworks fly over the way ahead while celebrating.
   */
  update(time: number, ocean: Ocean, camera: THREE.Vector3): void {
    this.updateFireworks(time, camera);
    const ahead = this.z - camera.z;
    if (ahead > HIDE || ahead < -60) {
      this.arch.visible = false;
      return;
    }
    this.arch.visible = true;
    const k = ahead > PROXY ? PROXY / ahead : 1;
    this.arch.position.set(camera.x * (1 - k), camera.y * (1 - k), camera.z + ahead * k);
    this.arch.scale.setScalar(k);
    for (const m of this.materials) {
      m.uniforms.uFogNear.value = FOG.near * k;
      m.uniforms.uFogFar.value = FOG.far * k;
    }
    for (let i = 0; i < this.stands.length; i++) {
      const stand = this.stands[i];
      const x = (i === 0 ? -1 : 1) * PONTOON.x;
      stand.position.y = ocean.height(x, this.z) + 0.05 + 0.04 * Math.sin(time * 2.1 + i);
      stand.rotation.z = 0.03 * Math.sin(time * 1.3 + i * 2);
    }
    const blink = Math.floor(time * 4) % 2 === 0;
    this.lightsA.visible = blink;
    this.lightsB.visible = !blink;
    this.updateBeams(time);
    // The strip's corners on the water: a hair above it (the polygon offset does the rest), under the riders' boards.
    if (ahead < 90) {
      const n = STRIP.cells;
      const cellW = (TOWER_X * 2 - TOWER_W) / n;
      const h = this.stripHeights;
      for (let row = 0; row < 3; row++)
        for (let i = 0; i <= n; i++) h[row * (n + 1) + i] = ocean.height(-n * cellW * 0.5 + i * cellW, this.z - STRIP.half + row * STRIP.half) + 0.03;
      const pos = this.strip.geometry.getAttribute('position') as THREE.BufferAttribute;
      let v = 0;
      for (let row = 0; row < 2; row++)
        for (let i = 0; i < n; i++) {
          pos.setY(v++, h[row * (n + 1) + i]);
          pos.setY(v++, h[row * (n + 1) + i + 1]);
          pos.setY(v++, h[(row + 1) * (n + 1) + i + 1]);
          pos.setY(v++, h[(row + 1) * (n + 1) + i]);
        }
      pos.needsUpdate = true;
    }
  }

  /** The searchlights' shafts: from each tower top, leaning out and swaying, two crossed quads each. */
  private updateBeams(time: number): void {
    const pos = this.beams.geometry.getAttribute('position') as THREE.BufferAttribute;
    let v = 0;
    for (let b = 0; b < 4; b++) {
      const side = b < 2 ? -1 : 1;
      const lean = side * (0.22 + (b % 2) * 0.32) + BEAM.sway * Math.sin(time * (0.55 + b * 0.13) + b * 1.7);
      const back = 0.25 + 0.15 * Math.sin(time * 0.4 + b);
      const fx = side * TOWER_X;
      const fy = BEAM_Y + 1.6;
      const tx = fx + Math.sin(lean) * BEAM.length;
      const ty = fy + Math.cos(lean) * BEAM.length;
      const tz = back * BEAM.length * 0.5;
      // Two quads: one spread across x (in the lean's plane, turned), one across z.
      for (const across of [0, 1]) {
        const bx = across === 0 ? Math.cos(lean) : 0;
        const by = across === 0 ? -Math.sin(lean) : 0;
        const bz = across === 0 ? 0 : 1;
        const corner = (top: boolean, s: number): [number, number, number] => {
          const w = (top ? BEAM.top : BEAM.base) * s;
          return top ? [tx + bx * w, ty + by * w, tz + bz * w] : [fx + bx * w, fy + by * w, bz * w];
        };
        const a = corner(false, -1);
        const c = corner(false, 1);
        const d = corner(true, 1);
        const e = corner(true, -1);
        // Order matches the colours: vertices 2, 4 and 5 of the six are at the top.
        for (const p of [a, c, d, a, d, e]) pos.setXYZ(v++, p[0], p[1], p[2]);
      }
    }
    pos.needsUpdate = true;
  }

  /** The fireworks: each burst throws its sparks out from its centre, falling and fading, high over the way ahead of the camera. */
  private updateFireworks(time: number, camera: THREE.Vector3): void {
    const t = time - this.celebrateAt;
    if (!(t >= 0 && t < FIREWORKS.seconds + 0.5)) {
      this.fireworks.visible = false;
      return;
    }
    this.fireworks.visible = true;
    this.fireworks.position.set(camera.x * 0.3, 0, Math.max(this.z, camera.z + FIREWORKS.ahead));
    const pos = this.fireworks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.fireworks.geometry.getAttribute('color') as THREE.BufferAttribute;
    const dirs = this.sparkDirs;
    let i = 0;
    for (const burst of this.bursts) {
      const age = t - burst.at;
      const live = age >= 0 && age < FIREWORKS.life;
      // Bright as it bursts, then fading, with a twinkle.
      const fade = live ? Math.min(1, 1.6 * Math.max(0, 1 - age / FIREWORKS.life)) : 0;
      const reach = FIREWORKS.speed * (1 - Math.exp(-age * 2.4)) / 2.4;
      const fall = 0.5 * FIREWORKS.gravity * age * age;
      for (let s = 0; s < FIREWORKS.sparks; s++, i++) {
        if (!live) {
          pos.setXYZ(i, 0, -1000, 0);
          col.setXYZW(i, 0, 0, 0, 0);
          continue;
        }
        pos.setXYZ(i, burst.x + dirs[i * 3] * reach, burst.y + dirs[i * 3 + 1] * reach - fall, burst.z + dirs[i * 3 + 2] * reach);
        // White-hot as it bursts, then its colour, twinkling and fading.
        const tw = (s + Math.floor(time * 20)) % 5 === 0 ? 0.35 : 1;
        const hot = age < 0.12 ? 1 - age / 0.12 : 0;
        const c = burst.color;
        col.setXYZW(i, c.r + (1 - c.r) * hot, c.g + (1 - c.g) * hot, c.b + (1 - c.b) * hot, fade * tw);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}
