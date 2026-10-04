import { usePortraitLayout } from '../../game/platform';

/**
 * Tuning for Waves of Rage 2: Boardmasters. Everything that decides how the
 * prototype looks and feels lives here so playtesting changes are one-line.
 */
const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);

/** Phones hold the game upright; desktops play landscape (same rule as the original, `?portrait=1` / `?landscape=1` override). */
export const IS_PORTRAIT = usePortraitLayout();

/**
 * Internal resolution: 426x240 keeps the PlayStation's 240 lines at 16:9
 * (240x426 upright). The HUD canvas, touch buttons and pointer mapping work
 * in these VIEW pixels. `?res=320` uses the original game's 320x180 for
 * comparison.
 *
 * The 3D world renders at RENDER_SCALE times VIEW (852x480 / 480x852 by
 * default) and is CSS-scaled with the HUD to the same rectangle: silhouettes
 * and far detail come out sharper while the textures, dither, 5-bit
 * quantise and vertex snap keep the PlayStation grain. `?res=1` restores the
 * 1x world, `?res=1.5` / `?res=3` try other multiples.
 */
const RES = params.get('res');
const LOW_RES = RES === '320';
const LONG_SIDE = LOW_RES ? 320 : 426;
const SHORT_SIDE = LOW_RES ? 180 : 240;
const RES_SCALE = RES !== null && !LOW_RES ? Number(RES) : NaN;
export const RENDER_SCALE = RES_SCALE >= 1 && RES_SCALE <= 4 ? RES_SCALE : 2;
/**
 * The vertex snap grid in VIEW pixels per cell: 1 snaps to the VIEW grid
 * (the 1x build's polygon jitter at any RENDER_SCALE), 1 / RENDER_SCALE to
 * the render grid. Never finer than one rendered pixel.
 */
const SNAP_CELL = 0.5;
export const VIEW = {
  width: IS_PORTRAIT ? SHORT_SIDE : LONG_SIDE,
  height: IS_PORTRAIT ? LONG_SIDE : SHORT_SIDE,
  snap: Math.max(SNAP_CELL, 1 / RENDER_SCALE),
} as const;

/** `?character=kai` picks a rider from CHARACTERS; the character select comes later. */
export const CHARACTER_PARAM = params.get('character');

/**
 * Chase camera, framed like the gameplay mockup: behind and above the
 * surfer, looking down on their head and shoulders, with a narrower FOV than
 * before so the surfer fills the lower middle of the screen (about 47 % to
 * 91 % of the height on an upright phone) while the horizon sits about 38 %
 * from the top. Run.updateCamera uses all of it.
 */
export const CAMERA = {
  /** Vertical field of view in degrees at cruising speed. */
  fov: IS_PORTRAIT ? 64 : 52,
  near: 0.3,
  far: 130,
  /** Metres behind and above the surfer (the e2e test expects 3 to 7 m behind and more than 0.8 m above). */
  back: IS_PORTRAIT ? 4.3 : 4.8,
  height: IS_PORTRAIT ? 2.4 : 2.2,
  /** Metres beside the surfer, against the heading, at full carve: the camera swings out a little to show the line. */
  side: 1.0,
  /** Least height over the water under the camera itself, after easing and shake. */
  clearance: 0.6,
  /** The look-at point, metres ahead of and above the surfer, and how far it leads the carve. */
  lookAhead: IS_PORTRAIT ? 12 : 13,
  lookHeight: IS_PORTRAIT ? 0 : 0.1,
  lookSide: 1.2,
  /** Exponential easing rates per second for position, look target and roll. */
  followRate: 6,
  lookRate: 8,
  rollRate: 4,
  /** Roll into a carve, radians at full heading (eased; kept small so carves do not read as spinning). */
  roll: 0.035,
  /** FOV kick in degrees: up to `speedFov` from cruising to top speed, plus `boostFov` while a BOOST lasts and `rageFov` while raging. */
  speedFov: 4,
  boostFov: 5,
  rageFov: 3,
  /** Easing rates per second for the kick: quick to widen, slow to settle. */
  fovIn: 7,
  fovOut: 2,
  /** Run.shake: metres of offset per unit of amount and radians of roll per unit, decaying quadratically over the shake's seconds. */
  shakeMove: 0.12,
  shakeRoll: 0.03,
  /**
   * Near-camera occlusion: a rival this close to the camera (metres, full
   * to none), or within `lineFull` to `lineNone` metres of the sight line
   * from the camera to the surfer and short of the surfer, fades out
   * (Run.applyNearFade).
   */
  nearFull: 3.0,
  nearNone: 4.2,
  lineFull: 0.6,
  lineNone: 1.1,
} as const;

/** Short draw distance: linear fog to the sunset colour. The sky dome meets the same colour at the horizon. */
export const FOG = {
  color: 0xf7a04b,
  near: IS_PORTRAIT ? 30 : 26,
  far: IS_PORTRAIT ? 100 : 88,
} as const;

