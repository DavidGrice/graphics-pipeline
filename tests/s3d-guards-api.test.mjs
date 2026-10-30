/**
 * S3-D E1 — R1 rev2 §0 error envelope · #76 GLB_TOO_LARGE · #141 PATH_OUTSIDE_INBOX.
 * Hermetic: private API on a free port with a tmp WB_DATA_ROOT (in-memory store); every
 * asset registered here is DELETEd in after(), then the tmp data root is removed.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, startApi, billboardBody, makeRiggedGlb } from "./helpers/s3d-synth.mjs";
import { spawnBash } from "./helpers/spawn-bash.mjs";

const MiB = 1024 * 1024;
let api;
const registered = new Set();

async function post(body) {
  const r = await fetch(`${api.url}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (r.status === 201) registered.add(body.id);
  return { status: r.status, body: j };
}
function sparse(rel, size) {
  const abs = path.join(api.dataRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const fd = fs.openSync(abs, "w");
  fs.ftruncateSync(fd, size);
  fs.closeSync(fd);
  return abs;
}
const uid = (n) => `5d3d0000-0000-4000-8000-${String(n).padStart(12, "0")}`;

before(async () => {
  api = await startApi({ MAX_GLB_MB: "1" });
});
after(async () => {
  for (const id of registered) {
    const r = await fetch(`${api.url}/api/assets/${id}`, { method: "DELETE" });
    assert.ok([204, 404].includes(r.status), `cleanup DELETE ${id} → ${r.status}`);
  }
  const left = await (await fetch(`${api.url}/api/assets`)).json();
  assert.equal(left.length, 0, "s3d guard tests left assets behind");
  await api.stop();
});

test("§0 envelope: 4xx bodies are flat {code, error}; 404s never echo absolute paths", async () => {
  const r = await fetch(`${api.url}/api/assets/nope`);
  assert.equal(r.status, 404);
  const j = await r.json();
  assert.equal(j.code, "NOT_FOUND");
  assert.equal(typeof j.error, "string");

  const bad = await post({ id: uid(1) }); // missing slug
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "VALIDATION");
  assert.equal(typeof bad.body.error, "string");

  // orphan (metadata, no GLB) → file 404 FILE_MISSING with repo-relative rel only
  const id = uid(2);
  assert.equal((await post(billboardBody(id, "s3d-orphan"))).status, 201);
  const f = await fetch(`${api.url}/api/assets/${id}/file`);
  assert.equal(f.status, 404);
  const fj = await f.json();
  assert.equal(fj.code, "FILE_MISSING");
  assert.equal(fj.rel, `assets/${id}/model.glb`);
  const text = JSON.stringify(fj);
  assert.ok(!text.includes(api.dataRoot) && !text.includes(ROOT), `404 leaked an absolute path: ${text}`);
  const p = await fetch(`${api.url}/api/assets/${id}/preview`);
  assert.equal(p.status, 404);
  const pj = await p.json();
  assert.equal(pj.code, "FILE_MISSING");
  assert.ok(!JSON.stringify(pj).includes(api.dataRoot));
});

test("§0 envelope: DELETE of a scene-referenced asset → 409 ASSET_IN_USE {refs}", async () => {
  const child = uid(3);
  const scene = uid(4);
  assert.equal((await post(billboardBody(child, "s3d-child"))).status, 201);
  const sceneBody = {
    ...billboardBody(scene, "s3d-scene"),
    characterType: "unknown",
    stage: "scene",
    scene: { version: 1, rootId: "n0", nodes: [{ id: "n0", assetId: child, transform: { position: [0, 0, 0] } }] },
  };
  const s = await post(sceneBody);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const d = await fetch(`${api.url}/api/assets/${child}`, { method: "DELETE" });
  assert.equal(d.status, 409);
  const dj = await d.json();
  assert.equal(dj.code, "ASSET_IN_USE");
  assert.deepEqual(dj.refs, [scene]);
  // scene first, then child (after() also covers it)
  assert.equal((await fetch(`${api.url}/api/assets/${scene}`, { method: "DELETE" })).status, 204);
  registered.delete(scene);
});

test("#76 GLB at exactly MAX_GLB_MB → 201; max+1 byte → 413 GLB_TOO_LARGE {sizeBytes, maxBytes}", async () => {
  const okId = uid(10);
  sparse(`assets/${okId}/model.glb`, 1 * MiB);
  const ok = await post(billboardBody(okId, "s3d-size-max"));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  const bigId = uid(11);
  sparse(`assets/${bigId}/model.glb`, 1 * MiB + 1);
  const big = await post(billboardBody(bigId, "s3d-size-max-plus-1"));
  assert.equal(big.status, 413);
  assert.equal(big.body.code, "GLB_TOO_LARGE");
  assert.equal(big.body.sizeBytes, MiB + 1);
  assert.equal(big.body.maxBytes, MiB);
  assert.equal(typeof big.body.error, "string");
  assert.equal((await fetch(`${api.url}/api/assets/${bigId}`)).status, 404, "413 must not store metadata");
});

test("#76 MAX_GLB_MB invalid → server refuses to start (fail-closed)", () => {
  for (const bad of ["0", "abc", "1.5", "-3"]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, "apps/world-builder/server/src/index.js")], {
      env: { ...process.env, PORT: "1", MAX_GLB_MB: bad, MONGO_URI: "mongodb://127.0.0.1:1" },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(r.status, 1, `MAX_GLB_MB=${bad} should exit 1`);
    assert.match(r.stderr, /MAX_GLB_MB must be an integer >= 1/);
  }
});

test("#76 register_asset: size gate runs BEFORE probe (2 MB sparse non-GLB, MAX_GLB_MB=1 → exit 4)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3d-76-"));
  try {
    const f = path.join(dir, "big.glb");
    fs.writeFileSync(f, "");
    fs.truncateSync(f, 2 * MiB); // not a GLB: probe would fail with "not a GLB"
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "apps/blender-pipeline/register_asset.mjs"), "--glb", f, "--api", "http://127.0.0.1:9"],
      { env: { ...process.env, MAX_GLB_MB: "1", WB_DATA_ROOT: dir }, encoding: "utf8" },
    );
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /GLB_TOO_LARGE/);
    assert.doesNotMatch(r.stderr + r.stdout, /not a GLB|probe:/, "probe must not run");
    // at the cap: a real GLB under 1 MB passes the gate (fails later only on the dead API)
    const small = path.join(dir, "ok.glb");
    fs.writeFileSync(small, makeRiggedGlb());
    const r2 = spawnSync(
      process.execPath,
      [path.join(ROOT, "apps/blender-pipeline/register_asset.mjs"), "--glb", small, "--api", "http://127.0.0.1:9"],
      { env: { ...process.env, MAX_GLB_MB: "1", WB_DATA_ROOT: dir }, encoding: "utf8" },
    );
    assert.match(r2.stdout, /probe: clips=/);
    assert.doesNotMatch(r2.stderr, /GLB_TOO_LARGE/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#76 pipeline.sh: exported GLB over MAX_GLB_MB → exit 4 GLB_TOO_LARGE; invalid MAX_GLB_MB → exit 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3d-76p-"));
  try {
    const stub = path.join(dir, "blender-stub.sh");
    // stub "Blender": writes a 2 MiB sparse file to the out path (arg after the input PNG)
    fs.writeFileSync(
      stub,
      '#!/usr/bin/env bash\nwhile [[ "$1" != "--" ]]; do shift; done; shift\nOUT="$2"\ntruncate -s 2097152 "$OUT"\n',
      { mode: 0o755 },
    );
    const png = path.join(dir, "in.png");
    fs.writeFileSync(png, "x");
    const out = path.join(dir, "out.glb");
    const script = path.join(ROOT, "apps/blender-pipeline/pipeline.sh");
    const r = spawnBash(script, [png, out], { env: { ...process.env, BLENDER_BIN: stub, MAX_GLB_MB: "1" } });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /GLB_TOO_LARGE/);
    const ok = spawnBash(script, [png, out], { env: { ...process.env, BLENDER_BIN: stub, MAX_GLB_MB: "3" } });
    assert.equal(ok.status, 0, ok.stderr);
    const bad = spawnBash(script, [png, out], { env: { ...process.env, BLENDER_BIN: stub, MAX_GLB_MB: "zero" } });
    assert.equal(bad.status, 2, bad.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("#141 traversal set → 400 PATH_OUTSIDE_INBOX on every formats.* path; no path echoed", async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "s3d-outside-"));
  try {
    fs.writeFileSync(path.join(outside, "secret.glb"), "x");
    fs.symlinkSync(outside, path.join(api.dataRoot, "assets", "escape"));
    fs.symlinkSync(outside, path.join(api.dataRoot, "inbox", "escape"));
    const cases = [
      ["glb", "../x.glb"],
      ["glb", "/etc/passwd"],
      ["glb", "%2e%2e/x.glb"],
      ["glb", "assets/%252e%252e/%252e%252e/x.glb"],
      ["glb", "assets/a\u0000b.glb"],
      ["glb", "assets/escape/secret.glb"],
      ["preview", "assets/../../etc/hosts"],
      ["fbx", "C:/Windows/x.fbx"],
      ["obj", "assets/escape/missing.obj"],
      ["sourcePng", "assets/x.png"], // not under inbox/
      ["sourcePng", "inbox/../assets/x.png"],
      ["sourcePng", "inbox/escape/x.png"],
      ["sourcePng", "/etc/passwd"],
    ];
    let n = 100;
    for (const [field, value] of cases) {
      const id = uid(n++);
      const body = billboardBody(id, `s3d-trav-${n}`, { [field]: value });
      const r = await post(body);
      assert.equal(r.status, 400, `${field}=${JSON.stringify(value)} → ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, "PATH_OUTSIDE_INBOX", `${field}=${JSON.stringify(value)}`);
      const text = JSON.stringify(r.body);
      for (const leak of [outside, api.dataRoot, "/etc/passwd", "/etc/hosts", value]) {
        assert.ok(!text.includes(leak), `${field}=${JSON.stringify(value)} echoed ${leak}: ${text}`);
      }
    }
    // control: real inbox path is accepted
    fs.mkdirSync(path.join(api.dataRoot, "inbox", "s3d-ok"), { recursive: true });
    const okId = uid(199);
    const ok = await post(billboardBody(okId, "s3d-inbox-ok", { sourcePng: "inbox/s3d-ok/20261030-000000.png" }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  } finally {
    fs.rmSync(path.join(api.dataRoot, "assets", "escape"), { force: true });
    fs.rmSync(path.join(api.dataRoot, "inbox", "escape"), { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("#141 run_mvp.sh: slug '../a' / non-kebab → exit 2; symlinked inbox slug dir escaping → exit 2", () => {
  const script = path.join(ROOT, "apps/blender-pipeline/run_mvp.sh");
  for (const slug of ["../a", "A b", "a/../../b", "-lead"]) {
    const r = spawnBash(script, [slug], { env: { ...process.env, API: "http://127.0.0.1:9" } });
    assert.equal(r.status, 2, `slug ${slug}: ${r.stderr}`);
    assert.match(r.stderr, /PATH_OUTSIDE_INBOX/);
  }
  const inboxRoot = path.join(ROOT, "data", "inbox");
  fs.mkdirSync(inboxRoot, { recursive: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "s3d-inbox-out-"));
  const link = path.join(inboxRoot, `s3d-escape-${process.pid}`);
  try {
    fs.symlinkSync(outside, link);
    const r = spawnBash(script, [path.basename(link)], { env: { ...process.env, API: "http://127.0.0.1:9" } });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /PATH_OUTSIDE_INBOX/);
    assert.ok(!r.stderr.includes(outside), "must not echo the resolved path");
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("R1 nit: fs error on file/preview routes → 500 {code:INTERNAL, error:'internal error'}; no 4xx/5xx body leaks a path", async () => {
  const ABS = /(^|[\s'"])\/(home|workspace|tmp|etc|usr|var)\//;
  const bodies = [];
  const grab = async (label, url, init) => {
    const r = await fetch(url, init);
    const text = await r.text();
    if (r.status >= 400) bodies.push({ label, status: r.status, text });
    return { status: r.status, text };
  };

  // EACCES: GLB exists but is unreadable (sendFile stream error → callback). Root ignores 0o000.
  const id = uid(300);
  const glb = sparse(`assets/${id}/model.glb`, 64);
  // EISDIR: preview path is a directory
  fs.mkdirSync(path.join(api.dataRoot, "assets", id, "preview.png"), { recursive: true });
  assert.equal((await post(billboardBody(id, "s3d-fs-error", { preview: `assets/${id}/preview.png` }))).status, 201);
  fs.chmodSync(glb, 0o000);
  try {
    const canEacces = typeof process.getuid !== "function" || process.getuid() !== 0;
    if (canEacces) {
      const f = await grab("file EACCES", `${api.url}/api/assets/${id}/file`);
      assert.equal(f.status, 500, f.text);
      assert.deepEqual(JSON.parse(f.text), { code: "INTERNAL", error: "internal error" });
    }
    const p = await grab("preview EISDIR", `${api.url}/api/assets/${id}/preview`);
    assert.ok(p.status >= 400, `directory preview must fail (${p.status})`);
    if (p.status === 500) assert.deepEqual(JSON.parse(p.text), { code: "INTERNAL", error: "internal error" });
    assert.match(api.log(), /INTERNAL GET \/api\/assets\/:id\/(file|preview)/, "details are logged server-side");
  } finally {
    fs.chmodSync(glb, 0o644);
  }

  // sweep of the other error paths
  await grab("unknown route", `${api.url}/home/box/secret`);
  await grab("unknown api route", `${api.url}/api/tmp/x`);
  await grab("not found", `${api.url}/api/assets/nope`);
  await grab("file missing", `${api.url}/api/assets/${uid(2)}/file`);
  await grab("bad json", `${api.url}/api/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  await grab("traversal", `${api.url}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(billboardBody(uid(301), "s3d-trav-sweep", { glb: "/etc/passwd" })),
  });
  const strict = await startApi({ HEALTH_STRICT_KRITA: "1", KRITA_HEALTH_MODE: "", KRITA_MCP_PORT: "1" });
  try {
    const h = await fetch(`${strict.url}/api/health`);
    const ht = await h.text();
    assert.equal(h.status, 503, ht);
    bodies.push({ label: "health 503", status: 503, text: ht, root: strict.dataRoot });
  } finally {
    await strict.stop();
  }

  assert.ok(bodies.length >= 8, `swept ${bodies.length} error bodies`);
  for (const b of bodies) {
    assert.doesNotMatch(b.text, ABS, `${b.label} (${b.status}) leaked an absolute path: ${b.text}`);
    for (const leak of [api.dataRoot, ROOT, b.root].filter(Boolean)) {
      assert.ok(!b.text.includes(leak), `${b.label} leaked ${leak}`);
    }
    assert.match(b.text, /"code":"[A-Z][A-Z0-9_]+"/, `${b.label} is not a {code,error} JSON body: ${b.text}`);
  }
});
