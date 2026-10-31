/**
 * S3-F #128 — append-only activity feed (Leader ruling a; D2 §#128).
 *
 *   <DATA_ROOT>/activity.jsonl  one JSON object per line: {at, kind, id, slug?}  (D2 @1f687da / R1 §3)
 *   kind ∈ asset.register | asset.patch | asset.delete | scene.save | scene.purge | pack.import.
 *   S3-G: ops kinds inbox.sweep {removed, kept} | webhook.refused {reason} | webhook.failed (no id).
 *   Never bodies, paths, IPs or headers.
 *   Cap ACTIVITY_MAX_LINES (default 10,000; test-only override): when the current file holds `cap`
 *   lines it is renamed to activity.1.jsonl (one generation kept, overwritten) and a fresh file starts.
 *   Writes are serialised; a failed write logs a warning and NEVER fails the request it records.
 *   The feed reads newest-first from the current file and falls back to activity.1.jsonl when it needs
 *   more; malformed lines are skipped. `total` counts valid entries across both files.
 */
import fs from "node:fs";
import { resolveUnder } from "./pathGuard.js";
import { ConfigError } from "./security.js";

export const ACTIVITY_KINDS = Object.freeze([
  "asset.register",
  "asset.patch",
  "asset.delete",
  "scene.save",
  "scene.purge",
  "pack.import",
  // S3-G #78 / #72 (D2) — ops events: no id; only the listed counters/reason, never URL/IP/path/secret.
  "inbox.sweep",
  "webhook.refused",
  "webhook.failed",
]);
/** S3-G — kinds that carry no asset id; the allowed extra fields per kind. */
export const OPS_KINDS = Object.freeze({
  "inbox.sweep": ["removed", "kept"],
  "webhook.refused": ["reason"],
  "webhook.failed": [],
});

/** Sanitised ops entry `{at, kind, ...allowed}`; null for unknown kinds or bad field types. */
export function opsEntry(kind, fields = {}, at = new Date()) {
  const allowed = OPS_KINDS[kind];
  if (!allowed) return null;
  const e = { at: at.toISOString(), kind };
  for (const k of allowed) {
    const v = fields[k];
    if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) e[k] = v;
    else if (typeof v === "string" && /^[a-z_-]{1,32}$/.test(v)) e[k] = v;
  }
  return e;
}
export const ACTIVITY_MAX_LINES_DEFAULT = 10000;
export const ACTIVITY_LIMIT_DEFAULT = 20;
export const ACTIVITY_LIMIT_MAX = 100;

export function parseActivityMaxLines(raw) {
  if (raw == null || String(raw).trim() === "") return ACTIVITY_MAX_LINES_DEFAULT;
  const t = String(raw).trim();
  if (!/^[0-9]+$/.test(t) || !Number.isSafeInteger(Number(t)) || Number(t) < 1) {
    throw new ConfigError("ACTIVITY_MAX_LINES", "must be an integer >= 1");
  }
  return Number(t);
}

/** `?limit=` → integer 1..100 (default 20) or null when invalid. */
export function parseActivityLimit(raw) {
  if (raw === undefined) return ACTIVITY_LIMIT_DEFAULT;
  if (typeof raw !== "string" || !/^[0-9]{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= ACTIVITY_LIMIT_MAX ? n : null;
}

function countLines(file) {
  try {
    const txt = fs.readFileSync(file, "utf8");
    if (!txt) return 0;
    return txt.split("\n").filter((l) => l.trim() !== "").length;
  } catch {
    return 0;
  }
}

/** Build a sanitised entry `{at, kind, id, slug?}` from an asset doc; null for unknown kinds. */
export function activityEntry(kind, doc, at = new Date()) {
  if (OPS_KINDS[kind]) return null;
  if (!ACTIVITY_KINDS.includes(kind) || !doc || typeof doc.id !== "string") return null;
  const e = { at: at.toISOString(), kind, id: doc.id };
  if (typeof doc.slug === "string" && doc.slug) e.slug = doc.slug;
  return e;
}

function parseFile(file) {
  let txt = "";
  try {
    txt = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const items = [];
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (!e || typeof e !== "object" || Array.isArray(e)) continue;
      if (typeof e.at !== "string" || !ACTIVITY_KINDS.includes(e.kind)) continue;
      if (OPS_KINDS[e.kind]) {
        const o = opsEntry(e.kind, e, new Date(e.at));
        if (o && !Number.isNaN(Date.parse(e.at))) items.push({ ...o, at: e.at });
        continue;
      }
      if (typeof e.id !== "string") continue;
      const out = { at: e.at, kind: e.kind, id: e.id };
      if (typeof e.slug === "string") out.slug = e.slug;
      items.push(out);
    } catch {
      /* malformed line — skipped, never fatal */
    }
  }
  return items;
}

export function createActivityLog({ dataRoot, maxLines = ACTIVITY_MAX_LINES_DEFAULT, warn = console.warn }) {
  const file = resolveUnder(dataRoot, "activity.jsonl");
  const rotated = resolveUnder(dataRoot, "activity.1.jsonl");
  let lines = null; // lazily counted once, then tracked
  let chain = Promise.resolve();

  function writeOne(entry) {
    if (lines === null) lines = countLines(file);
    if (lines >= maxLines) {
      fs.renameSync(file, rotated); // overwrites the previous generation
      lines = 0;
    }
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o644 });
    lines += 1;
  }

  return {
    file,
    rotated,
    /** Fire-and-forget; resolves when written (or after the warning on failure). Never rejects. */
    record(kind, doc) {
      const entry = OPS_KINDS[kind] ? opsEntry(kind, doc ?? {}) : activityEntry(kind, doc);
      if (!entry) return chain;
      chain = chain.then(() => {
        try {
          writeOne(entry);
        } catch (err) {
          lines = null; // recount next time
          warn(`[world-builder] activity write failed (${err && err.code ? err.code : "error"}); request unaffected`);
        }
      });
      return chain;
    },
    /** Newest-first `{items, total}`: current file first, then activity.1.jsonl when more are needed. */
    async read(limit = ACTIVITY_LIMIT_DEFAULT) {
      await chain;
      const current = parseFile(file).reverse();
      const older = parseFile(rotated).reverse();
      const items = current.length >= limit ? current.slice(0, limit) : [...current, ...older].slice(0, limit);
      return { items, total: current.length + older.length };
    },
  };
}