/** One sun plus ambient; lighting is per-vertex (Gouraud) in the shader. */
export const LIGHT = {
  /** From the drawn sun, ahead and high: crests rim-light, riders read by ambient. */
  sun: [0.35, 0.8, 0.5] as const,
  ambient: 0.65,
} as const;

/** The deliberate PlayStation artefacts, each switchable live from the dev console (`bm.look`). */
export const LOOK = {
  /** Snap vertices to the low-res pixel grid (polygon jitter). */
  snap: true,
  /** Affine (not perspective-correct) texture mapping (texture warping). */
  affine: true,
  /** Quantise output to 5 bits per channel (colour banding). */
  quantize: true,
  /** 4x4 ordered dither before quantising, as the PlayStation's 15-bit framebuffer write did. */
  dither: true,
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
  /** The water must drop away faster than gravity by this much (m/s^2) before the rider leaves it; step-rate independent. */
  launchAccel: 10,
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
  /** The endless course: cruising speed grows with distance up to this much more... */
  speedRampMax: 0.3,
  /** ...reached after this many metres. */
  speedRampOver: 4000,
  startHealth: 3,
  buoyDamage: 1,
  invulnerableSeconds: 1.2,
  /** Speed kept after hitting a buoy, and after bumping a rival. */
  hitSpeedFactor: 0.4,
  bumpSpeedFactor: 0.85,
  /** Seconds the wipeout plays before the results accept input. */
  wipeoutSeconds: 1.6,
} as const;

/** HIT (punch), BARGE (shoulder), knockouts and rivals' own shoulder checks. Metres, seconds, points. */
export const COMBAT = {
  rivalHealth: 2,
  punchDamage: 1,
  punchShove: 3.5,
  punchCooldown: 0.45,
  punchSeconds: 0.25,
  punchRangeX: 1.7,
  punchRangeZ: 2.2,
  bargeDamage: 1,
  bargeShove: 8,
  bargeCooldown: 1.0,
  bargeSeconds: 0.35,
  bargeRangeX: 2.2,
  bargeRangeZ: 2.6,
  /** A barge costs the barger some speed and a moment of control: it risks destabilising you. */
  bargeSelfSpeed: 0.92,
  bargeSelfStun: 0.2,
  knockoutPoints: 500,
  /** Barged into a buoy or off the course. */
  environmentPoints: 750,
  /** A rival sliding this fast from a shove is knocked out by whatever it hits. */
  environmentShove: 3,
  comboSeconds: 4,
  comboMax: 5,
  respawnSeconds: 3,
  respawnBehind: 20,
  /** Rivals with POWER at least this shoulder-check the player when alongside. */
  rivalAggression: 0.5,
  rivalShove: 4,
  rivalCheckCooldown: 4,
  rivalCheckSeconds: 0.7,
} as const;

/** In the air: Left/Right spin, X grabs; land within the tolerance or wipe out. */
export const TRICKS = {
  /** Radians per second at full steer. */
  spinRate: (Math.PI * 2) / 0.75,
  /** Points by half-turns landed: 180, 360, 540, 720. */
  spinPoints: [0, 250, 500, 750, 1000] as const,
  grabPoints: 250,
  landingPoints: 250,
  landingToleranceDeg: 50,
  /** A bad landing keeps this much speed and costs a heart. */
  badLandingSpeed: 0.5,
  crashSeconds: 0.7,
  /** The barrel roll (RIGHT RIGHT UP / LEFT LEFT UP): a launch plus a full roll about the board over this long. */
  rollSeconds: 0.55,
  barrelRollPoints: 400,
  /** Land before this much of the roll is done and it is a crash. */
  rollLandingFraction: 0.85,
} as const;

/** BOOST (UP UP): a burst of speed, on a cooldown. */
export const BOOST = {
  gain: 5,
  cooldown: 1.5,
  /** Seconds of extra spray and the pump pose after the burst. */
  seconds: 0.4,
} as const;

/** The RAGE meter: tricks and knockouts fill it; full, the surfer goes faster, hits harder and smashes buoys. */
export const RAGE = {
  seconds: 8,
  perTrick: 0.12,
  perKnockout: 0.2,
  /** Riding through a boost gate. */
  perGate: 0.06,
  decayPerSecond: 0.015,
  speedMul: 1.3,
  attackDamage: 2,
  smashPoints: 100,
} as const;

/** The MENU corner on touch screens (internal pixels; at least 44 CSS px on phones). */
export const MENU_ZONE = { w: 80, h: 32 } as const;

/** The original game's palette (docs/art-direction/README.md), reused for water, sky and riders. */
export const PALETTE = {
  deepWater: 0x25307e,
  water: 0x1f6fc2,
  lightWater: 0x45cbe6,
  foam: 0xf8fbff,
  cloud: 0xff9a7a,
  cloudLit: 0xffd1a0,
  cliff: 0x5b2f86,
  cliffLit: 0x9a5fc4,
  palm: 0x1d6b4a,
  wood: 0x7a4a2a,
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
