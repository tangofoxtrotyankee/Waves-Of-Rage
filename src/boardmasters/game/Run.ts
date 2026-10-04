import { platformOverrideQuery } from '../../game/platform';
import { loadJSON, saveJSON } from '../../systems/Storage';
import type { Hud2D } from '../engine/Hud2D';
import { requestImmersiveMode } from '../engine/immersive';
import type { Input, InputState } from '../engine/Input';
import { createPS1Material, sharedUniforms, syncLook } from '../engine/PS1Material';
import type { Renderer } from '../engine/Renderer';
import { damp, hex } from '../engine/math';
import { skullTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { Buoy } from '../entities/Buoy';
import { Chevron, chevronMaterial } from '../entities/Chevron';
import type { Landing, Rider } from '../entities/Rider';
import { Rival } from '../entities/Rival';
import { Spray } from '../entities/Spray';
import { Wake } from '../entities/Wake';
import { Surfer } from '../entities/Surfer';
import { CourseGenerator, COURSES, type CourseSpec } from '../world/Course';
import { Ocean } from '../world/Ocean';
import { Scenery } from '../world/Scenery';
import { Sky } from '../world/Sky';
import { CHARACTER_ORDER, CHARACTER_STORAGE_KEY, CHARACTERS, RIVALS, type RiderSpec } from './characters';
import { type Combo, ComboReader } from './Combos';
import { CAMERA, COMBAT, FOG, IMPACT, MENU_ZONE, PALETTE, PHYSICS, RAGE, RIDER_ANIM, SCORING, TRICKS } from './constants';
import { PAUSE_ZONE, titleArrowX, titleRow } from './HudLayout';
import { HudView } from './HudView';

export type RunState = 'title' | 'playing' | 'paused' | 'wipeout';

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
/** The start grid for the rivals: (x, z) around the player. */
const RIVAL_GRID: [number, number][] = [[-4, 6], [4, 9], [-8, 3], [8, 12], [-6, -6], [2, 16], [7, -9], [-3, 20]];

/** localStorage key (through systems/Storage) for the best score and distance. */
const BEST_KEY = 'bm.best';
/** Pooled skull buoys: enough for the generated stretch ahead at the tightest spacing. */
const BUOY_POOL = 24;
/** Pooled boost gates: the stretch ahead holds at most four. */
const CHEVRON_POOL = 8;
type ImpactKind = keyof typeof IMPACT.hitStop;
const inZone = (x: number | null, y: number | null, zx: number, zy: number, w: number, h: number): boolean => x !== null && y !== null && x >= zx && x < zx + w && y >= zy && y < zy + h;

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
  health: number = SCORING.startHealth;
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
  /** Best score and distance on this device, and whether this run set one. */
  best: { score: number; distance: number };
  newBest = false;
  readonly ocean = new Ocean();
  readonly sky: Sky;
  readonly surfer: Surfer;
  readonly rivals: Rival[] = [];
  readonly buoys: Buoy[] = [];
  readonly chevrons: Chevron[] = [];
  readonly spray = new Spray();
  readonly wake = new Wake();
  readonly scenery = new Scenery();
  /** The endless course, generated ahead of the surfer. */
  generator: CourseGenerator;
  private featureCount = -1;
  private floating: FloatingText[] = [];
  /** The combo reader (the HUD shows its held presses). */
  readonly combos = new ComboReader();
  private invulnerableUntil = 0;
  private bumpCooldown = 0;
  /** A blow the surfer threw that lands a moment later (when the fist arrives): its time, its kind and the word to show. */
  private impact: { at: number; kind: ImpactKind; label: string; color: string; scale: number; target: Rider } | null = null;
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
    this.best = loadJSON<{ score: number; distance: number }>(BEST_KEY, { score: 0, distance: 0 });
    this.sky = new Sky();
    const scene = renderer.scene;
    scene.add(this.ocean.mesh, this.sky.group, this.scenery.group, this.spray.mesh);
    scene.add(this.wake.mesh);

    this.characterIndex = Math.max(0, CHARACTER_ORDER.indexOf(spec.id as (typeof CHARACTER_ORDER)[number]));
    this.surfer = new Surfer(spec);
    scene.add(this.surfer.group, this.surfer.shadow);
    const pool = [...RIVALS, ...CHARACTER_ORDER.map((id) => CHARACTERS[id])];
    for (let i = 0; i < course.rivals; i++) {
      const rival = new Rival(pool[i % pool.length], i);
      rival.autoNearFade = false; // the camera's rule (updateNearFade) decides, sight line included
      this.rivals.push(rival);
      scene.add(rival.group, rival.shadow);
    }
    const drum = createPS1Material({ map: skullTexture() });
    for (let i = 0; i < BUOY_POOL; i++) {
      const buoy = new Buoy(drum);
      this.buoys.push(buoy);
      scene.add(buoy.group);
    }
    const gate = chevronMaterial();
    for (let i = 0; i < CHEVRON_POOL; i++) {
      const chevron = new Chevron(gate);
      this.chevrons.push(chevron);
      scene.add(chevron.mesh);
    }
    this.reset();
  }

  get spec(): RiderSpec {
    return this.surfer.spec;
  }

  /** The floating texts on screen, oldest first (the HUD draws them). */
  get floats(): readonly FloatingText[] {
    return this.floating;
  }

  /** Run time until which the surfer is invulnerable after a hit (the HUD flashes the lost heart). */
  get invulnerableTill(): number {
    return this.invulnerableUntil;
  }

  /** Everyone back to the start line, with a fresh course ahead. */
  reset(): void {
    this.generator = new CourseGenerator(this.course);
    this.featureCount = -1;
    for (const b of this.buoys) b.retire();
    for (const c of this.chevrons) c.retire();
    this.extendCourse(0);
    this.ocean.advance(0, 0);
    this.surfer.reset(0, 0, this.ocean);
    this.surfer.health = SCORING.startHealth;
    this.rivals.forEach((rival, i) => rival.respawn(RIVAL_GRID[i % RIVAL_GRID.length][0], RIVAL_GRID[i % RIVAL_GRID.length][1], this.ocean));
    this.newBest = false;
    this.score = 0;
    this.health = SCORING.startHealth;
    this.distance = 0;
    this.rank = 1;
    this.knockouts = 0;
    this.combo = 0;
    this.comboUntil = 0;
    this.lastLanding = null;
    this.floating = [];
    this.invulnerableUntil = 0;
    this.bumpCooldown = 0;
    this.impact = null;
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
    this.reset();
    this.state = 'playing';
    this.stateTime = 0;
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
    for (const spot of added.buoys) {
      const free = this.buoys.find((b) => !b.active);
      if (free) free.place(spot.x, spot.z);
    }
    for (const spot of added.chevrons) {
      const free = this.chevrons.find((c) => !c.active);
      if (free) free.place(spot.x, spot.z);
    }
  }

  /** Title screen: cycle the character; the choice is remembered. */
  selectCharacter(direction: number): void {
    const n = CHARACTER_ORDER.length;
    this.characterIndex = (this.characterIndex + direction + n) % n;
    const spec = CHARACTERS[CHARACTER_ORDER[this.characterIndex]];
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
      this.updateCamera(dt);
      return;
    }
    this.time += dt;
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
        if (this.stateTime > SCORING.wipeoutSeconds) {
          if (input.back || this.tappedMenu(input)) this.mainMenu();
          else if (input.start) this.start();
        }
        this.simulate(dt, idle, false);
        break;
    }

    for (const f of this.floating) f.age += dt;
    this.floating = this.floating.filter((f) => f.age < FLOAT_SECONDS);
    this.updateCamera(dt);
    this.sky.update(this.renderer.camera, this.time);
    this.scenery.update(this.renderer.camera.position.z);
    this.spray.update(dt, this.renderer.camera);
    this.wake.update(dt, this.ocean);
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
    // The endless course speeds up with distance; RAGE on top.
    const ramp = 1 + Math.min(SCORING.speedRampMax, (this.distance / SCORING.speedRampOver) * SCORING.speedRampMax);
    s.targetSpeed = PHYSICS.baseSpeed * s.stats.speed * ramp * (this.raging ? RAGE.speedMul : 1);
    s.update(dt, s.fromInput(input), this.ocean, this.time);
    const buoyPositions = this.buoys.filter((b) => b.active && !b.smashed);
    for (const r of this.rivals) {
      if (r.knockedOut && this.time >= r.respawnAt) r.respawn((r.index % 2 === 0 ? 1 : -1) * (3 + (r.index % 3) * 2.5), s.z - COMBAT.respawnBehind, this.ocean);
      r.update(dt, r.think(s, buoyPositions, this.time), this.ocean, this.time);
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
      this.wake.emit(tailX, r.y, tailZ, r.heading, r.speed, 0.55 + pace * 0.35 + carve * 0.4);
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
    s.group.visible = s.wiped || this.time >= this.invulnerableUntil || Math.floor(this.time * 12) % 2 === 0;
    if (this.raging) s.setFlash(0.2 + 0.2 * Math.sin(this.time * 20));

    if (!live) return;
    this.distance = s.z;
    this.score += s.speed * Math.cos(s.heading) * dt * SCORING.perMetre;
    this.rank = 1 + this.rivals.filter((r) => r.z > s.z).length;

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
    if (this.impact && this.time >= this.impact.at) this.landImpact();
    this.resolveAttacks();
    this.resolveHazards();
  }

  /** Throw a splash for every body or board that hit the water this step (knockouts, wipeouts, crashes). */
  private splashFrom(r: Rider): void {
    for (let sp = r.takeSplash(); sp; sp = r.takeSplash()) this.spray.splash(sp.x, this.ocean.height(sp.x, sp.z), sp.z, sp.size * IMPACT.splashScale);
  }

  /** The surfer's blow arrives: freeze frames, a jolt of the camera and the word. */
  private landImpact(): void {
    const impact = this.impact;
    if (!impact) return;
    this.impact = null;
    this.hitStop = IMPACT.hitStop[impact.kind];
    const [amount, seconds] = IMPACT.shake[impact.kind];
    this.shake(amount, seconds);
    this.float(impact.label, impact.color, impact.scale, impact.target);
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
      this.damage('WIPEOUT -1');
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
        const damage = this.raging ? RAGE.attackDamage : barge ? COMBAT.bargeDamage : COMBAT.punchDamage;
        const shove = dir * (barge ? COMBAT.bargeShove : COMBAT.punchShove) * s.stats.power;
        if (barge) s.stunnedUntil = Math.max(s.stunnedUntil, this.time + COMBAT.bargeSelfStun);
        // Damage and points count now; the victim feels it (shove, flinch, launch) when the blow arrives, and so does the camera.
        // The word waits for the blow too, over the victim: HIT!, BARGE!, or the knockout with its points.
        const out = target.takeHit(damage, shove, this.time);
        const label = out ? this.knockout(target, 'KNOCKOUT', COMBAT.knockoutPoints, false) : barge ? 'BARGE!' : 'HIT!';
        // Keep the victim in sight through its flinch: the camera's near fade must not screen-door it out as the blow lands.
        this.strikeTarget = target;
        this.strikeUntil = this.time + RIDER_ANIM.impactDelay + RIDER_ANIM.flinchSeconds;
        this.impact = {
          at: this.time + RIDER_ANIM.impactDelay,
          kind: out ? 'knockout' : barge ? 'barge' : 'punch',
          label,
          color: out ? hex(PALETTE.gold) : '#ffffff',
          scale: out ? 2 : 1,
          target,
        };
      }
    }
    for (const r of this.rivals) {
      if (!r.barging || r.knockedOut || s.wiped || this.time < this.invulnerableUntil) continue;
      if (Math.abs(r.x - s.x) > 1.6 || Math.abs(r.z - s.z) > 2.4) continue;
      const dir = Math.sign(s.x - r.x || 1);
      r.strikeDir = dir;
      s.shoveVx = dir * COMBAT.rivalShove * r.stats.power;
      s.speed *= 0.9;
      s.stunnedUntil = Math.max(s.stunnedUntil, this.time + 0.2);
      s.flinch(dir, (COMBAT.rivalShove * r.stats.power) / 4, this.time);
      const [amount, seconds] = IMPACT.shake.shoved;
      this.shake(amount, seconds);
      this.float('SHOVED!', hex(PALETTE.cyan), 1);
    }
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
          const dir = Math.sign(s.x - b.x || 1);
          s.speed *= SCORING.hitSpeedFactor;
          s.shoveVx = dir * 6;
          s.stunnedUntil = Math.max(s.stunnedUntil, this.time + 0.45);
          s.flinch(dir, 1.2, this.time);
          this.spray.splash(b.x, this.ocean.height(b.x, b.z), b.z, IMPACT.buoySplash);
          const [amount, seconds] = IMPACT.shake.buoy;
          this.shake(amount, seconds);
          this.damage('OUCH!');
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
    }
  }

  /** Lose a heart (buoys, bad landings); the third is the wipeout. */
  private damage(label: string): void {
    const s = this.surfer;
    this.health -= 1;
    if (this.health <= 0) {
      this.health = 0;
      this.state = 'wipeout';
      this.stateTime = 0;
      this.invulnerableUntil = 0;
      s.wiped = true;
      s.group.visible = true;
      const [amount, seconds] = IMPACT.shake.wipeout;
      this.shake(amount, seconds);
      this.endRage();
      this.float('WIPEOUT', hex(PALETTE.red), 2);
      // The run is over: keep the best score and distance on this device.
      const score = Math.floor(this.score);
      const distance = Math.floor(this.distance);
      if (score > this.best.score || distance > this.best.distance) {
        this.best = { score: Math.max(score, this.best.score), distance: Math.max(distance, this.best.distance) };
        this.newBest = true;
        saveJSON(BEST_KEY, this.best);
      }
    } else {
      this.invulnerableUntil = this.time + SCORING.invulnerableSeconds;
      this.float(label, hex(PALETTE.red), 1);
    }
  }

  /** Knock a rival out: points (times the combo), RAGE, and the word, shown now or (`show` false) by the caller. Returns the word. */
  private knockout(r: Rival, label: string, points: number, show = true): string {
    r.knockOut(this.time);
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
    this.float('RAGE!', hex(PALETTE.red), 2);
    sharedUniforms.uFogColor.value.setHex(0xff4fa3);
    sharedUniforms.uHorizon.value.setHex(0xff8fd0);
  }

  private endRage(): void {
    this.raging = false;
    this.surfer.setFlash(0);
    sharedUniforms.uFogColor.value.setHex(FOG.color);
    sharedUniforms.uHorizon.value.setHex(PALETTE.horizon);
  }

  /**
   * Show a word: in the column beside the surfer, or over rider `at`. A word
   * already showing in the same place pops again instead of showing twice,
   * and each place keeps at most FLOAT_MAX words (the oldest goes).
   */
  float(text: string, color: string, scale = 1, at: Rider | null = null): void {
    const s = this.surfer;
    const anchor = at ? { x: at.x - s.x, y: at.y + FLOAT_HEAD - s.y, z: at.z - s.z } : null;
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
    let amount = 0;
    for (const r of this.rivals) {
      if (r.knockedOut) continue;
      const dz = r.z - s.z;
      if (dz < CAMERA.crowdBehind || dz > CAMERA.crowdAhead) continue;
      amount = Math.max(amount, 1 - Run.step(CAMERA.crowdFull, CAMERA.crowdNone, Math.abs(r.x - s.x)));
    }
    return amount;
  }

  /**
   * Near-camera occlusion: for each rival, how much it is in the way, 0..1,
   * from how close it is to the camera and whether it sits on the sight line
   * from the camera to the surfer, short of the surfer. Allocation-free.
   *
   * The rival the surfer is hitting (strikeTarget, until its flinch is over)
   * is exempt: the blow and the reaction must read, so only a tighter lens
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
      if (r === struck && !r.knockedOut) {
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
