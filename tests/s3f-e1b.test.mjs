/**
 * S3-F E1 tip1b — #128 activity feed, #52 bridge unauthorized vs down, #110 glTF separate debug export.
 * Specs: docs/sprint3f-brief.md (R1 §3, §4, §9) + docs/sprint3f-d2-contracts-codes-carryovers.md @1f687da.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { ROOT, startApi, billboardBody, runId, freePort, tmpDataRoot, loadClientTs } from "./helpers/s3d-synth.mjs";

const SERVER = path.join(ROOT, "apps/world-builder/server/src/index.js");
const json = { "Content-Type": "application/json" };
const tf = (x) => ({ position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
const post = (api, b, headers = {}) => fetch(`${api.url}/api/assets`, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(b) });
const patch = (api, id, b) => fetch(`${api.url}/api/assets/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(b) });
const feed = async (api, q = "") => {
  const r = await fetch(`${api.url}/api/activity${q}`);
  return { status: r.status, body: await r.json() };
};
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : []);

// ---------------------------------------------------------------- #128
test("#128 each kind written once ({at, kind, id, slug?}, no bodies); feed newest-first {items,total}", async () => {
  const api = await startApi();
  try {
    const a = runId("act-a");
    const b = runId("act-b");
    const sc = runId("act-scene");
    assert.equal((await post(api, billboardBody(a, "act-a"))).status, 201); // asset.register
    assert.equal((await post(api, billboardBody(b, "act-b"), { "X-Activity-Kind": "pack.import" })).status, 201); // pack.import
    assert.equal((await patch(api, a, { altText: "a plane" })).status, 200); // asset.patch
    const scene = {
      ...billboardBody(sc, "act-scene"),
      characterType: "unknown",
      stage: "scene",
      scene: { version: 1, rootId: "n0", nodes: [{ id: "n0", assetId: a, transform: tf(0) }, { id: "n1", assetId: b, transform: tf(1) }] },
    };
    assert.equal((await post(api, scene)).status, 201); // scene.save
    const tomb = { ...scene.scene, nodes: [scene.scene.nodes[0], { ...scene.scene.nodes[1], deleted: true }] };
    assert.equal((await patch(api, sc, { scene: tomb })).status, 200); // scene.save (tombstone)
    assert.equal((await patch(api, sc, { scene: { ...tomb, nodes: [tomb.nodes[0]] } })).status, 200); // scene.purge
    assert.equal((await fetch(`${api.url}/api/assets/${b}`, { method: "DELETE" })).status, 204); // asset.delete

    await feed(api); // GET awaits the serialised write chain (writes are fire-and-forget after the response)
    const raw = lines(path.join(api.dataRoot, "activity.jsonl")).map((l) => JSON.parse(l));
    assert.deepEqual(raw.map((e) => e.kind), [
      "asset.register", "pack.import", "asset.patch", "scene.save", "scene.save", "scene.purge", "asset.delete",
    ]);
    for (const e of raw) {
      assert.deepEqual(Object.keys(e).sort(), ["at", "id", "kind", "slug"], "only {at, kind, id, slug}");
      assert.match(e.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, "ISO-8601 UTC");
    }
    assert.deepEqual(raw.map((e) => e.id), [a, b, a, sc, sc, sc, b]);
    assert.doesNotMatch(fs.readFileSync(path.join(api.dataRoot, "activity.jsonl"), "utf8"), /a plane|formats|127\.0\.0\.1|\/tmp\//, "no bodies, paths, IPs");

    const r = await feed(api);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 7);
    assert.deepEqual(r.body.items.map((e) => e.kind), raw.map((e) => e.kind).reverse(), "newest first");
    assert.deepEqual(Object.keys(r.body).sort(), ["items", "total"]);
  } finally {
    await api.stop();
  }
});

test("#128 limit bounds: default 20, 1..100 ok; 0 / 101 / abc / 1.5 / -1 / '' → 400 VALIDATION {field:'limit'}; GET never rate-limited", async () => {
  const api = await startApi({ RATE_LIMIT_PER_MIN: "1" });
  try {
    const f = path.join(api.dataRoot, "activity.jsonl");
    fs.writeFileSync(f, Array.from({ length: 30 }, (_, i) => JSON.stringify({ at: new Date(1e12 + i).toISOString(), kind: "asset.register", id: `id-${i}`, slug: `s-${i}` })).join("\n") + "\n");
    assert.equal((await feed(api)).body.items.length, 20);
    assert.equal((await feed(api, "?limit=1")).body.items[0].id, "id-29");
    assert.equal((await feed(api, "?limit=100")).body.items.length, 30);
    for (const bad of ["0", "101", "abc", "1.5", "-1", "", "1e2"]) {
      const r = await feed(api, `?limit=${encodeURIComponent(bad)}`);
      assert.equal(r.status, 400, `limit=${bad}`);
      assert.equal(r.body.code, "VALIDATION");
      assert.equal(r.body.field, "limit");
    }
    for (let i = 0; i < 5; i++) assert.equal((await feed(api)).status, 200, "GET is never throttled");
  } finally {
    await api.stop();
  }
});

test("#128 malformed lines are skipped, never fatal", async () => {
  const api = await startApi();
  try {
    const good = (i) => JSON.stringify({ at: new Date(1e12 + i).toISOString(), kind: "scene.save", id: `g${i}` });
    fs.writeFileSync(
      path.join(api.dataRoot, "activity.jsonl"),
      [good(1), "{not json", "[]", "null", JSON.stringify({ at: "x", kind: "bogus.kind", id: "z" }), JSON.stringify({ kind: "asset.patch", id: "noat" }), good(2), ""].join("\n"),
    );
    const r = await feed(api);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((e) => e.id), ["g2", "g1"]);
    assert.equal(r.body.total, 2);
  } finally {
    await api.stop();
  }
});

test("#128 rotation at ACTIVITY_MAX_LINES: one generation (activity.1.jsonl overwritten), feed reads it when it needs more", async () => {
  const api = await startApi({ ACTIVITY_MAX_LINES: "3" });
  try {
    const cur = path.join(api.dataRoot, "activity.jsonl");
    const old = path.join(api.dataRoot, "activity.1.jsonl");
    const ids = [];
    for (let i = 0; i < 7; i++) {
      const id = runId(`rot-${i}`);
      ids.push(id);
      assert.equal((await post(api, billboardBody(id, `rot-${i}`))).status, 201);
    }
    await feed(api); // waits for the write chain
    assert.deepEqual(lines(cur).map((l) => JSON.parse(l).id), [ids[6]]);
    assert.deepEqual(lines(old).map((l) => JSON.parse(l).id), [ids[3], ids[4], ids[5]], "only the latest generation kept");
    assert.ok(!fs.existsSync(path.join(api.dataRoot, "activity.2.jsonl")));
    const r = await feed(api, "?limit=3");
    assert.deepEqual(r.body.items.map((e) => e.id), [ids[6], ids[5], ids[4]], "spills into activity.1.jsonl");
    assert.equal(r.body.total, 4);
    assert.deepEqual((await feed(api, "?limit=1")).body.items.map((e) => e.id), [ids[6]]);
  } finally {
    await api.stop();
  }
});

test("#128 a failed activity write never fails the request (warns instead)", async () => {
  const dataRoot = tmpDataRoot("s3f-actfail-");
  fs.mkdirSync(path.join(dataRoot, "activity.jsonl")); // a directory → append fails (EISDIR)
  const api = await startApi({ WB_DATA_ROOT: dataRoot });
  try {
    const id = runId("act-fail");
    assert.equal((await post(api, billboardBody(id, "act-fail"))).status, 201);
    assert.equal((await patch(api, id, { altText: "x" })).status, 200);
    assert.equal((await fetch(`${api.url}/api/assets/${id}`, { method: "DELETE" })).status, 204);
    const r = await feed(api);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { items: [], total: 0 });
    assert.match(api.log(), /activity write failed \(EISDIR\); request unaffected/);
    assert.doesNotMatch(api.log(), new RegExp(dataRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ".*activity"), "no path in the warning");
  } finally {
    await api.stop();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("#128/#52 config: bad ACTIVITY_MAX_LINES / BRIDGE refuse to start with CONFIG_INVALID (value never echoed)", () => {
  for (const [k, v] of [["ACTIVITY_MAX_LINES", "0"], ["ACTIVITY_MAX_LINES", "sekrit"], ["BRIDGE", "sekrit-bridge"], ["BRIDGE", "vendorx"]]) {
    const r = spawnSync(process.execPath, [SERVER], {
      env: { ...process.env, PORT: "1", MONGO_URI: "mongodb://127.0.0.1:1", [k]: v },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(r.status, 1, `${k}=${v}`);
    assert.match(r.stderr.trim(), new RegExp(`^\\[world-builder\\] FATAL CONFIG_INVALID: ${k} `));
    assert.ok(!r.stderr.includes(v), "value not echoed");
  }
});

test("#128/#110 gitignore: activity files and *.gltf-debug/ never tracked", () => {
  const r = spawnSync("git", ["check-ignore", "-v", "data/activity.jsonl", "data/activity.1.jsonl", "out/model.gltf-debug/model.gltf", "data/assets/x/model.gltf-debug/model.bin"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 4);
});

test("#128/#52 client helpers: verbs, bridge badge text (state never colour-only)", async () => {
  const A = await loadClientTs("apps/world-builder/client/src/s3fActivity.ts");
  assert.equal(A.activityVerb("asset.register"), "Registered");
  assert.equal(A.activityVerb("scene.purge"), "Purged scene");
  assert.equal(A.activityVerb("pack.import"), "Imported");
  const u = A.bridgeBadge({ mode: "vendor", status: "unauthorized", httpStatus: 401 });
  assert.equal(u.text, "Krita: unauthorized");
  assert.equal(u.tone, "warn");
  assert.match(u.title, /vendor.*HTTP 401/);
  assert.equal(A.bridgeBadge({ mode: "vendor", status: "down" }).tone, "err");
  assert.equal(A.bridgeBadge({ mode: "mock", status: "mock" }).text, "Krita: mock");
  assert.equal(A.bridgeBadge(null).text, "Krita: unknown");
});

// ---------------------------------------------------------------- #52
async function stub(status) {
  const port = await freePort();
  const srv = http.createServer((_q, s) => {
    s.writeHead(status, status >= 300 && status < 400 ? { Location: "/elsewhere" } : {});
    s.end("x");
  });
  await new Promise((r) => srv.listen(port, "127.0.0.1", r));
  return { port, close: () => new Promise((r) => srv.close(r)) };
}
const health = async (env) => {
  const api = await startApi({ KRITA_HEALTH_MODE: "bridge", ...env });
  try {
    const r = await fetch(`${api.url}/api/health`);
    return { status: r.status, body: await r.json() };
  } finally {
    await api.stop();
  }
};

test("#52 bridge status: 200/302 ok, 401/403 unauthorized, 500 down (+httpStatus), closed port down, mock, skipped", async () => {
  for (const [code, want] of [[200, "ok"], [302, "ok"], [401, "unauthorized"], [403, "unauthorized"], [500, "down"]]) {
    const s = await stub(code);
    try {
      const h = await health({ KRITA_MCP_PORT: String(s.port) });
      assert.equal(h.status, 200, "non-strict health stays 200");
      assert.equal(h.body.bridge.mode, "vendor");
      assert.equal(h.body.bridge.status, want, `HTTP ${code}`);
      if (want === "ok") assert.equal(h.body.bridge.httpStatus, undefined);
      else assert.equal(h.body.bridge.httpStatus, code);
      assert.equal(h.body.krita.ok, want === "ok", "legacy krita.ok derived (unauthorized is not ok)");
      assert.equal(h.body.krita.status, want === "ok" ? "running" : want);
    } finally {
      await s.close();
    }
  }
  const closed = await freePort();
  const d = await health({ KRITA_MCP_PORT: String(closed) });
  assert.deepEqual(d.body.bridge, { mode: "vendor", status: "down" });
  assert.equal(d.body.krita.error, "connection failed");
  const fp = await stub(401);
  try {
    const h = await health({ BRIDGE: "firstparty", KRITA_FP_PORT: String(fp.port), KRITA_MCP_PORT: String(closed) });
    assert.deepEqual(h.body.bridge, { mode: "firstparty", status: "unauthorized", httpStatus: 401 });
  } finally {
    await fp.close();
  }
  assert.deepEqual((await health({ BRIDGE: "mock" })).body.bridge, { mode: "mock", status: "mock" });
  assert.deepEqual((await health({ BRIDGE: "MOCK", KRITA_HEALTH_MODE: "off" })).body.bridge, { mode: "mock", status: "mock" });
  assert.deepEqual((await health({ KRITA_HEALTH_MODE: "off" })).body.bridge, { mode: "vendor", status: "skipped" });
});

test("#52 strict: unauthorized → 503 KRITA_UNAUTHORIZED, down → 503 KRITA_DOWN, ok → 200; no paths in 503", async () => {
  const s401 = await stub(401);
  const s200 = await stub(200);
  const closed = await freePort();
  try {
    const u = await health({ HEALTH_STRICT_KRITA: "1", KRITA_MCP_PORT: String(s401.port) });
    assert.equal(u.status, 503);
    assert.equal(u.body.code, "KRITA_UNAUTHORIZED");
    assert.equal(typeof u.body.error, "string");
    assert.equal(u.body.dataRoot, undefined);
    const d = await health({ HEALTH_STRICT_KRITA: "1", KRITA_MCP_PORT: String(closed) });
    assert.equal(d.status, 503);
    assert.equal(d.body.code, "KRITA_DOWN");
    assert.doesNotMatch(JSON.stringify(d.body), /(^|[\s'"])\/(home|workspace|tmp)\//);
    const ok = await health({ HEALTH_STRICT_KRITA: "1", KRITA_MCP_PORT: String(s200.port) });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.code, undefined);
  } finally {
    await s401.close();
    await s200.close();
  }
});

// ---------------------------------------------------------------- #110
test("#110 pipeline.sh rejects unknown options (exit 1) before touching Blender", (t) => {
  const bash = spawnSync("bash", ["--version"]);
  if (bash.status !== 0) return t.skip("SKIP_PLATFORM: bash not available (need Git Bash on Windows)");
  const r = spawnSync("bash", [path.join(ROOT, "apps/blender-pipeline/pipeline.sh"), "--gltf-seperate", "a.png", "b.glb"], {
    encoding: "utf8",
    env: { ...process.env, BLENDER_BIN: "/nonexistent/blender" },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown option --gltf-seperate/);
});

test("#110 --gltf-separate: GLB bytes identical with/without the flag; .gltf (2.0) + .bin in <name>.gltf-debug/", (t) => {
  const blender = process.env.BLENDER_BIN;
  if (!blender) return t.skip("SKIP_NO_BLENDER: BLENDER_BIN unset");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3f-gltf-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const png = path.join(dir, "in.png");
  spawnSync(process.execPath, [path.join(ROOT, "scripts/ensure-smoke-png.mjs"), png], { stdio: "ignore" });
  assert.ok(fs.existsSync(png));
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  for (const mode of ["billboard", "rigged"]) {
    const env = { ...process.env, BLENDER_BIN: blender, MODE: mode, SMOKE_MODE: mode, SEED: "0" };
    const plain = path.join(dir, `plain-${mode}`, "model.glb");
    const dbg = path.join(dir, `dbg-${mode}`, "model.glb");
    const r1 = spawnSync("bash", [path.join(ROOT, "apps/blender-pipeline/pipeline.sh"), png, plain], { env, encoding: "utf8", timeout: 180000 });
    assert.equal(r1.status, 0, r1.stderr);
    const r2 = spawnSync("bash", [path.join(ROOT, "apps/blender-pipeline/pipeline.sh"), "--gltf-separate", png, dbg], { env, encoding: "utf8", timeout: 180000 });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(sha(dbg), sha(plain), `${mode}: GLB canonical (same bytes)`);
    assert.ok(!fs.existsSync(path.join(dir, `plain-${mode}`, "model.gltf-debug")), "no debug dir without the flag");
    const ddir = path.join(dir, `dbg-${mode}`, "model.gltf-debug");
    const gltf = JSON.parse(fs.readFileSync(path.join(ddir, "model.gltf"), "utf8"));
    assert.equal(gltf.asset.version, "2.0");
    assert.equal(gltf.buffers[0].uri, "model.bin");
    assert.ok(fs.statSync(path.join(ddir, "model.bin")).size > 0);
    if (mode === "rigged") assert.ok((gltf.animations ?? []).length >= 4, "rigged clips present in debug glTF");
    // timings sidecar describes the GLB only
    const tm = JSON.parse(fs.readFileSync(path.join(dir, `dbg-${mode}`, "model.timings.json"), "utf8"));
    assert.equal(tm.glb, "model.glb");
    assert.equal(tm.sha256, sha(dbg));
    // re-run replaces the debug dir (no stale files)
    fs.writeFileSync(path.join(ddir, "stale.txt"), "x");
    const r3 = spawnSync("bash", [path.join(ROOT, "apps/blender-pipeline/pipeline.sh"), "--gltf-separate", png, dbg], { env, encoding: "utf8", timeout: 180000 });
    assert.equal(r3.status, 0, r3.stderr);
    assert.ok(!fs.existsSync(path.join(ddir, "stale.txt")));
    assert.equal(sha(dbg), sha(plain));
  }
});
