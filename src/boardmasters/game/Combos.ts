/**
 * Input combos: short sequences of presses, fighting-game style, that
 * trigger moves. The same presses come from the keyboard (arrows, Space,
 * X, Shift) and from the phone's buttons, so a combo works everywhere.
 * Adding a move is adding a row and handling its id in Run.performCombo.
 */
export type ComboKey = 'L' | 'R' | 'F' | 'J' | 'H' | 'B';

export type ComboId = 'barrelRollRight' | 'barrelRollLeft' | 'boost';

export interface Combo {
  id: ComboId;
  name: string;
  sequence: ComboKey[];
}

export const COMBOS: Combo[] = [
  // The player's own design: RIGHT RIGHT UP (or LEFT LEFT UP). The tight COMBO_WINDOW keeps ordinary weaving and pumping from
  // firing it by accident.
  { id: 'barrelRollRight', name: 'BARREL ROLL', sequence: ['R', 'R', 'F'] },
  { id: 'barrelRollLeft', name: 'BARREL ROLL', sequence: ['L', 'L', 'F'] },
  { id: 'boost', name: 'BOOST', sequence: ['F', 'F'] },
];

/** Seconds allowed between two presses of one combo. */
export const COMBO_WINDOW = 0.35;
/** How long a press stays on the HUD's input trail. */
export const TRAIL_SECONDS = 1.0;

/** The HUD's spelling of each key. */
export const KEY_LABELS: Record<ComboKey, string> = { L: '<', R: '>', F: 'UP', J: 'JUMP', H: 'HIT', B: 'BRG' };

export class ComboReader {
  private readonly history: { key: ComboKey; at: number }[] = [];

  /** Record a press; returns the combo it completes, if any (the longest match wins). */
  push(key: ComboKey, time: number): Combo | null {
    const last = this.history[this.history.length - 1];
    if (last && time - last.at > COMBO_WINDOW) this.history.length = 0;
    this.history.push({ key, at: time });
    if (this.history.length > 6) this.history.shift();
    let best: Combo | null = null;
    for (const combo of COMBOS) {
      const n = combo.sequence.length;
      if (n > this.history.length || (best && n <= best.sequence.length)) continue;
      const tail = this.history.slice(-n);
      if (tail.every((p, i) => p.key === combo.sequence[i])) best = combo;
    }
    if (best) this.history.length = 0;
    return best;
  }

  /** The presses still showing on the trail. */
  recent(time: number): ComboKey[] {
    return this.history.filter((p) => time - p.at <= TRAIL_SECONDS).map((p) => p.key);
  }

  clear(): void {
    this.history.length = 0;
  }
}
