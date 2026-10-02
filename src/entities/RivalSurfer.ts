import Phaser from 'phaser';

import { AssetKeys, SurferFrame } from '../game/constants';
import { PLAYER_BOUNDS } from './Player';
import { Obstacle, type HazardContext } from './Obstacle';

export const RIVAL = {
  health: 2,
  damage: 1,
  /** Too tall to hop over: must be dodged. */
  jumpable: false,
  knocksOutRivals: false,
  /** Rivals surf forward too, so they close on the player more slowly. */
  approachFactor: 0.55,

  // --- movement (slow and readable) ---
  /** Sideways cruising speed in pixels per second. */
  lateralSpeed: 45,
  /** Seconds between picking a new lateral target (random within range). */
  retargetMin: 1.2,
  retargetMax: 2.6,
  /** Chance a retarget heads for the player's lane instead of a random drift. */
  seekPlayerChance: 0.4,
  /** Random drift distance in pixels. */
  driftDistance: 30,

  // --- shoulder check (their attack) ---
  /** Player must be within this box (dx, dy) for a check to start. */
  checkRangeX: 40,
  checkRangeY: 18,
  checkDurationSeconds: 0.25,
  checkCooldownSeconds: 2.0,
  /** Burst speed towards the player during a check. */
  checkSpeed: 180,

  // --- taking hits ---
  stunSeconds: 0.35,
  /** Drag applied to knockback velocity, pixels per second squared. */
  knockbackDrag: 420,
  /** Seconds after a hit during which slamming into a hazard counts as a knockout. */
  knockedSeconds: 0.6,
  /** Sideways speed given when wiped out. */
  wipeoutSpeed: 140,
  wipeoutSeconds: 1.1,
  /** Simple ramp hop: how long they are up and how much bigger they are drawn at the peak. */
  airSeconds: 0.9,
  airScaleBoost: 0.3,
} as const;

export type RivalState = 'surfing' | 'checking' | 'stunned' | 'wipedOut';

/**
 * A rival surfer: drifts around, sometimes heads for your lane, shoulder
 * checks you when close, and can be punched or barged off their board.
 */
export class RivalSurfer extends Obstacle {
  private currentState: RivalState = 'surfing';
  private health: number = RIVAL.health;

  private targetX: number;
  private untilRetarget = 0;
  private lateralVelocity = 0;

