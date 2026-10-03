import Phaser from 'phaser';

import type { Obstacle } from '../entities/Obstacle';
import { PLAYER_START, Player } from '../entities/Player';
import { RivalSurfer } from '../entities/RivalSurfer';
import { GAME_WIDTH, SceneKeys } from '../game/constants';
import { difficultySpec, getDifficulty } from '../game/difficulty';
import { GAMEPLAY } from '../game/gameplay';
import { Controls } from '../input/Controls';
import { consumeTap } from '../input/TouchControls';
import { Combat, type KnockoutEvent } from '../systems/Combat';
import { Combo } from '../systems/Combo';
import { GameSpeed } from '../systems/GameSpeed';
import { ObstacleSpawner } from '../systems/ObstacleSpawner';
import { OceanScroller } from '../systems/OceanScroller';
import { DebugHud } from '../ui/DebugHud';
import { spawnFloatingText } from '../ui/FloatingText';
import { Hud } from '../ui/Hud';
import type { GameOverData } from './GameOverScene';

/** Camera shake on a landed blow: deliberately tiny. */
const HIT_SHAKE = { durationMs: 60, intensity: 0.004 } as const;
const KNOCKOUT_SHAKE = { durationMs: 110, intensity: 0.007 } as const;

/**
 * GameScene runs the arcade loop: surf, dodge or jump hazards, fight rivals,
 * take damage, wipe out, hand over to GameOverScene.
 *
 * It wires the independent pieces together and drives them from update().
 * Keep entity behaviour in the entity modules rather than here.
 */
export class GameScene extends Phaser.Scene {
  private ocean!: OceanScroller;
  private player!: Player;
  private controls!: Controls;
  private gameSpeed!: GameSpeed;
  private spawner!: ObstacleSpawner;
  private combat!: Combat;
  private combo!: Combo;
  private hud!: Hud;
  private debugHud!: DebugHud;

  private health = 0;
  private maxHealth = 3;
  private score = 0;
  private distance = 0;
  private elapsedSeconds = 0;
  private gameOver = false;

  constructor() {
    super(SceneKeys.Game);
  }

  create(): void {
    const mode = difficultySpec(getDifficulty());
    this.maxHealth = mode.startHealth;
    this.health = mode.startHealth;
    this.score = 0;
    this.distance = 0;
    this.elapsedSeconds = 0;
    this.gameOver = false;

    this.gameSpeed = new GameSpeed(mode);
    this.combo = new Combo();
    this.ocean = new OceanScroller(this);
    this.spawner = new ObstacleSpawner(this, mode);
    this.player = new Player(this, PLAYER_START.x, PLAYER_START.y);
    this.controls = new Controls(this);
    this.combat = new Combat({
      onRivalHit: (rival) => this.onRivalHit(rival),
      onKnockout: (event) => this.onKnockout(event),
    });
    this.hud = new Hud(this);
    this.debugHud = new DebugHud(this);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.addCapture('F1'); // stop the browser opening its help page
      keyboard.on('keydown-F1', () => this.debugHud.toggle());
    }

    // Desktop: a mouse click on the water also jumps (touch taps come through TouchControls).
    if (!this.controls.isTouch) this.input.on('pointerdown', () => this.controls.requestJump());

