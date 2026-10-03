/**
 * ASCII pixel maps for every sprite. Legend in palette.mjs ('.' = transparent).
 * Player frames are 24x32 with the board on the bottom rows; the sprite's
 * origin in-game is bottom-centre.
 */

const BOARD = [
  '.kyyyyyyyyyyyyyyyyyyyyk.',
  'kyyyyoooooooooooooooyyyk',
  'kyyyooorrrrrrrrrrrooooyk',
  'kyyyyoooooooooooooooyyyk',
  '.kyyyyyyyyyyyyyyyyyyyyk.',
  '..kkkkkkkkkkkkkkkkkkkk..',
];

const HEAD_FRONT = [
  '........hhhhhhhh........',
  '.......hHHhhhhhhh.......',
  '......hHhhhhhhhhhh......',
  '......hhssssssshhh......',
  '......hsssssssssh.......',
  '......sskssssksss.......',
  '......ssssssssss........',
  '.......sssSSSss.........',
  '........sssss...........',
];

export const PLAYER = {
  // Neutral surfing stance, facing the camera, slight crouch.
  surf: [
    ...HEAD_FRONT,
    '.....kttttttttttk.......',
    '....kttTTttttttttk......',
    '...sttttttttttttttk.....',
    '..ssttttttTtttttttss....',
    '..ss.ttttttttttttt.ss...',
    '.....ttttttttttttt......',
    '.....nnnnnnnnnnnnn......',
    '.....nnNNnnnnnNNnn......',
    '.....nnnnnnnnnnnnn......',
    '.....nnnnn...nnnnn......',
    '.....ssss.....ssss......',
    '.....ssss.....ssss......',
    '.....SSSS.....SSSS......',
    '....kssssk...kssssk.....',
    ...BOARD,
    '.....b..........b.......',
  ],
  // Leaning into a turn (used flipped for the other side), arm trailing.
  lean: [
    '.......hhhhhhhh.........',
    '......hHHhhhhhhh........',
    '.....hHhhhhhhhhhh.......',
    '.....hhssssssshhh.......',
    '.....hsssssssssh........',
    '.....sskssssksss........',
    '.....ssssssssss.........',
    '......sssSSSss..........',
    '.......sssss............',
    '....kttttttttttk........',
    '...kttTTttttttttk.......',
    '..sttttttttttttttk......',
    '.ssttttttTtttttttkss....',
    '.ss.tttttttttttttt.ss...',
    '....ttttttttttttttt.....',
    '....nnnnnnnnnnnnnn......',
    '....nnNNnnnnnNNnnn......',
    '....nnnnnnnnnnnnnn......',
    '....nnnnn....nnnnn......',
    '....ssss......ssss......',
    '....ssss......ssss......',
    '....SSSS......SSSS......',
    '...kssssk....kssssk.....',
    ...BOARD,
    '.....b..........b.......',
  ],
  // Airborne: knees tucked, arms out wide.
  jump: [
    '........hhhhhhhh........',
    '.......hHHhhhhhhh.......',
    '......hHhhhhhhhhhh......',
    '......hhssssssshhh......',
    '......hsssssssssh.......',
    '......sskssssksss.......',
    '......ssssssssss........',
    '.......sssSSSss.........',
    '........sssss...........',
    'ss...kttttttttttk...ss..',
    '.ss.kttTTttttttttk.ss...',
    '..ssttttttttttttttss....',
    '...sttttttTttttttts.....',
    '.....ttttttttttttt......',
    '.....nnnnnnnnnnnnn......',
    '.....nnNNnnnnnNNnn......',
    '.....nnnnnnnnnnnnn......',
    '.....nnnnn...nnnnn......',
    '.....ssss.....ssss......',
    '.....SSSS.....SSSS......',
    '....kssssk...kssssk.....',
    '........................',
    '........................',
    '........................',
    '........................',
    ...BOARD,
    '.....b..........b.......',
  ],
  // Punch to the right (flipped for left).
  punch: [
    ...HEAD_FRONT,
    '.....kttttttttttk.......',
    '....kttTTttttttttk......',
    '...stttttttttttttkssss..',
    '..ssttttttTttttttkssSSk.',
    '..ss.ttttttttttttt.kkk..',
    '.....ttttttttttttt......',
    '.....nnnnnnnnnnnnn......',
    '.....nnNNnnnnnNNnn......',
    '.....nnnnnnnnnnnnn......',
    '.....nnnnn...nnnnn......',
    '.....ssss.....ssss......',
    '.....ssss.....ssss......',
    '.....SSSS.....SSSS......',
    '....kssssk...kssssk.....',
    ...BOARD,
    '.....b..........b.......',
  ],
  // Hurt: arms up, mouth open, knocked back.
  hurt: [
    '.........hhhhhhhh.......',
    '........hHHhhhhhhh......',
    '.......hHhhhhhhhhhh.....',
    '.......hhssssssshhh.....',
    '.......hsssssssssh......',
    '.......sskssssksss......',
    '.......sssskkssss.......',
    '........sssSkSss........',
    '.........sssss..........',
    '.ss..kttttttttttk..ss...',
    '..ss.ttTTttttttttt.ss...',
    '...ssttttttttttttsss....',
    '....sttttttTttttts......',
    '.....ttttttttttttt......',
    '.....nnnnnnnnnnnnn......',
    '.....nnNNnnnnnNNnn......',
    '.....nnnnnnnnnnnnn......',
    '.....nnnnn...nnnnn......',
    '.....ssss.....ssss......',
    '.....ssss.....ssss......',
    '.....SSSS.....SSSS......',
    '....kssssk...kssssk.....',
    ...BOARD,
    '.....b..........b.......',
  ],
};

