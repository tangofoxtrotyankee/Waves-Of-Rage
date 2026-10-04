/**
 * Riders: the playable characters from the line-up sheet
 * (docs/art-direction/boardmasters/character-lineup.webp) and the rival
 * surfers. A rider is data: four stats on a 0..1 scale that scale the
 * physics, the colours its low-poly mesh is painted in, and a `look` (body
 * type, hair, clothes, accessories, board graphic) that the model builder
 * (entities/RiderModel.ts) turns into geometry and textures. Adding a
 * character is adding a row; the mesh builder and physics read the spec.
 *
 * Stats:  SPEED  cruising and top speed
 *         TURN   carve rate
 *         POWER  shove strength in contact
 *         RAGE   how fast the RAGE meter fills
 */
export interface RiderColors {
  skin: number;
  hair: number;
  /** Board shorts (or bikini bottoms); the base of the shorts pattern. */
  shorts: number;
  board: number;
  boardStripe: number;
}

/** Heroic and broad, big-bellied and wide, or lean and narrow. */
export type BodyType = 'athletic' | 'heavy' | 'slim';
export type HairStyle = 'spiky' | 'quiff' | 'mohawk' | 'long' | 'dreads' | 'ponytail' | 'buzz' | 'bald' | 'hood';
export type HatStyle = 'none' | 'cap' | 'capBack' | 'visor';
export type TopStyle = 'none' | 'bikini' | 'crop' | 'vest' | 'wetsuit';
/** The loud print on the shorts (riderTextures.ts paints it in `colors.shorts` and `look.accent`). */
export type ShortsPattern = 'floral' | 'leopard' | 'stripe' | 'denim' | 'solid' | 'palm' | 'bikini';
/** Deck graphics from the sheet's BOARDS row. */
export type BoardDesign = 'classic' | 'jagged' | 'flame' | 'palm' | 'shark' | 'skull' | 'reggae' | 'neon' | 'cross';

export interface RiderLook {
  body: BodyType;
  /** A female figure: narrower shoulders, wider hips, a bust. */
  female: boolean;
  hair: HairStyle;
  hat: HatStyle;
  /** Hat colour (caps and visors). */
  hatColor: number;
  top: TopStyle;
  /** Colour of the top (vest, crop top, bikini top, wetsuit trim). */
  topColor: number;
  shorts: ShortsPattern;
  /** The second colour of the shorts print (and the waistband). */
  accent: number;
  shades: boolean;
  beard: boolean;
  /** Colour of a chain or shell necklace, or null for none. */
  necklace: number | null;
  /** Colour of the wristbands, or null for none. */
  wristbands: number | null;
  board: BoardDesign;
  /** A pointed shortboard nose, or a rounded one. */
  roundNose: boolean;
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
  look: RiderLook;
  /** Body scale: Chungus is big. */
  build: number;
}

export type CharacterId = 'sam' | 'kai' | 'chungus' | 'skye' | 'diesel' | 'bish' | 'shadow';

const LOOK_DEFAULT: RiderLook = {
  body: 'athletic',
  female: false,
  hair: 'spiky',
  hat: 'none',
  hatColor: 0xe63946,
  top: 'none',
  topColor: 0x1a1a2e,
  shorts: 'floral',
  accent: 0xff4fa3,
  shades: false,
  beard: false,
  necklace: null,
  wristbands: null,
  board: 'classic',
  roundNose: false,
};

const rider = (id: string, name: string, title: string, stats: [number, number, number, number], colors: RiderColors, look: Partial<RiderLook>, build = 1): RiderSpec => ({
  id,
  name,
  title,
  speed: stats[0],
  turn: stats[1],
  power: stats[2],
  rage: stats[3],
  colors,
  look: { ...LOOK_DEFAULT, ...look },
  build,
});

