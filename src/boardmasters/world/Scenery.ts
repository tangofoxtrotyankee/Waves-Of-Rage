import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { colorGeometry, createPS1Material, paintGeometry } from '../engine/PS1Material';
import { mixRgb, mulberry32, rgb } from '../engine/math';
import { bannerTexture, crowdTexture, flagTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { PALETTE } from '../game/constants';

/** Metres of coastline built at once; two copies leapfrog ahead of the camera so it never ends. */
const SPAN = 1200;
/** The pier sits beside the course, this far across (world +x, which is screen-left). */
const PIER_X = 20;

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return colorGeometry(g, color);
}

/** A palm: a leaning trunk and five fronds, merged. */
function palm(x: number, y: number, z: number, rng: () => number): THREE.BufferGeometry[] {
  const height = 5 + rng() * 3;
  const lean = (rng() - 0.5) * 0.5;
  const trunk = new THREE.CylinderGeometry(0.25, 0.45, height, 5);
  trunk.rotateZ(lean);
  trunk.translate(x, y + height / 2, z);
  const parts: THREE.BufferGeometry[] = [colorGeometry(trunk, PALETTE.wood)];
  const topX = x - Math.sin(lean) * height;
  for (let i = 0; i < 5; i++) {
    const frond = new THREE.BoxGeometry(3.2, 0.14, 0.9);
    frond.translate(1.4, 0, 0);
    frond.rotateZ(-0.5 - rng() * 0.3);
    frond.rotateY((i / 5) * Math.PI * 2 + rng());
    frond.translate(topX, y + height, z);
    parts.push(colorGeometry(frond, PALETTE.palm));
  }
  return parts;
}

/** A cliff: a faceted cone, darker at the foot, with palms on top and sometimes a waterfall down its course-facing side. */
function cliff(side: number, z: number, rng: () => number): THREE.BufferGeometry[] {
  const radius = 16 + rng() * 14;
  const height = 28 + rng() * 26;
  const x = side * (radius + 22 + rng() * 10);
  const cone = new THREE.ConeGeometry(radius, height, 6 + Math.floor(rng() * 3));
  cone.rotateY(rng() * Math.PI);
  cone.translate(x, height / 2 - 3, z);
  const foot = rgb(PALETTE.cliff);
  const top = rgb(PALETTE.cliffLit);
  const parts: THREE.BufferGeometry[] = [paintGeometry(cone, (_x, y) => mixRgb(foot, top, Math.max(0, Math.min(1, (y + 3) / height))))];
  const palms = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < palms; i++) parts.push(...palm(x + (rng() - 0.5) * radius * 0.5, height - 3 - rng() * 4, z + (rng() - 0.5) * radius * 0.5, rng));
  if (rng() < 0.3) {
    // A waterfall: a bright strip down the inner face into the sea.
    const w = 1.2 + rng() * 1.2;
    parts.push(box(w, height * 0.8, 0.6, PALETTE.foam, x - side * radius * 0.78, height * 0.4 - 3, z + (rng() - 0.5) * 4));
  }
  return parts;
}

/**
 * The world beside the course: cliffs with palms and waterfalls along both
 * sides, and a pier on the right with pilings, a crowd, tents, flags and
 * the BOARDMASTERS banner. Everything coloured is merged into one mesh per
 * span and side; the crowd and banner are textured meshes. Two copies of
 * each span leapfrog ahead of the camera, so the endless course always has
 * a shore.
 */
export class Scenery {
  readonly group = new THREE.Group();
  private readonly spans: THREE.Group[] = [];

  constructor() {
    const rng = mulberry32(5);
    const solid = createPS1Material({ flat: 0.18 });
    const crowd = createPS1Material({ map: crowdTexture(), unlit: true });
    const banner = createPS1Material({ map: bannerTexture('BOARDMASTERS'), unlit: true, side: THREE.DoubleSide });
    const flag = createPS1Material({ map: flagTexture(), unlit: true, side: THREE.DoubleSide });
    for (let copy = 0; copy < 2; copy++) {
      const span = new THREE.Group();
      const parts: THREE.BufferGeometry[] = [];
      for (const side of [-1, 1]) {
        for (let z = 30; z < SPAN; z += 70 + rng() * 50) parts.push(...cliff(side, z, rng));
      }
      // The pier: 120 m of deck on pilings, from 300 m into the span.
      const pz = 300;
      const length = 120;
      for (let z = pz; z < pz + length; z += 6) {
        parts.push(box(0.6, 7, 0.6, PALETTE.wood, PIER_X - 5, 1.5, z));
        parts.push(box(0.6, 7, 0.6, PALETTE.wood, PIER_X + 5, 1.5, z));
      }
      parts.push(box(14, 0.5, length, PALETTE.wood, PIER_X, 5, pz + length / 2));
      parts.push(box(0.3, 1, length, PALETTE.outline, PIER_X - 6.5, 5.8, pz + length / 2));
      for (let z = pz + 10; z < pz + length; z += 24) {
        const cone = new THREE.ConeGeometry(3.5, 3, 4);
        cone.translate(PIER_X + 3, 7, z);
        parts.push(colorGeometry(cone, z % 48 < 24 ? 0xe63946 : 0x2d4fd6));
        parts.push(box(0.2, 7, 0.2, PALETTE.outline, PIER_X - 6, 9, z + 12));
      }
      span.add(new THREE.Mesh(mergeGeometries(parts), solid));
      // The crowd along the inner rail, the banner over the stand, flags on the poles.
      const stand = new THREE.BoxGeometry(2, 2, length - 4);
      const uv = stand.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 12);
      const standMesh = new THREE.Mesh(colorGeometry(stand, 0xffffff), crowd);
      standMesh.position.set(PIER_X - 4.5, 6.3, pz + length / 2);
      span.add(standMesh);
      const bannerMesh = new THREE.Mesh(colorGeometry(new THREE.BoxGeometry(24, 4.5, 0.2), 0xffffff), banner);
      bannerMesh.position.set(PIER_X + 1, 12, pz + length * 0.6);
      span.add(bannerMesh);
      const flagParts: THREE.BufferGeometry[] = [];
      for (let z = pz + 10; z < pz + length; z += 24) {
        const f = new THREE.PlaneGeometry(2.4, 1.6);
        f.translate(PIER_X - 6 + 1.2, 12, z + 12);
        flagParts.push(colorGeometry(f, 0xffffff));
      }
      span.add(new THREE.Mesh(mergeGeometries(flagParts), flag));
      span.position.z = copy * SPAN;
      this.spans.push(span);
      this.group.add(span);
    }
  }

  /**
   * Place the two spans on the two tiles the camera needs: the tile holding the point 60 m behind it and the
   * next one, each copy taking the tiles of its own parity. Computed from the camera every frame, so it also
   * works backwards (a restart puts the camera back at the start line).
   */
  update(cameraZ: number): void {
    const first = Math.max(0, Math.ceil((cameraZ - 60) / SPAN - 1));
    for (let copy = 0; copy < this.spans.length; copy++) {
      const tile = first % 2 === copy ? first : first + 1;
      this.spans[copy].position.z = tile * SPAN;
    }
  }
}
