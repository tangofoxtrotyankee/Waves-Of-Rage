import type { Hud2D } from '../engine/Hud2D';
import type { Input, InputState } from '../engine/Input';
import { createPS1Material, syncLook } from '../engine/PS1Material';
import type { Renderer } from '../engine/Renderer';
import { damp, hex } from '../engine/math';
import { skullTexture } from '../engine/Textures';
import { THREE } from '../engine/three';
import { Buoy } from '../entities/Buoy';
import { FinishLine } from '../entities/FinishLine';
import { Rival } from '../entities/Rival';
import { Spray } from '../entities/Spray';
import { Surfer } from '../entities/Surfer';
import { buildCourse, COURSES, type CourseLayout, type CourseSpec } from '../world/Course';
import { Ocean } from '../world/Ocean';
import { Sky } from '../world/Sky';
import { RIVALS, type RiderSpec } from './characters';
import { CAMERA, IS_PORTRAIT, PALETTE, PHYSICS, SCORING } from './constants';

export type RunState = 'title' | 'playing' | 'wipeout' | 'finished';

interface FloatingText {
  text: string;
  color: string;
  age: number;
}

const FLOAT_SECONDS = 1.3;
/** The tappable MENU corner on touch screens, internal pixels. */
const MENU_ZONE = { w: 52, h: 16 };

const pad = (value: number, digits: number): string => String(Math.max(0, Math.floor(value))).padStart(digits, '0');
const ordinal = (n: number): string => `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`;

