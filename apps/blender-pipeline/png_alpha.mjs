/**
 * S3-D #49 — premultiplied-alpha suspicion check (warn-only, deterministic, no deps).
 *
 * R1 rev2 §4 (fixed thresholds): consider semi-transparent pixels 0 < a < 255. If there are
 * ≥ 64 of them and ≥ 99% satisfy max(r,g,b) ≤ a → PNG_ALPHA_PREMULT_SUSPECT { semiCount, ratio }.
 * Fewer than 64 semi-transparent pixels → no check (opaque / cutout art is fine).
 */
import fs from "node:fs";
import zlib from "node:zlib";

export const PNG_ALPHA_PREMULT_SUSPECT = "PNG_ALPHA_PREMULT_SUSPECT";
export const PREMULT_MIN_SEMI = 64;
export const PREMULT_MIN_RATIO = 0.99;

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Decode an 8/16-bit non-interlaced PNG to RGBA8 (colour types 0,2,4,6; palette → null).
 * @returns {{ width: number, height: number, rgba: Uint8Array, hasAlpha: boolean } | null}
 */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null;
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        ctype: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!ihdr || ihdr.interlace !== 0 || ![8, 16].includes(ihdr.depth)) return null;
  const chans = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.ctype];
  if (!chans) return null;
  const bpp = chans * (ihdr.depth / 8);
  const stride = ihdr.width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(ihdr.width * ihdr.height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < ihdr.height; y++) {
    const ft = raw[y * (stride + 1)];
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    const step = ihdr.depth / 8; // take the high byte of 16-bit samples
    for (let x = 0; x < ihdr.width; x++) {
      const s = (k) => line[x * bpp + k * step];
      const o = (y * ihdr.width + x) * 4;
      if (chans === 1) out.set([s(0), s(0), s(0), 255], o);
      else if (chans === 2) out.set([s(0), s(0), s(0), s(1)], o);
      else if (chans === 3) out.set([s(0), s(1), s(2), 255], o);
      else out.set([s(0), s(1), s(2), s(3)], o);
    }
    prev = line;
  }
  return { width: ihdr.width, height: ihdr.height, rgba: out, hasAlpha: chans === 2 || chans === 4 };
}

/** Pure analysis over RGBA8 pixels. */
export function analyzeAlpha(rgba, { minSemi = PREMULT_MIN_SEMI, minRatio = PREMULT_MIN_RATIO } = {}) {
  let semiCount = 0;
  let premultLike = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0 || a === 255) continue;
    semiCount++;
    if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) <= a) premultLike++;
  }
  const ratio = semiCount ? Number((premultLike / semiCount).toFixed(4)) : 0;
  const checked = semiCount >= minSemi;
  return { semiCount, premultLike, ratio, checked, suspect: checked && premultLike / semiCount >= minRatio };
}

/**
 * File → warning entry or null. Unreadable/unsupported PNG → null (warn-only; never throws).
 * @returns {{ code: string, message: string, detail: { semiCount: number, ratio: number } } | null}
 */
export function premultWarningForPng(filePath, opts) {
  let img;
  try {
    img = decodePng(fs.readFileSync(filePath));
  } catch {
    return null;
  }
  if (!img || !img.hasAlpha) return null;
  const r = analyzeAlpha(img.rgba, opts);
  if (!r.suspect) return null;
  return {
    code: PNG_ALPHA_PREMULT_SUSPECT,
    message: `PNG looks premultiplied: ${r.premultLike}/${r.semiCount} semi-transparent pixels have max(r,g,b) ≤ alpha — export straight alpha`,
    detail: { semiCount: r.semiCount, ratio: r.ratio },
  };
}
