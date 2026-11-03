import fs from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
// Reproducible code-drawn icon: orange tile and three white stack outlines.
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  let c = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  const size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, crc]);
}
function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay,
    t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}
function png(size) {
  const data = Buffer.alloc(size * (1 + size * 4));
  const lines = [
    [0.5, 0.26, 0.77, 0.4],
    [0.77, 0.4, 0.5, 0.54],
    [0.5, 0.54, 0.23, 0.4],
    [0.23, 0.4, 0.5, 0.26],
    [0.23, 0.51, 0.5, 0.65],
    [0.5, 0.65, 0.77, 0.51],
    [0.23, 0.62, 0.5, 0.76],
    [0.5, 0.76, 0.77, 0.62],
  ];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size,
        py = (y + 0.5) / size,
        dx = Math.max(0.2 - px, 0, px - 0.8),
        dy = Math.max(0.2 - py, 0, py - 0.8);
      const inside = Math.hypot(dx, dy) < 0.16;
      const white = lines.some((v) => segmentDistance(px, py, ...v) < 0.015);
      const index = y * (1 + size * 4) + 1 + x * 4;
      data[index] = white ? 255 : 232;
      data[index + 1] = white ? 255 : 117;
      data[index + 2] = white ? 255 : 54;
      data[index + 3] = inside ? 255 : 0;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(data)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
await fs.mkdir('build', { recursive: true });
await fs.writeFile('build/icon.png', png(512));
const embedded = png(256),
  header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(embedded.length, 14);
header.writeUInt32LE(22, 18);
await fs.writeFile('build/icon.ico', Buffer.concat([header, embedded]));
