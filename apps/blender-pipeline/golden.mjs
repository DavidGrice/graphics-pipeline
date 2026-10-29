/**
 * S3-C #62r / #63 — golden GLB sha256 helpers (hashes only; never GLB bytes in git).
 *
 * Goldens live in testdata/golden/hashes.json. Each entry records mode, seed,
 * input fixture sha256, and the Blender version that produced the hash.
 * PLACEHOLDER / malformed hashes fail closed. BLENDER_BIN unset fails closed
 * for generation (tests skip with an explicit reason instead).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../..");
export const GOLDEN_PATH = path.join(REPO_ROOT, "testdata", "golden", "hashes.json");
export const PIPELINE_SH = path.join(__dirname, "pipeline.sh");
export const FIXTURE_SCRIPT = path.join(REPO_ROOT, "scripts", "ensure-smoke-png.mjs");

/** Golden entries: key → { mode, seed }. `billboard`/`rigged` are canonical seed 0. */
export const GOLDEN_SPECS = Object.freeze({
  billboard: { mode: "billboard", seed: 0, file: "billboard-spin.glb" },
  rigged: { mode: "rigged", seed: 0, file: "rigged-smoke.glb" },
  riggedSeed63: { mode: "rigged", seed: 63, file: "rigged-smoke-seed63.glb" },
});

const HEX64 = /^[0-9a-f]{64}$/;

export class GoldenError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export function sha256File(p) {
  return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

export function loadGolden(p = GOLDEN_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Returns list of problems; empty = structurally valid real goldens. */
export function validateGolden(golden) {
  const errs = [];
  if (!golden || typeof golden !== "object") return ["golden file is not an object"];
  for (const key of Object.keys(GOLDEN_SPECS)) {
    const e = golden[key];
    if (!e) {
      errs.push(`${key}: missing entry`);
      continue;
    }
    if (e.algo !== "sha256") errs.push(`${key}: algo must be sha256`);
    if (typeof e.sha256 !== "string" || /PLACEHOLDER/i.test(e.sha256)) {
      errs.push(`${key}: PLACEHOLDER/non-string sha256 (E_GOLDEN_PLACEHOLDER)`);
    } else if (!HEX64.test(e.sha256)) {
      errs.push(`${key}: sha256 not 64 lowercase hex (E_GOLDEN_MALFORMED)`);
    }
    if (e.mode !== GOLDEN_SPECS[key].mode) errs.push(`${key}: mode mismatch`);
    if (e.seed !== GOLDEN_SPECS[key].seed) errs.push(`${key}: seed mismatch`);
    if (typeof e.blenderVersion !== "string" || !e.blenderVersion) {
      errs.push(`${key}: blenderVersion required`);
    }
    if (typeof e.inputSha256 !== "string" || !HEX64.test(e.inputSha256)) {
      errs.push(`${key}: inputSha256 required`);
    }
  }
  return errs;
}

/** Throws GoldenError E_GOLDEN_DRIFT when actual ≠ expected. */
export function assertGoldenMatch(key, expected, actual) {
  if (typeof expected !== "string" || /PLACEHOLDER/i.test(expected)) {
    throw new GoldenError("E_GOLDEN_PLACEHOLDER", `${key}: golden is a placeholder`);
  }
  if (expected !== actual) {
    throw new GoldenError(
      "E_GOLDEN_DRIFT",
      `${key}: expected ${expected} got ${actual} — refresh intentionally via scripts/refresh-goldens.mjs`,
    );
  }
}

/** Fail-closed BLENDER_BIN resolution (no PATH fallback). */
export function requireBlenderBin(env = process.env) {
  const bin = env.BLENDER_BIN;
  if (!bin) {
    throw new GoldenError("E_BLENDER_BIN_UNSET", "BLENDER_BIN must be set (fail-closed; no PATH fallback)");
  }
  if (!fs.existsSync(bin)) {
    throw new GoldenError("E_BLENDER_BIN_MISSING", `BLENDER_BIN does not exist: ${bin}`);
  }
  return bin;
}

export function blenderVersion(bin) {
  const out = execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 30000 });
  const m = out.match(/Blender\s+(\d+\.\d+(?:\.\d+)?)/);
  if (!m) throw new GoldenError("E_BLENDER_VERSION", `could not parse version from: ${out.slice(0, 120)}`);
  return m[1];
}

/** Deterministic 8x8 fixture PNG in a tmp dir (never under git). */
export function makeFixturePng(dir) {
  const p = path.join(dir, "smoke-8x8.png");
  execFileSync(process.execPath, [FIXTURE_SCRIPT, p], { stdio: "ignore" });
  return p;
}

/** Run pipeline.sh → GLB; returns { glb, sha256 }. */
export function generateGlb({ blenderBin, mode, seed, inPng, outGlb }) {
  execFileSync("bash", [PIPELINE_SH, inPng, outGlb], {
    env: { ...process.env, BLENDER_BIN: blenderBin, MODE: mode, SMOKE_MODE: mode, SEED: String(seed) },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180000,
  });
  return { glb: outGlb, sha256: sha256File(outGlb) };
}

export function tmpDir(prefix = "gp-golden-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
