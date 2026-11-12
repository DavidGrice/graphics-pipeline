/**
 * S3-I E3 #59 — opt-in Draco (`pipeline.sh --draco`) + vendored, pinned, checksummed decoder.
 * Node-only cases always run; Blender cases skip with SKIP_NO_BLENDER (BLENDER_BIN unset) or
 * SKIP_PLATFORM (Blender build has no Draco encoder: png_to_glb.py exit 6). Never a green lie.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  GOLDEN_SPECS,
  loadGolden,
  validateGolden,
  makeFixturePng,
  requireBlenderBin,
  PIPELINE_SH,
} from "../apps/blender-pipeline/golden.mjs";
import { probeGlb } from "../apps/blender-pipeline/probe_glb.mjs";
import {
  DRACO_CHECKSUM,
  readManifest,
  stripCdnDecoder,
  threeRoot,
  vendorDraco,
  verifyDraco,
} from "../apps/world-builder/client/draco-vendor.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLIENT = path.join(ROOT, "apps/world-builder/client");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("#59 decoder manifest pins the installed three and its sha256s", () => {
  const m = readManifest();
  const three = threeRoot(CLIENT);
  assert.equal(JSON.parse(fs.readFileSync(path.join(three, "package.json"), "utf8")).version, m.three);
  assert.deepEqual(Object.keys(m.files).sort(), ["draco_decoder.wasm", "draco_wasm_wrapper.js"]);
  for (const v of Object.values(m.files)) assert.match(v, /^[0-9a-f]{64}$/);
  const dir = tmp("gp-draco-");
  try {
    assert.deepEqual(vendorDraco({ dir, three }).sort(), Object.keys(m.files).sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#59 checksum check fails on a swapped decoder binary", () => {
  const dir = tmp("gp-draco-swap-");
  try {
    vendorDraco({ dir });
    const wasm = path.join(dir, "draco_decoder.wasm");
    const buf = fs.readFileSync(wasm);
    buf[buf.length >> 1] ^= 0xff;
    fs.writeFileSync(wasm, buf);
    assert.throws(() => verifyDraco(dir), (e) => e.code === DRACO_CHECKSUM && /draco_decoder\.wasm sha256/.test(e.message));
    // a pinned version that is not installed is refused too (no silent upgrade)
    assert.throws(() => vendorDraco({ dir, manifest: { ...readManifest(), three: "0.0.1" } }), (e) => e.code === DRACO_CHECKSUM);
    // vendorDraco repairs a stale copy from the pinned package
    vendorDraco({ dir });
    verifyDraco(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#59 viewer uses the vendored /draco/ decoder: no CDN, no setDecoderConfig", () => {
  const src = path.join(CLIENT, "src");
  const files = fs.readdirSync(src).filter((f) => /\.(ts|tsx)$/.test(f));
  let calls = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(src, f), "utf8");
    assert.doesNotMatch(text, /gstatic|unpkg|jsdelivr/i, `${f} references a CDN`);
    assert.doesNotMatch(text, /setDecoderConfig/, `${f} calls setDecoderConfig`);
    for (const m of text.matchAll(/useGLTF\(([^)]*)\)/g)) {
      calls++;
      assert.match(m[1], /,\s*DRACO_PATH\s*$/, `${f}: useGLTF(${m[1]}) must pass DRACO_PATH`);
    }
  }
  assert.ok(calls >= 3, `expected the 3 useGLTF call sites, saw ${calls}`);
  assert.match(fs.readFileSync(path.join(src, "s3iDraco.ts"), "utf8"), /DRACO_PATH = "\/draco\/"/);
  const vite = fs.readFileSync(path.join(CLIENT, "vite.config.ts"), "utf8");
  assert.match(vite, /dracoVendorPlugin\(\)/, "vite must vendor + verify the decoder on dev and build");
  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(ignore, /^apps\/world-builder\/client\/public\/draco\/\*$/m, "decoder bytes stay out of git");
  // Build-or-fail (never skip): a fresh vite build into a temp outDir, so a stale or missing dist can't pass.
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "s3i-draco-dist-"));
  try {
    const b = spawnSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir", "--logLevel", "warn"], {
      cwd: CLIENT,
      encoding: "utf8",
      timeout: 240_000,
    });
    assert.equal(b.status, 0, `vite build failed (status ${b.status}): ${(b.stderr || "").slice(-800)}`);
    const js = fs.readdirSync(path.join(dist, "assets")).filter((n) => n.endsWith(".js"));
    assert.ok(js.length > 0, "vite build produced no JS chunks");
    for (const f of js) {
      assert.doesNotMatch(fs.readFileSync(path.join(dist, "assets", f), "utf8"), /gstatic|unpkg|jsdelivr/i, `bundle ${f} references a CDN`);
    }
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

test("#59 bundle: drei's default CDN decoder URL is stripped at renderChunk", () => {
  const drei = "let decoderPath = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/'; x";
  assert.equal(stripCdnDecoder(drei), "let decoderPath = '/draco/'; x");
  assert.equal(stripCdnDecoder(stripCdnDecoder(drei)), null, "idempotent");
  assert.equal(stripCdnDecoder("no cdn here"), null);
  const vendor = fs.readFileSync(path.join(CLIENT, "draco-vendor.mjs"), "utf8");
  assert.match(vendor, /renderChunk\(code\)\s*\{\s*const out = stripCdnDecoder\(code\)/);
});

test("#59 golden specs pin plain and Draco rigged separately (#62)", () => {
  const g = loadGolden();
  assert.deepEqual(validateGolden(g), []);
  assert.equal(GOLDEN_SPECS.riggedDraco.draco, true);
  assert.equal(GOLDEN_SPECS.riggedDraco.mode, GOLDEN_SPECS.rigged.mode);
  assert.equal(g.riggedDraco.draco, true);
  assert.notEqual(g.riggedDraco.sha256, g.rigged.sha256);
  assert.deepEqual(validateGolden({ ...g, riggedDraco: { ...g.riggedDraco, draco: false } }), ["riggedDraco: draco mismatch"]);
});

test("#59 pipeline.sh rejects unknown options and documents --draco", () => {
  const r = spawnSync("bash", [PIPELINE_SH, "--zstd", "a.png", "b.glb"], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /--draco/);
});

function blenderOrSkip(t) {
  if (!process.env.BLENDER_BIN) {
    t.skip("SKIP_NO_BLENDER: BLENDER_BIN unset — #59 Draco export check skipped (not a green lie)");
    return null;
  }
  return requireBlenderBin();
}

function exportGlb(bin, { mode, draco, png, out }) {
  return spawnSync("bash", [PIPELINE_SH, ...(draco ? ["--draco"] : []), png, out], {
    env: { ...process.env, BLENDER_BIN: bin, MODE: mode, SEED: "0" },
    encoding: "utf8",
  });
}

test("#59 --draco gives a smaller rigged GLB the probe reads the same; default stays plain", (t) => {
  const bin = blenderOrSkip(t);
  if (!bin) return;
  const dir = tmp("gp-draco-blend-");
  try {
    const png = makeFixturePng(dir);
    const plain = path.join(dir, "plain.glb");
    const dra = path.join(dir, "draco.glb");
    const rd = exportGlb(bin, { mode: "rigged", draco: true, png, out: dra });
    if (rd.status === 6) {
      t.skip("SKIP_PLATFORM: this Blender build has no Draco encoder (png_to_glb.py exit 6)");
      return;
    }
    assert.equal(rd.status, 0, rd.stderr + rd.stdout);
    const rp = exportGlb(bin, { mode: "rigged", draco: false, png, out: plain });
    assert.equal(rp.status, 0, rp.stderr + rp.stdout);
    assert.ok(fs.statSync(dra).size < fs.statSync(plain).size, `draco ${fs.statSync(dra).size} !< plain ${fs.statSync(plain).size}`);
    const a = probeGlb(plain);
    const b = probeGlb(dra);
    assert.equal(a.meshCompression, "none");
    assert.equal(b.meshCompression, "draco");
    for (const k of ["clips", "clipDurations", "boneCount", "hasArmature", "hasWeights", "armatureCount"]) {
      assert.deepEqual(b[k], a[k], `probe ${k} differs under Draco`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
