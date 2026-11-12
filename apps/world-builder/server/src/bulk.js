/**
 * S3-I #70 — POST /api/assets/bulk helpers: BULK_MAX parsing, a small ZIP central-directory reader
 * (stored + deflate, no dependency) and slug derivation. Containment and probing stay in index.js.
 */
import zlib from "node:zlib";
import { ConfigError } from "./security.js";

export const BULK_MAX_DEFAULT = 20;
export const BULK_MAX_LIMIT = 100;

/** BULK_MAX → integer 1..100 (default 20); anything else → CONFIG_INVALID naming the variable only. */
export function parseBulkMax(raw) {
  if (raw == null || String(raw).trim() === "") return BULK_MAX_DEFAULT;
  const t = String(raw).trim();
  const n = Number(t);
  if (!/^[0-9]+$/.test(t) || !Number.isSafeInteger(n) || n < 1 || n > BULK_MAX_LIMIT) {
    throw new ConfigError("BULK_MAX", `must be an integer 1..${BULK_MAX_LIMIT}`);
  }
  return n;
}

export class ZipFormatError extends Error {}

/**
 * Entries from the central directory: `{name, method, compSize, size, offset, dir}`.
 * Throws ZipFormatError on a malformed archive (no EOCD, truncated records, encrypted or zip64).
 */
export function readZipEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipFormatError("not a zip");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipFormatError("no end of central directory");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new ZipFormatError("zip64 is not supported");
  const out = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipFormatError("bad central directory");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) throw new ZipFormatError("bad central directory");
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    out.push({ name, method, compSize, size, offset, encrypted: (flags & 1) === 1, dir: name.endsWith("/") });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** True when an entry name could land outside an extract root (zip-slip, absolute, drive, NUL). */
export function entryEscapes(name) {
  if (name.includes("\0")) return true;
  const n = name.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return true;
  return n.split("/").some((seg) => seg === "..");
}

/**
 * Bytes of one entry, capped at `maxBytes`. Returns `{tooLarge:true}` when the entry (declared or
 * actual) exceeds the cap, `{corrupt:true}` when it cannot be read; never throws.
 */
export function readZipEntry(buf, e, maxBytes) {
  if (e.encrypted || (e.method !== 0 && e.method !== 8)) return { corrupt: true };
  if (e.size > maxBytes || e.compSize > maxBytes) return { tooLarge: true };
  try {
    const p = e.offset;
    if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) return { corrupt: true };
    const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
    const raw = buf.subarray(start, start + e.compSize);
    if (raw.length !== e.compSize) return { corrupt: true };
    const data = e.method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw, { maxOutputLength: maxBytes + 1 });
    if (data.length > maxBytes) return { tooLarge: true };
    if (data.length !== e.size) return { corrupt: true };
    return { data };
  } catch (err) {
    if (/larger than/i.test(String(err?.message))) return { tooLarge: true }; // inflate hit maxOutputLength
    return { corrupt: true };
  }
}

/** `dir/My Model_v2.GLB` → `my-model-v2` (kebab-case per the asset slug rule), or null when empty. */
export function slugFromEntryName(name) {
  const base = name.replace(/\\/g, "/").split("/").pop().replace(/\.glb$/i, "");
  const s = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return s || null;
}