/** Rival: same maps, different clothes, hair and board. */
export const RIVAL_RECOLOR = { t: 'x', T: 'X', h: 'k', H: 'G', y: 'w', o: 'l', r: 'a' };

export const PLAYER_FRAME_NAMES = ['surf', 'lean', 'jump', 'punch', 'hurt'];

/** Rider only (no board) and board only, for the rival's knock-off. */
export function riderOnly(rows) {
  return rows.map((r, i) => (i >= rows.length - 7 ? '.'.repeat(r.length) : r));
}
export function boardOnly() {
  return [...BOARD];
}

export const ROCK = [
  '......kkkkkkkk........',
  '....kkLLLLLLLRkk......',
  '...kLLLLLLLLRRRRk.....',
  '..kLLLLLLRRRRRRRRk....',
  '..kLLLLRRRRRRRRRRk....',
  '.kLLLRRRRRRRRRRRKKk...',
  '.kLRRRRRRRRRRRKKKKk...',
  '.kRRRRRRRRRKKKKKKKk...',
  '.kRRRRRRRKKKKKKKKKk...',
  'kkRRRRRKKKKKKKKKKKkk..',
  'kRRRRKKKKKKKKKKKKKKKk.',
  'kKKKKKKKKKKKKKKKKKKKk.',
  'wwkkkkkkkkkkkkkkkkkkww',
  'fwwwffwwwfffwwwffwwwwf',
  '.ffwwwfffwwwfffwwwfff.',
  '...ff....fff....ff....',
];

export const SHARK = [
  '...................kk.........',
  '..................kGgk........',
  '.................kGGggk.......',
  '................kGGGggk.......',
  '...............kGGGGggk.......',
  '..............kGGGGGggk.......',
  '.............kGGGGGGggk.......',
  '............kGGGGGGGggk.......',
  'kk.........kGGGGGGGGggkk......',
  'kGk.......kggggggggggggkk.....',
  'kGGkkkkkkkggggggggggggggkk....',
  'kGGGggggggggggggggggggggggkk..',
  'kGGgggggggggggggggggggggggxkk.',
  'kgggggBBBBBBBBBBBBBBBBBBBBkkk.',
  '.kkBBBBBBBBBBBBBBBBBBBBBkk....',
  'wwffkkkkkkkkkkkkkkkkkkkkffwww.',
  'fwwwwffwwwffwwwwffwwwffwwwwfff',
  '.ff.....fff...ff....fff...ff..',
];

export const RAMP = [
  '......................wwwwwwww',
  '...................wwwwffwwwww',
  '................wwwwfflllffwww',
  '..............wwwfflllllllfffw',
  '............wwflllllllllllllff',
  '..........wwfllllllaaallllllff',
  '........wwfllllaaaaaaaallllff.',
  '......wwfllllaaaaaaaaaaallff..',
  '....wwflllaaaaaaaaaaaaaallf...',
  '..wwfllaaaaaaaaaaaaaaaaalff...',
  'wwfllaaaaaaaaaaaaaaaaaaaff....',
  'fflaaaaaaaaaaaaaaaaaaaaff.....',
  'wwwwwwwwwwwwwwwwwwwwwwwww.....',
  'ffwwffffwwwfffwwwffffwwwf.....',
];

/** Lifeguard boat, 40x18, facing right (flipped in-game for the other way). */
export const BOAT = [
  '..................xx....................',
  '..................xwx...................',
  '..................xwwx..................',
  '..................xxxx..................',
  '..................kk....................',
  '............kkkkkkkkkkkkk...............',
  '............kwwwwwwwwwwwk...............',
  '............kwkkwwwwkkwwk...............',
  '............kwwwwwwwwwwwk...............',
  '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
  'kwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwk.',
  'kwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwk',
  'kxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxk',
  '.kwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwk..',
  '..kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk...',
  'ffwwffwwwffffwwwfffwwwwffffwwwffwwwfffff',
  '.fff..fff...ffff..ffff...fff...ffff..ff.',
  '...ff.....ff....ff.....ff....ff.....ff..',
];

/** Spray behind the board: three frames, 24x8. */
export const SPRAY = [
  [
    '........................',
    '....w..............w....',
    '...www....ww......www...',
    '..wwfw...wwww....wfww...',
    '.wwfffw.wwffww..wfffww..',
    'wwffffwwwffffwwwwffffww.',
    'ffffffffffffffffffffffff',
    '.fff..ffff..ffff..ffff..',
  ],
  [
    '........................',
    '.......w........w.......',
    '..w...www..w...www...w..',
    '.www.wwfww.www.wfww.www.',
    'wwfwwwffffwwfwwfffwwwfww',
    'wffffwffffffffffffwffffw',
    'ffffffffffffffffffffffff',
    '..ffff..fff..fff..ffff..',
  ],
  [
    '........................',
    '..........w....w........',
    '.w......wwww..wwww....w.',
    'www....wwffww.wwffww.www',
    'wfww..wwffffwwwffffwwwfw',
    'wfffwwwffffffffffffwwfff',
    'ffffffffffffffffffffffff',
    'fff..ffff..ffff..ffff..f',
  ],
];
