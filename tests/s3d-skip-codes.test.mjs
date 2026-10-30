/**
 * S3-D E3 #104 — every skip reason starts with a known SKIP_* code; `npm run test:s1` ends with a
 * code · count · tests table and exits 1 on an uncoded skip (R1 rev2 §11, D2 §3 group 6).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./helpers/s3d-synth.mjs";
import { SKIP_CODES, classifySkip, summarizeSkips, renderTable } from "./reporters/skip-summary.mjs";

const REPORTER = path.join(ROOT, "tests/reporters/skip-summary.mjs");
const KNOWN = new RegExp(`^(${SKIP_CODES.join("|")}):`);

test("#104 code set is exactly D2 group 6", () => {
  assert.deepEqual([...SKIP_CODES].sort(), [
    "SKIP_NO_API",
    "SKIP_NO_BLENDER",
    "SKIP_NO_KRITA",
    "SKIP_NO_MONGO",
    "SKIP_NO_UI_URL",
    "SKIP_PLATFORM",
  ]);
});

test("#104 classify + summarize: known codes grouped, uncoded/bare/unknown flagged", () => {
  assert.deepEqual(classifySkip("SKIP_NO_API: down"), { code: "SKIP_NO_API", known: true });
  assert.deepEqual(classifySkip("SKIP_FOO: x"), { code: "SKIP_FOO", known: false });
  assert.deepEqual(classifySkip("api down"), { code: "UNCODED", known: false });
  assert.deepEqual(classifySkip(true), { code: "UNCODED", known: false });
  const s = summarizeSkips([
    { name: "a", reason: "SKIP_NO_API: x" },
    { name: "b", reason: "SKIP_NO_API: y" },
    { name: "c", reason: "SKIP_NO_BLENDER: z" },
    { name: "d", reason: "nope" },
  ]);
  assert.deepEqual(s.rows, [
    { code: "SKIP_NO_API", count: 2, tests: ["a", "b"] },
    { code: "SKIP_NO_BLENDER", count: 1, tests: ["c"] },
    { code: "UNCODED", count: 1, tests: ["d"] },
  ]);
  assert.deepEqual(s.bad, [{ name: "d", reason: "nope" }]);
  const t = renderTable(s);
  assert.match(t, /# SKIP_NO_API · 2 · a \| b/);
  assert.match(t, /SKIP_CODE_MISSING: 1 skip/);
  assert.match(renderTable(summarizeSkips([])), /\(no skips\)/);
});

test("#104 static: every t.skip()/{skip} reason in tests/ starts with a known code", () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, "tests")).filter((f) => f.endsWith(".mjs")).map((f) => `tests/${f}`),
    ...fs.readdirSync(path.join(ROOT, "tests/helpers")).filter((f) => f.endsWith(".mjs")).map((f) => `tests/helpers/${f}`),
  ].filter((f) => !f.endsWith("s3d-skip-codes.test.mjs"));
  const bad = [];
  let sites = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/\bt\.skip\(\s*([^\s)])/g)) {
      sites++;
      const rest = src.slice(m.index + m[0].length - 1);
      if (/^["'`]/.test(rest)) {
        if (!KNOWN.test(rest.slice(1))) bad.push(`${f}: ${rest.slice(0, 60)}`);
      } else {
        const ident = /^[\w.]+/.exec(rest)[0];
        if (ident === "env.skip") continue; // browserEnv() — literals checked below
        const def = new RegExp(`const ${ident}\\s*=\\s*["'\`]([^"'\`]*)`).exec(src);
        if (!def || !KNOWN.test(def[1])) bad.push(`${f}: ${ident} not a coded constant`);
      }
    }
    for (const m of src.matchAll(/\{\s*skip:\s*(["'`])([^"'`]*)/g)) {
      sites++;
      if (!KNOWN.test(m[2])) bad.push(`${f}: {skip: ${m[2].slice(0, 50)}}`);
    }
    if (/\b(test|it|describe)\.skip\(/.test(src)) bad.push(`${f}: bare test.skip() has no reason`);
  }
  assert.ok(sites >= 19, `found ${sites} skip sites`);
  assert.deepEqual(bad, []);
});

test("#104 test:s1 wires the summary reporter next to TAP", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const s1 = pkg.scripts["test:s1"];
  assert.match(s1, /--test-reporter=tap --test-reporter-destination=stdout/);
  assert.match(s1, /--test-reporter=\.\/tests\/reporters\/skip-summary\.mjs --test-reporter-destination=stdout/);
  assert.match(s1, /tests\/s3d-\*\.test\.mjs/);
});

test("#104 end-to-end: uncoded skip → table + SKIP_CODE_MISSING + exit 1; coded only → exit 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-s3d-skip-"));
  // a nested `node --test` must not inherit the parent runner's context (it would stay silent)
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  try {
    const run = (body) => {
      const f = path.join(dir, `t${Math.random().toString(36).slice(2)}.test.mjs`);
      fs.writeFileSync(f, `import { test } from "node:test";\n${body}\n`);
      return spawnSync(
        process.execPath,
        ["--test", "--test-reporter=tap", "--test-reporter-destination=stdout", `--test-reporter=${REPORTER}`, "--test-reporter-destination=stdout", f],
        { encoding: "utf8", env: childEnv },
      );
    };
    const good = run('test("g", (t) => t.skip("SKIP_NO_MONGO: no mongo"));\ntest("p", () => {});');
    assert.equal(good.status, 0, good.stdout);
    assert.match(good.stdout, /# SKIP_NO_MONGO · 1 · g/);
    const bad = run('test("u", (t) => t.skip("mongo down"));');
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /# UNCODED · 1 · u/);
    assert.match(bad.stdout, /SKIP_CODE_MISSING: 1 skip/);
    const none = run('test("p", () => {});');
    assert.equal(none.status, 0);
    assert.match(none.stdout, /# \(no skips\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
