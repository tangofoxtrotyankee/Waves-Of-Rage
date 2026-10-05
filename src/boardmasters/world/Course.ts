import { mulberry32 } from '../engine/math';
import type { OceanFeature } from './Ocean';

export interface CourseSpec {
  id: string;
  name: string;
  seed: number;
  rivals: number;
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
  sunsetBay: { id: 'sunset-bay', name: 'SUNSET BAY', seed: 7, rivals: 5 },
} as const satisfies Record<string, CourseSpec>;

/** How the endless course tightens with distance. */
const ENDLESS = {
  /** Ramps every 45 to 80 m, in one of three lanes, sometimes with a trough after. */
  rampGap: [45, 35] as const,
  /** Buoys every 35 to 65 m at the start... */
  buoyGap: [35, 30] as const,
  /** ...shrinking to this fraction of that by `tightenOver` metres. */
  buoyGapMin: 0.45,
  tightenOver: 6000,
  /** Boost chevrons every 110 to 190 m, in a lane. */
  chevronGap: [110, 80] as const,
  /** Metres of course kept generated ahead of the rider, and dropped behind. */
  ahead: 320,
  behind: 60,
} as const;

/**
 * An endless course, generated deterministically from the seed as the rider
 * advances: steep-backed ramps in three lanes (sometimes with a slowing
 * trough), and skull buoys that come thicker the further you get. There is
 * no finish line; a run ends with the last heart.
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
    const toZ = riderZ + ENDLESS.ahead;
    const rng = this.rng;
    const lanes = [-6, 0, 6];
    const added: BuoySpot[] = [];
    const chevrons: BuoySpot[] = [];
    while (this.nextChevronZ < toZ) {
      // Kept within the outer lanes (|x| <= 6), so no gate sits out beside the pier or the cliffs.
      const x = lanes[Math.floor(rng() * lanes.length)] + (rng() - 0.5) * 4;
      chevrons.push({ x: Math.max(-6, Math.min(6, x)), z: this.nextChevronZ });
      this.nextChevronZ += ENDLESS.chevronGap[0] + rng() * ENDLESS.chevronGap[1];
    }
    while (this.nextRampZ < toZ) {
      const x = lanes[Math.floor(rng() * lanes.length)] + (rng() - 0.5) * 3;
      this.features.push({ kind: 'ramp', z: this.nextRampZ, x, length: 9, width: 4.5, height: 1.5 + rng() * 0.5 });
      if (rng() < 0.35) this.features.push({ kind: 'trough', z: this.nextRampZ + 20 + rng() * 10, x: -x, length: 10, width: 5, height: 0.9 });
      this.nextRampZ += ENDLESS.rampGap[0] + rng() * ENDLESS.rampGap[1];
    }
    while (this.nextBuoyZ < toZ) {
      const z = this.nextBuoyZ;
      let x = (rng() * 2 - 1) * 9;
      const nearRamp = (bx: number) => this.features.some((f) => f.kind === 'ramp' && Math.abs(f.z + f.length / 2 - z) < 14 && Math.abs(f.x - bx) < 4.5);
      if (nearRamp(x)) x = -x;
      if (nearRamp(x)) x = x > 0 ? 9.5 : -9.5;
      const spot = { x, z };
      this.buoys.push(spot);
      added.push(spot);
      const tighten = 1 - (1 - ENDLESS.buoyGapMin) * Math.min(1, z / ENDLESS.tightenOver);
      this.nextBuoyZ += (ENDLESS.buoyGap[0] + rng() * ENDLESS.buoyGap[1]) * tighten;
    }
    this.generatedTo = toZ;
    const behind = riderZ - ENDLESS.behind;
    for (let i = this.features.length - 1; i >= 0; i--) if (this.features[i].z + this.features[i].length < behind) this.features.splice(i, 1);
    for (let i = this.buoys.length - 1; i >= 0; i--) if (this.buoys[i].z < behind) this.buoys.splice(i, 1);
    return { buoys: added, chevrons };
  }
}
