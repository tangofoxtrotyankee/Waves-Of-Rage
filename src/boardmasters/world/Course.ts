import { mulberry32 } from '../engine/math';
import { RACE } from '../game/constants';
import type { OceanFeature } from './Ocean';

export interface CourseSpec {
  id: string;
  name: string;
  seed: number;
  rivals: number;
  /** Metres from the start to the finish line. */
  length: number;
}

export interface BuoySpot {
  x: number;
  z: number;
}

export interface Generated {
  buoys: BuoySpot[];
  /** Boost gates (chevrons on the water). */
  chevrons: BuoySpot[];
}

/** The six stages from the brief start with the first; the others are rows to add here when their hazards exist. */
export const COURSES = {
  sunsetBay: { id: 'sunset-bay', name: 'SUNSET BAY', seed: 7, rivals: 5, length: 2000 },
} as const satisfies Record<string, CourseSpec>;

/** How the course is laid out, and how it tightens towards the finish. */
const LAYOUT = {
  /** Ramps every 45 to 80 m, in one of three lanes, sometimes with a trough after. */
  rampGap: [45, 35] as const,
  /** Buoys every 35 to 65 m at the start... */
  buoyGap: [35, 30] as const,
  /** ...shrinking to this fraction of that by RACE.tightFrom of the race. */
  buoyGapMin: 0.45,
  /** Boost chevrons every 110 to 190 m, in a lane. */
  chevronGap: [110, 80] as const,
  /** Metres of course kept generated ahead of the rider, and dropped behind. */
  ahead: 320,
  behind: 60,
} as const;

/**
 * A race course, generated deterministically from the seed as the rider
 * advances (a few hundred metres ahead, dropped behind): steep-backed ramps
 * in three lanes (sometimes with a slowing trough), skull buoys that come
 * thicker as the race goes on (tightest over the final third), and boost
 * gates. Buoys and gates stop RACE.clearBeforeFinish metres short of the
 * finish line at `spec.length`; the ramps and the swell run on past it.
 */
export class CourseGenerator {
  readonly features: OceanFeature[] = [];
  readonly buoys: BuoySpot[] = [];
  /** The course exists up to here. */
  generatedTo = 0;
  private readonly rng: () => number;
  private nextRampZ = 70;
  private nextBuoyZ = 90;
  private nextChevronZ = 50;

  constructor(readonly spec: CourseSpec) {
    this.rng = mulberry32(spec.seed);
  }

  /** Make sure everything up to `riderZ + ahead` exists and drop what is far behind. Returns the new spots. */
  extend(riderZ: number): Generated {
    const toZ = riderZ + LAYOUT.ahead;
    const clearFrom = this.spec.length - RACE.clearBeforeFinish;
    const rng = this.rng;
    const lanes = [-6, 0, 6];
    const added: BuoySpot[] = [];
    const chevrons: BuoySpot[] = [];
    while (this.nextChevronZ < toZ) {
      // Kept within the outer lanes (|x| <= 6), so no gate sits out beside the pier or the cliffs.
      const x = lanes[Math.floor(rng() * lanes.length)] + (rng() - 0.5) * 4;
      if (this.nextChevronZ <= clearFrom) chevrons.push({ x: Math.max(-6, Math.min(6, x)), z: this.nextChevronZ });
      this.nextChevronZ += LAYOUT.chevronGap[0] + rng() * LAYOUT.chevronGap[1];
    }
    while (this.nextRampZ < toZ) {
      const x = lanes[Math.floor(rng() * lanes.length)] + (rng() - 0.5) * 3;
      this.features.push({ kind: 'ramp', z: this.nextRampZ, x, length: 9, width: 4.5, height: 1.5 + rng() * 0.5 });
      if (rng() < 0.35) this.features.push({ kind: 'trough', z: this.nextRampZ + 20 + rng() * 10, x: -x, length: 10, width: 5, height: 0.9 });
      this.nextRampZ += LAYOUT.rampGap[0] + rng() * LAYOUT.rampGap[1];
    }
    while (this.nextBuoyZ < toZ) {
      const z = this.nextBuoyZ;
      let x = (rng() * 2 - 1) * 9;
      const nearRamp = (bx: number) => this.features.some((f) => f.kind === 'ramp' && Math.abs(f.z + f.length / 2 - z) < 14 && Math.abs(f.x - bx) < 4.5);
      if (nearRamp(x)) x = -x;
      if (nearRamp(x)) x = x > 0 ? 9.5 : -9.5;
      if (z <= clearFrom) {
        const spot = { x, z };
        this.buoys.push(spot);
        added.push(spot);
      }
      const tighten = 1 - (1 - LAYOUT.buoyGapMin) * Math.min(1, z / (this.spec.length * RACE.tightFrom));
      this.nextBuoyZ += (LAYOUT.buoyGap[0] + rng() * LAYOUT.buoyGap[1]) * tighten;
    }
    this.generatedTo = toZ;
    const behind = riderZ - LAYOUT.behind;
    for (let i = this.features.length - 1; i >= 0; i--) if (this.features[i].z + this.features[i].length < behind) this.features.splice(i, 1);
    for (let i = this.buoys.length - 1; i >= 0; i--) if (this.buoys[i].z < behind) this.buoys.splice(i, 1);
    return { buoys: added, chevrons };
  }
}
