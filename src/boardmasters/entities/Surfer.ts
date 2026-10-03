import type { InputState } from '../engine/Input';
import { Rider, type RiderControl } from './Rider';

/** The player's rider: controlled by input. */
export class Surfer extends Rider {
  fromInput(input: InputState): RiderControl {
    // The chase camera looks down world +z, so world +x is screen-left: Right must steer towards -x.
    return { steer: -input.steer, pump: input.pump, brake: input.brake, jump: input.jump, attack: input.attack, barge: input.barge };
  }
}
