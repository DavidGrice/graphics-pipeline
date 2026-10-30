#!/usr/bin/env node
/**
 * S3-C #62r — regenerate testdata/golden/hashes.json from real Blender output.
 * Fail-closed: exits 2 when BLENDER_BIN unset/missing. Writes hashes only;
 * GLB + PNG live in a tmp dir and are deleted. Each export runs TWICE in clean
 * dirs; any mismatch → exit 3 (E_GOLDEN_UNSTABLE) and nothing is written.
 * --check: exit 1 on content drift (E_GOLDEN_DRIFT), 2 on Blender version
 * mismatch (E_GOLDEN_BLENDER_VERSION).
 *
 *   BLENDER_BIN=/home/box/tools/blender node scripts/refresh-goldens.mjs [--check]
 *   --check: regenerate and compare, do not write (exit 1 on drift)
 */
import fs from "node:fs";
import path from "node:path";
import {
  GOLDEN_PATH,
  GOLDEN_SPECS,
  GoldenError,
  requireBlenderBin,
  blenderVersion,
  makeFixturePng,
  generateStable,
  assertBlenderVersion,
  sha256File,
  tmpDir,
  loadGolden,
} from "../apps/blender-pipeline/golden.mjs";

const check = process.argv.includes("--check");
let bin;
try {
  bin = requireBlenderBin();
} catch (err) {
  console.error(`ERROR ${err.message}`);
  process.exit(2);
}
const version = blenderVersion(bin);
if (check) {
  // Version drift ≠ content drift: check before exporting anything.
  const golden = loadGolden();
  for (const key of Object.keys(golden)) {
    try {
      assertBlenderVersion(key, golden[key]?.blenderVersion, version);
    } catch (err) {
      console.error(`ERROR ${err.message}`);
      process.exit(2);
    }
  }
}
const dir = tmpDir();
try {
  const png = makeFixturePng(dir);
  const inputSha256 = sha256File(png);
  const out = {};
  for (const [key, spec] of Object.entries(GOLDEN_SPECS)) {
    const sha256 = generateStable({
      blenderBin: bin,
      mode: spec.mode,
      seed: spec.seed,
      inPng: png,
      workDir: path.join(dir, key),
      file: spec.file,
    });
    out[key] = {
      algo: "sha256",
      file: spec.file,
      sha256,
      mode: spec.mode,
      seed: spec.seed,
      blenderVersion: version,
      fixture: "scripts/ensure-smoke-png.mjs (8x8 RGBA 220,40,40)",
      inputSha256,
      generatedBy: "npm run golden:refresh",
      stableRuns: 2,
      note: "sha256 of exported GLB bytes; never commit GLB bytes",
    };
    console.log(`${key} mode=${spec.mode} seed=${spec.seed} sha256=${sha256}`);
  }
  if (check) {
    const golden = loadGolden();
    let bad = 0;
    for (const key of Object.keys(out)) {
      if (golden[key]?.sha256 !== out[key].sha256) {
        console.error(`DRIFT ${key}: golden=${golden[key]?.sha256} live=${out[key].sha256}`);
        bad++;
      }
    }
    process.exitCode = bad ? 1 : 0;
  } else {
    fs.writeFileSync(GOLDEN_PATH, JSON.stringify(out, null, 2) + "\n");
    console.log(`OK wrote ${path.relative(process.cwd(), GOLDEN_PATH)} (Blender ${version})`);
  }
} catch (err) {
  console.error(err instanceof GoldenError ? `ERROR ${err.message}` : err);
  process.exitCode = err?.code === "E_GOLDEN_UNSTABLE" ? 3 : 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
