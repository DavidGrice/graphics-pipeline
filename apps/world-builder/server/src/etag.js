/**
 * S3-H #69 — strong ETag from a canonical JSON serialization of a stored asset doc.
 * ETag form: "<first 32 hex of sha256(canonical)>" (quoted, strong).
 */
import crypto from "node:crypto";

/** Deep-sort object keys so the hash is stable across key insertion order. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

/** Strong ETag string for a stored doc (quoted 32-hex). */
export function etagOf(doc) {
  const hex = crypto.createHash("sha256").update(canonicalJson(doc)).digest("hex").slice(0, 32);
  return `"${hex}"`;
}

/**
 * Parse an If-Match header.
 * @returns {null} absent (opt-in: treat as match)
 * @returns {{ ok: false }} malformed
 * @returns {{ ok: true, star: true }} `*`
 * @returns {{ ok: true, tags: string[] }} one or more quoted tags (as returned by etagOf)
 */
export function parseIfMatch(header) {
  if (header == null) return null;
  const raw = String(header).trim();
  if (raw === "") return { ok: false };
  if (raw === "*") return { ok: true, star: true };
  const tags = [];
  let s = raw;
  while (s.length) {
    s = s.replace(/^\s*,\s*/, "");
    if (!s) break;
    // Quoted-string only (no weak W/ prefix — our ETags are strong).
    const m = /^"((?:\\.|[^"\\])*)"/.exec(s);
    if (!m) return { ok: false };
    tags.push(`"${m[1].replace(/\\(.)/g, "$1")}"`);
    s = s.slice(m[0].length).trim();
    if (s && s[0] !== ",") return { ok: false };
  }
  if (!tags.length) return { ok: false };
  return { ok: true, tags };
}

/** Whether an opt-in If-Match allows the write given the current ETag. Absent → true. */
export function ifMatchOk(parsed, currentEtag) {
  if (parsed == null) return true;
  if (!parsed.ok) return false;
  if (parsed.star) return true;
  return parsed.tags.includes(currentEtag);
}
