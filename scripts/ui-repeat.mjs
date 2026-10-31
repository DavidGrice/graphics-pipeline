#!/usr/bin/env node
/**
 * S3-G CO-4 — `npm run test:ui:repeat -- [N]` (default 3): run the browser UI suite N times and fail
 * if any test flips (passes in one run, fails in another). A test failing in every run also fails.
 * Prints a flip table (test · result per run). Needs UI_URL + WORLD_API like the UI tests; without
 * them every UI test skips with its own code and nothing can flip.
 *
 *   UI suite = tests/*.test.mjs that call browserEnv() (override: UI_REPEAT_FILES=a.mjs,b.mjs)
 *   exit 0 stable and green · exit 1 any flip or failure (verdict column; no new error code) · exit 2 bad N
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const arg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const N = arg ? Number(arg) : 3;
if (!(N >= 1 && N <= 20)) {
  console.error("usage: test:ui:repeat -- [N 1..20]");
  process.exit(2);
}

function uiFiles() {
  if (process.env.UI_REPEAT_FILES) return process.env.UI_REPEAT_FILES.split(",").filter(Boolean);
  const dir = path.join(ROOT, "tests");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".test.mjs") && /\bbrowserEnv\(/.test(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort()
    .map((f) => path.join("tests", f));
}

/** TAP → Map(name → "pass" | "fail" | "skip"), top-level tests only. */
export function parseTap(out) {
  const res = new Map();
  for (const line of out.split("\n")) {
    const m = /^(not ok|ok) \d+ - (.*?)(\s+# (SKIP|TODO).*)?$/.exec(line);
    if (!m) continue;
    res.set(m[2], m[3] ? "skip" : m[1] === "ok" ? "pass" : "fail");
  }
  return res;
}

const files = uiFiles();
// a parent `node --test` sets NODE_TEST_CONTEXT, which turns the child into a subtest stream — drop it
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;
const runs = [];
for (let i = 1; i <= N; i++) {
  const r = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...files], {
    cwd: ROOT,
    encoding: "utf8",
    env: childEnv,
    maxBuffer: 64 << 20,
  });
  runs.push(parseTap(r.stdout || ""));
  console.log(`run ${i}/${N}: exit ${r.status}`);
}
const names = [...new Set(runs.flatMap((m) => [...m.keys()]))].sort();
let flips = 0;
let fails = 0;
console.log(`\n| test | ${runs.map((_, i) => `run ${i + 1}`).join(" | ")} | verdict |`);
console.log(`|---|${runs.map(() => "---|").join("")}---|`);
for (const n of names) {
  const r = runs.map((m) => m.get(n) ?? "missing");
  const ran = r.filter((x) => x === "pass" || x === "fail");
  const verdict = ran.includes("pass") && ran.includes("fail") ? "FLIP" : ran.includes("fail") ? "FAIL" : r.every((x) => x === "skip") ? "skip" : "ok";
  if (verdict === "FLIP") flips++;
  if (verdict === "FAIL") fails++;
  console.log(`| ${n} | ${r.join(" | ")} | ${verdict} |`);
}
console.log(`\nui-repeat: ${names.length} tests × ${N} runs, ${flips} flip(s), ${fails} consistent fail(s)`);
process.exit(flips || fails ? 1 : 0);
