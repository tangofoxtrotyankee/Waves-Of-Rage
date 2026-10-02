/**
 * Minimal PNG writer (RGBA, 8-bit, no dependencies) plus tiny pixel helpers.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** A simple RGBA canvas. */
export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = rgba[0];
    this.data[i + 1] = rgba[1];
    this.data[i + 2] = rgba[2];
    this.data[i + 3] = rgba[3] ?? 255;
  }

  get(x, y) {
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  fillRect(x, y, w, h, rgba) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, rgba);
  }

  /** Copy another canvas onto this one (alpha > 0 wins). */
  blit(src, dx, dy) {
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const p = src.get(x, y);
        if (p[3] > 0) this.set(dx + x, dy + y, p);
      }
  }

  scaled(factor) {
    const out = new Canvas(this.width * factor, this.height * factor);
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++) out.set(x, y, this.get(Math.floor(x / factor), Math.floor(y / factor)));
    return out;
  }

  toPNG() {
    const raw = Buffer.alloc((this.width * 4 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 4 + 1)] = 0; // filter: none
      raw.set(this.data.subarray(y * this.width * 4, (y + 1) * this.width * 4), y * (this.width * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

/** '#rrggbb' or '#rrggbbaa' -> [r,g,b,a] */
export function hex(h) {
  const v = h.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), v.length === 8 ? parseInt(v.slice(6, 8), 16) : 255];
}

/**
 * Build a canvas from ASCII rows. `palette` maps one character to a colour;
 * '.' (or any unmapped char) is transparent. Every row must be `width` long.
 */
export function fromRows(rows, palette, width = rows[0].length) {
  const c = new Canvas(width, rows.length);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y} is ${row.length} wide, expected ${width}: "${row}"`);
    for (let x = 0; x < width; x++) {
      const col = palette[row[x]];
      if (col) c.set(x, y, col);
    }
  });
  return c;
}

/** Lay frames out horizontally in one sheet. */
export function sheet(frames) {
  const w = frames[0].width;
  const h = frames[0].height;
  const out = new Canvas(w * frames.length, h);
  frames.forEach((f, i) => {
    if (f.width !== w || f.height !== h) throw new Error('frame size mismatch');
    out.blit(f, i * w, 0);
  });
  return out;
}

/** Return a copy with palette characters remapped (for recolours like the rival). */
export function recolorRows(rows, map) {
  return rows.map((r) => r.replace(/./g, (ch) => map[ch] ?? ch));
}

/** Seeded PRNG for deterministic noise. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
