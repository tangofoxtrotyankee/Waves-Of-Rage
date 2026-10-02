import Phaser from 'phaser';

import { Animations, AssetKeys, GAME_HEIGHT, GAME_WIDTH, SurferFrame } from '../game/constants';
import { GAMEPLAY } from '../game/gameplay';
import type { Controls } from '../input/Controls';
import { perspectiveScale } from '../systems/Perspective';

/** Placeholder sprite size, sized for a future 32x40 / 32x48 pixel-art surfer. */
const SPRITE_WIDTH = 24;
const SPRITE_HEIGHT = 32;

/**
 * Movement tuning. All values are in internal pixels per second (or per
 * second squared). Horizontal movement is the main axis; vertical movement
 * is deliberately slower and more limited so the surfer only shifts a little
 * up and down the face of the wave.
 */
export const PLAYER_MOVEMENT = {
  maxSpeedX: 150,
  maxSpeedY: 70,
  accelerationX: 900,
  accelerationY: 600,
  /** Applied when no input is held, so the surfer settles quickly. */
  decelerationX: 1100,
  decelerationY: 800,
} as const;

/** Arcade jump: a fixed-duration parabola, no gravity simulation. */
export const PLAYER_JUMP = {
  /** Peak lift in pixels. */
  height: 26,
  /** Total airtime in seconds. */
  durationSeconds: 0.6,
} as const;

/** Big air from a wave ramp: higher, longer, and the only time tricks are possible. */
export const PLAYER_BIG_AIR = {
  height: 48,
  durationSeconds: 1.35,
  /** Spin speed while holding left/right, degrees per second. 540 takes about 1.1 s. */
  rotationSpeed: 480,
  /** Touch: degrees of spin per game pixel of sideways drag. */
  dragSpinDegreesPerPixel: 6,
  /** Fraction of normal horizontal speed available while in big air. */
  driftFactor: 0.35,
  /** Seconds of recovery (no control) after a crash landing. */
  crashRecoverySeconds: 0.5,
} as const;

/** Basic punch: a short hitbox on the facing side. */
export const PLAYER_ATTACK = {
  durationSeconds: 0.18,
  cooldownSeconds: 0.35,
  damage: 1,
  /** Sideways shove given to a rival that is hit. */
  knockback: 90,
  /** Hitbox size (pixels, before perspective scale) and how far it reaches past the body. */
  reach: 16,
  width: 18,
  height: 22,
} as const;

/** Shoulder barge: a dash with a bigger hitbox and far more knockback. */
export const PLAYER_BARGE = {
  durationSeconds: 0.22,
  cooldownSeconds: 0.9,
  damage: 1,
  knockback: 230,
  /** Horizontal speed during the barge. */
  speed: 260,
  reach: 12,
  width: 24,
  height: 26,
} as const;

/** What happens when the surfer hits something. */
export const PLAYER_HIT = {
  /** Sideways shove away from the obstacle, pixels per second. */
  knockbackX: 160,
  /** Push towards the foreground, pixels per second. */
  knockbackY: 70,
  /** Seconds of immunity after a hit. */
  invulnerableSeconds: 1.2,
  /** Seconds of red tint before the blink phase takes over. */
  flashSeconds: 0.15,
} as const;

/** Fraction of the sprite's bounds trimmed from each side for collisions. */
const HITBOX_INSET = 0.2;

/**
 * The area the surfer is allowed to occupy (the sprite's bottom-centre, i.e.
 * the board). The top edge keeps the surfer on the lower half of the screen,
 * the bottom edge stops the board going off the foreground.
 */
export const PLAYER_BOUNDS = {
  minX: SPRITE_WIDTH / 2,
  maxX: GAME_WIDTH - SPRITE_WIDTH / 2,
  minY: 92 + SPRITE_HEIGHT / 2,
  maxY: GAME_HEIGHT,
} as const;

export type PlayerState = 'surfing' | 'jumping' | 'bigAir' | 'attacking' | 'barging' | 'hit' | 'wipedOut';

export type Facing = -1 | 1;

export type AerialState = 'none' | 'jump' | 'bigAir';

