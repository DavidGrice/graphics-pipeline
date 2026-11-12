/**
 * S3-I E3 #105 — perf budgets: one perf-budgets.json, a Node 24 CI job, over-budget lines carry
 * budget + actual + HEAD=. A planted over-budget fixture fails the script; the committed budgets
 * pass (GLB bytes always; the 256-node SwiftShader frame check when UI_URL + WORLD_API are set).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { checkGlbBytes, line, loadBudgets } from "../scripts/perf-budget.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/perf-budget.mjs");
const noUi = () => {
  const env = { ...process.env };
  for (const k of ["UI_URL", "WORLD_API", "PERF_REQUIRE_UI"]) delete env[k];
  return env;
};
const run = (args, env) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env, encoding: "utf8", timeout: 240000 });

test("#105 perf-budgets.json: GLB bytes + a SwiftShader 256-node frame budget, documented", () => {
  const b = loadBudgets();
  assert.ok(Object.keys(b.fixtureGlbBytes).length >= 1);
  for (const v of Object.values(b.fixtureGlbBytes)) assert.ok(Number.isInteger(v) && v > 0);
  assert.ok(b.frame256Ms.budget > 0);
  assert.equal(b.frame256Ms.renderer, "swiftshader");
  assert.match(b.note, /SwiftShader/);
  const docs = fs.readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md"));
  assert.ok(docs.some((f) => /perf-budgets\.json/.test(fs.readFileSync(path.join(ROOT, "docs", f), "utf8"))), "a docs/ line names perf-budgets.json");
});

test("#105 CI: a Node 24 perf-budgets job runs the script with the UI stack required", () => {
  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const job = ci.split(/\n  (?=[a-z0-9-]+:\n)/).find((j) => j.startsWith("perf-budgets:"));
  assert.ok(job, "perf-budgets job present");
  assert.match(job, /node-version: "24"/);
  assert.match(job, /node scripts\/perf-budget\.mjs/);
  assert.match(job, /PERF_REQUIRE_UI: "1"/);
  assert.doesNotMatch(job, /matrix/, "Node 24 only");
});

test("#105 a planted over-budget fixture fails with budget, actual and HEAD=", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-perf-"));
  try {
    const planted = { ...loadBudgets(), fixtureGlbBytes: { "rigged-synth": 16 } };
    const p = path.join(dir, "budgets.json");
    fs.writeFileSync(p, JSON.stringify(planted));
    const r = run(["--budgets", p], noUi());
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^PERF OVER glb:rigged-synth budget=16B actual=\d+B HEAD=[0-9a-f]{7,40} NODE=v\d+/m);
    assert.match(r.stdout, /FAIL perf budgets: 1 over/);
    // the frame side reports the same way
    assert.match(line("frame256:swiftshader", 10, 12.5, "ms").text, /^PERF OVER frame256:swiftshader budget=10ms actual=12.5ms HEAD=/);
    // CI mode: no stack is a failure, not a skip
    const ci = run(["--budgets", path.join(ROOT, "perf-budgets.json")], { ...noUi(), PERF_REQUIRE_UI: "1" });
    assert.equal(ci.status, 1);
    assert.match(ci.stdout, /PERF OVER frame256 no measurement \(SKIP_NO_UI_URL/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#105 committed budgets pass (GLB bytes; frame check skips with a code without a stack)", () => {
  assert.deepEqual(checkGlbBytes(loadBudgets()).filter((r) => r.over), []);
  const r = run([], noUi());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^SKIP_NO_UI_URL: frame256 not measured/m);
  assert.match(r.stdout, /^OK perf budgets$/m);
});
