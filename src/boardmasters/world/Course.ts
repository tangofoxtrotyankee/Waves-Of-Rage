import { mulberry32 } from '../engine/math';
import { ENDLESS } from '../game/constants';
import type { OceanFeature } from './Ocean';

export interface CourseSpec {
  id: string;
  name: string;
  seed: number;
}

export interface Spot {
  x: number;
  z: number;
}

/** A lifeguard boat's crossing: where along the course, and which way it crosses (+1 towards +x, screen-left). */
export interface BoatSpot {
  z: number;
  direction: 1 | -1;
}

export interface Generated {
  buoys: Spot[];
  /** Boost gates (chevrons on the water). */
  chevrons: Spot[];
  sharks: Spot[];
  boats: BoatSpot[];
}

/** The one course so far: Sunset Bay, endless. */
export const COURSE: CourseSpec = { id: 'sunset-bay', name: 'SUNSET BAY', seed: 7 };

/** How the course is laid out, and how it tightens with distance. */
const LAYOUT = {
  /** Ramps every 45 to 80 m, in one of three lanes, sometimes with a trough after. */
  rampGap: [45, 35] as const,
  /** Buoys every 35 to 65 m at the start... */
  buoyGap: [35, 30] as const,
  /** ...shrinking to this fraction of that by ENDLESS.tightMetres. */
  buoyGapMin: 0.45,
  /** Boost chevrons every 110 to 190 m, in a lane. */
  chevronGap: [110, 80] as const,
  /** Sharks every 90 to 160 m once they are unlocked (ENDLESS.sharksFrom), tightening like the buoys. */
  sharkGap: [90, 70] as const,
  /** The lifeguard boat crosses every 170 to 290 m once unlocked (ENDLESS.boatsFrom). */
  boatGap: [170, 120] as const,
  /** Metres of course kept generated ahead of the rider, and dropped behind. */
  ahead: 320,
  behind: 60,
} as const;

/**
 * The endless course, generated deterministically from the seed as the
 * rider advances (a few hundred metres ahead, dropped behind): steep-backed
 * ramps in three lanes (sometimes with a slowing trough), skull buoys that
 * come thicker with distance (tightest from ENDLESS.tightMetres on), boost
 * gates, and from their unlock distances sharks (in a lane, swimming up the
 * course at the rider) and the lifeguard boat (crossing the course from
 * either side). `hazardGap` widens every hazard's spacing (phones).
 */
export class CourseGenerator {
  readonly features: OceanFeature[] = [];
  readonly buoys: Spot[] = [];
  /** The course exists up to here. */
  generatedTo = 0;
  private readonly rng: () => number;
  private nextRampZ = 70;
  private nextBuoyZ = 90;
  private nextChevronZ = 50;
  private nextSharkZ: number = ENDLESS.sharksFrom;
  private nextBoatZ: number = ENDLESS.boatsFrom;

  constructor(
    readonly spec: CourseSpec,
    private readonly hazardGap = 1,
  ) {
    this.rng = mulberry32(spec.seed);
  }

  /** How much the buoys' (and sharks') gaps have closed at `z`: 1 at the start down to LAYOUT.buoyGapMin. */
  private tighten(z: number): number {
    return 1 - (1 - LAYOUT.buoyGapMin) * Math.min(1, z / ENDLESS.tightMetres);
  }

  /** Make sure everything up to `riderZ + ahead` exists and drop what is far behind. Returns the new spots. */
  extend(riderZ: number): Generated {
    const toZ = riderZ + LAYOUT.ahead;
    const rng = this.rng;
    const lanes = [-6, 0, 6];
    const out: Generated = { buoys: [], chevrons: [], sharks: [], boats: [] };
    while (this.nextChevronZ < toZ) {
      // Kept within the outer lanes (|x| <= 6), so no gate sits out beside the pier or the cliffs.
      const x = lanes[Math.floor(rng() * lanes.length)] + (rng() - 0.5) * 4;
      out.chevrons.push({ x: Math.max(-6, Math.min(6, x)), z: this.nextChevronZ });
      this.nextChevronZ += LAYOUT.chevronGap[0] + rng() * LAYOUT.chevronGap[1];
    }
    while (this.nextRampZ < toZ) {
      const x = lanes[Math.floor(rng() * lanes.length)] + (rng() - 0.5) * 3;
      this.features.push({ kind: 'ramp', z: this.nextRampZ, x, length: 9, width: 4.5, height: 1.5 + rng() * 0.5 });
      if (rng() < 0.35) this.features.push({ kind: 'trough', z: this.nextRampZ + 20 + rng() * 10, x: -x, length: 10, width: 5, height: 0.9 });
      this.nextRampZ += LAYOUT.rampGap[0] + rng() * LAYOUT.rampGap[1];
    }
    const nearRamp = (bx: number, z: number) => this.features.some((f) => f.kind === 'ramp' && Math.abs(f.z + f.length / 2 - z) < 14 && Math.abs(f.x - bx) < 4.5);
    while (this.nextBuoyZ < toZ) {
      const z = this.nextBuoyZ;
      let x = (rng() * 2 - 1) * 9;
      if (nearRamp(x, z)) x = -x;
      if (nearRamp(x, z)) x = x > 0 ? 9.5 : -9.5;
      const spot = { x, z };
      this.buoys.push(spot);
      out.buoys.push(spot);
      this.nextBuoyZ += (LAYOUT.buoyGap[0] + rng() * LAYOUT.buoyGap[1]) * this.tighten(z) * this.hazardGap;
    }
    while (this.nextSharkZ < toZ) {
      const z = this.nextSharkZ;
      // In a lane, clear of the ramp it would otherwise lurk behind.
      let x = lanes[Math.floor(rng() * lanes.length)] + (rng() - 0.5) * 3;
      if (nearRamp(x, z)) x = -x;
      out.sharks.push({ x, z });
      this.nextSharkZ += (LAYOUT.sharkGap[0] + rng() * LAYOUT.sharkGap[1]) * Math.max(0.6, this.tighten(z)) * this.hazardGap;
    }
    while (this.nextBoatZ < toZ) {
      out.boats.push({ z: this.nextBoatZ, direction: rng() < 0.5 ? 1 : -1 });
      this.nextBoatZ += (LAYOUT.boatGap[0] + rng() * LAYOUT.boatGap[1]) * this.hazardGap;
    }
    this.generatedTo = toZ;
    const behind = riderZ - LAYOUT.behind;
    for (let i = this.features.length - 1; i >= 0; i--) if (this.features[i].z + this.features[i].length < behind) this.features.splice(i, 1);
    for (let i = this.buoys.length - 1; i >= 0; i--) if (this.buoys[i].z < behind) this.buoys.splice(i, 1);
    return out;
  }
}