export const CHARACTERS: Record<CharacterId, RiderSpec> = {
  // Blond spikes, teal shorts with magenta leaves, a shell necklace, a yellow board with pink streaks (the mockup's hero).
  sam: rider('sam', 'SAM', 'THE ALL-ROUNDER', [0.6, 0.6, 0.6, 0.6], { skin: 0xe0955a, hair: 0xd9a441, shorts: 0x2a9d8f, board: 0xffc43d, boardStripe: 0xe6287a }, {
    hair: 'spiky', shorts: 'floral', accent: 0xe6287a, necklace: 0xf8f0d8, wristbands: 0x1a1a2e, board: 'jagged',
  }),
  // Long dark hair, a pink bikini, a pink palm board.
  kai: rider('kai', 'KAI', 'THE SPEED DEMON', [0.95, 0.8, 0.3, 0.5], { skin: 0xc97b4a, hair: 0x2b1a3d, shorts: 0xff4fa3, board: 0xff8fd0, boardStripe: 0xffffff }, {
    body: 'slim', female: true, hair: 'long', top: 'bikini', topColor: 0xff4fa3, shorts: 'bikini', accent: 0xffffff, wristbands: 0xffd166, board: 'palm', roundNose: true,
  }),
  // Big belly, a backwards cap, a beard, shades and a gold chain; purple leopard shorts; a dark flame board.
  chungus: rider('chungus', 'CHUNGUS', 'THE HEAVY HITTER', [0.35, 0.3, 1.0, 0.7], { skin: 0xc98048, hair: 0x2a1a12, shorts: 0x7b2cbf, board: 0x1e2a44, boardStripe: 0xff8c42 }, {
    body: 'heavy', hair: 'bald', hat: 'capBack', hatColor: 0xe63946, shorts: 'leopard', accent: 0x1a1a2e, shades: true, beard: true, necklace: 0xffd166, wristbands: 0x1a1a2e, board: 'flame', roundNose: true,
  }, 1.25),
  // Long blonde hair under a backwards cap, a green crop top, denim shorts, a neon board.
  skye: rider('skye', 'SKYE', 'THE TRICKSTER', [0.6, 0.9, 0.4, 0.8], { skin: 0xf0b98a, hair: 0xf1d27a, shorts: 0x5a8fd6, board: 0x7ff6ff, boardStripe: 0xff4fa3 }, {
    body: 'slim', female: true, hair: 'long', hat: 'capBack', hatColor: 0x2d4fd6, top: 'crop', topColor: 0x2bb673, shorts: 'denim', accent: 0xbfe3ff, wristbands: 0xff4fa3, board: 'neon',
  }, 0.92),
  // The lifeguard: a red cap and shades, red shorts with a white stripe, a white board with a red cross.
  diesel: rider('diesel', 'DIESEL', 'THE LIFEGUARD', [0.5, 0.5, 0.8, 0.5], { skin: 0xb8703f, hair: 0x2a1a12, shorts: 0xe63946, board: 0xf8f8f0, boardStripe: 0xe63946 }, {
    hair: 'buzz', hat: 'cap', hatColor: 0xe63946, shorts: 'stripe', accent: 0xffffff, shades: true, wristbands: 0xffffff, board: 'cross', roundNose: true,
  }, 1.1),
  // The poser: a blond quiff and shades, a gold chain, leopard shorts, a pink palm board.
  bish: rider('bish', 'BISH', 'THE POSER', [0.7, 0.6, 0.5, 0.3], { skin: 0xe9a066, hair: 0xffe066, shorts: 0xffc23d, board: 0xff8fd0, boardStripe: 0x1a1a2e }, {
    hair: 'quiff', shorts: 'leopard', accent: 0x6b3a1e, shades: true, necklace: 0xffd166, board: 'palm',
  }),
  // The mystery: a black wetsuit and hood, a mask with cyan goggles, a shark board.
  shadow: rider('shadow', 'SHADOW', 'THE MYSTERY', [0.8, 0.7, 0.7, 0.9], { skin: 0x1c1c28, hair: 0x15151f, shorts: 0x15151f, board: 0x3b4252, boardStripe: 0x7ff6ff }, {
    hair: 'hood', top: 'wetsuit', topColor: 0x7ff6ff, shorts: 'solid', accent: 0x7ff6ff, wristbands: 0x7ff6ff, board: 'shark',
  }),
};

export const CHARACTER_ORDER: CharacterId[] = ['sam', 'kai', 'chungus', 'skye', 'diesel', 'bish', 'shadow'];

/** localStorage key (through systems/Storage) for the chosen character. */
export const CHARACTER_STORAGE_KEY = 'bm.character';

/** Rival surfers, cycled through as rivals are added to a course. */
export const RIVALS: RiderSpec[] = [
  // Dreadlocks, teal shorts with yellow palms, a reggae board.
  rider('local', 'LOCAL', 'RIVAL', [0.55, 0.6, 0.5, 0.5], { skin: 0xa8683a, hair: 0x3a2418, shorts: 0x2a9d8f, board: 0x2bb673, boardStripe: 0xffd166 }, {
    hair: 'dreads', shorts: 'palm', accent: 0xffd166, necklace: 0xf8f0d8, board: 'reggae', roundNose: true,
  }),
  // Blond spikes and shades, floral shorts, a classic board.
  rider('poser', 'POSER', 'RIVAL', [0.65, 0.5, 0.4, 0.4], { skin: 0xf0a565, hair: 0xffe066, shorts: 0x5fb3f0, board: 0xffc43d, boardStripe: 0x7b2cbf }, {
    hair: 'spiky', shorts: 'floral', accent: 0xffd166, shades: true, wristbands: 0x7b2cbf, board: 'classic',
  }),
  // The mockup's big rival: a mohawk, a black vest with a skull on the back, red shorts, a skull board.
  rider('big-guy', 'BIG GUY', 'RIVAL', [0.4, 0.35, 0.95, 0.6], { skin: 0x9a5c32, hair: 0x15151f, shorts: 0xd62839, board: 0x1a1a2e, boardStripe: 0xf8f8f0 }, {
    body: 'heavy', hair: 'mohawk', top: 'vest', topColor: 0x1e1e26, shorts: 'floral', accent: 0xf8f8f0, wristbands: 0x1a1a2e, board: 'skull', roundNose: true,
  }, 1.3),
  // Long dark hair and a magenta bikini, a neon board.
  rider('girl-rival', 'GIRL RIVAL', 'RIVAL', [0.7, 0.85, 0.45, 0.6], { skin: 0xc08050, hair: 0x2b1a3d, shorts: 0xe6287a, board: 0xff4fa3, boardStripe: 0xffffff }, {
    body: 'slim', female: true, hair: 'long', top: 'bikini', topColor: 0xe6287a, shorts: 'bikini', accent: 0xffffff, board: 'neon', roundNose: true,
  }, 0.92),
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
