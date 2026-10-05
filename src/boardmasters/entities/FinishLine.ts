import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material } from '../engine/PS1Material';
import { mulberry32 } from '../engine/math';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';
import type { Ocean } from '../world/Ocean';

/**
 * Where the arch stands across the course: its towers just outside the
 * rideable water (PHYSICS.trackHalfWidth is 11), the banner's bottom edge
 * well above any jump and the chase camera.
 */
const TOWER_X = 12.6;
const TOWER_W = 1.2;
const BEAM_Y = 9.6;
const BANNER = { w: 20, h: 3.6, y: 7.0 } as const;
/** The floating stands either side, beyond the towers, with their crowds. */
const PONTOON = { x: 15.6, w: 5.2, d: 12, h: 0.6 } as const;
/** The chequered strip on the water across the course, metres along (either side of the line) and its cells across. */
const STRIP = { half: 0.9, cells: 24 } as const;
/**
 * Seen from afar: past PROXY metres from the camera the whole line is drawn
 * that much nearer and smaller along the same lines of sight (identical on
 * screen, but inside the camera's 130 m far plane), with its fog scaled to
 * match, so it rises out of the haze from about 150 m. Beyond HIDE metres it
 * is not drawn at all; FOG is its own, much later than the sea's.
 */
const PROXY = 112;
const HIDE = 300;
const FOG = { near: 125, far: 280 } as const;

/** A canvas texture with crisp pixels. */
function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/** Five by seven pixel letters for the banner. */
const LETTERS: Record<string, string[]> = {
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
};

/** The banner: chequered top and bottom rows round a red band with FINISH in white (outlined dark). */
function bannerTexture(): THREE.CanvasTexture {
  return canvasTexture(96, 24, (ctx) => {
    for (let x = 0; x < 96; x += 4)
      for (const y of [0, 20]) {
        ctx.fillStyle = (x / 4 + y / 20) % 2 === 0 ? '#f8f8f8' : '#14142a';
        ctx.fillRect(x, y, 4, 4);
      }
    ctx.fillStyle = '#d61f3c';
    ctx.fillRect(0, 4, 96, 16);
    ctx.fillStyle = '#ff5a6e';
    ctx.fillRect(0, 4, 96, 1);
    const word = 'FINISH';
    const scale = 2;
    const left = Math.round((96 - (word.length * 6 - 1) * scale) / 2);
    const top = 5;
    // A dark drop shadow, then the white letters.
    for (const [dx, color] of [[1, '#2a0a18'], [0, '#ffffff']] as const)
      for (let i = 0; i < word.length; i++) {
        const glyph = LETTERS[word[i]];
        ctx.fillStyle = color;
        for (let gy = 0; gy < 7; gy++)
          for (let gx = 0; gx < 5; gx++) if (glyph[gy][gx] === '#') ctx.fillRect(left + (i * 6 + gx) * scale + dx, top + gy * scale + dx, scale, scale);
      }
  });
}

/** A chequered flag cloth, 4x4 checks. */
function checkerTexture(): THREE.CanvasTexture {
  return canvasTexture(16, 16, (ctx) => {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f8f8f8' : '#14142a';
        ctx.fillRect(x * 4, y * 4, 4, 4);
      }
  });
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry =>
  colorGeometry(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color).toNonIndexed();

const SHIRTS = [0xff4fa3, 0x7ff6ff, 0xffd166, 0xf8fbff, 0x45cbe6, 0xff8c42, 0x9b5de5, 0xe63946, 0x2d4fd6];
const SKINS = [0xf4a261, 0xc68642, 0x8d5524, 0xffdbac, 0xe0ac69];

/**
 * The finish line (entities/FinishLine.ts), at z = the course length: a
 * gantry arch spanning the course (striped towers just outside the
 * rideable water, a truss beam with a row of lights, the chequered FINISH
 * banner, chequered flags on top and pennants along the beam), floating
 * stands either side packed with a cheering crowd, and a chequered strip
 * riding the swell on the water across the line. Plain blocks in the
 * world's materials; update() keeps the floating parts on the water and
 * keeps the arch in view from afar (PROXY).
 */