    this.createPauseButton();
    keyboard?.on('keydown-ESC', () => this.pause());
    keyboard?.on('keydown-P', () => this.pause());
    this.events.on(Phaser.Scenes.Events.RESUME, () => consumeTap());
  }

  /** Two-bar pause icon in the top-right corner of the HUD. */
  private createPauseButton(): void {
    const x = GAME_WIDTH - 9;
    const y = 9;
    const icon = this.add.graphics().setDepth(1000);
    icon.fillStyle(0x1a0b2e, 0.85);
    icon.fillRect(x - 7, y - 7, 14, 14);
    icon.fillStyle(0xffd166, 1);
    icon.fillRect(x - 5, y - 5, 3, 10);
    icon.fillRect(x + 2, y - 5, 3, 10);
    const hit = this.add.zone(x, y, 18, 18).setDepth(1001).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.pause();
    });
  }

  private pause(): void {
    if (this.gameOver || this.scene.isPaused()) return;
    this.scene.launch(SceneKeys.Pause);
    this.scene.pause();
  }

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;
    this.gameSpeed.update(delta);
    const speed = this.gameSpeed.value;

    if (!this.gameOver) {
      this.elapsedSeconds += dt;
      this.distance += speed * dt;
      this.score += (speed * dt * GAMEPLAY.scorePerDistanceUnit) / GAMEPLAY.pixelsPerDistanceUnit;
      this.combo.update(dt);
    }

    this.ocean.update(delta, speed);
    this.spawner.update(delta, speed, this.elapsedSeconds, {
      playerX: this.player.x,
      playerY: this.player.y,
      playerInBigAir: this.player.isBigAir,
    });
    this.player.update(this.controls, delta);
    if (!this.gameOver) {
      this.checkRamps();
      this.resolveLanding();
      this.combat.update(this.player, this.spawner.active);
      this.checkCollisions();
    }

    this.hud.update({
      health: this.health,
      maxHealth: this.maxHealth,
      score: this.score,
      distanceUnits: this.distanceUnits,
      comboMultiplier: this.combo.multiplier,
      comboSecondsRemaining: this.combo.secondsRemaining,
    });
    this.debugHud.update({
      player: this.player,
      health: this.health,
      score: this.score,
      gameSpeed: speed,
      elapsedSeconds: this.elapsedSeconds,
      obstacles: this.spawner.active,
      secondsToNextSpawn: this.spawner.secondsUntilNext(speed),
      comboMultiplier: this.combo.multiplier,
      comboSecondsRemaining: this.combo.secondsRemaining,
      rampsSpawned: this.spawner.rampsSpawned,
    });
  }

  private get distanceUnits(): number {
    return Math.floor(this.distance / GAMEPLAY.pixelsPerDistanceUnit);
  }

  // --- combat events ---------------------------------------------------

  private onRivalHit(_rival: RivalSurfer): void {
    this.cameras.main.shake(HIT_SHAKE.durationMs, HIT_SHAKE.intensity);
  }

  private onKnockout({ rival, environmental }: KnockoutEvent): void {
    const multiplier = this.combo.register();
    const base = environmental ? GAMEPLAY.environmentalKnockoutScore : GAMEPLAY.rivalKnockoutScore;
    const points = base * multiplier;
    this.score += points;

    const label = multiplier > 1 ? `+${points} x${multiplier}` : `+${points}`;
    spawnFloatingText(this, rival.x, rival.y - rival.displayHeight, label, environmental ? 0x7ff6ff : 0xffd166);
    this.cameras.main.shake(KNOCKOUT_SHAKE.durationMs, KNOCKOUT_SHAKE.intensity);
  }

  // --- ramps, air and landings -----------------------------------------

  /** Riding over a ramp launches the player (and rivals) into the air. */
  private checkRamps(): void {
    const ramps = this.spawner.active.filter((o) => o.kind === 'ramp');
    if (ramps.length === 0) return;

    const playerBox = this.player.hitBox;
    const rivals = this.spawner.active.filter((o): o is RivalSurfer => o instanceof RivalSurfer && o.isAlive);

    for (const ramp of ramps) {
      const rampBox = ramp.hitBox;
      if (!this.player.isBigAir && Phaser.Geom.Rectangle.Overlaps(playerBox, rampBox)) {
        this.player.launch();
      }
      for (const rival of rivals) {
        if (!rival.isAirborne && Phaser.Geom.Rectangle.Overlaps(rival.hitBox, rampBox)) rival.launch();
      }
    }
  }

  /** Score a clean landing or punish a crash. */
  private resolveLanding(): void {
    const landing = this.player.consumeLanding();
    if (!landing) return;

    const px = this.player.x;
    const py = this.player.y - 44;

    if (!landing.clean) {
      this.player.crashLand();
      spawnFloatingText(this, px, py, 'WIPEOUT', 0xff4d6d);
      this.cameras.main.shake(KNOCKOUT_SHAKE.durationMs, KNOCKOUT_SHAKE.intensity);
      this.applyDamage(1, px);
      return;
    }

    const points = GameScene.trickPoints(landing.rotation, landing.grabbed);
    this.score += points;
    spawnFloatingText(this, px, py, `${landing.trickName} +${points}`, 0x7ff6ff);
  }

  static trickPoints(rotation: number, grabbed: boolean): number {
    const { trick } = GAMEPLAY;
    const spin = rotation >= 540 ? trick.rotation540 : rotation >= 360 ? trick.rotation360 : rotation >= 180 ? trick.rotation180 : 0;
    return trick.air + spin + (grabbed ? trick.grab : 0) + trick.landing;
  }

  // --- player damage ---------------------------------------------------

  private checkCollisions(): void {
    const playerBox = this.player.hitBox;

    for (const obstacle of this.spawner.active) {
      if (!Phaser.Geom.Rectangle.Overlaps(playerBox, obstacle.hitBox)) continue;

      if (obstacle.kind === 'ramp') continue;

      if (obstacle.jumpable && this.player.isAirborne) {
        if (!obstacle.cleared) {
          obstacle.cleared = true;
          this.score += GAMEPLAY.jumpClearBonus;
          spawnFloatingText(this, this.player.x, this.player.y - 40, `+${GAMEPLAY.jumpClearBonus}`);
        }
        continue;
      }

      // Nothing on the water can reach a player launched off a ramp.
      if (this.player.isBigAir) continue;

      if (obstacle.isDangerous && !this.player.isInvulnerable) {
        this.takeHit(obstacle);
        return;
      }
    }
  }

  private takeHit(obstacle: Obstacle): void {
    this.applyDamage(obstacle.damage, obstacle.x);
  }

  /** Shared damage path for hazards and crash landings. */
  private applyDamage(amount: number, fromX: number): void {
    this.health = Math.max(0, this.health - amount);
    this.player.hit(fromX);
    this.gameSpeed.applyHit();

    if (this.health === 0) this.wipeOut();
  }

  private wipeOut(): void {
    this.gameOver = true;
    this.player.wipeOut();
    this.spawner.stop();
    this.gameSpeed.stop();

    const data: GameOverData = { distanceUnits: this.distanceUnits, score: Math.floor(this.score) };
    this.time.delayedCall(GAMEPLAY.wipeoutSeconds * 1000, () => this.scene.start(SceneKeys.GameOver, data));
  }
}
