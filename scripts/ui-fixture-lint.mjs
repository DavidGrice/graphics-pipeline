#!/usr/bin/env node
/**
 * S3-H CO-2 — `lint:ci` check: UI tests must not hard-code asset ids.
 * Scans the same file set as ui-repeat (tests/*.test.mjs that call browserEnv()),
 * plus any path passed as CLI args (used by the planted-id self-test).
 *
 * A hard-coded UUID (8-4-4-4-12 hex) in a UI test file → LINT_FAILED.
 * Dynamic ids from runId() / registerFixture() never appear as literals, so they pass.
 *
 *   exit 0  clean
 *   exit 1  ERROR LINT_FAILED: ui-fixture — findings printed above
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function uiFiles() {
  const dir = path.join(ROOT, "tests");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".test.mjs") && /\bbrowserEnv\(/.test(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort()
    .map((f) => path.join("tests", f));
}

export function findHardcodedIds(rel, src) {
  const problems = [];
  for (const m of src.matchAll(UUID_RE)) {
    problems.push(`${rel}:${lineOf(src, m.index)} hard-coded asset id ${m[0]}`);
  }
  return problems;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split("\n").length;
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : uiFiles();
const problems = [];
for (const rel of files) {
  const abs = path.isAbsolute(rel) ? rel : path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    problems.push(`${rel}: file not found`);
    continue;
  }
  problems.push(...findHardcodedIds(path.relative(ROOT, abs) || rel, fs.readFileSync(abs, "utf8")));
}

if (problems.length) {
  for (const p of problems) console.error(`ui-fixture: ${p}`);
  console.error("ERROR LINT_FAILED: ui-fixture");
  process.exit(1);
}
console.log(`OK ui-fixture (${files.length} file${files.length === 1 ? "" : "s"})`);
