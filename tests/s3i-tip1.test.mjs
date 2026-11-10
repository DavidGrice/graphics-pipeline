/**
 * S3-I tip1 — CO-1 per-array echo cap; CO-2 HEAD= run header; CO-3 oracle wiring is in
 * tests/s3h-e3-fuzz.test.mjs. AC on this tip alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, startApi } from "./helpers/s3d-synth.mjs";
import { capEcho, sendError, ECHO_MAX, ECHO_ITEMS_MAX } from "../apps/world-builder/server/src/errors.js";
import { formatRunHeader, gitHead } from "./reporters/skip-summary.mjs";

const node = (args, opts = {}) => {
  const env = { ...process.env, ...(opts.env || {}) };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", ...opts, env });
};

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

// ---------------------------------------------------------------- CO-1
test("CO-1 ECHO_ITEMS_MAX is a constant 20, not an env", () => {
  assert.equal(ECHO_ITEMS_MAX, 20);
  assert.equal(ECHO_MAX, 200);
  const envEx = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.doesNotMatch(envEx, /ECHO_ITEMS_MAX/);
});

test("CO-1 capEcho: 10k-entry invalid[] → 20 items plus truncated: 9980; inner strings still ≤200 and end in …", () => {
  const L = "x".repeat(5000);
  const items = Array.from({ length: 10000 }, () => L);
  const out = capEcho({ invalid: items });
  assert.equal(out.invalid.length, 20);
  assert.equal(out.truncated, 9980);
  assert.ok(out.invalid.every((s) => s.length === 200 && s.endsWith("…")));
  const short = capEcho({ invalid: ["ok", "fine"] });
  assert.equal(short.invalid.length, 2);
  assert.equal(short.truncated, undefined);
});

test("CO-1 capEcho: two capped arrays sum their drops", () => {
  const a = Array.from({ length: 30 }, () => "a");
  const b = Array.from({ length: 25 }, () => "b");
  const out = capEcho({ invalid: a, issues: b });
  assert.equal(out.invalid.length, 20);
  assert.equal(out.issues.length, 20);
  assert.equal(out.truncated, 15);
});

test("CO-1 sendError: 10k invalid[] is flattened with truncated: 9980", () => {
  const res = mockRes();
  sendError(res, 400, "FEATURED_INVALID", "bad", { invalid: Array.from({ length: 10000 }, () => "x") });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "FEATURED_INVALID");
  assert.equal(res.body.invalid.length, 20);
  assert.equal(res.body.truncated, 9980);
});

test("CO-1 PUT /api/featured with 10,020 ids (too many) returns 20 invalid plus truncated: 9980", async () => {
  const api = await startApi();
  try {
    // FEATURED_MAX is 20; invalid[] is the overflow, so 10020 ids → 10000 echoed, then capped
    const ids = Array.from({ length: 10020 }, () => crypto.randomUUID());
    const r = await fetch(`${api.url}/api/featured`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sceneIds: ids }),
    });
    const j = await r.json();
    assert.equal(r.status, 400);
    assert.equal(j.code, "FEATURED_INVALID");
    assert.equal(j.invalid.length, 20);
    assert.equal(j.truncated, 9980);
    assert.deepEqual(j.invalid, ids.slice(20, 40));
  } finally {
    await api?.stop?.();
  }
});

// ---------------------------------------------------------------- CO-2
test("CO-2 formatRunHeader matches git rev-parse HEAD", () => {
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  assert.equal(gitHead(), sha);
  assert.equal(formatRunHeader({ sha, node: "v24.0.0", run: "local" }), `HEAD=${sha} NODE=v24.0.0 RUN=local`);
  assert.match(formatRunHeader({ sha }), new RegExp(`^HEAD=${sha} NODE=${process.version.replaceAll(".", "\\.")} RUN=(local|\\d+)$`));
});

test("CO-2 dry run: first line is HEAD=<git rev-parse HEAD> NODE=… RUN=…", () => {
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3i-head-"));
  try {
    const f = path.join(dir, "t.test.mjs");
    fs.writeFileSync(f, 'import { test } from "node:test";\ntest("ok", () => {});\n');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    // Same order as the npm scripts (`print-head.mjs && node --test …`), but both steps use this
    // test's own Node (process.execPath), never a login shell's PATH `node` (Node 22 CI fix).
    const opts = { cwd: ROOT, encoding: "utf8", env };
    const h = spawnSync(process.execPath, ["tests/reporters/print-head.mjs"], opts);
    assert.equal(h.status, 0, h.stdout + h.stderr);
    const t = spawnSync(
      process.execPath,
      ["--test", "--test-reporter=tap", "--test-reporter-destination=stdout", "--test-reporter=./tests/reporters/skip-summary.mjs", "--test-reporter-destination=stdout", f],
      opts,
    );
    assert.equal(t.status, 0, t.stdout + t.stderr);
    const first = (h.stdout + t.stdout).split(/\r?\n/)[0];
    const run = process.env.GITHUB_RUN_ID || "local";
    assert.equal(first, `HEAD=${sha} NODE=${process.version} RUN=${run}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CO-2 doc: test:s1, test:focused, and test:ui:repeat are wired to print the header; unhooking fails this test", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  for (const name of ["test:s1", "test:focused"]) {
    const s = pkg.scripts[name];
    assert.match(s, /node tests\/reporters\/print-head\.mjs &&/, name);
    assert.match(s, /--test-reporter=\.\/tests\/reporters\/skip-summary\.mjs/, name);
    assert.match(s, /tests\/s3i-\*\.test\.mjs/, name);
  }
  assert.match(pkg.scripts["test:s1"], /--test-reporter=tap --test-reporter-destination=stdout/);
  assert.equal(pkg.scripts["test:ui:repeat"], "node scripts/ui-repeat.mjs");
  const ui = fs.readFileSync(path.join(ROOT, "scripts/ui-repeat.mjs"), "utf8");
  assert.match(ui, /printRunHeader/);
  const printHead = fs.readFileSync(path.join(ROOT, "tests/reporters/print-head.mjs"), "utf8");
  assert.match(printHead, /printRunHeader/);
});

test("CO-2 test:ui:repeat dry run: first line is the HEAD header", () => {
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const env = { UI_REPEAT_FILES: "tests/fixtures/flip-fixture.test.mjs" };
  const state = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "s3i-flip-")), "n");
  fs.writeFileSync(state, "0");
  env.FLIP_STATE = state;
  const r = node(["scripts/ui-repeat.mjs", "1"], { env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const first = (r.stdout || "").split(/\r?\n/)[0];
  const run = process.env.GITHUB_RUN_ID || "local";
  assert.equal(first, `HEAD=${sha} NODE=${process.version} RUN=${run}`);
});

// ---------------------------------------------------------------- changelog lock for tip1
test("CO-1 contract-changelog S3-I names the array cap; no new env; only new code is PRECONDITION_REQUIRED (#40)", () => {
  const md = fs.readFileSync(path.join(ROOT, "docs/contract-changelog.md"), "utf8");
  assert.match(md, /^## S3-I$/m);
  const sec = md.slice(md.indexOf("## S3-I"));
  assert.match(sec, /\*\*Codes:\*\* `PRECONDITION_REQUIRED`/); // #40 adds the only new code
  assert.match(sec, /\*\*Env:\*\* none/);
  assert.match(sec, /truncated/);
  assert.match(sec, /ECHO_ITEMS_MAX is a constant 20/);
});

// ---------------------------------------------------------------- S-I-1 depth limit
test("S-I-1 capEcho: nothing past depth 8 is echoed raw; a deep 500-item array is dropped and counted", async () => {
  const { capEcho } = await import("../apps/world-builder/server/src/errors.js");
  let deep = Array.from({ length: 500 }, (_, i) => `x${i}`);
  for (let i = 0; i < 9; i++) deep = { k: deep };
  // root object is depth 0, so the array sits at depth 9 (Tester's depth-probe shape)
  const out = capEcho(deep);
  let v = out;
  for (let i = 0; i < 8; i++) v = v.k;
  assert.deepEqual(v.k, [], "array past depth 8 is not echoed");
  assert.equal(out.truncated, 500);
  assert.ok(!JSON.stringify(out).includes("x499"));
  let deepObj = { s: "y".repeat(5000) };
  for (let i = 0; i < 9; i++) deepObj = { k: deepObj };
  const o2 = capEcho({ deepObj });
  assert.ok(!JSON.stringify(o2).includes("y".repeat(201)), "no raw long string past depth 8");
  assert.equal(o2.truncated, undefined);
});
