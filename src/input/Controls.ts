import Phaser from 'phaser';

import { touchState } from './TouchControls';

/**
 * Keyboard controls for the player.
 *
 * Reads both the arrow keys and WASD and exposes them as a single normalised
 * axis so the rest of the game never cares which scheme is being used.
 * Values are -1, 0 or 1 on each axis. Jump is Space, attack is X or J,
 * shoulder barge is Shift. On-screen touch buttons (TouchControls) are
 * merged in transparently; canvas taps are routed here by the scenes.
 */
export class Controls {
  private readonly cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private readonly wasd: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private jumpRequested = false;
  private attackRequested = false;
  private bargeRequested = false;

  constructor(scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) {
      throw new Error('Keyboard input is not available - check the game config.');
    }

    const { KeyCodes } = Phaser.Input.Keyboard;
    this.cursors = keyboard.createCursorKeys();
    this.wasd = {
      up: keyboard.addKey(KeyCodes.W),
      down: keyboard.addKey(KeyCodes.S),
      left: keyboard.addKey(KeyCodes.A),
      right: keyboard.addKey(KeyCodes.D),
    };
    // Actions are latched from keydown events rather than polled, so even a
    // tap shorter than one frame is never lost. Auto-repeat is ignored.
    const latch = (set: () => void) => (event: KeyboardEvent) => {
      if (!event.repeat) set();
    };
    keyboard.on('keydown-SPACE', latch(() => (this.jumpRequested = true)));
    keyboard.on('keydown-X', latch(() => (this.attackRequested = true)));
    keyboard.on('keydown-J', latch(() => (this.attackRequested = true)));
    keyboard.on('keydown-SHIFT', latch(() => (this.bargeRequested = true)));
    keyboard.addCapture([KeyCodes.SPACE, KeyCodes.SHIFT]); // stop the page scrolling / browser shortcuts
  }

  /** -1 = left, 1 = right, 0 = neither (or both). */
  get axisX(): number {
    const left = this.cursors.left.isDown || this.wasd.left.isDown || touchState.left;
    const right = this.cursors.right.isDown || this.wasd.right.isDown || touchState.right;
    return Number(right) - Number(left);
  }

  /** -1 = up (further up the wave), 1 = down (towards the foreground), 0 = neither. */
  get axisY(): number {
    const up = this.cursors.up.isDown || this.wasd.up.isDown || touchState.up;
    const down = this.cursors.down.isDown || this.wasd.down.isDown || touchState.down;
    return Number(down) - Number(up);
  }

  /** A canvas tap (or click) acts like Space: queue a jump. */
  requestJump(): void {
    this.jumpRequested = true;
  }

  /** True once per jump key press; reading it clears the request. */
  consumeJump(): boolean {
    const requested = this.jumpRequested;
    this.jumpRequested = false;
    return requested;
  }

  /** True once per attack key press (X or J); reading it clears the request. */
  consumeAttack(): boolean {
    const requested = this.attackRequested || touchState.attackRequested;
    this.attackRequested = false;
    touchState.attackRequested = false;
    return requested;
  }

  /** True once per barge key press (Shift); reading it clears the request. */
  consumeBarge(): boolean {
    const requested = this.bargeRequested || touchState.bargeRequested;
    this.bargeRequested = false;
    touchState.bargeRequested = false;
    return requested;
  }
}
