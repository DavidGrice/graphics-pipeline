/**
 * S3-H E1 #133 — worker_threads GLB probe pool.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  parseProbeWorkers,
  parseProbeTimeoutMs,
  createProbePool,
  resetSharedProbePoolForTests,
  INTERNAL,
  PROBE_WORKERS_DEFAULT,
  PROBE_TIMEOUT_MS_DEFAULT,
} from "../apps/blender-pipeline/probe_pool.mjs";
import { probeGlb, GLB_CORRUPT } from "../apps/blender-pipeline/probe_glb.mjs";
import { cachedProbe, cachedProbeAsync, PROBE_VERSION } from "../apps/blender-pipeline/probe_cache.mjs";
import { ROOT, makeRiggedGlb, tmpDataRoot } from "./helpers/s3d-synth.mjs";

after(async () => {
  await resetSharedProbePoolForTests();
});

test("#133 parseProbeWorkers / parseProbeTimeoutMs: defaults + CONFIG_INVALID", () => {
  assert.equal(parseProbeWorkers(undefined), PROBE_WORKERS_DEFAULT);
  assert.equal(parseProbeWorkers("4"), 4);
  assert.equal(parseProbeTimeoutMs(undefined), PROBE_TIMEOUT_MS_DEFAULT);
  assert.equal(parseProbeTimeoutMs("5000"), 5000);
  for (const v of ["0", "9", "x", "1.5", "-1"]) {
    assert.throws(() => parseProbeWorkers(v), (e) => e.code === "CONFIG_INVALID" && /PROBE_WORKERS/.test(e.message));
  }
  for (const v of ["999", "0", "abc"]) {
    assert.throws(() => parseProbeTimeoutMs(v), (e) => e.code === "CONFIG_INVALID" && /PROBE_TIMEOUT_MS/.test(e.message));
  }
});

test("#133 pool probe matches in-process probeGlb on a golden-ish rigged GLB", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3h-probe-"));
  const glb = path.join(dir, "m.glb");
  fs.writeFileSync(glb, makeRiggedGlb({ bones: 2, clips: { idle: 8, walk: 10 } }));
  const direct = probeGlb(glb);
  const pool = createProbePool({ workers: 1, timeoutMs: 10000 });
  try {
    const via = await pool.probe(glb);
    assert.deepEqual(via.clips, direct.clips);
    assert.equal(via.hasArmature, direct.hasArmature);
    assert.equal(via.boneCount, direct.boneCount);
    assert.deepEqual(via.clipDurations, direct.clipDurations);
  } finally {
    await pool.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#133 cache hit never touches the pool; miss uses pool and is byte-identical", async () => {
  const dataRoot = tmpDataRoot("s3h-pc-");
  const glb = path.join(dataRoot, "t.glb");
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(glb, makeRiggedGlb({ bones: 1, clips: { idle: 4 } }));
  let poolCalls = 0;
  const pool = {
    probe: async (f) => {
      poolCalls++;
      return probeGlb(f);
    },
  };
  const miss = await cachedProbeAsync(glb, { dataRoot, pool });
  assert.equal(miss.probeCache, "miss");
  assert.equal(poolCalls, 1);
  const hit = await cachedProbeAsync(glb, { dataRoot, pool });
  assert.equal(hit.probeCache, "hit");
  assert.equal(poolCalls, 1, "cache hit skips worker");
  assert.deepEqual(hit.probed.clips, miss.probed.clips);
  assert.equal(PROBE_VERSION, 1);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("#133 event loop answers /api/health within 200 ms during a slow probe", async () => {
  // Tiny health server in THIS process; a slow worker must not block it.
  const server = http.createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const slowWorker = path.join(os.tmpdir(), `s3h-slow-${process.pid}.mjs`);
  fs.writeFileSync(
    slowWorker,
    `import { parentPort } from "node:worker_threads";
     parentPort.on("message", ({ id }) => {
       const end = Date.now() + 1500;
       while (Date.now() < end) {}
       parentPort.postMessage({ id, ok: true, probed: { clips: [], hasArmature: false, hasWeights: false, boneCount: 0, armatureCount: 0, jointNames: [], clipDurations: {}, clipMotion: {} } });
     });\n`,
  );
  const pool = createProbePool({ workers: 1, timeoutMs: 10000, workerUrl: slowWorker });
  const probeP = pool.probe("/tmp/does-not-matter.glb");
  const t0 = Date.now();
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  const dt = Date.now() - t0;
  assert.equal(health.status, 200);
  assert.ok(dt < 200, `health took ${dt}ms`);
  await probeP;
  await pool.close();
  server.close();
  fs.rmSync(slowWorker, { force: true });
});

test("#133 worker crash → GLB_CORRUPT; timeout → INTERNAL", async () => {
  const crashWorker = path.join(os.tmpdir(), `s3h-crash-${process.pid}.mjs`);
  fs.writeFileSync(
    crashWorker,
    `import { parentPort } from "node:worker_threads";
     parentPort.on("message", () => { throw new Error("boom"); });\n`,
  );
  const pool = createProbePool({ workers: 1, timeoutMs: 5000, workerUrl: crashWorker });
  await assert.rejects(() => pool.probe("x.glb"), (e) => e.code === GLB_CORRUPT);
  await pool.close();
  fs.rmSync(crashWorker, { force: true });

  const hangWorker = path.join(os.tmpdir(), `s3h-hang-${process.pid}.mjs`);
  fs.writeFileSync(
    hangWorker,
    `import { parentPort } from "node:worker_threads";
     parentPort.on("message", () => { /* never reply */ });\n`,
  );
  const pool2 = createProbePool({ workers: 1, timeoutMs: 200, workerUrl: hangWorker });
  await assert.rejects(() => pool2.probe("x.glb"), (e) => e.code === INTERNAL);
  await pool2.close();
  fs.rmSync(hangWorker, { force: true });
});
