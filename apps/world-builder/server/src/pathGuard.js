/**
 * S3-D #141 — path containment (R1 §3 `resolveUnder`, D2 §3).
 * - decode-then-check (`%2e%2e` ≡ `..`); NUL bytes, absolute paths and `..` segments rejected
 * - realpath on the deepest existing prefix (symlink escape caught even if the leaf is missing)
 * - result must equal root or sit under `root + sep` (root itself realpath'd)
 * Never echoes the resolved/absolute path back (callers return `input` only).
 */
import fs from "node:fs";
import path from "node:path";

/** R1 rev2 §3: one code for every DATA_ROOT containment failure (not only the inbox). */
export const PATH_OUTSIDE_INBOX = "PATH_OUTSIDE_INBOX";

export class PathGuardError extends Error {
  /** @param {string} code @param {string} reason */
  constructor(code, reason) {
    super(`${code}: ${reason}`);
    this.code = code;
    this.reason = reason;
  }
}

/** realpath of the deepest existing ancestor + the remaining (non-existent) tail. */
function realpathLoose(abs) {
  let cur = abs;
  const tail = [];
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * Resolve `rel` (repo-relative to `root`) and require containment.
 * @param {string} root absolute root (e.g. DATA_ROOT or DATA_ROOT/inbox)
 * @param {unknown} rel untrusted relative path
 * @param {{ code?: string, stripPrefix?: RegExp }} [opts] (code defaults to PATH_OUTSIDE_INBOX)
 * @returns {string} absolute real path under root
 */
export function resolveUnder(root, rel, opts = {}) {
  const code = opts.code || PATH_OUTSIDE_INBOX;
  if (typeof rel !== "string" || rel.length === 0) throw new PathGuardError(code, "path must be a non-empty string");
  let decoded = rel;
  try {
    // decode repeatedly so %252e%252e cannot sneak through a single pass
    for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(decoded); i++) decoded = decodeURIComponent(decoded);
  } catch {
    throw new PathGuardError(code, "malformed percent-encoding");
  }
  if (decoded.includes("\0")) throw new PathGuardError(code, "NUL byte");
  let r = decoded.replace(/\\/g, "/");
  if (opts.stripPrefix) r = r.replace(opts.stripPrefix, "");
  if (path.isAbsolute(r) || /^[a-zA-Z]:/.test(r) || r.startsWith("//")) {
    throw new PathGuardError(code, "absolute path");
  }
  if (r.split("/").some((seg) => seg === "..")) throw new PathGuardError(code, "'..' segment");
  const rootReal = realpathLoose(path.resolve(root));
  const abs = realpathLoose(path.resolve(rootReal, r));
  if (abs !== rootReal && !abs.startsWith(rootReal + path.sep)) {
    throw new PathGuardError(code, "escapes root (symlink)");
  }
  return abs;
}