export class FinishLine {
  readonly group = new THREE.Group();
  z = 0;
  private readonly solids: THREE.ShaderMaterial;
  private readonly glow: THREE.ShaderMaterial;
  private readonly banner: THREE.ShaderMaterial;
  private readonly flag: THREE.ShaderMaterial;
  private readonly materials: THREE.ShaderMaterial[];
  /** The stands (bobbing with the water at their middle), and the two halves of the light row (they chase). */
  private readonly stands: THREE.Group[] = [];
  private readonly lightsA: THREE.Mesh;
  private readonly lightsB: THREE.Mesh;
  private readonly strip: THREE.Mesh;
  private readonly stripHeights: Float32Array;

  constructor() {
    this.solids = createPS1Material();
    this.glow = createPS1Material({ unlit: true, side: THREE.DoubleSide });
    this.banner = createPS1Material({ map: bannerTexture(), unlit: true, side: THREE.DoubleSide });
    this.flag = createPS1Material({ map: checkerTexture(), unlit: true, side: THREE.DoubleSide });
    this.materials = [this.solids, this.glow, this.banner, this.flag];
    for (const m of this.materials) {
      // Its own fog (scaled with the far-away proxy each frame), not the sea's shared one.
      m.uniforms.uFogNear = { value: FOG.near };
      m.uniforms.uFogFar = { value: FOG.far };
    }
    // The strip (in the unlit material) wins against the sea it lies on.
    this.glow.polygonOffset = true;
    this.glow.polygonOffsetFactor = -2;
    this.glow.polygonOffsetUnits = -4;
    // Partly unlit like the shore: the faces the riders see turn away from the low sun ahead.
    this.solids.uniforms.uUnlit.value = 0.35;

    // The arch.
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const x = side * TOWER_X;
      parts.push(box(TOWER_W, BEAM_Y + 3, TOWER_W, x, (BEAM_Y + 3) / 2 - 2, 0, 0x22204a));
      // Red and white bands up the tower, on its inner and front faces.
      for (let k = 0; k < 5; k++) parts.push(box(TOWER_W + 0.06, 0.55, TOWER_W + 0.06, x, 0.6 + k * 1.9, 0, k % 2 === 0 ? 0xe63946 : 0xf8f8f8));
      parts.push(box(TOWER_W + 0.5, 0.4, TOWER_W + 0.5, x, BEAM_Y + 1.05, 0, PALETTE.gold));
      // The flag pole on top.
      parts.push(box(0.14, 3.2, 0.14, x, BEAM_Y + 2.6, 0, 0xd8d8e8));
    }
    parts.push(box(TOWER_X * 2 + TOWER_W, 1.3, 1.1, 0, BEAM_Y, 0, 0x2a2858));
    parts.push(box(TOWER_X * 2 + TOWER_W, 0.18, 1.16, 0, BEAM_Y + 0.66, 0, PALETTE.gold));
    parts.push(box(TOWER_X * 2 + TOWER_W, 0.18, 1.16, 0, BEAM_Y - 0.66, 0, PALETTE.gold));
    // Struts from the beam down to the banner's top corners.
    for (const side of [-1, 1]) parts.push(box(0.12, 1.2, 0.12, side * (BANNER.w / 2 - 0.5), BANNER.y + BANNER.h / 2 + 0.45, 0, 0x14142a));
    this.group.add(new THREE.Mesh(mergeGeometries(parts), this.solids));

    // The banner, facing the riders coming up the course (and readable from behind it too).
    const banner = new THREE.PlaneGeometry(BANNER.w, BANNER.h, 6, 1);
    banner.rotateY(Math.PI);
    banner.translate(0, BANNER.y, -0.62);
    this.group.add(new THREE.Mesh(colorGeometry(banner, 0xffffff), this.banner));

