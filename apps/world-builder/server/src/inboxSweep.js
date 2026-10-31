/**
 * S3-G #78 — inbox PNG age-based cleanup (R1 §3, D2).
 * - INBOX_TTL_HOURS integer 1..8760 (default 168); anything else → CONFIG_INVALID at start.
 * - Only `*.png` directly under the inbox (resolveUnder), never symlinks (lstat), never subdirs.
 * - Files referenced by a registered asset (`importMeta.originalFilename`, or the pipeline's
 *   `formats.sourcePng` = "inbox/<name>.png") are kept.
 * - Removed only when mtime is older than the TTL. Per-file errors are warnings; never throws.
 * The file sweep is the source of truth (Mongo TTL index is advisory, only when connected).
 */
import fs from "node:fs";
import path from "node:path";
import { resolveUnder } from "./pathGuard.js";
import { ConfigError } from "./security.js";

export const INBOX_TTL_HOURS_DEFAULT = 168;
export const INBOX_TTL_HOURS_MAX = 8760;
export const INBOX_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export function parseInboxTtlHours(raw) {
  if (raw == null || String(raw).trim() === "") return INBOX_TTL_HOURS_DEFAULT;
  const t = String(raw).trim();
  const n = Number(t);
  if (!/^[0-9]+$/.test(t) || !Number.isSafeInteger(n) || n < 1 || n > INBOX_TTL_HOURS_MAX) {
    throw new ConfigError("INBOX_TTL_HOURS", `must be an integer 1..${INBOX_TTL_HOURS_MAX}`);
  }
  return n;
}

/** Basenames of inbox PNGs referenced by registered assets. */
export function referencedInboxNames(docs) {
  const out = new Set();
  for (const d of docs ?? []) {
    if (!d || typeof d !== "object") continue;
    const of = d.importMeta?.originalFilename;
    if (typeof of === "string" && of) out.add(path.basename(of.replace(/\\/g, "/")));
    const sp = d.formats?.sourcePng;
    if (typeof sp === "string" && sp.startsWith("inbox/")) {
      const rest = sp.slice("inbox/".length);
      if (rest && !rest.includes("/")) out.add(rest);
    }
  }
  return out;
}

/**
 * @param {{inboxRoot: string, ttlHours: number, now?: number, referenced?: Set<string>, warn?: Function}} o
 * @returns {{removed: number, kept: number}}
 */
export function sweepInbox({ inboxRoot, ttlHours, now = Date.now(), referenced = new Set(), warn = console.warn }) {
  let removed = 0;
  let kept = 0;
  let names;
  try {
    names = fs.readdirSync(inboxRoot);
  } catch (err) {
    if (err && err.code !== "ENOENT") warn(`[world-builder] inbox sweep: cannot list inbox (${err.code || "error"})`);
    return { removed, kept };
  }
  const cutoff = now - ttlHours * 3600 * 1000;
  for (const name of names) {
    if (!/\.png$/i.test(name)) continue;
    try {
      const st = fs.lstatSync(path.join(inboxRoot, name));
      if (st.isSymbolicLink() || !st.isFile()) continue; // never follow symlinks
      const abs = resolveUnder(inboxRoot, name);
      if (path.dirname(abs) !== fs.realpathSync(inboxRoot)) continue;
      if (referenced.has(name) || st.mtimeMs >= cutoff) {
        kept += 1;
        continue;
      }
      fs.unlinkSync(abs);
      removed += 1;
    } catch (err) {
      warn(`[world-builder] inbox sweep: skipped one file (${err && err.code ? err.code : "error"})`);
    }
  }
  return { removed, kept };
}
