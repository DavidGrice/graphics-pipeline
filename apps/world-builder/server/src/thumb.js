/**
 * S3-I #28 — scene thumbnail body check: exactly a 256x256 PNG (signature, IHDR, trailing IEND).
 * Never decodes pixels; the upload is stored as-is under WB_DATA_ROOT.
 */
import zlib from "node:zlib";

export const THUMB_SIZE = 256;
export const THUMB_MAX_BYTES = 512 * 1024;
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IEND = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

/** Returns null when `buf` is a 256x256 PNG, else a short reason (no body echo). */
export function thumbProblem(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 + 25 + 12) return "body must be a 256x256 PNG";
  if (!buf.subarray(0, 8).equals(SIG)) return "body must be a PNG (bad signature)";
  if (buf.readUInt32BE(8) !== 13 || buf.toString("latin1", 12, 16) !== "IHDR") return "body must be a PNG (missing IHDR)";
  if (zlib.crc32 && zlib.crc32(buf.subarray(12, 29)) !== buf.readUInt32BE(29)) return "body must be a PNG (bad IHDR checksum)";
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== THUMB_SIZE || h !== THUMB_SIZE) return `body must be ${THUMB_SIZE}x${THUMB_SIZE} (got ${w}x${h})`;
  if (!buf.subarray(buf.length - 12).equals(IEND)) return "body must be a complete PNG (no IEND)";
  return null;
}