  private stunTimer = 0;
  private knockedTimer = 0;
  private checkTimer = 0;
  private checkCooldown = 0;
  private checkDirection = 1;
  private wipeoutTimer = 0;
  private airTimer = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      kind: 'rival',
      texture: AssetKeys.Rival,
      approachFactor: RIVAL.approachFactor,
      damage: RIVAL.damage,
      jumpable: RIVAL.jumpable,
      knocksOutRivals: RIVAL.knocksOutRivals,
    });
    this.targetX = x;
    this.untilRetarget = Phaser.Math.FloatBetween(0.3, RIVAL.retargetMax);
  }

  // --- state -----------------------------------------------------------

  get rivalState(): RivalState {
    return this.currentState;
  }

  get currentHealth(): number {
    return this.health;
  }

  get isWipedOut(): boolean {
    return this.currentState === 'wipedOut';
  }

  /** Can still be hit by the player. */
  get isAlive(): boolean {
    return this.currentState !== 'wipedOut';
  }

  /** Recently knocked by the player: slamming into a hazard now is a knockout. */
  get isKnocked(): boolean {
    return this.isAlive && this.knockedTimer > 0;
  }

  /** Rivals only hurt the player while actually shoulder-checking. */
  override get isDangerous(): boolean {
    return this.currentState === 'checking' && !this.isAirborne;
  }

  get isAirborne(): boolean {
    return this.airTimer > 0;
  }

  /** Hop off a ramp: briefly airborne, lands automatically, no tricks. */
  launch(): boolean {
    if (this.isAirborne || !this.isAlive) return false;
    this.airTimer = RIVAL.airSeconds;
    if (this.currentState === 'checking') this.currentState = 'surfing';
    return true;
  }

  // --- combat ----------------------------------------------------------

  /**
   * Take a hit from the player. `direction` is -1/1 (which way to shove),
   * `knockback` the sideways speed. Returns true if this hit knocked them out.
   */
  takeHit(damage: number, direction: number, knockback: number): boolean {
    if (!this.isAlive) return false;

    this.health -= damage;
    this.lateralVelocity = direction * knockback;
    this.knockedTimer = RIVAL.knockedSeconds;
    this.flash(0xffe066);

    if (this.health <= 0) {
      this.wipeOut(direction);
      return true;
    }

    this.currentState = 'stunned';
    this.stunTimer = RIVAL.stunSeconds;
    this.checkTimer = 0;
    return false;
  }

  /** Lose the board: slide sideways, tip over, fade, then get removed. */
  wipeOut(direction: number): void {
    if (this.isWipedOut) return;
    this.currentState = 'wipedOut';
    this.health = 0;
    this.lateralVelocity = direction * RIVAL.wipeoutSpeed;
    this.wipeoutTimer = RIVAL.wipeoutSeconds;
    this.clearTint();

    // Rider stays on this object (tips over), the board is thrown loose.
    this.setFrame(SurferFrame.RiderOnly);
    const board = this.scene.add.image(this.x, this.y, AssetKeys.Rival, SurferFrame.BoardOnly).setOrigin(0.5, 1).setScale(this.scaleX).setDepth(this.depth - 1);
    this.scene.tweens.add({
      targets: board,
      x: this.x - direction * 28,
      y: this.y + 24,
      angle: -direction * 160,
      alpha: 0,
      duration: RIVAL.wipeoutSeconds * 1000,
      ease: 'Quad.easeOut',
      onComplete: () => board.destroy(),
    });
    this.scene.tweens.add({
      targets: this,
      angle: direction * 90,
      alpha: 0,
      duration: RIVAL.wipeoutSeconds * 1000,
      ease: 'Quad.easeIn',
    });
  }

  // --- per frame -------------------------------------------------------

  protected override onUpdate(dt: number, ctx: HazardContext): void {
    this.knockedTimer = Math.max(0, this.knockedTimer - dt);
    this.checkCooldown = Math.max(0, this.checkCooldown - dt);
    this.airTimer = Math.max(0, this.airTimer - dt);

    switch (this.currentState) {
      case 'wipedOut':
        this.wipeoutTimer -= dt;
        if (this.wipeoutTimer <= 0) {
          this.destroy();
          return;
        }
        break;

      case 'stunned':
        this.stunTimer -= dt;
        if (this.stunTimer <= 0) this.currentState = 'surfing';
        break;

      case 'checking':
        this.checkTimer -= dt;
        this.x += this.checkDirection * RIVAL.checkSpeed * dt;
        if (this.checkTimer <= 0) {
          this.currentState = 'surfing';
          this.targetX = this.x;
        }
        break;

      case 'surfing':
        this.cruise(dt, ctx);
        if (!this.isAirborne && !ctx.playerInBigAir) this.maybeStartCheck(ctx);
        break;
    }

    // Knockback / wipeout slide, with drag.
    if (this.lateralVelocity !== 0) {
      this.x += this.lateralVelocity * dt;
      const drag = RIVAL.knockbackDrag * dt;
      this.lateralVelocity = Math.abs(this.lateralVelocity) <= drag ? 0 : this.lateralVelocity - Math.sign(this.lateralVelocity) * drag;
    }

    this.x = Phaser.Math.Clamp(this.x, PLAYER_BOUNDS.minX, PLAYER_BOUNDS.maxX);
    this.pickFrame();
  }

  /** Choose the sprite frame from the current state. */
  private pickFrame(): void {
    if (this.currentState === 'wipedOut') return; // rider-only frame set in wipeOut()
    if (this.currentState === 'stunned') this.setFrame(SurferFrame.Hurt);
    else if (this.isAirborne) this.setFrame(SurferFrame.Jump);
    else if (this.currentState === 'checking' || Math.abs(this.targetX - this.x) > 2) this.setFrame(SurferFrame.Lean);
    else this.setFrame(SurferFrame.Surf);
  }

  /** Drift towards a slowly changing lateral target. */
  private cruise(dt: number, ctx: HazardContext): void {
    this.untilRetarget -= dt;
    if (this.untilRetarget <= 0) {
      this.untilRetarget = Phaser.Math.FloatBetween(RIVAL.retargetMin, RIVAL.retargetMax);
      const seek = Math.random() < RIVAL.seekPlayerChance;
      const wanted = seek ? ctx.playerX : this.x + Phaser.Math.Between(-RIVAL.driftDistance, RIVAL.driftDistance);
      this.targetX = Phaser.Math.Clamp(wanted, PLAYER_BOUNDS.minX, PLAYER_BOUNDS.maxX);
    }

    const diff = this.targetX - this.x;
    const step = RIVAL.lateralSpeed * dt;
    this.x += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    if (Math.abs(diff) > 1) this.setFlipX(diff > 0);
  }

  /** Shoulder-check the player when close enough and off cooldown. */
  private maybeStartCheck(ctx: HazardContext): void {
    if (this.checkCooldown > 0) return;
    const dx = ctx.playerX - this.x;
    const dy = ctx.playerY - this.y;
    if (Math.abs(dx) > RIVAL.checkRangeX || Math.abs(dy) > RIVAL.checkRangeY) return;

    this.currentState = 'checking';
    this.checkDirection = Math.sign(dx) || 1;
    this.checkTimer = RIVAL.checkDurationSeconds;
    this.checkCooldown = RIVAL.checkCooldownSeconds;
    this.setFlipX(this.checkDirection > 0);
    this.flash(0xff8c42);
  }

  /** Perspective as usual, plus a size bump while hopping off a ramp. */
  protected override applyPerspective(): void {
    super.applyPerspective();
    if (this.airTimer > 0) {
      const t = 1 - this.airTimer / RIVAL.airSeconds;
      this.setScale(this.scaleX * (1 + RIVAL.airScaleBoost * 4 * t * (1 - t)));
    }
  }

  private flash(color: number): void {
    this.setTint(color);
    this.scene.time.delayedCall(120, () => {
      if (this.active && !this.isWipedOut) this.clearTint();
    });
  }

}
