// S3-G CO-4 — deliberate flip for the repeat-runner test: passes on odd runs, fails on even runs
// (counter in FLIP_STATE). Not part of test:s1 (lives under fixtures/).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("flip fixture", () => {
  const f = process.env.FLIP_STATE;
  const n = (f && fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) : 0) + 1;
  if (f) fs.writeFileSync(f, String(n));
  assert.ok(n % 2 === 1, `run ${n}`);
});

test("steady fixture", () => assert.ok(true));
