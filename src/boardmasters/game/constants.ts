import { usePortraitLayout } from '../../game/platform';

/**
 * Tuning for Waves of Rage 2: Boardmasters. Everything that decides how the
 * prototype looks and feels lives here so playtesting changes are one-line.
 */
const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

/** Phones hold the game upright; desktops play landscape (same rule as the original, `?portrait=1` / `?landscape=1` override). */
export const IS_PORTRAIT = usePortraitLayout();

/**
 * Internal render resolution: 426x240 keeps the PlayStation's 240 lines at
 * 16:9 (240x426 upright). `?res=320` renders at the original game's 320x180
 * for comparison.
 */
const LOW_RES = params.get('res') === '320';
const LONG_SIDE = LOW_RES ? 320 : 426;
const SHORT_SIDE = LOW_RES ? 180 : 240;
export const VIEW = {
  width: IS_PORTRAIT ? SHORT_SIDE : LONG_SIDE,
  height: IS_PORTRAIT ? LONG_SIDE : SHORT_SIDE,
} as const;

/** `?character=kai` picks a rider from CHARACTERS; the character select comes later. */
export const CHARACTER_PARAM = params.get('character');

/** Chase camera: behind the surfer at about waist height, looking a little way ahead. */
export const CAMERA = {
  fov: IS_PORTRAIT ? 80 : 62,
  near: 0.4,
  far: 130,
  /** Metres behind and above the surfer. */
  back: 4.8,
  height: 1.5,
  /** The look-at point, metres ahead of and above the surfer. */
  lookAhead: 7,
  lookHeight: 0.5,
  /** Exponential easing rates per second for position and look target. */
  followRate: 6,
  lookRate: 8,
  /** Roll into a carve, radians at full heading. */
  roll: 0.09,
} as const;

/** Short draw distance: linear fog to the sunset colour. The sky dome meets the same colour at the horizon. */
export const FOG = {
  color: 0xf7a04b,
  near: IS_PORTRAIT ? 30 : 26,
  far: IS_PORTRAIT ? 100 : 88,
} as const;

/** One sun plus ambient; lighting is per-vertex (Gouraud) in the shader. */
export const LIGHT = {
  sun: [0.35, 0.8, -0.5] as const,
  ambient: 0.55,
} as const;

/** The deliberate PlayStation artefacts, each switchable live from the dev console (`bm.look`). */
export const LOOK = {
  /** Snap vertices to the low-res pixel grid (polygon jitter). */
  snap: true,
  /** Affine (not perspective-correct) texture mapping (texture warping). */
  affine: true,
  /** Quantise output to 5 bits per channel (colour banding). */
  quantize: true,
};

/** Rider physics in metres and seconds. Character stats scale some of these (see characters.ts). */
export const PHYSICS = {
  gravity: 16,
  /** Cruising speed the rider relaxes towards; pumping, braking and slopes move it. */
  baseSpeed: 13,
  minSpeed: 5,
  maxSpeed: 27,
  pumpAccel: 7,
  brakeDecel: 14,
  /** How quickly speed relaxes back to base, per second. */
  drag: 1.1,
  /** Speed gained per second per unit of downhill slope (lost uphill). */
  slopeGain: 10,
  /** Heading change per second at full steer, radians. */
  carveRate: 2.4,
  /** Braking tightens the carve. */
  hardCarveMul: 1.6,
  maxHeading: 0.62,
  /** Heading returns to straight this fast with no input, radians per second. */
  headingReturn: 4,
  /** Steering authority while airborne. */
  airSteer: 0.45,
  jumpVelocity: 6.2,
  /** A jump is still allowed this close above the water (skipping over chop). */
  coyoteHeight: 0.15,
  /** Rideable water is this wide either side of the centre line; beyond it is whitewater. */
  trackHalfWidth: 11,
  /** Sideways shoves from contact decay at this rate per second. */
  shoveDecay: 5,
} as const;

export const SCORING = {
  perMetre: 1,
  /** Air shorter than this is just skipping over chop. */
  airSeconds: 0.45,
  airBonus: 100,
  bigAirSeconds: 1.0,
  bigAirBonus: 250,
  finishBonus: 1000,
  firstPlaceBonus: 500,
  startHealth: 3,
  buoyDamage: 1,
  invulnerableSeconds: 1.2,
  /** Speed kept after hitting a buoy, and after bumping a rival. */
  hitSpeedFactor: 0.4,
  bumpSpeedFactor: 0.85,
  /** Seconds the wipeout plays before the results accept input. */
  wipeoutSeconds: 1.6,
} as const;

/** The original game's palette (docs/art-direction/README.md), reused for water, sky and riders. */
export const PALETTE = {
  deepWater: 0x1e4fa3,
  water: 0x2a66c4,
  lightWater: 0x5fb3f0,
  foam: 0xf8fbff,
  skyTop: 0x2d0b4e,
  skyMid: 0xf26b4e,
  horizon: 0xffcf6b,
  sun: 0xffe9a0,
  island: 0x3a1f5e,
  outline: 0x1a1a2e,
  ui: 0x1a0b2e,
  gold: 0xffd166,
  cyan: 0x7ff6ff,
  red: 0xff4d6d,
} as const;
