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
import type { Landing } from '../entities/Rider';
import { Rival } from '../entities/Rival';
import { Spray } from '../entities/Spray';
import { Surfer } from '../entities/Surfer';
import { CourseGenerator, COURSES, type CourseSpec } from '../world/Course';
import { Ocean } from '../world/Ocean';
import { Scenery } from '../world/Scenery';
import { Sky } from '../world/Sky';
import { CHARACTER_ORDER, CHARACTER_STORAGE_KEY, CHARACTERS, RIVALS, type RiderSpec } from './characters';
import { type Combo, ComboReader } from './Combos';
import { CAMERA, COMBAT, FOG, MENU_ZONE, PALETTE, PHYSICS, RAGE, SCORING, TRICKS } from './constants';
import { PAUSE_ZONE, titleArrowX, titleRow } from './HudLayout';
import { HudView } from './HudView';

export type RunState = 'title' | 'playing' | 'paused' | 'wipeout';

export interface FloatingText {
  text: string;
  color: string;
  age: number;
  scale: number;
}

const FLOAT_SECONDS = 1.3;
/** The start grid for the rivals: (x, z) around the player. */
const RIVAL_GRID: [number, number][] = [[-4, 6], [4, 9], [-8, 3], [8, 12], [-6, -6], [2, 16], [7, -9], [-3, 20]];

