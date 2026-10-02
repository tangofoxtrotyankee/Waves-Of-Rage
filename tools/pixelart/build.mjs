/**
 * Builds every generated art asset into public/assets/sprites and a scaled
 * preview sheet into tools/pixelart/preview.png for eyeballing.
 *
 *   node tools/pixelart/build.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Canvas, fromRows, recolorRows, sheet } from './png.mjs';
import { LEGEND } from './palette.mjs';
import { PLAYER, PLAYER_FRAME_NAMES, RIVAL_RECOLOR, ROCK, SHARK, RAMP, SPRAY, riderOnly, boardOnly } from './sprites.mjs';
import { buildSky, buildWaterTile, buildFoamTile } from './environment.mjs';
import { buildFont } from './font.mjs';

const OUT = 'public/assets/sprites';
mkdirSync(OUT, { recursive: true });

const outputs = {};
const save = (name, canvas) => {
  writeFileSync(`${OUT}/${name}.png`, canvas.toPNG());
  outputs[name] = canvas;
  console.log(`${name}.png  ${canvas.width}x${canvas.height}`);
};

const pad32 = (rows) => [...Array(32 - rows.length).fill('.'.repeat(24)), ...rows];
const frame = (rows) => fromRows(pad32(rows), LEGEND, 24);

// Player: surf, lean, jump, punch, hurt
save('player', sheet(PLAYER_FRAME_NAMES.map((n) => frame(PLAYER[n]))));

// Rival: same frames recoloured, then rider-only and board-only for the knock-off
const rivalRows = Object.fromEntries(PLAYER_FRAME_NAMES.map((n) => [n, recolorRows(PLAYER[n], RIVAL_RECOLOR)]));
save('rival', sheet([
  ...PLAYER_FRAME_NAMES.map((n) => frame(rivalRows[n])),
  frame(riderOnly(rivalRows.hurt)),
  frame(recolorRows(boardOnly(), RIVAL_RECOLOR)),
]));

save('rock', fromRows(ROCK, LEGEND));
save('shark', sheet([fromRows(SHARK, LEGEND), fromRows(SHARK.map((r, i) => (i === 0 ? '.'.repeat(r.length) : SHARK[i - 1])), LEGEND)]));
save('ramp', fromRows(RAMP, LEGEND));
save('spray', sheet(SPRAY.map((f) => fromRows(f, LEGEND))));
save('sky', buildSky());
save('water', buildWaterTile());
save('foam', buildFoamTile());
save('font', buildFont());

// Preview: everything scaled 4x on a water-coloured background.
const scale = 4;
const gap = 8;
let width = 0, height = 0;
for (const c of Object.values(outputs)) { width = Math.max(width, c.width); height += c.height + gap; }
const preview = new Canvas(Math.min(width, 320) * scale, height * scale);
preview.fillRect(0, 0, preview.width, preview.height, [30, 79, 163, 255]);
let y = 0;
for (const c of Object.values(outputs)) { preview.blit(c.scaled(scale), 0, y * scale); y += c.height + gap; }
writeFileSync('tools/pixelart/preview.png', preview.toPNG());
console.log('preview.png written');
