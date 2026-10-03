import { mulberry32 } from '../engine/math';
import type { OceanFeature } from './Ocean';

export interface CourseSpec {
  id: string;
  name: string;
  /** Metres to the finish line. */
  length: number;
  seed: number;
  rivals: number;
}

export interface CourseLayout {
  features: OceanFeature[];
  buoys: { x: number; z: number }[];
  finishZ: number;
}

/** The six stages from the brief start with the first; the others are rows to add here when their hazards exist. */
export const COURSES = {
  sunsetBay: { id: 'sunset-bay', name: 'SUNSET BAY', length: 1200, seed: 7, rivals: 7 },
} as const satisfies Record<string, CourseSpec>;

/**
 * Lay out a course deterministically from its seed: ramps every 45 to 80 m
 * in one of three lanes (sometimes with a trough nearby), skull buoys every
 * 35 to 65 m kept out of the ramp lanes, and the finish at the end.
 */
export function buildCourse(spec: CourseSpec): CourseLayout {
  const rng = mulberry32(spec.seed);
  const features: OceanFeature[] = [];
  const lanes = [-6, 0, 6];

  let z = 70;
  while (z < spec.length - 80) {
    const x = lanes[Math.floor(rng() * lanes.length)] + (rng() - 0.5) * 3;
    features.push({ kind: 'ramp', z, x, length: 9, width: 4.5, height: 1.5 + rng() * 0.5 });
    if (rng() < 0.35) features.push({ kind: 'trough', z: z + 20 + rng() * 10, x: -x, length: 10, width: 5, height: 0.9 });
    z += 45 + rng() * 35;
  }

  const buoys: { x: number; z: number }[] = [];
  z = 90;
  while (z < spec.length - 40) {
    let x = (rng() * 2 - 1) * 9;
    const nearRamp = (bx: number) => features.some((f) => f.kind === 'ramp' && Math.abs(f.z + f.length / 2 - z) < 14 && Math.abs(f.x - bx) < 4.5);
    if (nearRamp(x)) x = -x;
    if (nearRamp(x)) x = x > 0 ? 9.5 : -9.5;
    buoys.push({ x, z });
    z += 35 + rng() * 30;
  }

  return { features, buoys, finishZ: spec.length };
}
