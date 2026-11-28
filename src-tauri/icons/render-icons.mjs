import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

const rects = [
  [5, 2, 2, 2, '#10b981'],
  [7, 4, 2, 2, '#10b981'],
  [17, 2, 2, 2, '#10b981'],
  [15, 4, 2, 2, '#10b981'],
  [11, 5, 2, 2, '#34d399'],
  [2, 6, 20, 15, '#1e293b'],
  [2, 6, 20, 2, '#334155'],
  [2, 6, 2, 15, '#334155'],
  [20, 6, 2, 15, '#0f172a'],
  [2, 19, 20, 2, '#0f172a'],
  [4, 8, 13, 10, '#064e3b'],
  [5, 9, 11, 8, '#10b981'],
  [6, 10, 4, 2, '#a7f3d0'],
  [6, 13, 2, 2, '#6ee7b7'],
  [12, 14, 3, 2, '#047857'],
  [18, 9, 2, 2, '#34d399'],
  [18, 13, 2, 2, '#94a3b8'],
  [18, 16, 2, 1, '#475569'],
  [5, 21, 3, 1, '#0f172a'],
  [16, 21, 3, 1, '#0f172a'],
];

function hex(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

function raster(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const background = hex('#0c0e13');
  for (let i = 0; i < size * size; i++) pixels.set(background, i * 4);
  const grid = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => null));
  for (const [x, y, w, h, color] of rects) {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) grid[py][px] = hex(color);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sample = grid[Math.min(23, Math.floor((y * 24) / size))][Math.min(23, Math.floor((x * 24) / size))];
      if (sample) pixels.set(sample, (y * size + x) * 4);
    }
  }
  return pixels;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + entries.length;
  for (const [index, image] of images.entries()) {
    const at = index * 16;
    entries[at] = image.size >= 256 ? 0 : image.size;
    entries[at + 1] = image.size >= 256 ? 0 : image.size;
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(image.png.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += image.png.length;
  }
  return Buffer.concat([header, entries, ...images.map((image) => image.png)]);
}

mkdirSync(dir, { recursive: true });
const sizes = [32, 128, 256];
const images = sizes.map((size) => ({ size, png: png(size, raster(size)) }));
writeFileSync(join(dir, '32x32.png'), images[0].png);
writeFileSync(join(dir, '128x128.png'), images[1].png);
writeFileSync(join(dir, '128x128@2x.png'), images[2].png);
writeFileSync(join(dir, 'icon.ico'), ico(images));
