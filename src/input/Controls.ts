import Phaser from 'phaser';

/**
 * Keyboard controls for the player.
 *
 * Reads both the arrow keys and WASD and exposes them as a single normalised
 * axis so the rest of the game never cares which scheme is being used.
 * Values are -1, 0 or 1 on each axis.
 */
export class Controls {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly wasd: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  constructor(scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard input is not available - check the game config.');
    }

    this.cursors = keyboard.createCursorKeys();
    this.wasd = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  /** -1 = left, 1 = right, 0 = neither (or both). */
  get axisX(): number {
    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    return Number(right) - Number(left);
  }

  /** -1 = up (further up the wave), 1 = down (towards the foreground), 0 = neither. */
  get axisY(): number {
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;
    return Number(down) - Number(up);
  }
}