/** Result of touching down from big air, consumed by GameScene for scoring/damage. */
export interface LandingResult {
  clean: boolean;
  /** Full half-turns completed: 0, 180, 360, 540... */
  rotation: number;
  grabbed: boolean;
  /** Degrees away from upright at touchdown. */
  deviation: number;
  /** Display name, e.g. "360 GRAB" or "AIR". */
  trickName: string;
}

/**
 * The player's surfer.
 *
 * The container's x/y is the position on the wave (bottom-centre of the
 * board). The sprite inside it is lifted during a jump while the shadow
 * stays on the water. Movement is a simple hand-integrated velocity model
 * with acceleration and deceleration; no physics engine is involved.
 */
export class Player extends Phaser.GameObjects.Container {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly spray: Phaser.GameObjects.Sprite;
  private readonly fist: Phaser.GameObjects.Rectangle;

  private facingDirection: Facing = 1;
  private attackTimer = 0;
  private attackCooldownTimer = 0;
  private bargeTimer = 0;
  private bargeCooldownTimer = 0;

  private velocityX = 0;
  private velocityY = 0;
  private invulnerableUntil = 0;
  private blinkTween?: Phaser.Tweens.Tween;

  private readonly trickLabel: Phaser.GameObjects.Text;

  /** Air progress from 0 (take-off) to 1 (landed); -1 when on the wave. */
  private jumpProgress = -1;
  private aerial: AerialState = 'none';
  private spin = 0;
  private grabbed = false;
  private crashTimer = 0;
  private pendingLanding: LandingResult | null = null;
  private wipedOut = false;
  /** Sideways finger movement this frame (game px); drives facing and the lean frame on touch. */
  private touchMoveX = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);

    this.shadow = scene.add.ellipse(0, -2, SPRITE_WIDTH, 6, 0x000000, 0.35).setVisible(false);
    this.spray = scene.add.sprite(0, 2, AssetKeys.Spray).setOrigin(0.5, 1);
    this.spray.play(Animations.Spray);
    this.sprite = scene.add.sprite(0, 0, AssetKeys.Player, SurferFrame.Surf).setOrigin(0.5, 1);
    this.fist = scene.add.rectangle(0, -22, 8, 6, 0xffe066).setVisible(false);
    this.trickLabel = scene.add
      .text(0, -SPRITE_HEIGHT - 6, '', { fontFamily: 'monospace', fontSize: '8px', color: '#7ff6ff', stroke: '#1a0b2e', strokeThickness: 2 })
      .setOrigin(0.5, 1)
      .setVisible(false);
    this.add([this.shadow, this.spray, this.sprite, this.fist, this.trickLabel]);

    this.applyPerspective();
    scene.add.existing(this);
  }

  // --- state ---------------------------------------------------------------

  get playerState(): PlayerState {
    if (this.wipedOut) return 'wipedOut';
    if (this.isInvulnerable) return 'hit';
    if (this.isBarging) return 'barging';
    if (this.isAttacking) return 'attacking';
    if (this.isBigAir) return 'bigAir';
    if (this.isJumping) return 'jumping';
    return 'surfing';
  }

  get aerialState(): AerialState {
    return this.aerial;
  }

  /** Launched from a ramp: tricks possible, nothing on the water can touch you. */
  get isBigAir(): boolean {
    return this.aerial === 'bigAir';
  }

  /** Any kind of air (normal jump or big air). */
  get isAirborne(): boolean {
    return this.jumpProgress >= 0;
  }

  /** Sprite rotation in degrees, accumulated over the current big air. */
  get spinDegrees(): number {
    return this.spin;
  }

  get isGrabbing(): boolean {
    return this.grabbed;
  }

  /** Name of the trick in progress ("", "180", "360 GRAB"...). */
  get currentTrickName(): string {
    return this.isBigAir ? Player.trickName(Player.rotationTier(this.spin), this.grabbed) : '';
  }

  get facing(): Facing {
    return this.facingDirection;
  }

  get isAttacking(): boolean {
    return this.attackTimer > 0;
  }

  get isBarging(): boolean {
    return this.bargeTimer > 0;
  }

  /** Seconds until another punch is allowed (0 = ready). */
  get attackCooldown(): number {
    return this.attackCooldownTimer;
  }

  /** Seconds until another barge is allowed (0 = ready). */
  get bargeCooldown(): number {
    return this.bargeCooldownTimer;
  }

  get isJumping(): boolean {
    return this.jumpProgress >= 0;
  }

  /** True while the post-hit immunity window is active. */
  get isInvulnerable(): boolean {
    return this.scene.time.now < this.invulnerableUntil;
  }

  get isWipedOut(): boolean {
    return this.wipedOut;
  }

  /** Current horizontal velocity in pixels per second. */
  get vx(): number {
    return this.velocityX;
  }

  /** Current vertical velocity in pixels per second. */
  get vy(): number {
    return this.velocityY;
  }

  /** How far above the wave the surfer currently is, in pixels. */
  get airHeight(): number {
    return -this.sprite.y;
  }

  /**
   * Collision rectangle: the surfer's footprint on the wave, inset a little.
   * It deliberately ignores the jump lift; whether an overlap counts as a hit
   * while airborne is decided by the obstacle's `jumpable` flag.
   */
  get hitBox(): Phaser.Geom.Rectangle {
    const w = SPRITE_WIDTH * this.scaleX;
    const h = SPRITE_HEIGHT * this.scaleY;
    const b = new Phaser.Geom.Rectangle(this.x - w / 2, this.y - h, w, h);
    return Phaser.Geom.Rectangle.Inflate(b, -w * HITBOX_INSET, -h * HITBOX_INSET);
  }

  /**
   * Active offensive hitbox on the facing side, or null when not attacking.
   * The barge box is used while barging, otherwise the punch box.
   */
  get attackHitBox(): Phaser.Geom.Rectangle | null {
    const spec = this.isBarging ? PLAYER_BARGE : this.isAttacking ? PLAYER_ATTACK : null;
    if (!spec) return null;
    const s = this.scaleX;
    const w = spec.width * s;
    const h = spec.height * s;
    const centreX = this.x + this.facingDirection * (SPRITE_WIDTH / 2 + spec.reach - spec.width / 2) * s;
    const bottom = this.y - 4 * s;
    return new Phaser.Geom.Rectangle(centreX - w / 2, bottom - h, w, h);
  }

  // --- actions -------------------------------------------------------------

  /** Throw a punch if allowed. Returns true if an attack started. */
  attack(): boolean {
    if (this.wipedOut || this.isBigAir || this.isAttacking || this.isBarging || this.attackCooldownTimer > 0) return false;
    this.attackTimer = PLAYER_ATTACK.durationSeconds;
    this.attackCooldownTimer = PLAYER_ATTACK.durationSeconds + PLAYER_ATTACK.cooldownSeconds;
    this.sprite.setTint(0xfff3b0);
    return true;
  }

  /** Shoulder barge in `direction` if allowed. Returns true if it started. */
  barge(direction: Facing): boolean {
    if (this.wipedOut || this.isAirborne || this.isBarging || this.bargeCooldownTimer > 0 || this.crashTimer > 0) return false;
    this.facingDirection = direction;
    this.sprite.setFlipX(direction < 0);
    this.bargeTimer = PLAYER_BARGE.durationSeconds;
    this.bargeCooldownTimer = PLAYER_BARGE.durationSeconds + PLAYER_BARGE.cooldownSeconds;
    this.attackTimer = 0;
    this.fist.setVisible(false);
    this.velocityX = direction * PLAYER_BARGE.speed;
    this.sprite.setTint(0x7ff6ff).setAngle(direction * 18);
    return true;
  }

  /** Start a jump if on the wave. Returns true if a jump started. */
  jump(): boolean {
    if (this.isAirborne || this.wipedOut || this.crashTimer > 0) return false;
    this.jumpProgress = 0;
    this.aerial = 'jump';
    this.shadow.setVisible(true);
    return true;
  }

  /**
   * Launch into big air from a ramp. Works from the wave or mid normal-jump
   * (forgiving: no frame-perfect input needed). Returns true if launched.
   */
  launch(): boolean {
    if (this.isBigAir || this.wipedOut || this.crashTimer > 0) return false;
    this.jumpProgress = 0;
    this.aerial = 'bigAir';
    this.spin = 0;
    this.grabbed = false;
    this.attackTimer = 0;
    this.bargeTimer = 0;
    this.fist.setVisible(false);
    this.shadow.setVisible(true);
    this.trickLabel.setVisible(true).setText('AIR');
    return true;
  }

  /** Grab the board during big air. */
  grab(): boolean {
    if (!this.isBigAir || this.grabbed) return false;
    this.grabbed = true;
    this.fist.setPosition(0, -8).setVisible(true);
    return true;
  }

  /** The landing result from the last big air, once; null if none is pending. */
  consumeLanding(): LandingResult | null {
    const result = this.pendingLanding;
    this.pendingLanding = null;
    return result;
  }

  /** Bad landing: lose control briefly and reset the sprite. The scene applies damage. */
  crashLand(): void {
    this.crashTimer = PLAYER_BIG_AIR.crashRecoverySeconds;
    this.velocityX = 0;
    this.velocityY = 0;
    this.sprite.setAngle(0);
  }

  /**
   * React to a collision with something at `fromX`: shove away from it, push
   * towards the foreground, flash red, then blink for the immunity period.
   */
  hit(fromX: number): void {
    const direction = Math.sign(this.x - fromX) || (this.x < GAME_WIDTH / 2 ? 1 : -1);
    this.velocityX = direction * PLAYER_HIT.knockbackX;
    this.velocityY = PLAYER_HIT.knockbackY;
    this.invulnerableUntil = this.scene.time.now + PLAYER_HIT.invulnerableSeconds * 1000;

    this.blinkTween?.stop();
    this.sprite.setTint(0xff3b3b).setAngle(0);
    this.fist.setVisible(false);
    this.attackTimer = 0;
    this.bargeTimer = 0;
    this.setAlpha(1);
    this.scene.time.delayedCall(PLAYER_HIT.flashSeconds * 1000, () => {
      if (this.wipedOut) return;
      this.sprite.clearTint();
      this.blinkTween = this.scene.tweens.add({
        targets: this,
        alpha: 0.25,
        duration: 80,
        yoyo: true,
        repeat: Math.floor(((PLAYER_HIT.invulnerableSeconds - PLAYER_HIT.flashSeconds) * 1000) / 160),
        onComplete: () => this.setAlpha(1),
      });
    });
  }

  /** Final hit: controls stop, the surfer slumps and stays tinted. */
  wipeOut(): void {
    if (this.wipedOut) return;
    this.wipedOut = true;
    this.velocityX = 0;
    this.velocityY = 0;
    this.blinkTween?.stop();
    this.setAlpha(1);
    this.fist.setVisible(false);
    this.trickLabel.setVisible(false);
    this.attackTimer = 0;
    this.bargeTimer = 0;
    this.sprite.setTint(0xff3b3b).setFrame(SurferFrame.Hurt);
    this.scene.tweens.add({ targets: this.sprite, angle: 90, y: 6, duration: 500, ease: 'Back.easeIn' });
  }

  // --- per-frame -----------------------------------------------------------

  /** Advance movement by `delta` milliseconds using the given controls. */
  update(controls: Controls, delta: number): void {
    const dt = delta / 1000;

    if (this.wipedOut) {
      this.spray.setVisible(false);
      this.applyPerspective();
      return;
    }

    if (this.crashTimer > 0) {
      // Recovering from a crash landing: no input, just drift to a stop.
      this.crashTimer = Math.max(0, this.crashTimer - dt);
      controls.consumeJump();
      controls.consumeAttack();
      controls.consumeBarge();
      this.updateCombatTimers(dt);
      this.applyPerspective();
      this.pickFrame(0);
      return;
    }

    const axisX = controls.axisX;
    const bigAir = this.isBigAir;
    const drag = controls.consumeDrag();

    if (axisX !== 0 && !this.isBarging && !bigAir) {
      this.facingDirection = axisX > 0 ? 1 : -1;
      this.sprite.setFlipX(this.facingDirection < 0);
    }

    // A tap (Space on touch) jumps on the wave and grabs in big air.
    if (controls.consumeJump()) {
      if (bigAir && controls.isTouch) this.grab();
      else this.jump();
    }
    if (controls.consumeAttack()) {
      if (bigAir) this.grab();
      else this.attack();
    }
    if (controls.consumeBarge() && axisX !== 0) this.barge(axisX > 0 ? 1 : -1);

    // In big air left/right (or a sideways drag) spin the board instead of steering.
    if (bigAir) {
      const spinDelta = axisX * PLAYER_BIG_AIR.rotationSpeed * dt + drag.x * PLAYER_BIG_AIR.dragSpinDegreesPerPixel;
      if (spinDelta !== 0) {
        this.spin += spinDelta;
        this.sprite.setAngle(this.spin);
      }
    }

    // Touch steering: the surfer follows the finger's movement directly and
    // stops where the finger stops (no velocity, so no carried momentum).
    this.touchMoveX = 0;
    if (!bigAir && !this.isBarging && (drag.x !== 0 || drag.y !== 0)) {
      this.x = Phaser.Math.Clamp(this.x + drag.x, PLAYER_BOUNDS.minX, PLAYER_BOUNDS.maxX);
      this.y = Phaser.Math.Clamp(this.y + drag.y, PLAYER_BOUNDS.minY, PLAYER_BOUNDS.maxY);
      this.touchMoveX = drag.x;
      if (Math.abs(drag.x) > 0.5) {
        this.facingDirection = drag.x > 0 ? 1 : -1;
        this.sprite.setFlipX(this.facingDirection < 0);
      }
    }

    this.updateJump(dt);
    this.updateCombatTimers(dt);

    // During a barge the dash owns horizontal movement.
    if (!this.isBarging) {
      const driftFactor = bigAir ? PLAYER_BIG_AIR.driftFactor : 1;
      this.velocityX = Player.integrateAxis(
        this.velocityX,
        axisX,
        PLAYER_MOVEMENT.maxSpeedX * driftFactor,
        PLAYER_MOVEMENT.accelerationX * driftFactor,
        PLAYER_MOVEMENT.decelerationX,
        dt,
      );
    }
    this.velocityY = Player.integrateAxis(
      this.velocityY,
      controls.axisY,
      PLAYER_MOVEMENT.maxSpeedY,
      PLAYER_MOVEMENT.accelerationY,
      PLAYER_MOVEMENT.decelerationY,
      dt,
    );

    const nextX = Phaser.Math.Clamp(this.x + this.velocityX * dt, PLAYER_BOUNDS.minX, PLAYER_BOUNDS.maxX);
    const nextY = Phaser.Math.Clamp(this.y + this.velocityY * dt, PLAYER_BOUNDS.minY, PLAYER_BOUNDS.maxY);

    // Kill velocity when pressed against an edge so we don't "store up" speed.
    if (nextX !== this.x + this.velocityX * dt) this.velocityX = 0;
    if (nextY !== this.y + this.velocityY * dt) this.velocityY = 0;

    this.setPosition(nextX, nextY);
    this.applyPerspective();
    this.pickFrame(axisX);
  }

  /** Choose the sprite frame and flip from the current state. */
  private pickFrame(axisX: number): void {
    const facingLeft = this.facingDirection < 0;
    this.spray.setVisible(!this.isAirborne && !this.wipedOut);

    if (this.isInvulnerable) {
      this.sprite.setFrame(SurferFrame.Hurt).setFlipX(facingLeft);
    } else if (this.isBarging) {
      // The lean frame leans left; flip it to lean the way we are dashing.
      this.sprite.setFrame(SurferFrame.Lean).setFlipX(!facingLeft);
    } else if (this.isAttacking) {
      this.sprite.setFrame(SurferFrame.Punch).setFlipX(facingLeft);
    } else if (this.isAirborne) {
      this.sprite.setFrame(SurferFrame.Jump).setFlipX(facingLeft);
    } else if (axisX !== 0 || Math.abs(this.touchMoveX) > 0.5) {
      this.sprite.setFrame(SurferFrame.Lean).setFlipX((axisX || Math.sign(this.touchMoveX)) > 0);
    } else {
      this.sprite.setFrame(SurferFrame.Surf).setFlipX(facingLeft);
    }
  }

  /** Count down attack / barge durations and cooldowns, clearing their visuals. */
  private updateCombatTimers(dt: number): void {
    this.attackCooldownTimer = Math.max(0, this.attackCooldownTimer - dt);
    this.bargeCooldownTimer = Math.max(0, this.bargeCooldownTimer - dt);

    if (this.attackTimer > 0) {
      this.attackTimer = Math.max(0, this.attackTimer - dt);
      if (this.attackTimer === 0) {
        this.fist.setVisible(false);
        if (!this.isInvulnerable) this.sprite.clearTint();
      }
    }

    if (this.bargeTimer > 0) {
      this.bargeTimer = Math.max(0, this.bargeTimer - dt);
      if (this.bargeTimer === 0) {
        this.sprite.setAngle(0);
        if (!this.isInvulnerable) this.sprite.clearTint();
      }
    }
  }

  /** Lift the sprite along a parabola, then land back at zero (judging big-air landings). */
  private updateJump(dt: number): void {
    if (!this.isAirborne) return;

    const spec = this.isBigAir ? PLAYER_BIG_AIR : PLAYER_JUMP;
    this.jumpProgress += dt / spec.durationSeconds;

    if (this.isBigAir) this.trickLabel.setText(this.currentTrickName || 'AIR');

    if (this.jumpProgress >= 1) {
      const wasBigAir = this.isBigAir;
      this.jumpProgress = -1;
      this.aerial = 'none';
      this.sprite.y = 0;
      this.shadow.setVisible(false);
      this.trickLabel.setVisible(false);
      if (wasBigAir) this.judgeLanding();
      return;
    }

    const t = this.jumpProgress;
    const lift = spec.height * 4 * t * (1 - t);
    this.sprite.y = -Math.round(lift);
  }

  /** Compare the final spin to upright and queue a LandingResult for the scene. */
  private judgeLanding(): void {
    const normalised = ((this.spin % 360) + 360) % 360;
    const deviation = Math.min(normalised, 360 - normalised);
    const clean = deviation <= GAMEPLAY.landingToleranceDegrees;
    const rotation = Player.rotationTier(this.spin);

    this.pendingLanding = { clean, rotation, grabbed: this.grabbed, deviation, trickName: Player.trickName(rotation, this.grabbed) };

    this.spin = 0;
    this.grabbed = false;
    this.fist.setVisible(false);
    this.sprite.setAngle(0);
  }

  /** Completed half-turns, as a degree count: 0, 180, 360, 540... */
  static rotationTier(spinDegrees: number): number {
    return Math.floor(Math.abs(spinDegrees) / 180) * 180;
  }

  static trickName(rotation: number, grabbed: boolean): string {
    const parts: string[] = [];
    if (rotation > 0) parts.push(String(rotation));
    if (grabbed) parts.push('GRAB');
    return parts.length ? parts.join(' ') : 'AIR';
  }

  /** Subtle size change with depth, and draw order by Y so nearer things are on top. */
  private applyPerspective(): void {
    this.setScale(perspectiveScale(this.y));
    this.setDepth(this.y);
  }

  /**
   * Move one velocity component towards the target implied by the input:
   * accelerate towards +/- maxSpeed while held, decelerate to zero otherwise.
   */
  private static integrateAxis(
    velocity: number,
    input: number,
    maxSpeed: number,
    acceleration: number,
    deceleration: number,
    dt: number,
  ): number {
    if (input !== 0) {
      // Turning around uses the (stronger) deceleration so direction changes feel snappy.
      const rate = Math.sign(velocity) === -input ? deceleration + acceleration : acceleration;
      return Phaser.Math.Clamp(velocity + input * rate * dt, -maxSpeed, maxSpeed);
    }

    // No input: ease back to a stop without overshooting zero.
    const step = deceleration * dt;
    if (Math.abs(velocity) <= step) return 0;
    return velocity - Math.sign(velocity) * step;
  }

}
