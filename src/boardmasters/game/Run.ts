import { platformOverrideQuery } from '../../game/platform';
import { loadJSON, saveJSON } from '../../systems/Storage';
import type { Hud2D } from '../engine/Hud2D';
import { requestImmersiveMode } from '../engine/immersive';
import type { Input, InputState } from '../engine/Input';
import { createPS1Material, sharedUniforms, syncLook } from '../engine/PS1Material';
import type { Renderer } from '../engine/Renderer';
import { clamp, damp, hex } from '../engine/math';
import { skullTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { Buoy } from '../entities/Buoy';
import { Chevron, chevronMaterial } from '../entities/Chevron';
import { FinishLine } from '../entities/FinishLine';
import type { Landing, Rider } from '../entities/Rider';
import { Rival, type RivalContext } from '../entities/Rival';
import { Spray } from '../entities/Spray';
import { Wake } from '../entities/Wake';
import { Surfer } from '../entities/Surfer';
import { CourseGenerator, COURSES, type CourseSpec } from '../world/Course';
import { Ocean } from '../world/Ocean';
import { Scenery } from '../world/Scenery';
import { Sky } from '../world/Sky';
import { CHARACTER_ORDER, CHARACTER_STORAGE_KEY, CHARACTERS, RIVALS, type RiderSpec } from './characters';
import { type Combo, ComboReader } from './Combos';
import { CAMERA, COMBAT, FOG, HEALTH, IMPACT, MENU_ZONE, PALETTE, PHYSICS, RACE, RAGE, RIDER_ANIM, SCORING, TRICKS } from './constants';
import { PAUSE_ZONE, titleArrowX, titleRow } from './HudLayout';
import { HudView } from './HudView';

/** The title (attract and character select), a race in play, paused, and the two ends of a race: wiped out (did not finish) or over the line. */
export type RunState = 'title' | 'playing' | 'paused' | 'wipeout' | 'finished';

/** The best race on this device for one course: the fastest finish (race seconds) and best place (null until one finishes), and the best score (a wipeout can set it). */
export interface RaceBest {
  time: number | null;
  place: number | null;
  score: number;
}

/** A rider over the finish line: who, whether it is the surfer, and the race time they crossed it. */
export interface Finisher {
  name: string;
  id: string;
  player: boolean;
  time: number;
}

export interface FloatingText {
  text: string;
  color: string;
  age: number;
  scale: number;
  /**
   * A word over a rider (the blows' HIT!, BARGE!, KNOCKOUT): where it
   * shows, in metres from the surfer (so it keeps its place in the chase
   * camera's view). Null for the column beside the surfer.
   */
  anchor: { x: number; y: number; z: number } | null;
}

const FLOAT_SECONDS = 1.3;
/** At most this many floats in each place (the column beside the surfer, and over the riders); a new one pushes out the oldest. */
const FLOAT_MAX = 2;
/** Metres above a rider's feet where a word over them starts (about the head). */
const FLOAT_HEAD = 2.0;
/**
 * The start grid for the rivals: (x, z) from the player. Everyone starts
 * ahead and off to the side, so nobody starts beside or behind the camera
 * (a huge cut-off body at the screen edge) and the field comes back to the
 * player over the first seconds instead of piling onto it.
 */
const RIVAL_GRID: [number, number][] = [[-4, 7], [4, 10], [-7, 14], [7, 18], [0, 23]];
/** On the title the rivals ride parked in these slots, well ahead and clear of the selected character. */
const TITLE_GRID: [number, number][] = [[-4.5, 13], [4.5, 17], [-7.5, 22], [7.5, 27], [-1.5, 33]];
/** Seconds a hit spark (the comic star at the point of contact) shows. */
export const SPARK_SECONDS = 0.24;

/** localStorage key prefix (through systems/Storage) for a course's best race (RaceBest), followed by the course id. */
const RACE_KEY = 'bm.race.';
/** Pooled skull buoys: enough for the generated stretch ahead at the tightest spacing. */
const BUOY_POOL = 24;
/** Pooled boost gates: the stretch ahead holds at most four. */
const CHEVRON_POOL = 8;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const inZone = (x: number | null, y: number | null, zx: number, zy: number, w: number, h: number): boolean => x !== null && y !== null && x >= zx && x < zx + w && y >= zy && y < zy + h;

/** A blow on its way: when it lands, the freeze, the jolt, the word (over `over`, or beside the surfer) and a spark where `from` meets `to`. */
interface PendingImpact {
  /** Health the surfer loses as it lands (a rival's blow), else 0. */
  damage: number;
  at: number;
  hitStop: number;
  shake: readonly [number, number];
  label: string;
  color: string;
  scale: number;
  over: Rider | null;
  from: Rider;
  to: Rider;
  /** The surfer's speed is multiplied by this as it lands (a rival's shoulder check), else 1. */
  slow: number;
}

/** A change of the surfer's health (the HUD shows "-12" or "+6" beside the bar for a moment): the amount and the run time it happened. */
export interface HealthChange {
  delta: number;
  at: number;
}

/** A hit spark, in metres from the surfer (like an anchored float), with its age and size (metres across). */
export interface HitSpark {
  x: number;
  y: number;
  z: number;
  age: number;
  size: number;
}

/**
 * One course, one surfer, the field of rivals and the hazards, and the
 * rules that join them: distance and score, air and tricks, buoy hits and
 * health, HIT and BARGE with knockouts and combos, the RAGE meter, the
 * finish, and the title (with the character select), pause and results
 * overlays.
 */
export class Run {
  state: RunState = 'title';
  score = 0;
  /** The surfer's health, 0..HEALTH.max: blows, buoys and crashes take it, clean tricks give it back; at zero the surfer wipes out. */
  health: number = HEALTH.max;
  distance = 0;
  /** Seconds on the run clock (never reset; timers compare against it). */
  time = 0;
  stateTime = 0;
  rank = 1;
  rage = 0;
  raging = false;
  rageUntil = 0;
  knockouts = 0;
  combo = 0;
  comboUntil = 0;
  characterIndex = 0;
  /** The last landing with the points it scored (tests read it). */
  lastLanding: (Landing & { points: number }) | null = null;
  /** The best race on this device for this course; whether this race set any of it, and which. */
  best: RaceBest;
  newBest = false;
  readonly newBests = { time: false, place: false, score: false };
  /** The run time the race started (Run.start). */
  raceStart = 0;
  /** Over the line: the surfer's race time (seconds), place (1 to 6; 0 until then) and the place bonus added to the score. */
  finishTime = 0;
  place = 0;
  placeBonus = 0;
  /** Everyone over the line so far, in order (rivals keep racing after the surfer finishes). */
  readonly finishOrder: Finisher[] = [];
  /** The finish line across the course at its length. */
  readonly finishLine = new FinishLine();
  /** The latest race callout ("500 M TO GO", "FINAL STRETCH", "FINISH!") and the run time it was called: the HUD sweeps it across the screen. */
  callout: { text: string; at: number } | null = null;
  /** The race clock frozen when the race ended for the surfer (finished or wiped out), else -1. */
  private raceOver = -1;
  /** How many of RACE.callouts have shown, and every rider's z on the step before (for crossing the line). */
  private calloutsShown = 0;
  private playerPrevZ = 0;
  private readonly rivalPrevZ: number[] = [];
  readonly ocean = new Ocean();
  readonly sky: Sky;
  readonly surfer: Surfer;
  readonly rivals: Rival[] = [];
  readonly buoys: Buoy[] = [];
  readonly chevrons: Chevron[] = [];
  readonly spray = new Spray();
  readonly wake = new Wake();
  readonly scenery = new Scenery();
  /** The race course, generated ahead of the surfer. */
  generator: CourseGenerator;
  private featureCount = -1;
  private floating: FloatingText[] = [];
  private changes: HealthChange[] = [];
  /** The combo reader (the HUD shows its held presses). */
  readonly combos = new ComboReader();
  private invulnerableUntil = 0;
  /** Whether the surfer is pulsing white for its invulnerability (cleared when it ends). */
  private pulsing = false;
  private bumpCooldown = 0;
  /** What the rivals are told each step, and the run time before which no rival may start another attack (COMBAT.rivalStagger). */
  private readonly rivalContext: RivalContext = { fight: false, attackOpen: true, length: 1 };
  private rivalAttackGate = 0;
  /**
   * Blows on their way (the surfer's punches and barges, and rivals'
   * shoulder checks on the surfer), oldest first: each lands a moment later,
   * when the fist or shoulder arrives. Two in quick succession both land,
   * each with its own word; the freeze is the stronger one.
   */
  private impacts: PendingImpact[] = [];
  /** Hit sparks on screen (the HUD draws them). */
  private sparks: HitSpark[] = [];
  /** The rider whose blow just landed, and the run time until which the camera keeps the fight framed (crowdAmount, updateCamera). */
  private focusTarget: Rider | null = null;
  private focusUntil = 0;
  /** Hit-stop: seconds the run stays frozen while a blow lands (only the camera shake and the HUD move). */
  hitStop = 0;
  /** The rival the surfer's last blow is aimed at, and the run time until which its reaction must stay in sight (updateNearFade). */
  private strikeTarget: Rival | null = null;
  private strikeUntil = 0;
  private snapCamera = true;
  /** Camera and look-at offsets from the surfer, eased; the surfer's own motion is followed exactly. */
  private readonly camOffset = new THREE.Vector3();
  private readonly lookOffset = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(
    private readonly renderer: Renderer,
    readonly hud: Hud2D,
    readonly input: Input,
    spec: RiderSpec,
    readonly course: CourseSpec = COURSES.sunsetBay,
  ) {
    this.generator = new CourseGenerator(course);
    this.best = Run.loadBest(course.id);
    this.finishLine.place(course.length);
    this.sky = new Sky();
    const scene = renderer.scene;
    scene.add(this.ocean.mesh, this.sky.group, this.scenery.group, this.spray.mesh);
    scene.add(this.wake.mesh, this.finishLine.group);

    this.characterIndex = Math.max(0, CHARACTER_ORDER.indexOf(spec.id as (typeof CHARACTER_ORDER)[number]));
    this.surfer = new Surfer(spec);
    scene.add(this.surfer.group, this.surfer.shadow);
    // Never a clone of the player's own character (selectCharacter swaps one out if the player picks a rival's look).
    const pool = [...RIVALS, ...CHARACTER_ORDER.filter((id) => id !== spec.id).map((id) => CHARACTERS[id])];
    for (let i = 0; i < course.rivals; i++) {
      const rival = new Rival(pool[i % pool.length], i);
      rival.autoNearFade = false; // the camera's rule (updateNearFade) decides, sight line included
      this.rivals.push(rival);
      scene.add(rival.group, rival.shadow);
    }
    // One material per buoy (one texture): each fades on its own as the camera comes up to it.
    const skull = skullTexture();
    for (let i = 0; i < BUOY_POOL; i++) {
      const buoy = new Buoy(createPS1Material({ map: skull, fade: true }));
      this.buoys.push(buoy);
      scene.add(buoy.group);
    }
    const gate = chevronMaterial();
    for (let i = 0; i < CHEVRON_POOL; i++) {
      const chevron = new Chevron(gate);
      this.chevrons.push(chevron);
      scene.add(chevron.mesh);
    }
    this.reset(true);
  }

  /** A course's saved best, normalised: anything missing, corrupt or hand-edited reads as no best. */
  private static loadBest(id: string): RaceBest {
    const raw = loadJSON<Partial<RaceBest> | null>(RACE_KEY + id, null);
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const saved = raw !== null && typeof raw === 'object' ? raw : null;
    const place = num(saved?.place);
    return { time: num(saved?.time), place: place !== null && place >= 1 ? place : null, score: num(saved?.score) ?? 0 };
  }

  get spec(): RiderSpec {
    return this.surfer.spec;
  }

  /** The surfer's progress along the race, 0 at the start to 1 at the finish line (where they wiped out, after a wipeout). */
  get raceProgress(): number {
    return clamp((this.state === 'wipeout' ? this.distance : this.surfer.z) / this.course.length, 0, 1);
  }

  /** Seconds since the start of the race (the run clock, so hit-stops do not count), frozen when it ends; 0 on the title. */
  get raceTime(): number {
    if (this.state === 'title') return 0;
    return this.raceOver >= 0 ? this.raceOver : this.time - this.raceStart;
  }

  /** The floating texts on screen, oldest first (the HUD draws them). */
  get floats(): readonly FloatingText[] {
    return this.floating;
  }

  /** The hit sparks on screen (the HUD draws them). */
  get hitSparks(): readonly HitSpark[] {
    return this.sparks;
  }

  /** Run time until which the surfer is invulnerable after a hit (the surfer pulses meanwhile). */
  get invulnerableTill(): number {
    return this.invulnerableUntil;
  }

  /** The surfer's recent health changes, oldest first (kept HEALTH.changeSeconds): the HUD's "-12" and "+6" beside the bar, and its flash. */
  get healthChanges(): readonly HealthChange[] {
    return this.changes;
  }

  /** Everyone back to the start line, with a fresh course ahead; `title` parks the rivals in the title's slots instead. */
  reset(title = this.state === 'title'): void {
    this.generator = new CourseGenerator(this.course);
    this.featureCount = -1;
    for (const b of this.buoys) b.retire();
    for (const c of this.chevrons) c.retire();
    this.extendCourse(0);
    this.ocean.advance(0, 0);
    this.surfer.reset(0, 0, this.ocean);
    this.surfer.maxHealth = HEALTH.max;
    this.surfer.health = HEALTH.max;
    // The field's two fastest (by SPEED) sprint for the line hardest.
    const bySpeed = [...this.rivals].sort((a, b) => b.spec.speed - a.spec.speed);
    for (const r of this.rivals) r.sprinter = bySpeed.indexOf(r) < 2;
    const grid = title ? TITLE_GRID : RIVAL_GRID;
    this.rivals.forEach((rival, i) => {
      const [x, z] = grid[i % grid.length];
      rival.respawn(x, z, this.ocean);
      rival.holdChecks(this.time + COMBAT.rivalGraceSeconds); // no shoulder checks in the first seconds of a run
    });
    this.newBest = false;
    this.newBests.time = this.newBests.place = this.newBests.score = false;
    this.finishTime = 0;
    this.place = 0;
    this.placeBonus = 0;
    this.finishOrder.length = 0;
    this.raceOver = -1;
    this.calloutsShown = 0;
    this.callout = null;
    this.finishLine.calm();
    this.playerPrevZ = this.surfer.z;
    this.rivals.forEach((r, i) => {
      r.finishedAt = -1;
      this.rivalPrevZ[i] = r.z;
    });
    this.score = 0;
    this.health = HEALTH.max;
    this.changes = [];
    this.distance = 0;
    this.rank = 1;
    this.knockouts = 0;
    this.combo = 0;
    this.comboUntil = 0;
    this.lastLanding = null;
    this.floating = [];
    this.invulnerableUntil = 0;
    this.pulsing = false;
    this.bumpCooldown = 0;
    this.rivalAttackGate = 0;
    this.impacts = [];
    this.sparks = [];
    this.focusTarget = null;
    this.focusUntil = 0;
    this.hitStop = 0;
    this.strikeTarget = null;
    this.strikeUntil = 0;
    this.wake.reset();
    this.spray.reset();
    this.snapCamera = true;
    this.combos.clear();
    this.endRage();
    this.rage = 0;
  }

  start(): void {
    this.reset(false);
    this.state = 'playing';
    this.stateTime = 0;
    this.raceStart = this.time;
  }

  /** Generate the course ahead of `z`, hand new spots to pooled buoys and gates, and retire what is left behind. */
  private extendCourse(z: number): void {
    const added = this.generator.extend(z);
    if (added.buoys.length > 0 || this.generator.features.length !== this.featureCount) {
      this.ocean.setFeatures(this.generator.features);
      this.featureCount = this.generator.features.length;
    }
    for (const b of this.buoys) if (b.active && b.z < z - 60) b.retire();
    for (const c of this.chevrons) if (c.active && c.z < z - 30) c.retire();
    // Spots already behind (a jump down the course generates the stretch passed over too) take no pooled mesh.
    for (const spot of added.buoys) {
      if (spot.z < z - 60) continue;
      const free = this.buoys.find((b) => !b.active);
      if (free) free.place(spot.x, spot.z);
    }
    for (const spot of added.chevrons) {
      if (spot.z < z - 30) continue;
      const free = this.chevrons.find((c) => !c.active);
      if (free) free.place(spot.x, spot.z);
    }
  }

  /** Title screen: cycle the character; the choice is remembered. */
  selectCharacter(direction: number): void {
    const n = CHARACTER_ORDER.length;
    this.characterIndex = (this.characterIndex + direction + n) % n;
    const spec = CHARACTERS[CHARACTER_ORDER[this.characterIndex]];
    // The rival riding in the new character's look takes the one just given up, so the player never races a clone.
    const given = this.surfer.spec;
    for (const r of this.rivals) if (r.spec.id === spec.id) r.setSpec(given);
    this.surfer.setSpec(spec);
    saveJSON(CHARACTER_STORAGE_KEY, spec.id);
  }

  update(dt: number): void {
    if (this.hitStop > 0) {
      // Hit-stop: the world holds still for a few frames as a blow lands (the run clock too, so every timer
      // and animation picks up where it stopped); the camera shake and the words on the HUD keep moving.
      // Input is not read, so presses made now are kept for the next step.
      this.hitStop = Math.max(0, this.hitStop - dt);
      for (const f of this.floating) f.age += dt;
      this.ageSparks(dt); // the spark plays out over the freeze
      this.updateCamera(dt);
      return;
    }
    // Paused, the run clock holds (the race time, rivals' wind-ups, invulnerability and RAGE all wait); the panel's own clock runs.
    if (this.state !== 'paused') this.time += dt;
    this.stateTime += dt;
    syncLook();
    this.input.buttonsActive = this.state === 'playing';
    const input = this.input.poll();
    const idle: InputState = { ...input, steer: 0, pump: false, brake: false, jump: false, attack: false, barge: false };
    const W = this.hud.width;

    switch (this.state) {
      case 'title':
        if (input.back || this.tappedMenu(input)) this.mainMenu();
        else if (input.menuLeft || inZone(input.tapX, input.tapY, titleArrowX(-1) - 16, titleRow() - 10, 32, 32)) this.selectCharacter(-1);
        else if (input.menuRight || inZone(input.tapX, input.tapY, titleArrowX(1) - 16, titleRow() - 10, 32, 32)) this.selectCharacter(1);
        else if (input.start) {
          if (this.input.touch) void requestImmersiveMode();
          this.start();
        }
        // The attract ride starts over before it reaches the finish line.
        if (this.state === 'title' && this.surfer.z > this.course.length - 150) this.reset(true);
        this.simulate(dt, idle, false);
        break;
      case 'playing':
        if (input.back || inZone(input.tapX, input.tapY, W / 2 - PAUSE_ZONE.w / 2 - 6, 0, PAUSE_ZONE.w + 12, PAUSE_ZONE.h + 8)) {
          this.state = 'paused';
          this.stateTime = 0;
          break;
        }
        for (const key of input.presses) {
          const combo = this.combos.push(key, this.time);
          if (combo) this.performCombo(combo);
        }
        this.simulate(dt, input, true);
        break;
      case 'paused':
        if (input.menu || this.tappedMenu(input)) this.mainMenu();
        else if (input.back || input.start) {
          this.state = 'playing';
          this.stateTime = 0;
        }
        break;
      case 'wipeout':
      case 'finished':
        // The results: the surfer rides on (or floats) behind them with the field still racing; input after a moment.
        if (this.stateTime > (this.state === 'finished' ? RACE.resultsSeconds : SCORING.wipeoutSeconds)) {
          if (input.back || this.tappedMenu(input)) this.mainMenu();
          else if (input.start) this.start();
        }
        this.simulate(dt, idle, false);
        break;
    }
    // Paused: everything holds (the wakes, the spray and the words included), not just the riders and the camera.
    if (this.state === 'paused') return;

    for (const f of this.floating) f.age += dt;
    this.ageSparks(dt);
    this.floating = this.floating.filter((f) => f.age < FLOAT_SECONDS);
    if (this.changes.length > 0 && this.time - this.changes[0].at > HEALTH.changeSeconds) this.changes.shift();
    this.updateCamera(dt);
    this.sky.update(this.renderer.camera, this.time);
    this.scenery.update(this.renderer.camera.position.z);
    this.finishLine.update(this.time, this.ocean, this.renderer.camera.position);
    this.spray.update(dt, this.renderer.camera);
    this.wake.update(dt, this.ocean);
  }

  private ageSparks(dt: number): void {
    if (this.sparks.length === 0) return;
    for (const sp of this.sparks) sp.age += dt;
    this.sparks = this.sparks.filter((sp) => sp.age < SPARK_SECONDS);
  }

  render(): void {
    this.ocean.rebuild();
    this.renderer.render();
    this.drawHud();
  }

  private mainMenu(): void {
    const overrides = platformOverrideQuery(); // keep ?touch=1 and the orientation overrides across the pages
    window.location.href = `./?game=boardmasters${overrides ? `&${overrides}` : ''}`;
  }

  private tappedMenu(input: InputState): boolean {
    return inZone(input.tapX, input.tapY, 0, 0, MENU_ZONE.w, MENU_ZONE.h);
  }

  /** Advance the world one step; `live` applies the rules (score, damage, combat, finish). */
  private simulate(dt: number, input: InputState, live: boolean): void {
    const s = this.surfer;
    this.extendCourse(s.z);
    // The sea moves first so every rider samples the surface that is drawn this frame.
    this.ocean.advance(dt, s.z);
    // The pace rises with race progress (rivals' too, in Rival.think); RAGE on top.
    const ramp = 1 + RACE.speedRampMax * this.raceProgress;
    s.targetSpeed = PHYSICS.baseSpeed * s.stats.speed * ramp * (this.raging ? RAGE.speedMul : 1);
    s.update(dt, s.fromInput(input), this.ocean, this.time);
    const buoyPositions = this.buoys.filter((b) => b.active && !b.smashed);
    const ctx = this.rivalContext;
    ctx.fight = live;
    ctx.length = this.course.length;
    for (const r of this.rivals) {
      if (r.knockedOut && this.time >= r.respawnAt) r.respawn((r.index % 2 === 0 ? 1 : -1) * (3 + (r.index % 3) * 2.5), s.z - COMBAT.respawnBehind, this.ocean);
      // On the title the rivals ride parked in their slots ahead, clear of the selected character.
      const slot = this.state === 'title' ? TITLE_GRID[r.index % TITLE_GRID.length] : null;
      ctx.attackOpen = this.time >= this.rivalAttackGate;
      const control = r.think(s, buoyPositions, this.time, slot, ctx);
      // One rival's attack closes the gate for the others for a moment, so two rarely come at once.
      if (r.startedAttack) this.rivalAttackGate = this.time + COMBAT.rivalStagger;
      r.update(dt, control, this.ocean, this.time);
    }
    this.splashFrom(s);
    for (const r of this.rivals) this.splashFrom(r);
    for (const b of this.buoys) b.update(this.time, this.ocean);
    for (const c of this.chevrons) c.update(this.time, this.ocean);

    // Every rider on the water leaves a foam wake and throws spray: a fan from the tail at speed, a rooster tail to the outside of a hard carve.
    const camZ = this.renderer.camera.position.z;
    for (let i = -1; i < this.rivals.length; i++) {
      const r = i < 0 ? s : this.rivals[i];
      if (r.airborne || r.wiped || r.knockedOut || r.speed < 5) continue;
      const sinH = Math.sin(r.heading);
      const cosH = Math.cos(r.heading);
      const tailX = r.x - sinH * 0.9;
      const tailZ = r.z - cosH * 0.9;
      const carve = Math.min(1, Math.abs(r.heading) / PHYSICS.maxHeading);
      const pace = Math.min(1, Math.max(0, (r.speed - 6) / 16));
      this.wake.emit(tailX, r.y, tailZ, r.heading, r.speed, 0.4 + pace * 0.3 + carve * 0.4);
      // Spray only where it can be seen; rivals throw less of it so the pool goes round.
      if (r.z < camZ - 2 || r.z > camZ + 60) continue;
      const boost = this.time < r.boostUntil;
      const amount = (i < 0 ? 1 : 0.45) * (0.8 + pace * 1.2 + carve * 3 + (boost ? 2.5 : 0));
      // Clumps stay small (a rival's big ones read as white tiles over the riders); the surfer's fly close past the camera.
      const maxSize = i < 0 ? 1.4 : 1.25;
      let bursts = Math.floor(amount);
      if (Math.random() < amount - bursts) bursts++;
      const outward = r.heading > 0 ? -1 : 1; // the outside of the turn (heading > 0 carves towards +x)
      for (let k = 0; k < bursts; k++) {
        if (carve > 0.3 && k % 3 !== 2) {
          // Rooster tail: a fan thrown up and out behind the tail, carried along with most of the rider's speed.
          const fan = 0.4 + Math.random() * 0.8;
          this.spray.emit(
            tailX + outward * 0.25, r.y + 0.1, tailZ,
            outward * (1.5 + carve * 4.5) * fan + sinH * r.speed * 0.7, 1.8 + carve * 4.2 * Math.random() + pace, cosH * r.speed * (0.6 + Math.random() * 0.2),
            Math.min(maxSize, 0.8 + carve * 0.8 + Math.random() * 0.5),
          );
        } else {
          const side = (Math.floor(this.time * 60) + k) % 2 === 0 ? -1 : 1;
          this.spray.emit(
            tailX + cosH * side * 0.3, r.y + 0.05, tailZ - sinH * side * 0.3,
            cosH * side * (1 + Math.random() * 1.4) + sinH * r.speed * 0.7, 0.8 + Math.random() * 1.2 + pace * 0.8, cosH * r.speed * (0.65 + Math.random() * 0.2),
            Math.min(maxSize, 0.55 + pace * 0.35),
          );
        }
      }
    }
    // Invulnerable after a hit: the surfer pulses white (never blinks out of sight); RAGE has its own pulse.
    if (this.raging) s.setFlash(RAGE.pulse * (0.5 + 0.5 * Math.sin(this.time * 20)));
    else if (!s.wiped && this.time < this.invulnerableUntil) {
      if (!s.hitFlashing) s.setFlash(0.3 + 0.3 * Math.sin(this.time * 30));
      this.pulsing = true;
    } else if (this.pulsing) {
      this.pulsing = false;
      if (!s.hitFlashing) s.setFlash(0);
    }

    // The line: rivals' crossings are recorded as they happen, through the results too; the surfer's ends the race.
    if (this.state !== 'title') this.trackFinish(dt);
    if (!live || this.state !== 'playing') return;
    this.distance = s.z;
    this.score += s.speed * Math.cos(s.heading) * dt * SCORING.perMetre;
    let ahead = 0;
    for (const r of this.rivals) if (r.finishedAt >= 0 || r.z > s.z) ahead++;
    this.rank = 1 + ahead;
    this.callouts();

    // RAGE: drains while raging, decays slowly otherwise.
    if (this.raging) {
      this.rage = Math.max(0, (this.rageUntil - this.time) / RAGE.seconds);
      if (this.time >= this.rageUntil) this.endRage();
    } else {
      this.rage = Math.max(0, this.rage - RAGE.decayPerSecond * dt);
    }
    if (this.time >= this.comboUntil) this.combo = 0;

    const landing = s.takeLanding();
    if (landing) this.resolveLanding(landing);
    this.resolveAttacks();
    this.resolveRivalPunches();
    if (this.impacts.length > 0 && this.time >= this.impacts[0].at) this.landImpacts();
    this.resolveHazards();
  }

  /** Throw a splash for every body or board that hit the water this step (knockouts, wipeouts, crashes). */
  private splashFrom(r: Rider): void {
    for (let sp = r.takeSplash(); sp; sp = r.takeSplash()) this.spray.splash(sp.x, this.ocean.height(sp.x, sp.z), sp.z, sp.size * IMPACT.splashScale);
  }

  /**
   * Blows arrive: freeze frames (the strongest of those landing), a jolt
   * of the camera, a spark at the point of contact and each blow's word;
   * the camera keeps the fight framed for a moment (focusTarget).
   */
  private landImpacts(): void {
    const s = this.surfer;
    while (this.impacts.length > 0 && this.time >= this.impacts[0].at) {
      const impact = this.impacts.shift() as PendingImpact;
      this.hitStop = Math.max(this.hitStop, impact.hitStop);
      this.shake(impact.shake[0], impact.shake[1]);
      this.float(impact.label, impact.color, impact.scale, impact.over);
      if (impact.slow !== 1) s.speed *= impact.slow;
      if (impact.damage > 0) {
        this.damage(impact.damage, '', HEALTH.blowInvulnerable);
        // A blow landed on the surfer: the field backs off for a moment before anyone attacks again.
        this.rivalAttackGate = Math.max(this.rivalAttackGate, this.time + COMBAT.rivalBackOff);
      }
      // The spark: most of the way from the striker to the one struck, at chest height.
      const a = impact.from;
      const b = impact.to;
      const k = 0.6;
      this.sparks.push({
        x: a.x + (b.x - a.x) * k - s.x,
        y: a.y + (b.y - a.y) * k + IMPACT.sparkHeight * (a.spec.build + b.spec.build) * 0.5 - s.y,
        z: a.z + (b.z - a.z) * k - s.z,
        age: 0,
        size: impact.hitStop >= IMPACT.hitStop.knockout ? IMPACT.sparkSize * 1.4 : IMPACT.sparkSize,
      });
      if (this.sparks.length > 4) this.sparks.shift();
      const victim = b === s ? a : b;
      if (victim !== s) {
        this.focusTarget = victim;
        this.focusUntil = this.time + (victim.knockedOut ? CAMERA.fightKoSeconds : CAMERA.fightSeconds);
      }
    }
  }

  /** Air, spins and grabs score on a clean landing; a bad one is a crash. */
  private resolveLanding(l: Landing): void {
    const s = this.surfer;
    if (l.airTime < SCORING.airSeconds) return;
    this.spray.splash(s.x, this.ocean.height(s.x, s.z), s.z, IMPACT.landingSplash + Math.min(IMPACT.landingSplashMax, l.airTime * 0.4));
    if (!l.clean) {
      const [amount, seconds] = IMPACT.shake.crash;
      this.shake(amount, seconds);
      this.lastLanding = { ...l, points: 0 };
      s.crashUntil = this.time + TRICKS.crashSeconds;
      s.stunnedUntil = Math.max(s.stunnedUntil, this.time + TRICKS.crashSeconds);
      s.speed *= TRICKS.badLandingSpeed;
      // Like buoys, a crash costs no health while the last hit's invulnerability lasts (a buoy clipped in the air, then the landing).
      if (this.time >= this.invulnerableUntil) this.damage(HEALTH.crash, 'CRASH!');
      else this.float('CRASH!', hex(PALETTE.red), 1);
      return;
    }
    const big = l.airTime >= SCORING.bigAirSeconds;
    let points = big ? SCORING.bigAirBonus : SCORING.airBonus;
    let name = big ? 'BIG AIR' : 'AIR';
    const halfTurns = Math.min(TRICKS.spinPoints.length - 1, Math.round(l.spinDeg / 180));
    if (halfTurns >= 1) {
      points += TRICKS.spinPoints[halfTurns];
      name = `${halfTurns * 180}${big ? ' BIG AIR' : ''}`;
    }
    if (l.grabbed) {
      points += TRICKS.grabPoints;
      name += ' GRAB';
    }
    if (l.rolled) {
      points += TRICKS.barrelRollPoints;
      name = halfTurns >= 1 || l.grabbed ? `${name} ROLL` : 'BARREL ROLL';
    }
    const tricked = halfTurns >= 1 || l.grabbed || l.rolled;
    if (tricked) points += TRICKS.landingPoints;
    this.score += points;
    this.lastLanding = { ...l, points };
    // Clean air the surfer made gives health back: a JUMP (more for big air), and spins, grabs and rolls; a ramp or a swell
    // throwing an idle rider up gives nothing on its own, so the bar never refills by itself.
    const made = l.jumped || tricked;
    this.heal(
      (made ? (big ? HEALTH.healBigAir : HEALTH.healAir) : 0) + halfTurns * HEALTH.healPerHalfTurn + (l.grabbed ? HEALTH.healGrab : 0) + (l.rolled ? HEALTH.healRoll : 0),
    );
    this.float(`${name} +${points}`, hex(PALETTE.gold), tricked ? 2 : 1);
    this.addRage(RAGE.perTrick * (1 + halfTurns * 0.5 + (l.grabbed ? 0.5 : 0) + (l.rolled ? 1 : 0)));
  }

  /** A completed input combo: the move it names, if the surfer can do it right now. */
  private performCombo(combo: Combo): void {
    const s = this.surfer;
    switch (combo.id) {
      case 'barrelRollRight':
      case 'barrelRollLeft':
        // Screen-right is world -x; the roll direction follows the carve.
        if (s.barrelRoll(combo.id === 'barrelRollRight' ? -1 : 1, this.time)) this.float(`${combo.name}!`, hex(PALETTE.cyan), 1);
        break;
      case 'boost':
        if (s.boost(this.time)) this.float(`${combo.name}!`, hex(PALETTE.gold), 1);
        break;
    }
  }

  /** The player's punch or barge against the nearest rival in reach; rivals' shoulder checks against the player. */
  private resolveAttacks(): void {
    const s = this.surfer;
    if (s.attacking || s.barging) {
      const barge = s.barging;
      const rangeX = barge ? COMBAT.bargeRangeX : COMBAT.punchRangeX;
      const rangeZ = barge ? COMBAT.bargeRangeZ : COMBAT.punchRangeZ;
      let target: Rival | null = null;
      let best = Infinity;
      for (const r of this.rivals) {
        if (r.knockedOut) continue;
        const dx = Math.abs(r.x - s.x);
        if (dx < rangeX && dx < best && Math.abs(r.z - s.z) < rangeZ && Math.abs(r.y - s.y) < 1.2) {
          best = dx;
          target = r;
        }
      }
      if (target) {
        const dir = Math.sign(target.x - s.x || 1);
        s.strikeDir = dir; // the clip swings at the rider the run shoves
        // Struck in its wind-up (or as it strikes, before contact), a rival's punch is called off: the counter.
        const countered = target.attackPhase !== 'none' || target.checking;
        if (countered) target.cancelAttack();
        const damage = this.raging ? RAGE.attackDamage : barge ? COMBAT.bargeDamage : COMBAT.punchDamage;
        const shove = dir * (barge ? COMBAT.bargeShove : COMBAT.punchShove) * s.stats.power;
        if (barge) s.stunnedUntil = Math.max(s.stunnedUntil, this.time + COMBAT.bargeSelfStun);
        // Damage and points count now; the victim feels it (shove, flinch, launch) when the blow arrives, and so does the camera.
        // The word waits for the blow too, over the victim: HIT!, BARGE!, or the knockout with its points.
        const out = target.takeHit(damage, shove, this.time);
        if (!out) target.provoke(this.time); // a fighter hit and still up comes back at the surfer
        // A knocked-out body is thrown along with the surfer (beside and level with them), so the tumble and splash play out in frame.
        const label = out ? this.knockout(target, 'KNOCKOUT', COMBAT.knockoutPoints, false, s.speed) : countered ? 'COUNTER!' : barge ? 'BARGE!' : 'HIT!';
        // Keep the victim in sight through its flinch (or its knockout flight): the camera's near fade must not screen-door it out.
        this.strikeTarget = target;
        this.strikeUntil = this.time + RIDER_ANIM.impactDelay + (out ? CAMERA.fightKoSeconds : RIDER_ANIM.flinchSeconds);
        const kind = out ? 'knockout' : barge ? 'barge' : 'punch';
        this.queueImpact({
          damage: 0,
          at: this.time + RIDER_ANIM.impactDelay,
          hitStop: IMPACT.hitStop[kind],
          shake: IMPACT.shake[kind],
          label,
          color: out ? hex(PALETTE.gold) : '#ffffff',
          scale: out ? 2 : 1,
          over: target,
          from: s,
          to: target,
          slow: 1,
        });
      }
    }
    for (const r of this.rivals) {
      if (!r.barging || r.knockedOut || s.wiped || this.time < this.invulnerableUntil) continue;
      if (Math.abs(r.x - s.x) > 1.6 || Math.abs(r.z - s.z) > 2.4) continue;
      const dir = Math.sign(s.x - r.x || 1);
      r.strikeDir = dir;
      // Felt when the rival's shoulder arrives, like the surfer's own blows: the shove, the stagger, the flinch, the jolt and the word.
      const at = this.time + RIDER_ANIM.impactDelay;
      const push = dir * COMBAT.rivalShove * r.stats.power;
      s.shoveAt(push, at);
      s.stunnedUntil = Math.max(s.stunnedUntil, at + 0.2);
      s.flinch(dir, Math.abs(push) / 4, at);
      // No second blow while this one is on its way (the health goes when it lands).
      this.invulnerableUntil = Math.max(this.invulnerableUntil, at + HEALTH.blowInvulnerable);
      this.queueImpact({
        damage: HEALTH.barge * r.stats.power,
        at,
        hitStop: 0,
        shake: IMPACT.shake.shoved,
        label: 'SHOVED!',
        color: hex(PALETTE.red),
        scale: 1,
        over: s,
        from: r,
        to: s,
        slow: 0.9,
      });
    }
  }

  /**
   * Rivals' telegraphed punches reaching their contact time: each lands if
   * the surfer is still in punch reach and not high in the air (and not
   * invulnerable), with the flinch, a short hit-stop, the shake, a spark
   * and PUNCHED! over the surfer; out of reach it is DODGED!.
   */
  private resolveRivalPunches(): void {
    const s = this.surfer;
    for (const r of this.rivals) {
      if (!r.takePunchImpact(this.time) || r.knockedOut || r.wiped || s.wiped) continue;
      const dx = s.x - r.x;
      // Out of reach as the fist arrives: carved away, ahead or behind, in the air (the surfer, or a rival launched off a crest in its wind-up).
      const apart = Math.abs(dx) > COMBAT.rivalPunchLandX || Math.abs(s.z - r.z) > COMBAT.punchRangeZ || Math.abs(r.y - s.y) > 1.2;
      if (apart || r.airborne || s.airHeight(this.ocean) > COMBAT.rivalPunchDodgeAir) {
        this.float('DODGED!', hex(PALETTE.cyan), 1, s);
        continue;
      }
      if (this.time < this.invulnerableUntil) continue;
      const dir = Math.sign(dx || 1);
      const push = dir * COMBAT.rivalPunchShove * r.stats.power;
      s.shoveAt(push, this.time);
      s.stunnedUntil = Math.max(s.stunnedUntil, this.time + 0.25);
      s.flinch(dir, Math.max(0.8, Math.abs(push) / 3), this.time);
      this.invulnerableUntil = Math.max(this.invulnerableUntil, this.time + HEALTH.blowInvulnerable);
      this.queueImpact({
        damage: HEALTH.punch * r.stats.power,
        at: this.time,
        hitStop: IMPACT.hitStop.punched,
        shake: IMPACT.shake.punched,
        label: 'PUNCHED!',
        color: hex(PALETTE.red),
        scale: 1,
        over: s,
        from: r,
        to: s,
        slow: 0.92,
      });
    }
  }

  /** A blow on its way, kept in order of arrival. */
  private queueImpact(impact: PendingImpact): void {
    let i = this.impacts.length;
    while (i > 0 && this.impacts[i - 1].at > impact.at) i--;
    this.impacts.splice(i, 0, impact);
  }

  /** Buoys (smashed in RAGE), the course edge, and rider-on-rider bumps. */
  private resolveHazards(): void {
    const s = this.surfer;
    const near = (ax: number, az: number, bx: number, bz: number, rx: number, rz: number) => Math.abs(ax - bx) < rx && Math.abs(az - bz) < rz;
    // Boost gates: ride over the chevrons (on the water) for a free BOOST.
    for (const c of this.chevrons) {
      if (!c.active || Math.abs(c.z - s.z) > 5 || s.wiped) continue;
      if (near(s.x, s.z, c.x, c.z + 1.9, 2.4, 2.6) && s.airHeight(this.ocean) < 1.0) {
        c.retire();
        s.boost(this.time, true);
        this.addRage(RAGE.perGate);
        this.float('BOOST!', hex(PALETTE.cyan), 1);
      }
    }
    for (const b of this.buoys) {
      if (!b.active || b.smashed || Math.abs(b.z - s.z) > 4) continue;
      if (near(s.x, s.z, b.x, b.z, 1.05, 1.1) && s.airHeight(this.ocean) < 1.0) {
        if (this.raging) {
          b.smash();
          this.score += RAGE.smashPoints;
          this.spray.splash(b.x, this.ocean.height(b.x, b.z), b.z, IMPACT.smashSplash);
          const [amount, seconds] = IMPACT.shake.smash;
          this.shake(amount, seconds);
          this.float(`SMASH +${RAGE.smashPoints}`, hex(PALETTE.gold), 1);
        } else if (this.time >= this.invulnerableUntil) {
          // A thud: the surfer is thrown clear to the side (about 1.8 m, past the buoy and out of the chase camera's path),
          // the buoy lurches away and rings back, and the run holds for a beat.
          const dir = Math.sign(s.x - b.x || 1);
          s.speed *= SCORING.hitSpeedFactor;
          s.shoveVx = dir * IMPACT.buoyShove;
          s.stunnedUntil = Math.max(s.stunnedUntil, this.time + 0.45);
          s.flinch(dir, 1.2, this.time);
          b.strike(dir, this.time);
          this.spray.splash(b.x, this.ocean.height(b.x, b.z), b.z, IMPACT.buoySplash);
          const [amount, seconds] = IMPACT.shake.buoy;
          this.shake(amount, seconds);
          this.hitStop = Math.max(this.hitStop, IMPACT.hitStop.buoy);
          this.damage(HEALTH.buoy, 'OUCH!');
        }
      }
    }
    for (const r of this.rivals) {
      if (r.knockedOut) continue;
      const shoved = this.time < r.shovedUntil;
      if (shoved && r.edgeShove >= COMBAT.environmentShove) {
        this.knockout(r, 'OFF THE COURSE', COMBAT.environmentPoints);
        continue;
      }
      if (r.airborne) continue;
      for (const b of this.buoys) {
        if (!b.active || b.smashed || Math.abs(b.z - r.z) > 4 || !near(r.x, r.z, b.x, b.z, 1.05, 1.1)) continue;
        if (shoved) {
          this.knockout(r, 'INTO THE BUOY', COMBAT.environmentPoints);
          break;
        }
        if (this.time >= r.stunnedUntil) {
          r.shoveVx = Math.sign(r.x - b.x || 1) * 5;
          r.speed *= SCORING.hitSpeedFactor;
          r.stunnedUntil = this.time + 0.4;
          r.flinch(Math.sign(r.x - b.x || 1), 1, this.time);
        }
      }
    }
    this.bumpCooldown -= 1 / 60;
    for (const r of this.rivals) {
      if (r.knockedOut || this.bumpCooldown > 0 || !near(s.x, s.z, r.x, r.z, 0.95, 1.9) || Math.abs(s.y - r.y) > 1) continue;
      const dir = Math.sign(s.x - r.x || 1);
      s.shoveVx = dir * 4;
      r.shoveVx = -dir * 4;
      s.speed *= SCORING.bumpSpeedFactor;
      r.speed *= SCORING.bumpSpeedFactor;
      s.flinch(dir, 0.5, this.time);
      r.flinch(-dir, 0.5, this.time);
      const [amount, seconds] = IMPACT.shake.bump;
      this.shake(amount, seconds);
      this.bumpCooldown = 0.6; // the flinches and the shake say it; no word
      // A bump costs a little health (not while invulnerable after a hit, nor from a rival keeping station for an attack
      // that is not its blow, and it gives no invulnerability of its own).
      if (this.time >= this.invulnerableUntil && !r.stationing) this.damage(HEALTH.bump, '', 0);
    }
  }

  /**
   * Take `amount` of health (halved while raging) with `label` floated
   * beside the surfer ('' for none), then `invulnerableFor` seconds without
   * further damage. At zero the surfer wipes out: the race is over for them.
   */
  damage(amount: number, label: string, invulnerableFor: number = HEALTH.hazardInvulnerable): void {
    if (this.state !== 'playing') return;
    const s = this.surfer;
    const loss = Math.min(this.health, Math.max(1, Math.round(amount * (this.raging ? HEALTH.rageFactor : 1))));
    this.health -= loss;
    s.health = this.health;
    this.logChange(-loss);
    if (this.health <= 0) {
      this.health = 0;
      s.health = 0;
      this.state = 'wipeout';
      this.stateTime = 0;
      this.invulnerableUntil = 0;
      s.wiped = true;
      s.group.visible = true;
      const [amount, seconds] = IMPACT.shake.wipeout;
      this.shake(amount, seconds);
      this.endRage();
      this.float('WIPEOUT', hex(PALETTE.red), 2);
      // The race is over unfinished: only the best score can improve.
      this.distance = s.z;
      this.raceOver = this.time - this.raceStart;
      this.saveBest(false);
    } else {
      this.invulnerableUntil = Math.max(this.invulnerableUntil, this.time + invulnerableFor);
      if (label) this.float(label, hex(PALETTE.red), 1);
    }
  }

  /**
   * Who crossed the line this step: each rival's crossing is recorded in
   * order (the moment within the step it crossed), and the surfer's ends
   * the race (finish). A knocked-out body flying over the line does not
   * count; the rival crosses when it is back in the race.
   */
  private trackFinish(dt: number): void {
    const L = this.course.length;
    const stepStart = this.time - dt;
    const crossAt = (prev: number, z: number) => stepStart + dt * clamp((L - prev) / Math.max(1e-6, z - prev), 0, 1);
    for (let i = 0; i < this.rivals.length; i++) {
      const r = this.rivals[i];
      const prev = this.rivalPrevZ[i];
      this.rivalPrevZ[i] = r.z;
      if (r.finishedAt >= 0 || r.knockedOut || prev >= L || r.z < L) continue;
      r.finishedAt = crossAt(prev, r.z);
      this.addFinisher(r.spec.name, r.spec.id, false, r.finishedAt - this.raceStart);
    }
    const s = this.surfer;
    const prev = this.playerPrevZ;
    this.playerPrevZ = s.z;
    if (this.state === 'playing' && !s.wiped && prev < L && s.z >= L) this.finish(crossAt(prev, s.z));
  }

  private addFinisher(name: string, id: string, player: boolean, time: number): void {
    let i = this.finishOrder.length;
    while (i > 0 && this.finishOrder[i - 1].time > time) i--;
    this.finishOrder.splice(i, 0, { name, id, player, time });
  }

  /**
   * Over the line at run time `at`: the race time, the place (one behind
   * every rival already over), the place bonus on the score, FINISH! and
   * the best kept; the surfer rides on behind the results.
   */
  private finish(at: number): void {
    const s = this.surfer;
    this.state = 'finished';
    this.stateTime = 0;
    this.finishTime = at - this.raceStart;
    this.raceOver = this.finishTime;
    let before = 0;
    for (const r of this.rivals) if (r.finishedAt >= 0 && r.finishedAt <= at) before++;
    this.place = before + 1;
    this.rank = this.place;
    this.placeBonus = RACE.placeBonus[Math.min(this.place, RACE.placeBonus.length) - 1];
    this.score += this.placeBonus;
    this.addFinisher(s.spec.name, s.spec.id, true, this.finishTime);
    // Blows still on their way no longer count, and the surfer stops pulsing and raging.
    this.impacts = [];
    this.invulnerableUntil = 0;
    this.endRage();
    this.combos.clear();
    this.callout = { text: 'FINISH!', at: this.time };
    this.finishLine.celebrate(this.time);
    this.saveBest(true);
  }

  /** Keep this race's best on the device (per course): time and place only from a finish, the score either way. */
  private saveBest(finished: boolean): void {
    const b = this.best;
    const nb = this.newBests;
    const score = Math.floor(this.score);
    nb.score = score > b.score;
    nb.time = finished && (b.time === null || this.finishTime < b.time);
    nb.place = finished && (b.place === null || this.place < b.place);
    this.newBest = nb.score || nb.time || nb.place;
    if (!this.newBest) return;
    this.best = { time: nb.time ? this.finishTime : b.time, place: nb.place ? this.place : b.place, score: nb.score ? score : b.score };
    saveJSON(RACE_KEY + this.course.id, this.best);
  }

  /** "500 M TO GO" and "FINAL STRETCH" as the line nears (only the latest, if several are passed at once). */
  private callouts(): void {
    const left = this.course.length - this.surfer.z;
    let text = '';
    while (this.calloutsShown < RACE.callouts.length && left <= RACE.callouts[this.calloutsShown][0]) text = RACE.callouts[this.calloutsShown++][1];
    if (text) this.callout = { text, at: this.time };
  }

  /** Give back `amount` of health (clean tricks), up to HEALTH.max. */
  heal(amount: number): void {
    if (this.state !== 'playing' || amount <= 0) return;
    const gain = Math.min(HEALTH.max - this.health, Math.round(amount));
    if (gain <= 0) return;
    this.health += gain;
    this.surfer.health = this.health;
    this.logChange(gain);
  }

  private logChange(delta: number): void {
    this.changes.push({ delta, at: this.time });
    if (this.changes.length > 4) this.changes.shift();
  }

  /**
   * Knock a rival out: points (times the combo), RAGE, and the word, shown
   * now or (`show` false) by the caller; the body is thrown along at `carry`
   * m/s (its own speed unless given). Returns the word.
   */
  private knockout(r: Rival, label: string, points: number, show = true, carry = r.speed): string {
    r.knockOut(this.time, carry);
    this.knockouts++;
    this.combo = this.time < this.comboUntil ? Math.min(COMBAT.comboMax, this.combo + 1) : 1;
    this.comboUntil = this.time + COMBAT.comboSeconds;
    const total = points * this.combo;
    this.score += total;
    const text = this.combo > 1 ? `${label} +${total} X${this.combo}` : `${label} +${points}`;
    if (show) this.float(text, hex(PALETTE.gold), 2);
    this.addRage(RAGE.perKnockout);
    return text;
  }

  private addRage(amount: number): void {
    if (this.raging) return;
    this.rage = Math.min(1, this.rage + amount * this.surfer.stats.rage);
    if (this.rage >= 1) this.startRage();
  }

  private startRage(): void {
    this.raging = true;
    this.rageUntil = this.time + RAGE.seconds;
    // High over the surfer, in the middle of the screen (above the knockout's word that usually starts it), not in the column at the side.
    this.float('RAGE!', hex(PALETTE.red), 2, this.surfer, 1.4);
    // Only the distance tints (FOG.near and far stay): a deep hot pink, so the riders keep their contrast.
    sharedUniforms.uFogColor.value.setHex(RAGE.fog);
    sharedUniforms.uHorizon.value.setHex(RAGE.horizon);
  }

  private endRage(): void {
    this.raging = false;
    this.surfer.setFlash(0);
    sharedUniforms.uFogColor.value.setHex(FOG.color);
    sharedUniforms.uHorizon.value.setHex(PALETTE.horizon);
  }

  /**
   * Show a word: in the column beside the surfer, or over rider `at` (`lift`
   * metres higher than usual, to clear a blow's word beside it). A word
   * already showing in the same place pops again instead of showing twice,
   * and each place keeps at most FLOAT_MAX words (the oldest goes).
   */
  float(text: string, color: string, scale = 1, at: Rider | null = null, lift = 0): void {
    const s = this.surfer;
    const anchor = at ? { x: at.x - s.x, y: at.y + FLOAT_HEAD + lift - s.y, z: at.z - s.z } : null;
    const list = this.floating;
    const same = list.findIndex((f) => f.text === text && (f.anchor === null) === (anchor === null));
    if (same >= 0) list.splice(same, 1);
    else {
      let count = 0;
      let oldest = -1;
      for (let i = 0; i < list.length; i++) {
        if ((list[i].anchor === null) !== (anchor === null)) continue;
        if (oldest < 0) oldest = i;
        count++;
      }
      if (count >= FLOAT_MAX) list.splice(oldest, 1);
    }
    list.push({ text, color, age: 0, scale, anchor });
  }

  /** Where a float over a rider shows on the HUD (VIEW pixels, into `out`); false for a column float or one behind the camera. */
  floatPoint(f: FloatingText, out: { x: number; y: number }): boolean {
    const a = f.anchor;
    if (!a) return false;
    const s = this.surfer;
    return this.renderer.worldToHud(s.x + a.x, s.y + a.y, s.z + a.z, out);
  }

  /** Where the point `lift` metres over the top of a rider's head (as last drawn) shows on the HUD (VIEW pixels, into `out`); false behind the camera. */
  headPoint(r: Rider, lift: number, out: { x: number; y: number }): boolean {
    const head = r.headTop(this.tmp2);
    return this.renderer.worldToHud(head.x, head.y + lift, head.z, out);
  }

  /** Where a point given in metres from the surfer (a hit spark) shows on the HUD (VIEW pixels, into `out`); false behind the camera. */
  hudPoint(dx: number, dy: number, dz: number, out: { x: number; y: number }): boolean {
    const s = this.surfer;
    return this.renderer.worldToHud(s.x + dx, s.y + dy, s.z + dz, out);
  }

  /**
   * Chase camera: behind and above the surfer, looking down on them (the
   * mockup's framing), never under the water, rolling a little into carves,
   * widening its FOV with speed, BOOST and RAGE, and shaking on demand
   * (shake()). The offsets ease; the surfer's travel along the water is
   * followed exactly, so no speed leaves it behind, while its height is
   * followed loosely in the air so jumps rise in frame (within CAMERA.airLag).
   * The title screen has its own framing (CAMERA.title) that a run glides
   * out of; a rival right alongside eases the camera back a little
   * (crowdAmount); pausing freezes the camera. Ends by fading
   * rivals that come between the camera and the surfer or right up to the
   * lens (updateNearFade).
   */
  private updateCamera(dt: number): void {
    // Paused: the camera stays exactly where it was (no shake, no FOV settling on the frozen frame).
    if (this.state === 'paused') return;
    const s = this.surfer;
    const sinH = Math.sin(s.heading);
    const title = this.state === 'title';
    // A rival right alongside: ease back and up a little so a fight frames both riders rather than one big body.
    const crowd = title ? 0 : this.crowdAmount();
    if (this.snapCamera && !this.camWasTitle) this.camCrowd = crowd;
    else this.camCrowd += (crowd - this.camCrowd) * damp(CAMERA.crowdRate, dt);
    const back = CAMERA.back + (title ? CAMERA.title.back : 0) + this.camCrowd * CAMERA.crowdBack;
    const camX = s.x - sinH * CAMERA.side;
    const camZ = s.z - back;
    // The camera's own idea of the surfer's height: tight on the water, lagging in the air so a jump rises in
    // frame, but never more than CAMERA.airLag below the surfer (big airs stay in frame) and never above them
    // (no hanging on the way down, no jolt on landing).
    if (this.snapCamera) this.followY = s.y;
    else {
      this.followY += (s.y - this.followY) * damp(s.airborne ? CAMERA.airFollowRate : CAMERA.waterFollowRate, dt);
      this.followY = Math.max(s.y - CAMERA.airLag, Math.min(this.followY, s.y));
    }
    const water = this.ocean.height(camX, camZ);
    const height = CAMERA.height + (title ? CAMERA.title.height : 0) + this.camCrowd * CAMERA.crowdUp;
    const desired = this.tmp.set(-sinH * CAMERA.side, Math.max(height, water + CAMERA.clearance + 0.3 - this.followY), -back);
    const look = this.tmp2.set(sinH * CAMERA.lookSide, CAMERA.lookHeight + (title ? CAMERA.title.lookHeight : 0), CAMERA.lookAhead);
    // Swing round behind the board by part of its heading, so a held carve shows the board turned about half as far as it
    // is (it still reads as a carve, not as the board spinning under a camera that stays pointed down the course).
    const yaw = CAMERA.headingFollow * s.heading;
    if (yaw !== 0) {
      desired.applyAxisAngle(Y_AXIS, yaw);
      look.applyAxisAngle(Y_AXIS, yaw);
    }
    // Just after a blow lands, the frame slides towards the rider it hit (eased with the rest), so the reaction stays in shot.
    const focus = title ? null : this.fightFocus();
    if (focus) {
      const bias = Math.max(-CAMERA.fightShift, Math.min(CAMERA.fightShift, (focus.x - s.x) * 0.5));
      desired.x += bias;
      look.x += bias;
    }
    const roll = -s.lean * CAMERA.roll; // banks with how hard the surfer is turning, not with where the board points
    // FOV kick: wider with speed above cruising, more while a BOOST or RAGE lasts; quick to widen, slow to settle.
    const speedUp = Math.min(1, Math.max(0, (s.speed - PHYSICS.baseSpeed) / (PHYSICS.maxSpeed - PHYSICS.baseSpeed)));
    const kick = speedUp * CAMERA.speedFov + (this.time < s.boostUntil ? CAMERA.boostFov : 0) + (this.raging ? CAMERA.rageFov : 0);
    // A run started from the title glides from the title framing into the gameplay one; any other reset snaps.
    const glide = this.snapCamera && this.camWasTitle && !title;
    this.camWasTitle = title;
    if (this.snapCamera && !glide) {
      this.camOffset.copy(desired);
      this.lookOffset.copy(look);
      this.camRoll = roll;
      this.fovKick = 0;
      this.shakeLeft = 0;
      this.snapCamera = false;
    } else {
      if (glide) {
        this.fovKick = 0;
        this.shakeLeft = 0;
        this.snapCamera = false;
      }
      this.camOffset.lerp(desired, damp(CAMERA.followRate, dt));
      this.lookOffset.lerp(look, damp(CAMERA.lookRate, dt));
      this.camRoll += (roll - this.camRoll) * damp(CAMERA.rollRate, dt);
      this.fovKick += (kick - this.fovKick) * damp(kick > this.fovKick ? CAMERA.fovIn : CAMERA.fovOut, dt);
    }
    const camera = this.renderer.camera;
    const fov = CAMERA.fov + this.fovKick;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.position.set(s.x + this.camOffset.x, this.followY + this.camOffset.y, s.z + this.camOffset.z);
    let shakeRoll = 0;
    if (this.shakeLeft > 0) {
      // A decaying jolt: two incommensurate sines per axis read as noise without allocating or seeding anything.
      this.shakeClock += dt;
      const k = this.shakeLeft / this.shakeSeconds;
      const a = this.shakeAmount * k * k;
      const t = this.shakeClock;
      camera.position.x += a * CAMERA.shakeMove * (Math.sin(t * 53) + 0.5 * Math.sin(t * 97 + 1.3));
      camera.position.y += a * CAMERA.shakeMove * (Math.sin(t * 61 + 0.7) + 0.5 * Math.sin(t * 89 + 2.1));
      shakeRoll = a * CAMERA.shakeRoll * Math.sin(t * 71 + 0.4);
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    }
    // Never under (or skimming) the water, whatever the easing and shake did.
    const floor = this.ocean.height(camera.position.x, camera.position.z) + CAMERA.clearance;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(this.tmp.set(s.x + this.lookOffset.x, this.followY + this.lookOffset.y, s.z + this.lookOffset.z));
    camera.rotateZ(this.camRoll + shakeRoll);
    this.updateNearFade();
  }

  /** Eased surfer height (metres), roll (radians) and FOV kick (degrees) of the chase camera. */
  private followY = 0;
  private camRoll = 0;
  private fovKick = 0;
  /** Whether the last camera update framed the title screen (a run started from it glides rather than snaps). */
  private camWasTitle = false;
  /** Eased crowdAmount(): how far the camera has pulled back for a rival alongside. */
  private camCrowd = 0;
  /** The current camera shake: strength, length and seconds left, and its own clock for the wobble. */
  private shakeAmount = 0;
  private shakeSeconds = 1;
  private shakeLeft = 0;
  private shakeClock = 0;

  /**
   * Shake the camera: `amount` 1 is a solid hit (about CAMERA.shakeMove
   * metres and CAMERA.shakeRoll radians), decaying to nothing over
   * `seconds`. A stronger shake replaces a weaker one in progress; a weaker
   * one never cuts a stronger one short. The camera still never dips under
   * the water.
   */
  shake(amount: number, seconds: number): void {
    if (!(amount > 0) || !(seconds > 0)) return;
    const k = this.shakeLeft > 0 ? this.shakeLeft / this.shakeSeconds : 0;
    if (amount < this.shakeAmount * k * k) return;
    this.shakeAmount = amount;
    this.shakeSeconds = seconds;
    this.shakeLeft = seconds;
  }

  /**
   * How much a rival rides right alongside the surfer, 0..1 (full within
   * CAMERA.crowdFull metres to the side, none past crowdNone, counted only
   * from a little behind to a little ahead). Allocation-free.
   */
  private crowdAmount(): number {
    const s = this.surfer;
    // A fight that just happened counts in full (the victim reeling away, a knockout tumbling), so the camera stays back for it.
    if (this.fightFocus()) return 1;
    let amount = 0;
    for (const r of this.rivals) {
      if (r.knockedOut) continue;
      const dz = r.z - s.z;
      if (dz < CAMERA.crowdBehind || dz > CAMERA.crowdAhead) continue;
      amount = Math.max(amount, 1 - Run.step(CAMERA.crowdFull, CAMERA.crowdNone, Math.abs(r.x - s.x)));
    }
    return amount;
  }

  /** The rider a blow just landed on while the camera keeps the fight framed (not too far off to the side or along), else null. */
  private fightFocus(): Rider | null {
    const r = this.focusTarget;
    if (!r || this.time >= this.focusUntil) return null;
    const dz = r.z - this.surfer.z;
    return Math.abs(r.x - this.surfer.x) < 6 && dz > -4 && dz < 10 ? r : null;
  }

  /**
   * Near-camera occlusion: for each rival, how much it is in the way, 0..1,
   * from how close it is to the camera and whether it sits on the sight line
   * from the camera to the surfer, short of the surfer. Allocation-free.
   *
   * The rival the surfer is hitting (strikeTarget, until its flinch or its
   * knockout flight is over) is exempt: the blow and the reaction must read, so only a tighter lens
   * rule (CAMERA.strikeNear) can thin it, when it is right at the lens.
   */
  private updateNearFade(): void {
    const cam = this.renderer.camera.position;
    const s = this.surfer;
    const struck = this.time < this.strikeUntil ? this.strikeTarget : null;
    // The sight line: camera to the surfer's chest.
    const lx = s.x - cam.x;
    const ly = s.y + 1.0 - cam.y;
    const lz = s.z - cam.z;
    const len2 = lx * lx + ly * ly + lz * lz;
    for (const r of this.rivals) {
      if (r === struck) {
        r.fadeNear(cam, CAMERA.strikeNear.start, CAMERA.strikeNear.full);
        continue;
      }
      const rx = r.x - cam.x;
      const ry = r.y + 0.9 - cam.y;
      const rz = r.z - cam.z;
      // A rival dropping back past the surfer only fills the bottom of the frame, so it fades from further out.
      const shift = CAMERA.behindShift * Run.step(0, 1, s.z - r.z);
      const near = 1 - Run.step(CAMERA.nearFull + shift, CAMERA.nearNone + shift, Math.sqrt(rx * rx + ry * ry + rz * rz));
      let between = 0;
      const t = (rx * lx + ry * ly + rz * lz) / len2;
      if (t > 0 && t < 1) {
        const px = rx - lx * t;
        const py = ry - ly * t;
        const pz = rz - lz * t;
        between = (1 - Run.step(CAMERA.lineFull, CAMERA.lineNone, Math.sqrt(px * px + py * py + pz * pz))) * (1 - Run.step(CAMERA.lineEnd, 1, t));
      }
      this.applyNearFade(r, r.knockedOut ? 0 : Math.max(near, between));
    }
    for (const b of this.buoys) b.fadeNear(cam);
  }

  /**
   * Fade a rival that is in the camera's way, through the rider's
   * screen-door transparency (Rider.setNearFade / fadeNear). Never used on
   * the surfer (simulate flashes it while invulnerable).
   */
  private applyNearFade(rider: Rival, amount: number): void {
    // The rider's own rule fades the body and the board by their distance to the lens (a knocked-out board skidding
    // past fades on its own); in the way of the surfer, the whole rider screen-doors out from 0.15 to gone by 0.9.
    const own = rider.fadeNear(this.renderer.camera.position);
    const inWay = Run.step(CAMERA.fadeFrom, CAMERA.fadeTo, amount);
    if (inWay > own) rider.setNearFade(inWay);
  }

  /** Hermite step from 0 at `e0` to 1 at `e1` (engine/math's smoothstep, kept local to the camera code). */
  private static step(e0: number, e1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  /** The 2D overlay is game/HudView.ts (made on the first frame). */
  private hudView: HudView | null = null;

  private drawHud(): void {
    (this.hudView ??= new HudView(this)).draw();
  }
}
