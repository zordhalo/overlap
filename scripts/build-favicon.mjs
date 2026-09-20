/**
 * Generates src/app/favicon.ico from the same geometry as src/app/icon.svg.
 *
 * Rasterised here rather than shelled out to a converter for two reasons. The
 * macOS tool available (`qlmanage`) composites a page background, leaving an
 * opaque white pixel in the icon's transparent corner — small, and exactly the
 * kind of thing that makes a favicon look broken. And a build step that only
 * works on one operating system is not a build step.
 *
 * The mark is pure geometry, so a few dozen lines of supersampled circle maths
 * gives an exact result with no dependency at all.
 *
 *   node scripts/build-favicon.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// Design grid matches icon.svg's 32-unit viewBox.
const GRID = 32;
const GROUND = [0x10, 0x10, 0x10];
const DISC_A = [0x7f, 0xb2, 0xff]; // ice, a member tint
const DISC_B = [0xc9, 0xa2, 0x27]; // brass, a member tint
const LENS = [0x98, 0xff, 0x38]; // the answer colour
const RADIUS = 8.5;
const A = { x: 12, y: 16 };
const B = { x: 20, y: 16 };
const CORNER = 7;

/** 4x4 supersampling per pixel: enough to smooth a circle at 16px, cheap enough to be instant. */
const SS = 4;

function insideCircle(x, y, c) {
  const dx = x - c.x;
  const dy = y - c.y;
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

function insideRoundedRect(x, y) {
  if (x < 0 || y < 0 || x > GRID || y > GRID) return false;
  const cx = Math.min(Math.max(x, CORNER), GRID - CORNER);
  const cy = Math.min(Math.max(y, CORNER), GRID - CORNER);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= CORNER * CORNER;
}

/** Colour of one sample point, or null where the icon is transparent. */
function sample(x, y) {
  if (!insideRoundedRect(x, y)) return null;
  const a = insideCircle(x, y, A);
  const b = insideCircle(x, y, B);
  if (a && b) return LENS;
  if (a) return DISC_A;
  if (b) return DISC_B;
  return GROUND;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const scale = GRID / size;
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxi + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          const c = sample(x, y);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            hits++;
          }
        }
      }
      const total = SS * SS;
      const o = (py * size + pxi) * 4;
      if (hits === 0) continue; // stays fully transparent
      px[o] = Math.round(r / hits);
      px[o + 1] = Math.round(g / hits);
      px[o + 2] = Math.round(b / hits);
      px[o + 3] = Math.round((hits / total) * 255);
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Each scanline is prefixed with its filter type; 0 means none, which keeps
  // this writer trivial and costs a little size on an image this small.
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0;
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO with PNG payloads — read by every browser that matters, and far smaller than BMP. */
function toIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + 16 * entries.length;
  const dirs = [];
  for (const { size, png } of entries) {
    const d = Buffer.alloc(16);
    d.writeUInt8(size >= 256 ? 0 : size, 0);
    d.writeUInt8(size >= 256 ? 0 : size, 1);
    d.writeUInt16LE(1, 4); // colour planes
    d.writeUInt16LE(32, 6); // bits per pixel
    d.writeUInt32LE(png.length, 8);
    d.writeUInt32LE(offset, 12);
    dirs.push(d);
    offset += png.length;
  }
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.png)]);
}

const entries = [16, 32, 48].map((size) => ({ size, png: toPng(size, render(size)) }));
const ico = toIco(entries);
writeFileSync(new URL('../src/app/favicon.ico', import.meta.url), ico);
console.log(`favicon.ico: ${ico.length} bytes, sizes ${entries.map((e) => e.size).join('/')}`);

// A standalone PNG too, for anywhere an .ico is awkward (some link previews).
writeFileSync(new URL('../public/icon-256.png', import.meta.url), toPng(256, render(256)));
console.log('public/icon-256.png written');
