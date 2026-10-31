/**
 * S3-F E2 (tip2) — #11 clipRequires map, #85 PUBLIC_BASE_URL + client QR, #140 featured, #47 sourceKra.
 * Specs: docs/sprint3f-brief.md (R1) + docs/sprint3f-d2-contracts-codes-carryovers.md / D1 @1f687da.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { ROOT, startApi, billboardBody, runId, loadClientTs, makeRiggedGlb } from "./helpers/s3d-synth.mjs";

const SERVER = path.join(ROOT, "apps/world-builder/server/src/index.js");
const REGISTER = path.join(ROOT, "apps/blender-pipeline/register_asset.mjs");
const json = { "Content-Type": "application/json" };
const post = (api, b) => fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) });
const patch = (api, id, b) => fetch(`${api.url}/api/assets/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(b) });
const put = (api, b) => fetch(`${api.url}/api/featured`, { method: "PUT", headers: json, body: JSON.stringify(b) });
const clipBody = (tag, clipRequires) => {
  const id = runId(tag);
  return { ...billboardBody(id, tag), clips: ["idle", "walk", "run", "wave"], ...(clipRequires ? { clipRequires } : {}) };
};
const tf = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
const sceneBody = (tag, childId) => ({
  ...billboardBody(runId(tag), tag),
  characterType: "unknown",
  stage: "scene",
  scene: { version: 1, rootId: "n0", nodes: [{ id: "n0", assetId: childId, transform: tf }] },
});

// ---------------------------------------------------------------- #11
test("#11 register: diamond ok; missing key/value → CLIP_REQUIRES_MISSING {clip, missing}; self/cycle → CLIP_REQUIRES_CYCLE {cycle}; types → VALIDATION", async () => {
  const api = await startApi();
  try {
    const ok = clipBody("req-ok", { run: ["walk", "idle"], walk: ["idle"], wave: ["walk", "run"] }); // diamond-ish
    const r = await post(api, ok);
    assert.equal(r.status, 201);
    assert.deepEqual((await r.json()).clipRequires, ok.clipRequires);

    const cases = [
      [{ jump: ["idle"] }, 400, { code: "CLIP_REQUIRES_MISSING", clip: "jump", missing: ["jump"] }],
      [{ run: ["walk", "fly"] }, 400, { code: "CLIP_REQUIRES_MISSING", clip: "run", missing: ["fly"] }],
      [{ run: ["run"] }, 400, { code: "CLIP_REQUIRES_CYCLE", cycle: ["run", "run"] }],
      [{ idle: ["walk"], walk: ["run"], run: ["idle"] }, 400, { code: "CLIP_REQUIRES_CYCLE", cycle: ["idle", "walk", "run", "idle"] }],
    ];
    for (const [map, status, want] of cases) {
      const res = await post(api, clipBody("req-bad", map));
      const j = await res.json();
      assert.equal(res.status, status, JSON.stringify(map));
      for (const [k, v] of Object.entries(want)) assert.deepEqual(j[k], v, `${JSON.stringify(map)} ${k}`);
      assert.equal(typeof j.error, "string");
    }
    for (const bad of [{ run: [] }, { run: "walk" }, { run: ["walk", "walk"] }, { run: Array(9).fill(0).map((_, i) => `c${i}`) }, ["run"]]) {
      const res = await post(api, clipBody("req-type", bad));
      assert.equal(res.status, 400, JSON.stringify(bad));
      assert.equal((await res.json()).code, "VALIDATION");
    }
  } finally {
    await api.stop();
  }
});

test("#11 PATCH: checked against stored (probed) clips; null clears; cycle via PATCH rejected", async () => {
  const api = await startApi();
  try {
    const b = clipBody("req-patch");
    assert.equal((await post(api, b)).status, 201);
    let r = await patch(api, b.id, { clipRequires: { walk: ["idle"] } });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).clipRequires, { walk: ["idle"] });
    r = await patch(api, b.id, { clipRequires: { walk: ["idle"], idle: ["walk"] } });
    assert.equal(r.status, 400);
    assert.deepEqual((await r.json()).cycle, ["walk", "idle", "walk"]);
    r = await patch(api, b.id, { clipRequires: { swim: ["idle"] } });
    assert.equal((await r.json()).code, "CLIP_REQUIRES_MISSING");
    r = await patch(api, b.id, { clipRequires: null });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).clipRequires, undefined);
  } finally {
    await api.stop();
  }
});

test("#11 CLI register --clip-requires: probe wins; MISSING / CYCLE exit 1 before any copy or POST", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s3f-req-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const glb = path.join(dir, "r.glb");
  fs.writeFileSync(glb, makeRiggedGlb());
  const dataRoot = path.join(dir, "data");
  fs.mkdirSync(dataRoot);
  const run = (map) => {
    const f = path.join(dir, `req-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(f, JSON.stringify(map));
    return spawnSync(process.execPath, [REGISTER, "--glb", glb, "--slug", "req-cli", "--api", "http://127.0.0.1:1", "--clip-requires", f], {
      env: { ...process.env, WB_DATA_ROOT: dataRoot, PROBE_CACHE: "0" },
      encoding: "utf8",
      timeout: 30000,
    });
  };
  let r = run({ run: ["fly"] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ERROR CLIP_REQUIRES_MISSING: .*fly/m);
  r = run({ walk: ["run"], run: ["walk"] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ERROR CLIP_REQUIRES_CYCLE: Circular requirement: walk → run → walk/m);
  r = run({ run: [] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ERROR VALIDATION: /m);
  assert.ok(!fs.existsSync(path.join(dataRoot, "assets")), "nothing copied");
});

// ---------------------------------------------------------------- #47
test("#47 importMeta.sourceKra: basename .kra round-trips; separators / other extensions → 400 VALIDATION", async () => {
  const api = await startApi();
  try {
    const b = { ...billboardBody(runId("kra"), "kra"), importMeta: { source: "png_pipeline", sourceKra: "hero sheet v2.kra" } };
    const r = await post(api, b);
    assert.equal(r.status, 201);
    assert.equal((await r.json()).importMeta.sourceKra, "hero sheet v2.kra");
    for (const bad of ["art/hero.kra", "..\\hero.kra", "/abs/hero.kra", "hero.png", ".kra", "x".repeat(256) + ".kra"]) {
      const res = await post(api, { ...billboardBody(runId("kra-bad"), "kra-bad"), importMeta: { source: "png_pipeline", sourceKra: bad } });
      assert.equal(res.status, 400, bad);
      const j = await res.json();
      assert.equal(j.code, "VALIDATION");
      assert.ok(!JSON.stringify(j).includes("/abs/"), "input path never echoed");
    }
    const p = await patch(api, b.id, { importMeta: { sourceKra: "a/b.kra" } });
    assert.equal(p.status, 400);
  } finally {
    await api.stop();
  }
});

test("#47 register_asset sanitizeImportMeta keeps sourceKra (pack export/import carries importMeta whole)", () => {
  const src = fs.readFileSync(REGISTER, "utf8");
  assert.match(src, /out\.sourceKra = raw\.sourceKra/);
  assert.match(fs.readFileSync(path.join(ROOT, "apps/blender-pipeline/pack_assets.mjs"), "utf8"), /entry\.importMeta = a\.importMeta/);
  assert.match(fs.readFileSync(path.join(ROOT, "apps/blender-pipeline/import_pack.mjs"), "utf8"), /importMeta: meta\.importMeta/);
  assert.match(fs.readFileSync(path.join(ROOT, "apps/blender-pipeline/import_pack.mjs"), "utf8"), /clipRequires: meta\.clipRequires/);
});

// ---------------------------------------------------------------- #140
test("#140 featured: missing file = empty; PUT validates (shape/too_many/duplicate/unknown/not_scene); GET lists stale", async () => {
  const api = await startApi();
  try {
    assert.deepEqual(await (await fetch(`${api.url}/api/featured`)).json(), { sceneIds: [], scenes: [] });
    const child = billboardBody(runId("feat-child"), "feat-child");
    assert.equal((await post(api, child)).status, 201);
    const s1 = sceneBody("feat-s1", child.id);
    const s2 = sceneBody("feat-s2", child.id);
    for (const s of [s1, s2]) assert.equal((await post(api, s)).status, 201);

    const bad = [
      [{ sceneIds: "x" }, "shape"],
      [{}, "shape"],
      [{ sceneIds: Array.from({ length: 21 }, (_, i) => `id${i}`) }, "too_many"],
      [{ sceneIds: [s1.id, s1.id] }, "duplicate"],
      [{ sceneIds: [s1.id, "nope"] }, "unknown"],
      [{ sceneIds: [child.id] }, "not_scene"],
    ];
    for (const [body, reason] of bad) {
      const r = await put(api, body);
      const j = await r.json();
      assert.equal(r.status, 400, reason);
      assert.equal(j.code, "FEATURED_INVALID");
      assert.equal(j.reason, reason);
      assert.ok(Array.isArray(j.invalid));
    }
    assert.deepEqual((await (await put(api, { sceneIds: [s1.id] })).json()).invalid, undefined);
    let r = await put(api, { sceneIds: [s2.id, s1.id] });
    assert.equal(r.status, 200);
    const onDisk = JSON.parse(fs.readFileSync(path.join(api.dataRoot, "featured.json"), "utf8"));
    assert.deepEqual(onDisk, { sceneIds: [s2.id, s1.id] });
    assert.deepEqual(fs.readdirSync(api.dataRoot).filter((f) => f.endsWith(".tmp")), [], "atomic write leaves no tmp");
    let g = await (await fetch(`${api.url}/api/featured`)).json();
    assert.deepEqual(g.scenes.map((s) => s.id), [s2.id, s1.id]);
    assert.equal(g.scenes[0].slug, "feat-s2");
    assert.equal(g.stale, undefined);

    assert.equal((await fetch(`${api.url}/api/assets/${s2.id}`, { method: "DELETE" })).status, 204);
    g = await (await fetch(`${api.url}/api/featured`)).json();
    assert.deepEqual(g.sceneIds, [s2.id, s1.id]);
    assert.deepEqual(g.scenes.map((s) => s.id), [s1.id]);
    assert.deepEqual(g.stale, [s2.id]);

    fs.writeFileSync(path.join(api.dataRoot, "featured.json"), "{corrupt");
    r = await fetch(`${api.url}/api/featured`);
    assert.equal(r.status, 200, "corrupt file never 500s");
    assert.deepEqual((await r.json()).sceneIds, []);
  } finally {
    await api.stop();
  }
});

test("#140 PUT /api/featured is rate-limited (mutation limiter); GET is not", async () => {
  const api = await startApi({ RATE_LIMIT_PER_MIN: "1" });
  try {
    assert.equal((await put(api, { sceneIds: [] })).status, 200);
    const r = await put(api, { sceneIds: [] });
    assert.equal(r.status, 429);
    assert.equal((await r.json()).code, "RATE_LIMITED");
    for (let i = 0; i < 3; i++) assert.equal((await fetch(`${api.url}/api/featured`)).status, 200);
  } finally {
    await api.stop();
  }
});

// ---------------------------------------------------------------- #85
test("#85 PUBLIC_BASE_URL: health share.baseUrl (null when unset); bad values → CONFIG_INVALID (value not echoed)", async () => {
  let api = await startApi();
  try {
    assert.deepEqual((await (await fetch(`${api.url}/api/health`)).json()).share, { baseUrl: null });
  } finally {
    await api.stop();
  }
  api = await startApi({ PUBLIC_BASE_URL: "https://world.example.com/" });
  try {
    assert.deepEqual((await (await fetch(`${api.url}/api/health`)).json()).share, { baseUrl: "https://world.example.com" });
  } finally {
    await api.stop();
  }
  for (const v of ["ftp://x.example", "world.example.com", "https://x.example/sekrit", "https://x.example/?q=1", "https://x.example#h", "https://u:p@x.example"]) {
    const r = spawnSync(process.execPath, [SERVER], {
      env: { ...process.env, PORT: "1", MONGO_URI: "mongodb://127.0.0.1:1", PUBLIC_BASE_URL: v },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(r.status, 1, v);
    assert.match(r.stderr.trim(), /^\[world-builder\] FATAL CONFIG_INVALID: PUBLIC_BASE_URL /);
    assert.ok(!r.stderr.includes(v), "value not echoed");
  }
});

test("#85/#140/#11 client helpers: share URL, loopback hint, featured stepping, requires toggles/messages", async () => {
  const S = await loadClientTs("apps/world-builder/client/src/s3fShare.ts");
  assert.equal(S.shareUrl("https://w.example/", "scene", "a b"), "https://w.example/?scene=a%20b");
  for (const u of ["http://localhost:5174/?asset=x", "http://127.0.0.1/", "http://[::1]:8788/"]) assert.equal(S.isLoopbackUrl(u), true, u);
  assert.equal(S.isLoopbackUrl("https://w.example/?asset=x"), false);
  assert.equal(S.stepIndex(0, -1, 3), 2);
  assert.equal(S.stepIndex(2, 1, 3), 0);
  assert.deepEqual(S.moveItem(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(S.moveItem(["a", "b"], 0, -1), ["a", "b"]);
  assert.equal(S.requiresCaption({ run: ["walk", "idle"] }, "run"), "needs: walk, idle");
  assert.equal(S.requiresCaption({}, "run"), "");
  assert.deepEqual(S.toggleRequire({}, "run", "walk"), { run: ["walk"] });
  assert.deepEqual(S.toggleRequire({ run: ["walk"] }, "run", "walk"), {});
  assert.deepEqual(S.toggleRequire({}, "run", "run"), {}, "never itself");
  const eight = ["a", "b", "c", "d", "e", "f", "g", "h"];
  assert.deepEqual(S.toggleRequire({ run: eight }, "run", "z"), { run: eight }, "max 8");
  assert.deepEqual(S.clipRequiresIssue({ code: "CLIP_REQUIRES_CYCLE", cycle: ["a", "b", "a"] }), { message: "Circular requirement: a → b → a", clips: ["a", "b"] });
  assert.deepEqual(S.clipRequiresIssue({ code: "CLIP_REQUIRES_MISSING", clip: "run", missing: ["fly"] }).clips, ["run"]);
});

test("#85 QR: bundled lib (no CDN, no fetch in the QR module); matrix is a square of QR size", () => {
  const src = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/s3fQr.ts"), "utf8");
  assert.match(src, /from "qrcode-generator"/);
  assert.doesNotMatch(src, /fetch\(|https?:\/\//);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "apps/world-builder/client/package.json"), "utf8"));
  assert.ok(pkg.dependencies["qrcode-generator"], "bundled dependency");
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, "apps/world-builder/client/index.html"), "utf8"), /qrcode|unpkg|jsdelivr|cdnjs/i);
  const qrcode = createRequire(path.join(ROOT, "apps/world-builder/client/package.json"))("qrcode-generator");
  const q = qrcode(0, "M");
  q.addData("https://world.example.com/?scene=0b7f2c1e-6a1d-4c33-9a39-1d1e0c3a9f10", "Byte");
  q.make();
  const n = q.getModuleCount();
  assert.ok(n >= 21 && (n - 17) % 4 === 0, `valid QR size ${n}`);
});

test("E2 gitignore: featured.json (+ tmp) never tracked", () => {
  const r = spawnSync("git", ["check-ignore", "data/featured.json", "data/featured.json.123.456.tmp"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim().split("\n").length, 2);
});