    // Chequered flags flying off the pole tops, and pennants hanging along the beam.
    const flags: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const f = new THREE.PlaneGeometry(2.4, 1.5, 2, 1);
      f.translate(-side * 1.2, BEAM_Y + 3.4, 0);
      // A little wave in the cloth.
      const pos = f.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.25 * Math.sin(pos.getX(i) * 2.2));
      f.translate(side * TOWER_X, 0, 0);
      flags.push(colorGeometry(f, 0xffffff));
    }
    this.group.add(new THREE.Mesh(mergeGeometries(flags), this.flag));
    const pennants: number[] = [];
    const pennantColors: number[] = [];
    const tints = [0xffd166, 0x7ff6ff, 0xff4fa3, 0xe63946];
    for (let i = 0; i < 13; i++) {
      const x = -TOWER_X + 1.2 + i * ((TOWER_X * 2 - 2.4) / 12);
      const y = BEAM_Y - 0.7;
      pennants.push(x - 0.45, y, -0.6, x + 0.45, y, -0.6, x, y - 1.0, -0.6);
      const c = new THREE.Color(tints[i % tints.length]);
      for (let k = 0; k < 3; k++) pennantColors.push(c.r, c.g, c.b);
    }
    const pennantGeometry = new THREE.BufferGeometry();
    pennantGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pennants, 3));
    pennantGeometry.setAttribute('color', new THREE.Float32BufferAttribute(pennantColors, 3));
    pennantGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pennants.length / 3) * 2), 2));
    pennantGeometry.computeVertexNormals();
    this.group.add(new THREE.Mesh(pennantGeometry, this.glow));

    // The row of lights under the beam, in two alternating sets that chase.
    const lamps: THREE.BufferGeometry[][] = [[], []];
    for (let i = 0; i < 16; i++) {
      const x = -TOWER_X + 1.1 + i * ((TOWER_X * 2 - 2.2) / 15);
      lamps[i % 2].push(box(0.42, 0.42, 0.3, x, BEAM_Y - 0.15, -0.7, i % 4 < 2 ? 0xfff3a0 : 0xffffff));
    }
    this.lightsA = new THREE.Mesh(mergeGeometries(lamps[0]), this.glow);
    this.lightsB = new THREE.Mesh(mergeGeometries(lamps[1]), this.glow);
    this.group.add(this.lightsA, this.lightsB);

    // The stands: pontoons with a rail and a crowd facing the course, arms in the air.
    const rng = mulberry32(11);
    for (const side of [-1, 1]) {
      const stand = new THREE.Group();
      const sp: THREE.BufferGeometry[] = [];
      sp.push(box(PONTOON.w, PONTOON.h, PONTOON.d, 0, 0, 0, 0x3a2a50));
      sp.push(box(PONTOON.w + 0.1, 0.12, PONTOON.d + 0.1, 0, PONTOON.h / 2, 0, PALETTE.gold));
      sp.push(box(0.12, 0.9, PONTOON.d, -side * (PONTOON.w / 2 - 0.1), PONTOON.h / 2 + 0.45, 0, 0xf8f8f8));
      for (let i = 0; i < 26; i++) {
        const px = side * ((rng() - 0.5) * (PONTOON.w - 1.2));
        const pz = (rng() - 0.5) * (PONTOON.d - 1);
        const shirt = SHIRTS[Math.floor(rng() * SHIRTS.length)];
        const skin = SKINS[Math.floor(rng() * SKINS.length)];
        const h = 1.45 + rng() * 0.35;
        const top = PONTOON.h / 2;
        sp.push(box(0.36, h * 0.45, 0.24, px, top + h * 0.22, pz, 0x1a1a2e));
        sp.push(box(0.46, h * 0.36, 0.3, px, top + h * 0.62, pz, shirt));
        sp.push(box(0.26, 0.28, 0.26, px, top + h * 0.92, pz, skin));
        if (rng() < 0.7) {
          const arm = rng() < 0.5 ? -1 : 1;
          sp.push(box(0.1, 0.55, 0.1, px + arm * 0.3, top + h + 0.1, pz, skin));
        }
      }
      stand.add(new THREE.Mesh(mergeGeometries(sp), this.solids));
      stand.position.set(side * PONTOON.x, 0, 0);
      this.stands.push(stand);
      this.group.add(stand);
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
    this.strip = new THREE.Mesh(stripGeometry, this.glow);
    this.strip.frustumCulled = false;
    this.stripHeights = new Float32Array((n + 1) * 3);
    this.group.add(this.strip);
    this.group.visible = false;
  }

  /** Stand the line at `z` along the course. */
  place(z: number): void {
    this.z = z;
  }

  /**
   * Each frame: hide the line when far away or well behind the camera; else
   * float the stands and the strip on the swell, chase the lights, and past
   * PROXY metres draw it nearer and smaller along the camera's lines of
   * sight (with its fog scaled to match) so it shows from afar.
   */
  update(time: number, ocean: Ocean, camera: THREE.Vector3): void {
    const ahead = this.z - camera.z;
    if (ahead > HIDE || ahead < -60) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const k = ahead > PROXY ? PROXY / ahead : 1;
    this.group.position.set(camera.x * (1 - k), camera.y * (1 - k), camera.z + ahead * k);
    this.group.scale.setScalar(k);
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
}
