/**
 * S3-C-E1 — #62r real golden sha256 (drift fail-closed) + #63 --seed determinism.
 * Blender-gated cases skip with an explicit reason when BLENDER_BIN is unset;
 * BLENDER_BIN set to a missing path FAILS (fail-closed, not a skip).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  GOLDEN_PATH,
  GOLDEN_SPECS,
  GoldenError,
  loadGolden,
  validateGolden,
  assertGoldenMatch,
  requireBlenderBin,
  blenderVersion,
  makeFixturePng,
  generateGlb,
  sha256File,
  tmpDir,
  PIPELINE_SH,
} from "../apps/blender-pipeline/golden.mjs";

const SKIP_REASON =
  "BLENDER_BIN unset — Blender-gated golden/seed check skipped (set BLENDER_BIN=/home/box/tools/blender to run; not a green lie)";

/** null → skip; throws when BLENDER_BIN set but missing (fail-closed). */
function blenderOrSkip(t) {
  if (!process.env.BLENDER_BIN) {
    t.skip(SKIP_REASON);
    return null;
  }
  return requireBlenderBin();
}

test("T1.2 golden file: real sha256 per mode, no PLACEHOLDER, sidecar seed+Blender version", () => {
  assert.ok(fs.existsSync(GOLDEN_PATH), "testdata/golden/hashes.json required");
  const raw = fs.readFileSync(GOLDEN_PATH, "utf8");
  assert.doesNotMatch(raw, /PLACEHOLDER/i, "PLACEHOLDER golden must fail");
  const errs = validateGolden(loadGolden());
  assert.deepEqual(errs, [], errs.join("\n"));
});

test("T1.2 validateGolden: PLACEHOLDER / malformed / missing → fail", () => {
  const good = loadGolden();
  const placeholder = structuredClone(good);
  placeholder.billboard.sha256 = "PLACEHOLDER_REFRESH_WITH_BLENDER";
  assert.ok(validateGolden(placeholder).some((e) => e.includes("E_GOLDEN_PLACEHOLDER")));
  const malformed = structuredClone(good);
  malformed.rigged.sha256 = "abc123";
  assert.ok(validateGolden(malformed).some((e) => e.includes("E_GOLDEN_MALFORMED")));
  const missing = structuredClone(good);
  delete missing.riggedSeed63;
  assert.ok(validateGolden(missing).some((e) => e.includes("missing entry")));
  assert.throws(
    () => assertGoldenMatch("billboard", "PLACEHOLDER_X", good.billboard.sha256),
    (e) => e instanceof GoldenError && e.code === "E_GOLDEN_PLACEHOLDER",
  );
});

test("T1.2 tamper: one flipped hex digit → E_GOLDEN_DRIFT", () => {
  const { sha256 } = loadGolden().billboard;
  const tampered = (sha256[0] === "0" ? "1" : "0") + sha256.slice(1);
  assert.throws(
    () => assertGoldenMatch("billboard", tampered, sha256),
    (e) => e instanceof GoldenError && e.code === "E_GOLDEN_DRIFT",
  );
  assert.doesNotThrow(() => assertGoldenMatch("billboard", sha256, sha256));
});

test("T1.7 BLENDER_BIN fail-closed: unset/missing → named error; refresh script exits 2", () => {
  assert.throws(() => requireBlenderBin({}), (e) => e.code === "E_BLENDER_BIN_UNSET");
  assert.throws(
    () => requireBlenderBin({ BLENDER_BIN: "/nonexistent/blender" }),
    (e) => e.code === "E_BLENDER_BIN_MISSING",
  );
  const env = { ...process.env };
  delete env.BLENDER_BIN;
  const r = spawnSync(process.execPath, ["scripts/refresh-goldens.mjs", "--check"], {
    cwd: path.resolve(path.dirname(GOLDEN_PATH), "../.."),
    env,
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /E_BLENDER_BIN_UNSET/);
});

test("T1.6 #63 pipeline.sh rejects non-integer SEED before Blender", () => {
  const dir = tmpDir("gp-seed-bad-");
  try {
    const png = makeFixturePng(dir);
    for (const bad of ["abc", "-1", "1.5", "99999999999"]) {
      const r = spawnSync("bash", [PIPELINE_SH, png, path.join(dir, "x.glb")], {
        env: { ...process.env, BLENDER_BIN: "/bin/true", SEED: bad },
        encoding: "utf8",
      });
      assert.equal(r.status, 1, `SEED=${bad} should exit 1`);
      assert.match(r.stderr, /SEED must be an integer/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T1.2 drift assert: live Blender GLB sha256 == golden for every entry", (t) => {
  const bin = blenderOrSkip(t);
  if (!bin) return;
  const golden = loadGolden();
  const version = blenderVersion(bin);
  if (version !== golden.billboard.blenderVersion) {
    assert.fail(
      `Blender ${version} ≠ golden Blender ${golden.billboard.blenderVersion} — refresh goldens intentionally`,
    );
  }
  const dir = tmpDir();
  try {
    const png = makeFixturePng(dir);
    assert.equal(sha256File(png), golden.billboard.inputSha256, "fixture PNG drift");
    for (const [key, spec] of Object.entries(GOLDEN_SPECS)) {
      const { sha256 } = generateGlb({
        blenderBin: bin,
        mode: spec.mode,
        seed: spec.seed,
        inPng: png,
        outGlb: path.join(dir, spec.file),
      });
      assertGoldenMatch(key, golden[key].sha256, sha256);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T1.6 #63 --seed: same seed ⇒ identical sha256; different seed ⇒ different", (t) => {
  const bin = blenderOrSkip(t);
  if (!bin) return;
  const dir = tmpDir("gp-seed-");
  try {
    const png = makeFixturePng(dir);
    const run = (mode, seed, n) =>
      generateGlb({ blenderBin: bin, mode, seed, inPng: png, outGlb: path.join(dir, `${mode}-${seed}-${n}.glb`) })
        .sha256;
    for (const mode of ["billboard", "rigged"]) {
      const a = run(mode, 1234, 1);
      const b = run(mode, 1234, 2);
      assert.equal(a, b, `${mode}: same seed must give identical hash`);
      const c = run(mode, 4321, 1);
      assert.notEqual(a, c, `${mode}: different seed must change Actions`);
      const zero = run(mode, 0, 1);
      assert.equal(zero, loadGolden()[mode].sha256, `${mode}: seed 0 == canonical golden`);
    }
    // --seed flag directly on png_to_glb.py (not via env) is honored + invalid rejected
    const out = path.join(dir, "direct.glb");
    execFileSync(bin, [
      "--background", "--python", path.join(path.dirname(PIPELINE_SH), "png_to_glb.py"),
      "--", png, out, "--mode", "rigged", "--seed=63",
    ], { stdio: "ignore" });
    assert.equal(sha256File(out), loadGolden().riggedSeed63.sha256);
    const bad = spawnSync(bin, [
      "--background", "--python", path.join(path.dirname(PIPELINE_SH), "png_to_glb.py"),
      "--", png, path.join(dir, "bad.glb"), "--seed", "nope",
    ], { encoding: "utf8" });
    assert.match(`${bad.stdout}${bad.stderr}`, /invalid --seed/);
    assert.ok(!fs.existsSync(path.join(dir, "bad.glb")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
