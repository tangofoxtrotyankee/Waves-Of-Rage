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
 * (240x426 upright, the HUD taller on taller phones: see VIEW). The HUD
 * canvas, touch buttons and pointer mapping work in these VIEW pixels. `?res=320` uses the original game's 320x180 (the
 * world at 1x too) for comparison.
 *
 * The 3D world renders at a multiple of VIEW, the render scale: 1.5 by
 * default (639x360 / 360x639, the 300 to 470 world pixels across a phone
 * that the gameplay mockup reads as), so silhouettes and far detail come out
 * sharper while the textures, dither, 5-bit quantise and vertex snap keep
 * the PlayStation grain. Renderer.fit picks the scale per screen from
 * RENDER_SCALES so a world pixel covers a whole number of device pixels
 * (3 device pixels per VIEW pixel: 1.5; 4: 2; 5: 2.5), and lets the world
 * bleed past the HUD's 16:9 rectangle to the screen edges, so tall phones
 * get no letterbox bars. `?res=1` to `?res=4` force a scale (`?res=1` is
 * the old 1x world).
 */
const RES = params.get('res');
const LOW_RES = RES === '320';
const LONG_SIDE = LOW_RES ? 320 : 426;
const SHORT_SIDE = LOW_RES ? 180 : 240;
const RES_SCALE = RES !== null && !LOW_RES ? Number(RES) : NaN;
/** A forced render scale (`?res=N`; 1 under `?res=320`), or null to let Renderer.fit choose one. */
export const RENDER_SCALE_FORCED: number | null = RES_SCALE >= 1 && RES_SCALE <= 4 ? RES_SCALE : LOW_RES ? 1 : null;
/** Render scales Renderer.fit may choose, in order of preference; the first is also the fallback when none lands on whole device pixels. */
export const RENDER_SCALES = [1.5, 2, 2.5] as const;
/** The render scale before the first fit. */
export const RENDER_SCALE = RENDER_SCALE_FORCED ?? RENDER_SCALES[0];
/** The most world pixels (bleed included) Renderer.fit takes on for whole device pixels: phones stay near 1.5x (about 280k to 360k), desktops may go to 2x or 2.5x. */
export const RENDER_PIXEL_BUDGET = IS_PORTRAIT ? 420_000 : 1_200_000;
/** How far the world may bleed past the HUD rectangle, as a multiple of its size per axis (past that the page shows black). */
export const RENDER_BLEED_MAX = { x: 2.2, y: 1.6 } as const;
/** The upright HUD's tallest height in VIEW pixels (240x540 is 9:20.25, about the tallest phones); `?res=320` scales it. */
const PORTRAIT_MAX_H = Math.round((LONG_SIDE * 540) / 426);
/**
 * The upright HUD height for a safe area of `w` x `h` CSS pixels, with the
 * HUD `scale` CSS pixels per VIEW pixel (default: filling the width): as
 * tall as the screen allows, between LONG_SIDE (16:9) and PORTRAIT_MAX_H.
 * Rounded down, so the HUD never ends up taller than the screen.
 */
export function portraitViewHeight(w: number, h: number, scale = w / SHORT_SIDE): number {
  if (!(w > 0 && h > 0 && scale > 0)) return LONG_SIDE;
  return Math.max(LONG_SIDE, Math.min(PORTRAIT_MAX_H, Math.floor(h / scale + 1e-6)));
}

/** The upright HUD height at load, from #game's padding-free box (the safe area) or the window; Renderer.fit refines it. */
function initialViewHeight(): number {
  if (!IS_PORTRAIT) return SHORT_SIDE;
  if (typeof window === 'undefined') return LONG_SIDE;
  let w = window.innerWidth;
  let h = window.innerHeight;
  const el = typeof document === 'undefined' ? null : document.getElementById('game');
  if (el && el.clientWidth > 0 && el.clientHeight > 0) {
    const s = getComputedStyle(el);
    w = el.clientWidth - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0);
    h = el.clientHeight - (parseFloat(s.paddingTop) || 0) - (parseFloat(s.paddingBottom) || 0);
  }
  return portraitViewHeight(w, h);
}

const VIEW_W = IS_PORTRAIT ? SHORT_SIDE : LONG_SIDE;
const VIEW_H = initialViewHeight();
/**
 * The HUD's resolution. Landscape it is 426x240. Upright it is 240 wide and
 * as tall as the screen's aspect allows (426 at 16:9 up to 540), so the top
 * bar sits at the top of the screen and the controls at the bottom; Renderer.fit
 * sets `height` for the safe area at load and again whenever the page
 * resizes (fullscreen, the browser bars), and the HUD lays itself out again.
 */
