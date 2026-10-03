/**
 * Riders: the playable characters from the line-up sheet
 * (docs/art-direction/boardmasters/character-lineup.webp) and the rival
 * surfers. A rider is data: four stats on a 0..1 scale that scale the
 * physics, and the colours its low-poly mesh is built from. Adding a
 * character is adding a row; the mesh builder and physics read the spec.
 *
 * Stats:  SPEED  cruising and top speed
 *         TURN   carve rate
 *         POWER  shove strength in contact (combat, later)
 *         RAGE   how fast the RAGE meter fills (later)
 */
export interface RiderColors {
  skin: number;
  hair: number;
  shorts: number;
  board: number;
  boardStripe: number;
}

export interface RiderSpec {
  id: string;
  name: string;
  title: string;
  speed: number;
  turn: number;
  power: number;
  rage: number;
  colors: RiderColors;
  /** Body scale: Chungus is big. */
  build: number;
}

export type CharacterId = 'sam' | 'kai' | 'chungus' | 'skye' | 'diesel' | 'bish' | 'shadow';

const rider = (id: string, name: string, title: string, stats: [number, number, number, number], colors: RiderColors, build = 1): RiderSpec => ({
  id,
  name,
  title,
  speed: stats[0],
  turn: stats[1],
  power: stats[2],
  rage: stats[3],
  colors,
  build,
});

export const CHARACTERS: Record<CharacterId, RiderSpec> = {
  sam: rider('sam', 'SAM', 'THE ALL-ROUNDER', [0.6, 0.6, 0.6, 0.6], { skin: 0xf4a261, hair: 0xd9a441, shorts: 0x2a9d8f, board: 0xffc43d, boardStripe: 0xe63946 }),
  kai: rider('kai', 'KAI', 'THE SPEED DEMON', [0.95, 0.8, 0.3, 0.5], { skin: 0xc97b4a, hair: 0x2b1a3d, shorts: 0xff4fa3, board: 0xff8fd0, boardStripe: 0xffffff }),
  chungus: rider('chungus', 'CHUNGUS', 'THE HEAVY HITTER', [0.35, 0.3, 1.0, 0.7], { skin: 0xd98c4a, hair: 0x3a2418, shorts: 0x7b2cbf, board: 0x1e2a44, boardStripe: 0x8ecae6 }, 1.25),
  skye: rider('skye', 'SKYE', 'THE TRICKSTER', [0.6, 0.9, 0.4, 0.8], { skin: 0xf4c28f, hair: 0xf1d27a, shorts: 0x4f7cc8, board: 0x7ff6ff, boardStripe: 0xff4fa3 }, 0.92),
  diesel: rider('diesel', 'DIESEL', 'THE LIFEGUARD', [0.5, 0.5, 0.8, 0.5], { skin: 0xc97b4a, hair: 0x7a3f1d, shorts: 0xe63946, board: 0xffffff, boardStripe: 0xe63946 }, 1.1),
  bish: rider('bish', 'BISH', 'THE POSER', [0.7, 0.6, 0.5, 0.3], { skin: 0xf4a261, hair: 0xffe066, shorts: 0xffd166, board: 0xff8c42, boardStripe: 0x1a1a2e }),
  shadow: rider('shadow', 'SHADOW', 'THE MYSTERY', [0.8, 0.7, 0.7, 0.9], { skin: 0x15151f, hair: 0x15151f, shorts: 0x101018, board: 0x2b2b3b, boardStripe: 0x7ff6ff }),
};

export const CHARACTER_ORDER: CharacterId[] = ['sam', 'kai', 'chungus', 'skye', 'diesel', 'bish', 'shadow'];

/** Rival surfers, cycled through as rivals are added to a course. */
export const RIVALS: RiderSpec[] = [
  rider('local', 'LOCAL', 'RIVAL', [0.55, 0.6, 0.5, 0.5], { skin: 0xd98c4a, hair: 0x7a3f1d, shorts: 0x2a9d8f, board: 0x5fb3f0, boardStripe: 0xffffff }),
  rider('poser', 'POSER', 'RIVAL', [0.65, 0.5, 0.4, 0.4], { skin: 0xf4a261, hair: 0xffe066, shorts: 0x5fb3f0, board: 0xffc43d, boardStripe: 0x7b2cbf }),
  rider('big-guy', 'BIG GUY', 'RIVAL', [0.4, 0.35, 0.95, 0.6], { skin: 0xd98c4a, hair: 0xd98c4a, shorts: 0x1a1a2e, board: 0xe63946, boardStripe: 0x1a1a2e }, 1.3),
  rider('girl-rival', 'GIRL RIVAL', 'RIVAL', [0.7, 0.85, 0.45, 0.6], { skin: 0xc97b4a, hair: 0x2b1a3d, shorts: 0x9b5de5, board: 0xff4fa3, boardStripe: 0xffffff }, 0.92),
];

/** How the 0..1 stats scale the physics constants. */
export function statMultipliers(spec: RiderSpec): { speed: number; carve: number; power: number; rage: number } {
  return {
    speed: 0.9 + 0.2 * spec.speed,
    carve: 0.85 + 0.3 * spec.turn,
    power: 0.7 + 0.6 * spec.power,
    rage: 0.7 + 0.6 * spec.rage,
  };
}

export function characterById(id: string | null | undefined): RiderSpec {
  return id && Object.hasOwn(CHARACTERS, id) ? CHARACTERS[id as CharacterId] : CHARACTERS.sam;
}
