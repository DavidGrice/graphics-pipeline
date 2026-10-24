/**
 * S1-T3.4 / T3.5 — pipeline.sh error paths (no Blender required)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PIPELINE = path.join(ROOT, "apps/blender-pipeline/pipeline.sh");

test("T3.5: missing Blender binary fails clearly (exit 127)", () => {
  const r = spawnSync(
    "bash",
    [PIPELINE, "/tmp/nope.png", "/tmp/out.glb"],
    {
      env: { ...process.env, BLENDER_BIN: "/nonexistent/blender-binary-s1-t3" },
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 127);
  assert.match(r.stderr, /Blender binary not found/i);
  assert.match(r.stderr, /5\.2\.3/);
});

test("T3.4: missing inbox PNG fails before Blender invoke", () => {
  // Use a fake blender that would succeed if called — ensure we never reach it
  const fake = path.join(ROOT, "tests/fixtures/fake-blender.sh");
  fs.mkdirSync(path.dirname(fake), { recursive: true });
  fs.writeFileSync(
    fake,
    "#!/usr/bin/env bash\necho SHOULD_NOT_RUN >&2\nexit 0\n",
    { mode: 0o755 },
  );
  const missing = path.join(ROOT, "data/inbox/no-such-slug/missing.png");
  const out = path.join(ROOT, "data/assets/test-missing/model.glb");
  const r = spawnSync("bash", [PIPELINE, missing, out], {
    env: { ...process.env, BLENDER_BIN: fake },
    encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /input not found/i);
  assert.doesNotMatch(r.stderr, /SHOULD_NOT_RUN/);
});
