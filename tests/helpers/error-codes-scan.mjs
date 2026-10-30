/**
 * S3-D #152 — scan apps/ packages/ scripts/ (+ the #104 skip reporter) for error / exit / skip
 * codes, and parse docs/error-codes.md. Used by tests/s3d-error-codes.test.mjs (both directions).
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./s3d-synth.mjs";

export const SCAN_DIRS = ["apps", "packages", "scripts"];
export const EXTRA_FILES = ["tests/reporters/skip-summary.mjs"];
const EXT = /\.(m?js|cjs|ts|tsx|sh|py)$/;
const SKIP_DIR = new Set(["node_modules", "dist", "build", ".vite", "__pycache__"]);

/**
 * UPPER_SNAKE string literals that are NOT codes (env var / option / constant names).
 * Kept explicit so a new code-looking literal must be documented or consciously listed here.
 */
export const NON_CODES = new Set([
  "ARMATURE_NAME",
  "CORS_ORIGINS",
  "KRITA_FP_DEBUG",
  "KRITA_FP_PORT",
  "KRITA_FP_TOKEN",
  "MAX_GLB_MB",
  "RATE_LIMIT_PER_MIN",
  "SMOKE_MODE",
  "TRUST_PROXY",
]);

const UPPER = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+";
const PATTERNS = [
  new RegExp(`["'\`](${UPPER})["'\`]`, "g"), // "GLB_CORRUPT", 'E_GOLDEN_DRIFT'
  new RegExp(`["'\`](${UPPER}):\\s`, "g"), // `ALT_TEXT_TOO_LONG: …` message prefixes
  /sendError\(\s*res,\s*\d+,\s*"([A-Z][A-Z0-9_]*)"/g, // sendError(res, 404, "NOT_FOUND", …)
  /\bcode:\s*"([A-Z][A-Z0-9_]*)"/g, // { code: "INTERNAL" }
  /\bERROR ([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+):/g, // CLI: ERROR GLB_TOO_LARGE: …
  /\((V\d+[a-z]?)\)/g, // scene messages: "(V4a)"
];

export function sourceFiles() {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".") || SKIP_DIR.has(e.name)) continue;
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else if (EXT.test(e.name)) out.push(r);
    }
  };
  for (const d of SCAN_DIRS) walk(d);
  return [...out, ...EXTRA_FILES];
}

/** Map code → Set(files) of every code raised/declared in source. */
export function sourceCodes(files = sourceFiles()) {
  const codes = new Map();
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const c = m[1];
        if (NON_CODES.has(c)) continue;
        if (!codes.has(c)) codes.set(c, new Set());
        codes.get(c).add(f);
      }
    }
  }
  return codes;
}

/** All source text (for the doc → source direction on V-codes mentioned only in comments). */
export function sourceText(files = sourceFiles()) {
  return files.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
}

export const GROUPS = ["Generic", "Scene / V-codes", "Asset", "Import warnings", "CLI exits", "Test skips"];
export const HEADER = "| code | HTTP / exit | where raised | meaning | fix hint |";

/** Parse docs/error-codes.md → [{group, rows:[{codes:[...], status, where, meaning, fix, line}]}]. */
export function parseDoc(md) {
  const groups = [];
  let cur = null;
  for (const line of md.split("\n")) {
    const h = /^###\s+\d+\.\s+(.+?)\s*$/.exec(line);
    if (h) {
      cur = { group: h[1], header: null, rows: [] };
      groups.push(cur);
      continue;
    }
    if (!cur || !line.startsWith("|")) continue;
    if (!cur.header) {
      cur.header = line.trim();
      continue;
    }
    if (/^\|\s*-/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const codes = [...cells[0].matchAll(/`([A-Z][A-Z0-9_]*[A-Z0-9]|V\d+[a-z]?)`/g)].map((m) => m[1]);
    cur.rows.push({ codes, cells, line });
  }
  return groups;
}