/** localStorage key (through systems/Storage) for the best score and distance. */
const BEST_KEY = 'bm.best';
/** Pooled skull buoys: enough for the generated stretch ahead at the tightest spacing. */
const BUOY_POOL = 24;
/** Pooled boost gates: the stretch ahead holds at most four. */
const CHEVRON_POOL = 8;
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
  readonly scenery = new Scenery();
  /** The endless course, generated ahead of the surfer. */
  generator: CourseGenerator;
  private featureCount = -1;
  private floating: FloatingText[] = [];
  /** The combo reader (the HUD shows its held presses). */
  readonly combos = new ComboReader();
  private invulnerableUntil = 0;
  private bumpCooldown = 0;
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

    this.characterIndex = Math.max(0, CHARACTER_ORDER.indexOf(spec.id as (typeof CHARACTER_ORDER)[number]));
    this.surfer = new Surfer(spec);
    scene.add(this.surfer.group, this.surfer.shadow);
    const pool = [...RIVALS, ...CHARACTER_ORDER.map((id) => CHARACTERS[id])];
    for (let i = 0; i < course.rivals; i++) {
      const rival = new Rival(pool[i % pool.length], i);
      this.rivals.push(rival);
      scene.add(rival.group, rival.shadow);
    }
    const drum = createPS1Material({ map: skullTexture() });
    const plain = createPS1Material();
    for (let i = 0; i < BUOY_POOL; i++) {
      const buoy = new Buoy(drum, plain);
      this.buoys.push(buoy);
      scene.add(buoy.group);
    }
    const gate = chevronMaterial();
    for (let i = 0; i < CHEVRON_POOL; i++) {
      const chevron = new Chevron(gate);
      this.chevrons.push(chevron);
      scene.add(chevron.mesh);
    }
    hud.loadImage('logo', 'assets/boardmasters/logo-220x110.png');
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
    for (const b of this.buoys) b.update(this.time, this.ocean);
    for (const c of this.chevrons) c.update(this.time, this.ocean);

    if (!s.airborne && !s.wiped && s.speed > 8) {
      const sinH = Math.sin(s.heading);
      const cosH = Math.cos(s.heading);
      const bursts = this.time < s.boostUntil ? 3 : 1; // BOOST throws extra spray
      for (let i = 0; i < bursts; i++) {
        const side = (Math.floor(this.time * 60) + i) % 2 === 0 ? -1 : 1;
        this.spray.emit(s.x - sinH * 0.9 + side * 0.35, s.y + 0.05, s.z - cosH * 0.9, side * (1.2 + Math.random() * 1.2) - sinH * 2, 1.2 + Math.random() * 1.5, -s.speed * 0.1);
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
    this.resolveAttacks();
    this.resolveHazards();
  }

  /** Air, spins and grabs score on a clean landing; a bad one is a crash. */
  private resolveLanding(l: Landing): void {
    const s = this.surfer;
    if (l.airTime < SCORING.airSeconds) return;
    if (!l.clean) {
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
        const damage = this.raging ? RAGE.attackDamage : barge ? COMBAT.bargeDamage : COMBAT.punchDamage;
        const shove = dir * (barge ? COMBAT.bargeShove : COMBAT.punchShove) * s.stats.power;
        if (barge) s.stunnedUntil = Math.max(s.stunnedUntil, this.time + COMBAT.bargeSelfStun);
        if (target.takeHit(damage, shove, this.time)) this.knockout(target, 'KNOCKOUT', COMBAT.knockoutPoints);
        else this.float(barge ? 'BARGE!' : 'HIT!', '#ffffff', 1);
      }
    }
    for (const r of this.rivals) {
      if (!r.barging || r.knockedOut || s.wiped || this.time < this.invulnerableUntil) continue;
      if (Math.abs(r.x - s.x) > 1.6 || Math.abs(r.z - s.z) > 2.4) continue;
      const dir = Math.sign(s.x - r.x || 1);
      s.shoveVx = dir * COMBAT.rivalShove * r.stats.power;
      s.speed *= 0.9;
      s.stunnedUntil = Math.max(s.stunnedUntil, this.time + 0.2);
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
          this.float(`SMASH +${RAGE.smashPoints}`, hex(PALETTE.gold), 1);
        } else if (this.time >= this.invulnerableUntil) {
          s.speed *= SCORING.hitSpeedFactor;
          s.shoveVx = Math.sign(s.x - b.x || 1) * 6;
          s.stunnedUntil = Math.max(s.stunnedUntil, this.time + 0.45);
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
      this.bumpCooldown = 0.6;
      this.float('BUMP', hex(PALETTE.cyan), 1);
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

  private knockout(r: Rival, label: string, points: number): void {
    r.knockOut(this.time);
    this.knockouts++;
    this.combo = this.time < this.comboUntil ? Math.min(COMBAT.comboMax, this.combo + 1) : 1;
    this.comboUntil = this.time + COMBAT.comboSeconds;
    const total = points * this.combo;
    this.score += total;
    this.float(this.combo > 1 ? `${label} +${total} X${this.combo}` : `${label} +${points}`, hex(PALETTE.gold), 2);
    this.addRage(RAGE.perKnockout);
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

  float(text: string, color: string, scale = 1): void {
    this.floating.push({ text, color, age: 0, scale });
  }

  /** Chase camera: behind and above the surfer, never under the water, rolling into carves. The offsets ease; the surfer's travel is followed exactly, so no speed leaves it behind. */
  private updateCamera(dt: number): void {
    const s = this.surfer;
    const sinH = Math.sin(s.heading);
    const camX = s.x - sinH * 1.2;
    const camZ = s.z - CAMERA.back;
    const water = this.ocean.height(camX, camZ);
    const desired = this.tmp.set(-sinH * 1.2, Math.max(CAMERA.height, water + 0.9 - s.y), -CAMERA.back);
    const look = this.tmp2.set(sinH * 1.5, CAMERA.lookHeight, CAMERA.lookAhead);
    if (this.snapCamera) {
      this.camOffset.copy(desired);
      this.lookOffset.copy(look);
      this.snapCamera = false;
    } else {
      this.camOffset.lerp(desired, damp(CAMERA.followRate, dt));
      this.lookOffset.lerp(look, damp(CAMERA.lookRate, dt));
    }
    const camera = this.renderer.camera;
    camera.position.set(s.x + this.camOffset.x, s.y + this.camOffset.y, s.z + this.camOffset.z);
    camera.lookAt(this.tmp.set(s.x + this.lookOffset.x, s.y + this.lookOffset.y, s.z + this.lookOffset.z));
    camera.rotateZ((-s.heading / PHYSICS.maxHeading) * CAMERA.roll);
  }

  /** The 2D overlay is game/HudView.ts (made on the first frame). */
  private hudView: HudView | null = null;

  private drawHud(): void {
    (this.hudView ??= new HudView(this)).draw();
  }
}