export const VIEW = {
  width: VIEW_W,
  height: VIEW_H,
  /**
   * The 3D camera's framing rectangle inside the HUD, in VIEW pixels: always
   * 240x426 (426x240 landscape), so the world is framed exactly the same on
   * every phone; on a taller HUD it sits centred (`top`), which puts the
   * horizon about 40 % and the board's tail about 83 % down the screen like the
   * mockup, and the world bleeds past it to the screen edges (Renderer.fit).
   */
  frame: { width: VIEW_W, height: IS_PORTRAIT ? LONG_SIDE : SHORT_SIDE, top: Math.round((VIEW_H - (IS_PORTRAIT ? LONG_SIDE : SHORT_SIDE)) / 2) },
  /**
   * The vertex snap grid, in cells per half clip space per axis: half the
   * world buffer's pixel size, so vertices land on rendered pixels (polygons
   * still jitter as they move). Renderer.fit keeps it in step with the
   * buffer; PS1Material.syncLook reads it.
   */
  snapGrid: { x: (VIEW_W * RENDER_SCALE) / 2, y: ((IS_PORTRAIT ? LONG_SIDE : SHORT_SIDE) * RENDER_SCALE) / 2 } as { x: number; y: number },
};

/** `?character=kai` picks a rider from CHARACTERS; the character select comes later. */
export const CHARACTER_PARAM = params.get('character');

/**
 * Chase camera, framed like the gameplay mockup: behind and above the
 * surfer, looking down on their head and shoulders, with a narrower FOV than
 * before so the surfer fills the lower middle of the screen (about 47 % to
 * 91 % of the HUD rectangle on an upright phone) while the horizon sits about
 * 38 % from the top. On a phone taller than 16:9 the world bleeds past the
 * HUD rectangle (Renderer.fit), which puts the horizon at about 40 % and the
 * board's tail at about 83 % of the whole screen, as in the mockup.
 * Run.updateCamera uses all of it.
 */
export const CAMERA = {
  /** Vertical field of view in degrees at cruising speed. */
  fov: IS_PORTRAIT ? 64 : 52,
  near: 0.3,
  far: 130,
  /** Metres behind and above the surfer (the e2e test expects 3 to 7 m behind and more than 0.8 m above). */
  back: IS_PORTRAIT ? 4.3 : 4.8,
  height: IS_PORTRAIT ? 2.4 : 2.1,
  /** Metres beside the surfer, against the heading, at full carve: the camera swings out a little to show the line. */
  side: 1.0,
  /** Least height over the water under the camera itself, after easing and shake. */
  clearance: 0.6,
  /** The look-at point, metres ahead of and above the surfer, and how far it leads the carve. */
  lookAhead: IS_PORTRAIT ? 12 : 11,
  lookHeight: IS_PORTRAIT ? 0 : 0.1,
  lookSide: 1.2,
  /**
   * The title screen's framing, added to the above and eased like the rest
   * (starting a run glides into the gameplay framing): on an upright phone a
   * lower camera a little further back, pitched up, puts the horizon about
   * 55 % down and the surfer between the character stats and the control
   * hints, as in the title concept. Landscape keeps the gameplay framing.
   */
  title: IS_PORTRAIT ? { back: 1.3, height: -0.2, lookHeight: 3.2 } : { back: 0, height: 0, lookHeight: 0 },
  /** Exponential easing rates per second for position, look target and roll. */
  followRate: 6,
  /** ...and for following the surfer's height: tight on the water, loose in the air so jumps rise in frame. */
  waterFollowRate: 12,
  airFollowRate: 4,
  /** The most the camera's idea of the surfer's height may lag below the surfer in the air (metres), so big airs never leave the frame. */
  airLag: IS_PORTRAIT ? 0.7 : 0.5,
  /**
   * Combat framing: with a rival right alongside (within `crowdFull` to
   * `crowdNone` metres to the side, from `crowdBehind` to `crowdAhead`
   * metres along), the camera eases back and up this much so a fight shows
   * both riders rather than one body filling the side of the screen.
   */
  crowdBack: IS_PORTRAIT ? 1.0 : 0.5,
  crowdUp: IS_PORTRAIT ? 0.3 : 0.15,
  crowdFull: 1.4,
  crowdNone: 2.6,
  crowdBehind: -2.0,
  crowdAhead: 2.5,
  crowdRate: 2.5,
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
   * from the camera to the surfer and short of the surfer (up to
   * `lineEnd` of the way there), fades out (Run.applyNearFade).
   */
  nearFull: 3.0,
  nearNone: 4.2,
  lineFull: 0.6,
  lineNone: 1.1,
  lineEnd: 0.92,
  /** ...and the near band moves this much further out for a rival a metre or more behind the surfer. */
  behindShift: 0.5,
  /** How "in the way" (0..1) maps to the rider's screen-door fade: solid below fadeFrom, gone at fadeTo. */
  fadeFrom: 0.15,
  fadeTo: 0.9,
} as const;

