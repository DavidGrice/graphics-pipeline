/**
 * S3-E E1 #134 probe cache (sha256 + PROBE_VERSION, never-trusted entries) and #66 timings.json
 * (R1 §3–4, D2 §3–4). Hermetic API + tmp DATA_ROOT; synthetic rigged GLBs (no Blender needed).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT, startApi, makeRiggedGlb, runId, loadClientTs } from "./helpers/s3d-synth.mjs";
import { spawnBash } from "./helpers/spawn-bash.mjs";
import { PROBE_VERSION, cachedProbe, validProbe } from "../apps/blender-pipeline/probe_cache.mjs";
import { probeGlb } from "../apps/blender-pipeline/probe_glb.mjs";
import { buildTimings, readExportMs } from "../apps/blender-pipeline/timings.mjs";

const REGISTER = path.join(ROOT, "apps/blender-pipeline/register_asset.mjs");
let api;
let dir;
before(async () => {
  api = await startApi();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3e-134-"));
});
after(async () => {
  if (api) await api.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const cacheFile = (s) => path.join(api.dataRoot, "cache", "probe", `${s}.json`);
let n = 0;
function register(glb, extra = [], env = {}) {
  const id = runId(`134-${++n}`);
  const r = spawnSync(process.execPath, [REGISTER, "--id", id, "--slug", `s3e-pc-${process.pid}-${n}`, "--glb", glb, "--api", api.url, ...extra], {
    env: { ...process.env, WB_DATA_ROOT: api.dataRoot, ...env },
    encoding: "utf8",
    timeout: 30000,
  });
  const cache = /^probeCache: (hit|miss|off)$/m.exec(r.stdout)?.[1] ?? null;
  let body = null;
  for (const l of r.stdout.split("\n")) {
    if (l.startsWith("{")) body = JSON.parse(l);
  }
  return { id, r, cache, body };
}
function glbFile(name, opts) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, makeRiggedGlb(opts));
  return f;
}

test("#134 miss then hit (same bytes, other id); response + log report probeCache; entry keyed by sha256", () => {
  const glb = glbFile("a.glb", { bones: 3 });
  const s = sha(glb);
  const first = register(glb);
  assert.equal(first.r.status, 0, first.r.stderr);
  assert.equal(first.cache, "miss");
  assert.equal(first.body.probeCache, "miss");
  const entry = JSON.parse(fs.readFileSync(cacheFile(s), "utf8"));
  assert.equal(entry.probeVersion, PROBE_VERSION);
  assert.equal(entry.sha256, s);
  assert.ok(validProbe(entry.probe));
  assert.equal(fs.readdirSync(path.dirname(cacheFile(s))).filter((f) => f.endsWith(".tmp")).length, 0, "atomic: no tmp left");
  const second = register(glb);
  assert.equal(second.r.status, 0, second.r.stderr);
  assert.equal(second.cache, "hit");
  assert.equal(second.body.probeCache, "hit");
  for (const k of ["clips", "clipDurations", "rig", "stage", "characterType"]) {
    assert.deepEqual(second.body[k] && k === "rig" ? { ...second.body.rig } : second.body[k], first.body[k], k);
  }
  // different bytes → different key → miss
  const other = register(glbFile("b.glb", { bones: 4 }));
  assert.equal(other.cache, "miss");
});

test("#134 never trusted: corrupt / schema-invalid / version- or sha-mismatched entry → re-probe + overwrite", () => {
  const glb = glbFile("c.glb", { bones: 5 });
  const s = sha(glb);
  assert.equal(register(glb).cache, "miss");
  const good = fs.readFileSync(cacheFile(s), "utf8");
  const real = JSON.parse(good);
  const poisoned = [
    "{not json",
    JSON.stringify({ ...real, probeVersion: PROBE_VERSION + 1 }),
    JSON.stringify({ ...real, sha256: "0".repeat(64) }),
    JSON.stringify({ ...real, probe: { ...real.probe, clips: "idle" } }),
    JSON.stringify({ ...real, probe: { ...real.probe, armatureCount: 2 } }),
    JSON.stringify({ ...real, probe: { ...real.probe, clipDurations: {} } }),
    JSON.stringify({ probeVersion: PROBE_VERSION, sha256: s }),
  ];
  for (const p of poisoned) {
    fs.writeFileSync(cacheFile(s), p);
    const r = register(glb);
    assert.equal(r.r.status, 0, r.r.stderr);
    assert.equal(r.cache, "miss", `poisoned entry must miss: ${p.slice(0, 60)}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile(s), "utf8")), real, "overwritten with a fresh probe");
  }
});

test("#134 PROBE_CACHE=0 → off (no read, no write); failures are never cached", () => {
  const glb = glbFile("d.glb", { bones: 6 });
  const off = register(glb, [], { PROBE_CACHE: "0" });
  assert.equal(off.r.status, 0, off.r.stderr);
  assert.equal(off.cache, "off");
  assert.ok(!fs.existsSync(cacheFile(sha(glb))));
  // GLB_CORRUPT → exit 5, nothing cached
  const bad = path.join(dir, "bad.glb");
  fs.writeFileSync(bad, Buffer.from("glTF\u0002\u0000\u0000\u0000\u00ff\u0000\u0000\u0000"));
  const rb = register(bad);
  assert.equal(rb.r.status, 5);
  assert.ok(!fs.existsSync(cacheFile(sha(bad))));
  // MULTI_ARMATURE (injected probe) → returned, never written; a cached multi entry is rejected
  const multi = glbFile("m.glb", { bones: 7 });
  const fake = (f) => ({ ...probeGlb(f), armatureCount: 2 });
  const res = cachedProbe(multi, { dataRoot: api.dataRoot, probe: fake });
  assert.equal(res.probed.armatureCount, 2);
  assert.ok(!fs.existsSync(cacheFile(sha(multi))), "multi-armature result not cached");
  // probe throws → propagates, nothing cached
  assert.throws(() => cachedProbe(multi, { dataRoot: api.dataRoot, probe: () => { throw Object.assign(new Error("x"), { code: "GLB_CORRUPT" }); } }));
  assert.ok(!fs.existsSync(cacheFile(sha(multi))));
});

test("#134 cache lives under DATA_ROOT/cache/probe (resolveUnder) and is gitignored", () => {
  const glb = glbFile("e.glb", { bones: 2, clips: { idle: 6, walk: 6, run: 6 } });
  const res = cachedProbe(glb, { dataRoot: api.dataRoot });
  assert.equal(res.probeCache, "miss");
  const real = fs.realpathSync(cacheFile(res.sha256));
  assert.ok(real.startsWith(fs.realpathSync(api.dataRoot) + path.sep));
  const ig = spawnSync("git", ["check-ignore", "-q", "data/cache/probe/x.json"], { cwd: ROOT });
  assert.equal(ig.status, 0, "data/cache/ must be gitignored");
  // a symlinked cache dir escaping DATA_ROOT → treated as uncached, nothing written outside
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "s3e-134r-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "s3e-134o-"));
  try {
    fs.symlinkSync(outside, path.join(root2, "cache"));
    const r2 = cachedProbe(glb, { dataRoot: root2 });
    assert.equal(r2.probeCache, "miss");
    assert.deepEqual(fs.readdirSync(outside), [], "nothing written through the escaping symlink");
  } finally {
    fs.rmSync(root2, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- #66 timings
const KEYS = ["stages", "totalMs", "probeCache"];
const STAGES = ["export", "probe", "copy", "register"];

test("#66 register writes timings.json beside the asset: R1 keys, integer ms, total = sum, no export without a match", () => {
  const glb = glbFile("t.glb", { bones: 3, clips: { idle: 9, walk: 9, run: 9 } });
  const r = register(glb);
  assert.equal(r.r.status, 0, r.r.stderr);
  const t = JSON.parse(fs.readFileSync(path.join(api.dataRoot, "assets", r.id, "timings.json"), "utf8"));
  assert.deepEqual(Object.keys(t), KEYS);
  assert.deepEqual(Object.keys(t.stages), ["probe", "copy", "register"], "export omitted (no matching sidecar)");
  for (const k of ["probe", "copy", "register"]) assert.ok(Number.isInteger(t.stages[k]) && t.stages[k] >= 0, k);
  assert.equal(t.totalMs, t.stages.probe + t.stages.copy + t.stages.register);
  assert.equal(t.probeCache, "miss");
  assert.match(r.r.stdout, /^timings: total=\d+ms probe=\d+ms probeCache=miss$/m);
  assert.equal(r.body.importMeta, undefined, "#97 control: no importMeta created just for timings");
});

const sidecar = (glb, over = {}) =>
  JSON.stringify({ glb: path.basename(glb), sha256: sha(glb), stages: { export: 1234 }, ...over });

test("#66 export ms only from a <name>.timings.json whose glb name AND sha256 match; importMeta mirror", () => {
  const sub = fs.mkdtempSync(path.join(dir, "exp-"));
  const glb = path.join(sub, "model.glb");
  fs.writeFileSync(glb, makeRiggedGlb({ bones: 4, clips: { idle: 7, walk: 7, run: 7 } }));
  const tj = path.join(sub, "model.timings.json");
  fs.writeFileSync(tj, sidecar(glb));
  assert.equal(readExportMs(glb), 1234);
  const meta = path.join(sub, "meta.json");
  fs.writeFileSync(meta, JSON.stringify({ source: "png_pipeline" }));
  const r = register(glb, ["--import-meta", meta]);
  assert.equal(r.r.status, 0, r.r.stderr);
  const t = JSON.parse(fs.readFileSync(path.join(api.dataRoot, "assets", r.id, "timings.json"), "utf8"));
  assert.deepEqual(Object.keys(t.stages), STAGES);
  assert.equal(t.stages.export, 1234);
  assert.equal(t.totalMs, 1234 + t.stages.probe + t.stages.copy + t.stages.register);
  const m = r.body.importMeta.timingsMs;
  assert.deepEqual(Object.keys(m), ["export", "probe", "copy", "total", "probeCache"]);
  assert.equal(m.probeCache, "miss");
  assert.equal(m.export, 1234);
  assert.equal(m.total, m.export + m.probe + m.copy);
  // mismatches → no export time
  fs.writeFileSync(tj, sidecar(glb, { sha256: "0".repeat(64) }));
  assert.equal(readExportMs(glb), null, "sha mismatch");
  fs.writeFileSync(tj, sidecar(glb, { glb: "other.glb" }));
  assert.equal(readExportMs(glb), null, "name mismatch");
  fs.writeFileSync(tj, sidecar(glb, { stages: { export: 1.5 } }));
  assert.equal(readExportMs(glb), null, "non-integer");
  fs.writeFileSync(tj, "{garbage");
  assert.equal(readExportMs(glb), null, "malformed → ignored");
  // a legacy shared timings.json in the folder is never read
  fs.rmSync(tj);
  fs.writeFileSync(path.join(sub, "timings.json"), JSON.stringify(buildTimings({ export: 999 })));
  assert.equal(readExportMs(glb), null);
});

test("#66 NIT-E1-1: two GLBs in one folder never share an export time (pipeline.sh sidecars)", () => {
  const sub = fs.mkdtempSync(path.join(dir, "two-"));
  const stub = path.join(sub, "blender-stub.sh");
  // stub "Blender" writes a rigged GLB whose bytes depend on the output name
  const gen = path.join(sub, "gen.mjs");
  fs.writeFileSync(
    gen,
    `import fs from "node:fs";\nimport { makeRiggedGlb } from ${JSON.stringify(path.join(ROOT, "tests/helpers/s3d-synth.mjs"))};\n` +
      `const out = process.argv[2];\nfs.writeFileSync(out, makeRiggedGlb({ bones: out.endsWith("b.glb") ? 5 : 3 }));\n`,
  );
  fs.writeFileSync(stub, `#!/usr/bin/env bash\nwhile [[ "$1" != "--" ]]; do shift; done; shift\n"${process.execPath}" "${gen}" "$2"\n`, { mode: 0o755 });
  const png = path.join(sub, "in.png");
  fs.writeFileSync(png, "x");
  const older = path.join(sub, "ui-rig.glb");
  fs.writeFileSync(older, makeRiggedGlb({ bones: 6 })); // not exported by pipeline.sh
  const a = path.join(sub, "s3e-a.glb");
  const b = path.join(sub, "s3e-b.glb");
  for (const out of [a, b]) {
    const r = spawnBash(path.join(ROOT, "apps/blender-pipeline/pipeline.sh"), [png, out], { env: { ...process.env, BLENDER_BIN: stub } });
    assert.equal(r.status, 0, r.stderr);
  }
  for (const g of [a, b]) {
    const j = JSON.parse(fs.readFileSync(path.join(sub, `${path.basename(g, ".glb")}.timings.json`), "utf8"));
    assert.deepEqual(Object.keys(j), ["glb", "sha256", "stages"]);
    assert.deepEqual(Object.keys(j.stages), ["export"]);
    assert.equal(j.glb, path.basename(g));
    assert.equal(j.sha256, sha(g));
    assert.ok(Number.isInteger(j.stages.export) && j.stages.export >= 0);
    assert.equal(readExportMs(g), j.stages.export);
  }
  assert.ok(!fs.existsSync(path.join(sub, "timings.json")), "no shared per-folder file");
  // the Tester's repro: registering the older, never-exported GLB gets NO export time
  assert.equal(readExportMs(older), null);
  const ro = register(older);
  assert.equal(ro.r.status, 0, ro.r.stderr);
  const t = JSON.parse(fs.readFileSync(path.join(api.dataRoot, "assets", ro.id, "timings.json"), "utf8"));
  assert.ok(!("export" in t.stages), "older GLB must not inherit another GLB's export ms");
  // re-exporting b with different bytes under a's name can't leak b's sidecar onto a
  fs.copyFileSync(b, a);
  assert.equal(readExportMs(a), null, "a's sidecar sha no longer matches a's bytes");
});

test("tip1.1 PROBE_CACHE strict: only 0|1; anything else → ERROR CONFIG_INVALID, exit 2, value not echoed", async () => {
  const glb = glbFile("pc.glb", { bones: 2 });
  for (const v of ["2", "off", "true", "sekrit"]) {
    const r = register(glb, [], { PROBE_CACHE: v });
    assert.equal(r.r.status, 2, `PROBE_CACHE=${v}`);
    assert.equal(r.r.stderr.trim(), "ERROR CONFIG_INVALID: PROBE_CACHE must be 0 or 1");
  }
  assert.equal(register(glb, [], { PROBE_CACHE: "1" }).r.status, 0);
  const ip = spawnSync(process.execPath, [path.join(ROOT, "apps/blender-pipeline/import_pack.mjs"), "--zip", glb], {
    env: { ...process.env, PROBE_CACHE: "yes" },
    encoding: "utf8",
  });
  assert.equal(ip.status, 2);
  assert.match(ip.stderr, /CONFIG_INVALID: PROBE_CACHE/);
});

test("#66 schema: importMeta.timingsMs is additive + strict; assetSchemaVersion stays 3", async () => {
  const S = await import("@graphics-pipeline/asset-schema");
  assert.equal(S.ASSET_SCHEMA_VERSION, 3);
  assert.ok(S.ImportMetaSchema.safeParse({ source: "fbx", timingsMs: { probe: 1, copy: 2, total: 3, probeCache: "hit" } }).success);
  assert.ok(!S.ImportMetaSchema.safeParse({ source: "fbx", timingsMs: { probe: 1.5, copy: 2, total: 3, probeCache: "hit" } }).success);
  assert.ok(!S.ImportMetaSchema.safeParse({ source: "fbx", timingsMs: { probe: 1, copy: 2, total: 3, probeCache: "hit", extra: 1 } }).success);
  assert.ok(!S.ImportMetaSchema.safeParse({ source: "fbx", timingsMs: { probe: 1, copy: 2, total: 3, probeCache: "maybe" } }).success);
});

test("#66/#139 UI helpers: 429 parsing, countdown, timings tooltip", async () => {
  const U = await loadClientTs("apps/world-builder/client/src/s3eRateLimit.ts");
  assert.equal(U.parseRateLimited(200, "{}", null), null);
  assert.equal(U.parseRateLimited(429, JSON.stringify({ code: "RATE_LIMITED", error: "x", retryAfterSec: 7 }), "9"), 7);
  assert.equal(U.parseRateLimited(429, "<html>", "4"), 4);
  assert.equal(U.parseRateLimited(429, "", null), 1);
  assert.equal(U.parseRateLimited(429, JSON.stringify({ code: "OTHER" }), "4"), null);
  assert.equal(U.remainingSec(10_000, 8_100), 2);
  assert.equal(U.remainingSec(10_000, 10_001), 0);
  assert.equal(U.rateLimitMessage(3), "Too many changes, try again in 3s");
  assert.equal(U.timingsTitle(null), null);
  assert.equal(U.timingsTitle({ probe: 5, copy: 1, total: 6, probeCache: "hit" }), "Import took 6 ms (probe 5 ms · copy 1 ms) · probe cache hit");
});

test("#134 pack import shares the probe cache (miss, then hit for the same GLB bytes)", async () => {
  const { zipStore } = await import("../apps/blender-pipeline/zip_store.mjs");
  const glbBuf = makeRiggedGlb({ bones: 9, clips: { idle: 5, walk: 5, run: 5 } });
  const mk = (slug) => {
    const z = path.join(dir, `${slug}.zip`);
    const pack = { packSchemaVersion: 1, assets: [{ slug, name: slug, stage: "mvp-billboard", characterType: "billboard", license: "MIT", glb: "m.glb" }] };
    fs.writeFileSync(z, zipStore([
      { name: "pack.json", data: Buffer.from(JSON.stringify(pack)) },
      { name: "LICENSE", data: Buffer.from("MIT") },
      { name: "m.glb", data: glbBuf },
    ]));
    return z;
  };
  const run = (slug) =>
    spawnSync(process.execPath, [path.join(ROOT, "apps/blender-pipeline/import_pack.mjs"), "--zip", mk(slug), "--api", api.url, "--outdir", fs.mkdtempSync(path.join(dir, "imp-"))], {
      env: { ...process.env, WB_DATA_ROOT: api.dataRoot },
      encoding: "utf8",
      timeout: 30000,
    });
  const a = run(`s3e-pack-a-${process.pid}`);
  assert.match(a.stdout, /^probeCache: miss /m, a.stderr);
  const b = run(`s3e-pack-b-${process.pid}`);
  assert.match(b.stdout, /^probeCache: hit /m, b.stderr);
  const s = crypto.createHash("sha256").update(glbBuf).digest("hex");
  assert.ok(fs.existsSync(cacheFile(s)));
});
