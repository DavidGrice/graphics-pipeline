#!/usr/bin/env node
/**
 * Write tests/fixtures/smoke-8x8.png if missing (CI / local).
 * Optional argv[2]: alternate output path (S3-C golden refresh writes to tmp
 * so no PNG media is ever staged). Bytes are deterministic.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, "tests/fixtures/smoke-8x8.png");
if (fs.existsSync(out) && fs.statSync(out).size > 20) {
  console.log("OK fixture exists", out);
  process.exit(0);
}

const w = 8;
const h = 8;
const rows = [];
for (let y = 0; y < h; y++) {
  const row = Buffer.alloc(1 + w * 4);
  row[0] = 0;
  for (let x = 0; x < w; x++) {
    const i = 1 + x * 4;
    row[i] = 220;
    row[i + 1] = 40;
    row[i + 2] = 40;
    row[i + 3] = 255;
  }
  rows.push(row);
}
const raw = Buffer.concat(rows);

function chunk(tag, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([tag, data])) >>> 0);
  return Buffer.concat([len, tag, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0);
ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8;
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk(Buffer.from("IHDR"), ihdr),
  chunk(Buffer.from("IDAT"), zlib.deflateSync(raw, { level: 9 })),
  chunk(Buffer.from("IEND"), Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log("OK wrote", out, png.length);