/** Short draw distance: linear fog to the sunset colour. The sky dome meets the same colour at the horizon. */
export const FOG = {
  color: 0xf79a52,
  near: IS_PORTRAIT ? 32 : 28,
  far: IS_PORTRAIT ? 100 : 90,
} as const;

/** One sun plus ambient; lighting is per-vertex (Gouraud) in the shader. */
export const LIGHT = {
  /** From the drawn sun, ahead and high: crests rim-light, riders read by ambient. */
  sun: [0.35, 0.8, 0.5] as const,
  ambient: 0.65,
} as const;

/** The drawn sun: its direction from the camera (low, dead ahead down the course) and distance (just inside the far plane, behind the world); the sea's glitter path points at it. */
export const SUN = {
  dir: [0, 0.075, 1] as const,
  distance: CAMERA.far * 0.975,
} as const;

/**
 * The sea's look (world/Ocean.ts and the PS1_WATER shader block): tints
 * multiplied in by distance (turquoise near the camera, deep blue far out),
 * the glitter colour, the foam's pale shade, and how much whitewater the
 * crests, breaking faces and open-water patches carry.
 */
export const WATER = {
  nearTint: [0.78, 1.06, 1.04] as const,
  farTint: [0.62, 0.72, 1.0] as const,
  glint: 0xfff3c4,
  foamShade: 0xa8e6f6,
  /** Foam from height above this (metres) to full at crestFull. */
  crest: 1.35,
  crestFull: 2.2,
  /** Foam on faces steeper than this slope... */
  face: 0.22,
  faceFull: 0.5,
  /** ...and scattered patches of whitewater on open water, up to this much. */
  patches: 0.45,
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
  /** How quickly the turn rate follows the steer, per second: a digital press rolls into the carve over a few frames instead of snapping. */
  carveResponse: 18,
  /** Steering back across (against the current heading) turns this much faster, so changing line stays quick. */
  counterCarveMul: 1.4,
  /** Braking tightens the carve. */
  hardCarveMul: 1.6,
  maxHeading: 0.62,
  /** Heading returns to straight at up to this rate with no input, radians per second (eased by carveResponse). */
  headingReturn: 3.2,
  /** How far the rider and board bank into a carve at the full turn rate, radians (the visual lean follows the turn rate, not the heading). */
  carveLean: 0.36,
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

/**
 * How blows and crashes are felt (game/Run.ts): hit-stop (the whole run
 * freezes for a few frames as a blow lands), camera shake as [amount,
 * seconds] (Run.shake: amount 1 is about CAMERA.shakeMove metres), and
 * splash sizes for Spray.splash (about 1 for a landing, 2 for a knockout).
 */
export const IMPACT = {
  hitStop: { punch: 0.07, barge: 0.09, knockout: 0.14 },
  shake: {
    punch: [1, 0.22],
    barge: [1.5, 0.3],
    knockout: [2.2, 0.42],
    shoved: [0.9, 0.25],
    bump: [0.45, 0.15],
    buoy: [2, 0.35],
    smash: [1.2, 0.25],
    crash: [1.6, 0.32],
    wipeout: [2.4, 0.5],
  },
  /** Rider.takeSplash sizes (knocked-out body 1.4, board 0.6, wipeout 1.1, crash 0.8) are scaled by this for Spray.splash. */
  splashScale: 1.3,
  /** A landing after real air: this splash plus 0.4 per second of air, up to landingSplashMax more. */
  landingSplash: 0.55,
  landingSplashMax: 0.6,
  buoySplash: 1.3,
  smashSplash: 1.6,
} as const;

/**
 * In the air: Left/Right spin, X grabs; land within the tolerance or wipe
 * out. The spin is eased so a phone's digital button is not a full-rate
 * spin the moment it is touched:
 *
 *  - only a press made in the air spins: a steer carried off the water (a
 *    carve held over a crest) never does until it is let go or reversed, and
 *    the first moment of air ignores the steer altogether
 *  - the rate builds while the steer is held, to about 330 degrees a second
 *  - released, the rider settles to an upright by the time it lands
 *    (predicted from its height and fall): a short stray spin unwinds, a
 *    spin with momentum past the half turn completes
 *  - held on a big enough air (about a second), the spin is helped round to
 *    land the 360, and a completed 360 that cannot become a 720 in time is
 *    held there rather than over-rotated
 *
 * A spin held into a landing it cannot complete (a half turn off a small
 * jump) still lands crooked and crashes: that, and pressing too late, are
 * the risks.
 */
export const TRICKS = {
  /** Radians per second at full steer, once the rate has built up (330 degrees a second). */
  spinRate: (Math.PI * 2 * 330) / 360,
  /** Seconds of holding the steer for the spin rate to build from nothing to full. */
  spinRampSeconds: 0.25,
  /** Seconds after leaving the water before a press starts a spin. */
  spinDelay: 0.1,
  /** Stopping, reversing and settling a spin is this many times quicker than building one. */
  spinBrakeMul: 4,
  /** Settling (and helping a held spin round to land) may turn up to this multiple of spinRate... */
  spinSettleMul: 1.4,
  /** ...and helping a held spin round, its rate may build this many times faster than spinRampSeconds allows... */
  spinAssistMul: 2,
  /** ...but only once the turn is this far round (radians, 60 degrees): a short tap never gets the help, so it unwinds instead of whipping round a full 360. */
  spinAssistFrom: Math.PI / 3,
  /** Released, the rider approaches its upright at least this fast (proportional, per second), and faster when the water is close... */
  spinSettleGain: 6,
  /** ...and picks it from where the spin would carry it in this many seconds (momentum: past the half turn it completes). */
  spinSettleLead: 0.35,
  /** The settle aims to be upright this long before touching down (a little slack for a swell rising to meet the rider). */
  spinLandingMargin: 0.08,
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

/**
 * Rider animation (entities/RiderAnimator.ts): the combat clips' phases in
 * seconds (anticipation, strike, hold, recovery), how a hit is felt, the
 * knockout's launch and tumble, and the wipeout. The physics never waits on
 * these; they only shape what is drawn.
 */
export const RIDER_ANIM = {
  /** The punch's hold is longer than a real one so the fist stays out long enough to read on a phone. */
  punch: { windup: 0.07, strike: 0.08, hold: 0.12, recover: 0.2 },
  barge: { windup: 0.06, strike: 0.08, hold: 0.1, recover: 0.2 },
  /** A punch or barge connects this long after it starts (mid-strike): the victim's shove and flinch wait for the fist. */
  impactDelay: 0.09,
  /** The flinch's length, and how long the board wobbles after a hit. */
  flinchSeconds: 0.5,
  /** The deep knee bend on landing. */
  landSeconds: 0.22,
  /** Knockout: the body is thrown up and sideways (m/s) and tumbles (rad/s); the board flies off the same side, lower and slower, flipping. */
  koUp: 6,
  koSide: 2.6,
  koTumble: 8,
  boardUp: 4.2,
  boardSide: 1.2,
  boardTumble: 11,
  /** Floating after the splash, the body sinks this far over the respawn wait. */
  koSink: 0.55,
  /** The last heart: pitch forward over the board into the water over this long. */
  wipeoutFall: 0.45,
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

/** The original game's palette (docs/art-direction/README.md), reused for water, sky and riders, plus the sequel's shore colours. */
export const PALETTE = {
  deepWater: 0x16399a,
  water: 0x1b7fd0,
  lightWater: 0x2cb8d4,
  foam: 0xf8fbff,
  cloud: 0xff7a50,
  cloudLit: 0xffc070,
  cloudDark: 0x5a2a7a,
  cliffDeep: 0x180a38,
  cliff: 0x40207e,
  cliffLit: 0x7c4ab8,
  cliffRim: 0xff8a5a,
  rock: 0x4a2c5e,
  sand: 0xe8a66a,
  palm: 0x1d6b4a,
  palmLit: 0x3f9a4e,
  wood: 0x7a4a2a,
  glow: 0xffc45a,
  skyTop: 0x34105a,
  skyMid: 0xe24e66,
  horizon: 0xffcf6b,
  sun: 0xffe9a0,
  island: 0x3a1f5e,
  mountain: 0x6a3a8e,
  mountainFar: 0xb0628e,
  outline: 0x1a1a2e,
  ui: 0x1a0b2e,
  gold: 0xffd166,
  cyan: 0x7ff6ff,
  red: 0xff4d6d,
} as const;
