import Phaser from 'phaser';

import type { Obstacle } from '../entities/Obstacle';
import { Player } from '../entities/Player';
import type { RivalSurfer } from '../entities/RivalSurfer';
import { GAME_WIDTH, SceneKeys } from '../game/constants';
import { GAMEPLAY } from '../game/gameplay';
import { Controls } from '../input/Controls';
import { Combat, type KnockoutEvent } from '../systems/Combat';
import { Combo } from '../systems/Combo';
import { GameSpeed } from '../systems/GameSpeed';
import { ObstacleSpawner } from '../systems/ObstacleSpawner';
import { OceanScroller } from '../systems/OceanScroller';
import { DebugHud } from '../ui/DebugHud';
import { spawnFloatingText } from '../ui/FloatingText';
import { Hud } from '../ui/Hud';
import type { GameOverData } from './GameOverScene';

/** Where the surfer starts: horizontally centred, lower-middle of the screen. */
const PLAYER_START_X = GAME_WIDTH / 2;
const PLAYER_START_Y = 146;

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
  private score = 0;
  private distance = 0;
  private elapsedSeconds = 0;
  private gameOver = false;

  constructor() {
    super(SceneKeys.Game);
  }

  create(): void {
    this.health = GAMEPLAY.startHealth;
    this.score = 0;
    this.distance = 0;
    this.elapsedSeconds = 0;
    this.gameOver = false;

    this.gameSpeed = new GameSpeed();
    this.combo = new Combo();
    this.ocean = new OceanScroller(this);
    this.spawner = new ObstacleSpawner(this);
    this.player = new Player(this, PLAYER_START_X, PLAYER_START_Y);
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
    this.spawner.update(delta, speed, this.elapsedSeconds, { playerX: this.player.x, playerY: this.player.y });
    this.player.update(this.controls, delta);
    if (!this.gameOver) {
      this.combat.update(this.player, this.spawner.active);
      this.checkCollisions();
    }

    this.hud.update({
      health: this.health,
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
    spawnFloatingText(this, rival.x, rival.y - rival.displayHeight, label, environmental ? '#7ff6ff' : '#ffd166');
    this.cameras.main.shake(KNOCKOUT_SHAKE.durationMs, KNOCKOUT_SHAKE.intensity);
  }

  // --- player damage ---------------------------------------------------

  private checkCollisions(): void {
    const playerBox = this.player.hitBox;

    for (const obstacle of this.spawner.active) {
      if (!Phaser.Geom.Rectangle.Overlaps(playerBox, obstacle.hitBox)) continue;

      if (obstacle.jumpable && this.player.isJumping) {
        if (!obstacle.cleared) {
          obstacle.cleared = true;
          this.score += GAMEPLAY.jumpClearBonus;
          spawnFloatingText(this, this.player.x, this.player.y - 40, `+${GAMEPLAY.jumpClearBonus}`);
        }
        continue;
      }

      if (obstacle.isDangerous && !this.player.isInvulnerable) {
        this.takeHit(obstacle);
        return;
      }
    }
  }

  private takeHit(obstacle: Obstacle): void {
    this.health = Math.max(0, this.health - obstacle.damage);
    this.player.hit(obstacle.x);
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
