/**
 * S1-T3.4 / T3.5 — pipeline.sh error paths (no Blender required)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { spawnBash, assertExitCode, findBash } from "./helpers/spawn-bash.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PIPELINE = path.join(ROOT, "apps/blender-pipeline/pipeline.sh");

test("T3.5: missing Blender binary fails clearly (exit 127)", (t) => {
  if (!findBash()) {
    t.skip("bash not available (need Git Bash on Windows)");
    return;
  }
  const r = spawnBash(PIPELINE, [
    path.join(ROOT, "data/inbox/nope-missing.png"),
    path.join(ROOT, "data/assets/out-missing.glb"),
  ], {
    env: { BLENDER_BIN: path.join(ROOT, "nonexistent", "blender-binary-s1-t3") },
  });
  assertExitCode(r, 127, "pipeline missing blender");
  assert.match(r.stderr, /Blender binary not found/i);
  assert.match(r.stderr, /5\.2\.3/);
});

test("T3.4: missing inbox PNG fails before Blender invoke", (t) => {
  if (!findBash()) {
    t.skip("bash not available (need Git Bash on Windows)");
    return;
  }
  const fake = path.join(ROOT, "tests/fixtures/fake-blender.sh");
  fs.mkdirSync(path.dirname(fake), { recursive: true });
  fs.writeFileSync(
    fake,
    "#!/usr/bin/env bash\necho SHOULD_NOT_RUN >&2\nexit 0\n",
  );
  try {
    fs.chmodSync(fake, 0o755);
  } catch {
    /* Windows may ignore mode */
  }
  const missing = path.join(ROOT, "data/inbox/no-such-slug/missing.png");
  const out = path.join(ROOT, "data/assets/test-missing/model.glb");
  const r = spawnBash(PIPELINE, [missing, out], {
    env: { BLENDER_BIN: fake },
  });
  assertExitCode(r, 1, "pipeline missing png");
  assert.match(r.stderr, /input not found/i);
  assert.doesNotMatch(r.stderr, /SHOULD_NOT_RUN/);
});
