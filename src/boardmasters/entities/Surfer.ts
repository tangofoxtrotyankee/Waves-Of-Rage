import type { InputState } from '../engine/Input';
import { Rider, type RiderControl } from './Rider';

/** The player's rider: controlled by input. Combat and tricks will add attack, barge and trick handling here. */
export class Surfer extends Rider {
  fromInput(input: InputState): RiderControl {
    // The chase camera looks down world +z, so world +x is screen-left: Right must steer towards -x.
    return { steer: -input.steer, pump: input.pump, brake: input.brake, jump: input.jump };
  }
}