/**
 * One course, one surfer, the rivals and hazards, and the rules that join
 * them: distance and score, air bonuses, buoy hits and health, rival bumps,
 * the finish, and the title / results overlays. Racing positions, tricks,
 * combat and RAGE plug in here when they arrive.
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
  readonly ocean = new Ocean();
  readonly sky: Sky;
  readonly surfer: Surfer;
  readonly rivals: Rival[] = [];
  readonly buoys: Buoy[] = [];
  readonly finish: FinishLine;
  readonly spray = new Spray();
  readonly layout: CourseLayout;
  private floating: FloatingText[] = [];
  private invulnerableUntil = 0;
  private bumpCooldown = 0;
  private snapCamera = true;
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly renderer: Renderer,
    private readonly hud: Hud2D,
    private readonly input: Input,
    readonly spec: RiderSpec,
    readonly course: CourseSpec = COURSES.sunsetBay,
  ) {
    this.layout = buildCourse(course);
    this.ocean.setFeatures(this.layout.features);
    this.sky = new Sky(course.length);
    this.finish = new FinishLine(this.layout.finishZ);
    const scene = renderer.scene;
    scene.add(this.ocean.mesh, this.sky.group, this.spray.group, this.finish.group);

    this.surfer = new Surfer(spec);
    scene.add(this.surfer.group, this.surfer.shadow);
    for (let i = 0; i < course.rivals; i++) {
      const rival = new Rival(RIVALS[i % RIVALS.length], i);
      this.rivals.push(rival);
      scene.add(rival.group, rival.shadow);
    }
    const drum = createPS1Material({ map: skullTexture() });
    const plain = createPS1Material();
    for (const { x, z } of this.layout.buoys) {
      const buoy = new Buoy(x, z, drum, plain);
      this.buoys.push(buoy);
      scene.add(buoy.group);
    }
    hud.loadImage('logo', 'assets/boardmasters/logo-220x110.png');
    this.reset();
  }

  /** Everyone back to the start line. */
  reset(): void {
    this.ocean.update(0, 0);
    this.surfer.reset(0, 0, this.ocean);
    this.rivals.forEach((rival, i) => rival.reset((i % 2 === 0 ? 1 : -1) * (3 + i), 4 + i * 2, this.ocean));
    this.score = 0;
    this.health = SCORING.startHealth;
    this.distance = 0;
    this.rank = 1;
    this.floating = [];
    this.invulnerableUntil = 0;
    this.bumpCooldown = 0;
    this.snapCamera = true;
  }

  start(): void {
    this.reset();
    this.state = 'playing';
    this.stateTime = 0;
  }

  update(dt: number): void {
    this.time += dt;
    this.stateTime += dt;
    syncLook();
    const input = this.input.poll();
    const idle: InputState = { ...input, steer: 0, pump: false, brake: false, jump: false };

    switch (this.state) {
      case 'title':
        if (input.back || this.tappedMenu(input)) this.mainMenu();
        else if (input.start) this.start();
        this.simulate(dt, idle, false);
        break;
      case 'playing':
        if (input.back) this.mainMenu();
        this.simulate(dt, input, true);
        break;
      case 'wipeout':
      case 'finished':
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
    this.sky.update(this.renderer.camera);
    this.spray.update(dt, this.renderer.camera);
  }

  render(): void {
    this.renderer.render();
    this.drawHud();
  }

  private mainMenu(): void {
    window.location.href = './';
  }

  private tappedMenu(input: InputState): boolean {
    return input.tapX !== null && input.tapY !== null && input.tapX < MENU_ZONE.w && input.tapY < MENU_ZONE.h;
  }

  /** Advance the world one step; `live` applies the rules (score, damage, finish). */
  private simulate(dt: number, input: InputState, live: boolean): void {
    const s = this.surfer;
    // The sea moves first so every rider samples the surface that is drawn this frame.
    this.ocean.update(dt, s.z);
    s.update(dt, s.fromInput(input), this.ocean, this.time);
    for (const r of this.rivals) r.update(dt, r.think(s, this.time), this.ocean, this.time);
    for (const b of this.buoys) b.update(this.time, this.ocean);
    this.finish.update(this.time, this.ocean);

    if (!s.airborne && !s.wiped && s.speed > 8) {
      const sinH = Math.sin(s.heading);
      const cosH = Math.cos(s.heading);
      const side = Math.floor(this.time * 60) % 2 === 0 ? -1 : 1;
      this.spray.emit(s.x - sinH * 0.9 + side * 0.35, s.y + 0.05, s.z - cosH * 0.9, side * (1.2 + Math.random() * 1.2) - sinH * 2, 1.2 + Math.random() * 1.2, -s.speed * 0.1);
    }
    s.group.visible = this.time >= this.invulnerableUntil || Math.floor(this.time * 12) % 2 === 0;

    if (!live) return;
    this.distance = s.z;
    this.score += s.speed * Math.cos(s.heading) * dt * SCORING.perMetre;
    this.rank = 1 + this.rivals.filter((r) => r.z > s.z).length;

    const landing = s.takeLanding();
    if (landing && landing.airTime >= SCORING.airSeconds) {
      const big = landing.airTime >= SCORING.bigAirSeconds;
      this.score += big ? SCORING.bigAirBonus : SCORING.airBonus;
      this.float(big ? `BIG AIR +${SCORING.bigAirBonus}` : `AIR +${SCORING.airBonus}`, hex(PALETTE.gold));
    }

    const near = (ax: number, az: number, bx: number, bz: number, rx: number, rz: number) => Math.abs(ax - bx) < rx && Math.abs(az - bz) < rz;
    for (const b of this.buoys) {
      if (Math.abs(b.z - s.z) > 4) continue;
      if (this.time >= this.invulnerableUntil && near(s.x, s.z, b.x, b.z, 1.05, 1.1) && s.airHeight(this.ocean) < 1.0) this.hitBuoy(b);
      for (const r of this.rivals) {
        if (!r.airborne && near(r.x, r.z, b.x, b.z, 1.05, 1.1)) {
          r.shoveVx = Math.sign(r.x - b.x || 1) * 5;
          r.speed *= SCORING.hitSpeedFactor;
        }
      }
    }
    this.bumpCooldown -= dt;
    for (const r of this.rivals) {
      if (this.bumpCooldown > 0 || !near(s.x, s.z, r.x, r.z, 0.95, 1.9) || Math.abs(s.y - r.y) > 1) continue;
      const dir = Math.sign(s.x - r.x || 1);
      s.shoveVx = dir * 4;
      r.shoveVx = -dir * 4;
      s.speed *= SCORING.bumpSpeedFactor;
      r.speed *= SCORING.bumpSpeedFactor;
      this.bumpCooldown = 0.6;
      this.float('BUMP', hex(PALETTE.cyan));
    }

    if (s.z >= this.layout.finishZ) {
      this.state = 'finished';
      this.stateTime = 0;
      this.score += SCORING.finishBonus + (this.rank === 1 ? SCORING.firstPlaceBonus : 0);
      this.float(this.rank === 1 ? 'FINISH! 1ST PLACE' : 'FINISH!', hex(PALETTE.gold));
    }
  }

  private hitBuoy(b: Buoy): void {
    const s = this.surfer;
    this.health -= SCORING.buoyDamage;
    s.speed *= SCORING.hitSpeedFactor;
    s.shoveVx = Math.sign(s.x - b.x || 1) * 6;
    s.stunnedUntil = this.time + 0.45;
    this.invulnerableUntil = this.time + SCORING.invulnerableSeconds;
    if (this.health <= 0) {
      this.health = 0;
      this.state = 'wipeout';
      this.stateTime = 0;
      s.wiped = true;
      s.group.visible = true;
      this.float('WIPEOUT', hex(PALETTE.red));
    } else {
      this.float('OUCH!', hex(PALETTE.red));
    }
  }

  float(text: string, color: string): void {
    this.floating.push({ text, color, age: 0 });
  }

  /** Chase camera: behind and above the surfer, eased, never under the water, rolling into carves. */
  private updateCamera(dt: number): void {
    const s = this.surfer;
    const sinH = Math.sin(s.heading);
    const camX = s.x - sinH * 1.2;
    const camZ = s.z - CAMERA.back;
    const water = this.ocean.height(camX, camZ);
    const desired = this.tmp.set(camX, Math.max(s.y + CAMERA.height, water + 0.9), camZ);
    if (this.snapCamera) this.camPos.copy(desired);
    else this.camPos.lerp(desired, damp(CAMERA.followRate, dt));
    const look = this.tmp.set(s.x + sinH * 1.5, s.y + CAMERA.lookHeight, s.z + CAMERA.lookAhead);
    if (this.snapCamera) this.camLook.copy(look);
    else this.camLook.lerp(look, damp(CAMERA.lookRate, dt));
    this.snapCamera = false;
    const camera = this.renderer.camera;
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    camera.rotateZ((-s.heading / PHYSICS.maxHeading) * CAMERA.roll);
  }

  private drawHud(): void {
    const hud = this.hud;
    const W = hud.width;
    const H = hud.height;
    const gold = hex(PALETTE.gold);
    const cyan = hex(PALETTE.cyan);
    const red = hex(PALETTE.red);
    const white = '#ffffff';
    const grey = '#bbbbbb';
    const touch = this.input.touch;
    hud.clear();

    if (this.state === 'title') {
      const logoW = 220;
      const logoH = 110;
      const ly = IS_PORTRAIT ? 48 : 10;
      hud.image('logo', (W - logoW) / 2, ly);
      const y0 = ly + logoH + 8;
      hud.rect(0, y0 - 4, W, 46, PALETTE.ui, 0.6);
      hud.text(W / 2, y0, `${this.course.name}  ${this.course.length}M`, cyan, { align: 'center' });
      hud.text(W / 2, y0 + 12, `${this.spec.name}: ${this.spec.title}`, white, { align: 'center' });
      if (Math.floor(this.time * 2) % 2 === 0) hud.text(W / 2, y0 + 30, touch ? 'TAP TO SURF' : 'PRESS SPACE TO SURF', gold, { align: 'center' });
      hud.text(W / 2, H - 14, touch ? 'CARVE: DRAG   JUMP: TAP' : 'CARVE: LEFT/RIGHT  PUMP: UP  BRAKE: DOWN  JUMP: SPACE', grey, { align: 'center' });
      if (touch) {
        hud.rect(0, 0, MENU_ZONE.w, MENU_ZONE.h, PALETTE.ui, 0.8);
        hud.text(6, 4, 'MENU', cyan);
      } else {
        hud.text(6, 4, 'ESC: MAIN MENU', grey);
      }
      return;
    }

    // In play: hearts, position, distance, score, speed.
    const hearts = '♥'.repeat(this.health) + '♡'.repeat(SCORING.startHealth - this.health);
    const pct = Math.min(100, Math.floor((this.distance / this.layout.finishZ) * 100));
    const n = this.rivals.length + 1;
    const s = this.surfer;
    hud.text(6, 5, hearts, red);
    hud.text(W - 6, 5, `SCORE ${pad(this.score, 6)}`, gold, { align: 'right' });
    if (IS_PORTRAIT) {
      hud.text(6, 16, `POS ${this.rank}/${n}`, white);
      hud.text(W - 6, 16, `DIST ${pct}%`, cyan, { align: 'right' });
    } else {
      hud.text(6, 16, `POS ${this.rank}/${n}`, white);
      hud.text(W / 2, 5, `DIST ${pct}%`, cyan, { align: 'center' });
      hud.text(W / 2, 16, `${pad(this.distance, 4)}M`, cyan, { align: 'center' });
    }
    const barW = 48;
    hud.rect(W - 6 - barW, IS_PORTRAIT ? 28 : 17, barW, 5, PALETTE.ui, 0.75);
    hud.rect(W - 6 - barW, IS_PORTRAIT ? 28 : 17, Math.round((barW * s.speed) / PHYSICS.maxSpeed), 5, s.airborne ? PALETTE.gold : PALETTE.cyan);

    this.floating.forEach((f, i) => {
      const rise = f.age * 14;
      const scale = f.text.length <= 8 ? 2 : 1;
      hud.text(W / 2, H * 0.4 - rise - i * 12, f.text, f.color, { align: 'center', scale });
    });

    if (this.state === 'wipeout' || this.state === 'finished') {
      const pw = Math.min(W - 16, 216);
      const ph = 90;
      const px = (W - pw) / 2;
      const py = (H - ph) / 2;
      hud.rect(px, py, pw, ph, PALETTE.ui, 0.9);
      const title = this.state === 'wipeout' ? 'WIPEOUT' : 'FINISH!';
      hud.text(W / 2, py + 8, title, this.state === 'wipeout' ? red : gold, { align: 'center', scale: 2 });
      hud.text(W / 2, py + 32, `DIST ${pad(this.distance, 4)}M  ${ordinal(this.rank)} PLACE`, cyan, { align: 'center' });
      hud.text(W / 2, py + 44, `SCORE ${pad(this.score, 6)}`, gold, { align: 'center' });
      if (this.stateTime > SCORING.wipeoutSeconds) {
        hud.text(W / 2, py + 64, touch ? 'TAP: SURF AGAIN' : 'SPACE: SURF AGAIN', white, { align: 'center' });
        hud.text(W / 2, py + 76, touch ? 'MENU: TOP LEFT' : 'ESC: MAIN MENU', grey, { align: 'center' });
        if (touch) {
          hud.rect(0, 0, MENU_ZONE.w, MENU_ZONE.h, PALETTE.ui, 0.8);
          hud.text(6, 4, 'MENU', cyan);
        }
      }
    }
  }
}
