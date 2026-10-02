import Phaser from 'phaser';

import { Player } from '../entities/Player';
import { GAME_WIDTH, SceneKeys } from '../game/constants';
import { Controls } from '../input/Controls';
import { GameSpeed } from '../systems/GameSpeed';
import { ObstacleSpawner } from '../systems/ObstacleSpawner';
import { OceanScroller } from '../systems/OceanScroller';
import { DebugHud } from '../ui/DebugHud';
import { Hud } from '../ui/Hud';

/** Where the surfer starts: horizontally centred, lower-middle of the screen. */
const PLAYER_START_X = GAME_WIDTH / 2;
const PLAYER_START_Y = 146;

/**
 * GameScene runs the core loop: travel down the wave, dodge obstacles.
 *
 * It wires the independent pieces together and drives them from update().
 * Keep gameplay logic in those modules rather than here.
 */
export class GameScene extends Phaser.Scene {
  private ocean!: OceanScroller;
  private player!: Player;
  private controls!: Controls;
  private gameSpeed!: GameSpeed;
  private spawner!: ObstacleSpawner;
  private hud!: Hud;
  private debugHud!: DebugHud;
  private distance = 0;

  constructor() {
    super(SceneKeys.Game);
  }

  create(): void {
    this.distance = 0;
    this.gameSpeed = new GameSpeed();
    this.ocean = new OceanScroller(this);
    this.spawner = new ObstacleSpawner(this);
    this.player = new Player(this, PLAYER_START_X, PLAYER_START_Y);
    this.controls = new Controls(this);
    this.hud = new Hud(this);
    this.debugHud = new DebugHud(this);

    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.addCapture('F1'); // stop the browser opening its help page
      keyboard.on('keydown-F1', () => this.debugHud.toggle());
    }
  }

  override update(_time: number, delta: number): void {
    this.gameSpeed.update(delta);
    const speed = this.gameSpeed.value;
    this.distance += speed * (delta / 1000);

    this.ocean.update(delta, speed);
    this.spawner.update(delta, speed);
    this.player.update(this.controls, delta);
    this.checkCollisions();

    this.hud.update(this.distance);
    this.debugHud.update({
      player: this.player,
      gameSpeed: speed,
      obstacleCount: this.spawner.active.length,
      secondsToNextSpawn: this.spawner.secondsUntilNext(speed),
    });
  }

  private checkCollisions(): void {
    if (this.player.isInvulnerable) return;

    const playerBox = this.player.hitBox;
    for (const obstacle of this.spawner.active) {
      if (Phaser.Geom.Rectangle.Overlaps(playerBox, obstacle.hitBox)) {
        this.player.hit(obstacle.x);
        this.gameSpeed.applyHit();
        return;
      }
    }
  }
}
