import Phaser from 'phaser';

import { Player } from '../entities/Player';
import { GAME_WIDTH, SceneKeys } from '../game/constants';
import { Controls } from '../input/Controls';
import { OceanScroller } from '../systems/OceanScroller';
import { DebugHud } from '../ui/DebugHud';

/** Where the surfer starts: horizontally centred, lower-middle of the screen. */
const PLAYER_START_X = GAME_WIDTH / 2;
const PLAYER_START_Y = 130;

/**
 * GameScene is where gameplay lives.
 *
 * It wires together the independent pieces (ocean, player, controls, debug
 * HUD) and drives them from update(). Keep gameplay logic in those modules
 * rather than here.
 */
export class GameScene extends Phaser.Scene {
  private ocean!: OceanScroller;
  private player!: Player;
  private controls!: Controls;
  private debugHud!: DebugHud;

  constructor() {
    super(SceneKeys.Game);
  }

  create(): void {
    this.ocean = new OceanScroller(this);
    this.player = new Player(this, PLAYER_START_X, PLAYER_START_Y);
    this.controls = new Controls(this);
    this.debugHud = new DebugHud(this);
  }

  override update(_time: number, delta: number): void {
    this.ocean.update(delta);
    this.player.update(this.controls, delta);
    this.debugHud.update(this.player);
  }
}
