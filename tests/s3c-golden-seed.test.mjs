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
  assertBlenderVersion,
  verifyGoldens,
  requireBlenderBin,
  blenderVersion,
  makeFixturePng,
  generateGlb,
  sha256File,
  tmpDir,
  PIPELINE_SH,
} from "../apps/blender-pipeline/golden.mjs";

const SKIP_REASON =
  "SKIP_NO_BLENDER: BLENDER_BIN unset — Blender-gated golden/seed check skipped (set BLENDER_BIN=/home/box/tools/blender to run; not a green lie)";

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

test("T1.6 #63 pipeline.sh rejects non-integer SEED before Blender (exit 2)", () => {
  const dir = tmpDir("gp-seed-bad-");
  try {
    const png = makeFixturePng(dir);
    for (const bad of ["abc", "-1", "1.5", "99999999999"]) {
      const r = spawnSync("bash", [PIPELINE_SH, png, path.join(dir, "x.glb")], {
        env: { ...process.env, BLENDER_BIN: "/bin/true", SEED: bad },
        encoding: "utf8",
      });
      assert.equal(r.status, 2, `SEED=${bad} should exit 2`);
      assert.match(r.stderr, /SEED must be an integer/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T1.2 drift assert: live Blender GLB sha256 == golden for every entry", (t) => {
  const bin = blenderOrSkip(t);
  if (!bin) return;
  const dir = tmpDir();
  try {
    const { blenderVersion: live, results } = verifyGoldens({ blenderBin: bin, golden: loadGolden(), workDir: dir });
    assert.equal(live, loadGolden().billboard.blenderVersion);
    assert.deepEqual(Object.keys(results).sort(), Object.keys(GOLDEN_SPECS).sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T1.2 live tamper matrix (BLENDER_BIN set): hash→DRIFT, version→BLENDER_VERSION, PLACEHOLDER/non-hex→fail", (t) => {
  const bin = blenderOrSkip(t);
  if (!bin) return;
  const run = (mutate) => {
    const g = structuredClone(loadGolden());
    mutate(g);
    const dir = tmpDir();
    try {
      verifyGoldens({ blenderBin: bin, golden: g, workDir: dir });
      return null;
    } catch (e) {
      return e;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const drift = run((g) => {
    g.rigged.sha256 = (g.rigged.sha256[0] === "0" ? "1" : "0") + g.rigged.sha256.slice(1);
  });
  assert.equal(drift?.code, "E_GOLDEN_DRIFT", String(drift));
  const ver = run((g) => {
    for (const k of Object.keys(g)) g[k].blenderVersion = "9.9.9";
  });
  assert.equal(ver?.code, "E_GOLDEN_BLENDER_VERSION", String(ver));
  assert.doesNotMatch(ver.message, /E_GOLDEN_DRIFT/);
  const ph = run((g) => {
    g.billboard.sha256 = "PLACEHOLDER_REFRESH_WITH_BLENDER";
  });
  assert.equal(ph?.code, "E_GOLDEN_PLACEHOLDER", String(ph));
  const hex = run((g) => {
    g.billboard.sha256 = "zz".repeat(32);
  });
  assert.equal(hex?.code, "E_GOLDEN_MALFORMED", String(hex));
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
    // seed default 0: no SEED env / no --seed ⇒ canonical golden bytes
    const env = { ...process.env, BLENDER_BIN: bin, MODE: "billboard" };
    delete env.SEED;
    delete env.SMOKE_MODE;
    const dflt = path.join(dir, "default-seed.glb");
    execFileSync("bash", [PIPELINE_SH, png, dflt], { env, stdio: "ignore" });
    assert.equal(sha256File(dflt), loadGolden().billboard.sha256, "default seed must be 0");
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
    assert.equal(bad.status, 2, "non-integer --seed must exit 2");
    assert.ok(!fs.existsSync(path.join(dir, "bad.glb")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Fake-Blender harness (no real Blender): version mismatch + two-run stability ----
function fakeBlender(dir, { version = "5.2.3", unstable = false } = {}) {
  const p = path.join(dir, "fake-blender");
  fs.writeFileSync(
    p,
    `#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then echo "Blender ${version}"; exit 0; fi
args=(); seen=0
for a in "$@"; do if [[ $seen -eq 1 ]]; then args+=("$a"); fi; [[ "$a" == "--" ]] && seen=1; done
out="\${args[1]}"
if [[ "${unstable ? "1" : "0"}" == "1" ]]; then extra="$RANDOM$RANDOM$$"; else extra="stable"; fi
printf 'glTF-fake-%s-%s' "\${args[*]:2}" "$extra" > "$out"
`,
    { mode: 0o755 },
  );
  return p;
}

function runRefresh(args, env) {
  return spawnSync(process.execPath, ["scripts/refresh-goldens.mjs", ...args], {
    cwd: path.resolve(path.dirname(fileURLToPathSafe()), ".."),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}
function fileURLToPathSafe() {
  return new URL(import.meta.url).pathname;
}

test("T1.2 assertBlenderVersion: mismatch → E_GOLDEN_BLENDER_VERSION (distinct from drift)", () => {
  assert.doesNotThrow(() => assertBlenderVersion("billboard", "5.2.3", "5.2.3"));
  assert.throws(
    () => assertBlenderVersion("billboard", "5.2.3", "5.3.0"),
    (e) => e.code === "E_GOLDEN_BLENDER_VERSION" && !/DRIFT/.test(e.message) && /5\.3\.0/.test(e.message),
  );
});

test("T1.2 golden:refresh --check: Blender version mismatch → exit 2 + E_GOLDEN_BLENDER_VERSION (not DRIFT)", () => {
  const dir = tmpDir("gp-fake-ver-");
  try {
    const bin = fakeBlender(dir, { version: "9.9.9" });
    const r = runRefresh(["--check"], { BLENDER_BIN: bin });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /E_GOLDEN_BLENDER_VERSION/);
    assert.doesNotMatch(r.stderr, /DRIFT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T1.2 golden:refresh runs each export twice; unstable → exit 3, nothing written", () => {
  const dir = tmpDir("gp-fake-unstable-");
  try {
    const target = path.join(dir, "hashes.json");
    fs.copyFileSync(GOLDEN_PATH, target);
    const before = fs.readFileSync(target, "utf8");
    const r = runRefresh([], { BLENDER_BIN: fakeBlender(dir, { unstable: true }), GP_GOLDEN_PATH: target });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /E_GOLDEN_UNSTABLE/);
    assert.equal(fs.readFileSync(target, "utf8"), before, "must not write a flaky hash");

    // stable fake → writes (to the tmp override only), records stableRuns=2
    const ok = runRefresh([], { BLENDER_BIN: fakeBlender(dir, { unstable: false }), GP_GOLDEN_PATH: target });
    assert.equal(ok.status, 0, ok.stderr);
    const written = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.equal(written.billboard.stableRuns, 2);
    assert.equal(written.billboard.generatedBy, "npm run golden:refresh");
    assert.match(written.billboard.sha256, /^[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // tracked file untouched
  assert.deepEqual(validateGolden(loadGolden()), []);
});
