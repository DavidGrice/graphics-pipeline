/**
 * S3-C-E4 — #19 multi-armature reject · #21 CharacterType badge · OpenAPI honest content-type.
 * No :8787 needed: OpenAPI routes mounted on an ephemeral Express app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  probeGlb,
  countArmatures,
  assertSingleArmature,
  MULTI_ARMATURE,
} from "../apps/blender-pipeline/probe_glb.mjs";
import { safeParseAsset, glbPathFor, previewPathFor } from "../packages/asset-schema/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "apps/world-builder/package.json"));

/** Minimal GLB (JSON chunk only) from a glTF JSON object. */
function glbFromJson(json) {
  let body = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (4 - (body.length % 4)) % 4;
  body = Buffer.concat([body, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "utf8");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + body.length, 8);
  header.writeUInt32LE(body.length, 12);
  header.write("JSON", 16, "utf8");
  return Buffer.concat([header, body]);
}

const ANIMS = ["idle", "walk", "run"].map((name) => ({ name, samplers: [], channels: [] }));
const mesh = { primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } }] };

/** Blender-shaped: Armature node → [mesh, rootBone→tip]. */
const oneArmature = {
  asset: { version: "2.0" },
  nodes: [
    { name: "tip" },
    { name: "root", children: [0] },
    { name: "PngPlane", mesh: 0, skin: 0 },
    { name: "Armature", children: [2, 1] },
  ],
  skins: [{ joints: [1, 0], name: "Armature" }],
  meshes: [mesh],
  animations: ANIMS,
  scenes: [{ nodes: [3] }],
};

const twoArmatures = {
  asset: { version: "2.0" },
  nodes: [
    { name: "tip" },
    { name: "root", children: [0] },
    { name: "PlaneA", mesh: 0, skin: 0 },
    { name: "ArmatureA", children: [2, 1] },
    { name: "tipB" },
    { name: "rootB", children: [4] },
    { name: "PlaneB", mesh: 0, skin: 1 },
    { name: "ArmatureB", children: [6, 5] },
  ],
  skins: [
    { joints: [1, 0], name: "ArmatureA" },
    { joints: [5, 4], name: "ArmatureB" },
  ],
  meshes: [mesh],
  animations: ANIMS,
  scenes: [{ nodes: [3, 7] }],
};

test("T1.6 #19 countArmatures: 0 billboard / 1 rig / 2 rigs / shared armature counts once", () => {
  assert.equal(countArmatures({ nodes: [{ name: "Plane", mesh: 0 }] }), 0);
  assert.equal(countArmatures(oneArmature), 1);
  assert.equal(countArmatures(twoArmatures), 2);
  const shared = structuredClone(oneArmature);
  shared.skins.push({ joints: [1, 0], name: "Armature.001" });
  assert.equal(countArmatures(shared), 1, "two skins bound to one armature = one armature");
  const explicit = structuredClone(twoArmatures);
  explicit.skins[0].skeleton = 3;
  explicit.skins[1].skeleton = 7;
  assert.equal(countArmatures(explicit), 2);
});

test("T1.6 #19 assertSingleArmature + schema refinement reject with MULTI_ARMATURE", () => {
  assert.doesNotThrow(() => assertSingleArmature({ armatureCount: 1 }));
  assert.doesNotThrow(() => assertSingleArmature({ armatureCount: 0 }));
  assert.throws(
    () => assertSingleArmature({ armatureCount: 2 }),
    (e) => e.code === MULTI_ARMATURE && /one armature per GLB \(got 2\)/.test(e.message),
  );
  const id = "550e8400-e29b-41d4-a716-4466554400c1";
  const base = {
    id,
    slug: "s3c-multi",
    name: "multi",
    characterType: "prop",
    stage: "rigged",
    tags: [],
    clips: ["idle", "walk", "run"],
    formats: { glb: glbPathFor(id), preview: previewPathFor(id) },
    rig: { hasArmature: true, hasWeights: true, boneCount: 2, armatureCount: 1 },
    createdAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
  assert.equal(safeParseAsset(base).success, true);
  const bad = safeParseAsset({ ...base, rig: { ...base.rig, armatureCount: 2 } });
  assert.equal(bad.success, false);
  assert.ok(bad.error.issues.some((i) => i.message.startsWith("MULTI_ARMATURE")));
});

test("T1.6 #19 register_asset rejects multi-armature GLB before copy/POST", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-s3c-arm-"));
  try {
    const multi = path.join(dir, "multi.glb");
    fs.writeFileSync(multi, glbFromJson(twoArmatures));
    assert.equal(probeGlb(multi).armatureCount, 2);
    const id = "550e8400-e29b-41d4-a716-4466554400c2";
    const r = spawnSync(
      process.execPath,
      ["apps/blender-pipeline/register_asset.mjs", "--id", id, "--glb", multi, "--api", "http://127.0.0.1:9"],
      { cwd: ROOT, encoding: "utf8" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /MULTI_ARMATURE: one armature per GLB \(got 2\)/);
    assert.ok(!fs.existsSync(path.join(ROOT, "data", "assets", id)), "no data written on reject");

    const single = path.join(dir, "single.glb");
    fs.writeFileSync(single, glbFromJson(oneArmature));
    assert.equal(probeGlb(single).armatureCount, 1);
    // demo billboard GLB: zero armatures
    const demo = path.join(dir, "demo.glb");
    execFileSync(process.execPath, ["apps/blender-pipeline/make_demo_glb.mjs", demo], { cwd: ROOT });
    assert.equal(probeGlb(demo).armatureCount, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("T1.6 #21 CharacterType badge: mapping + wired into register list", async () => {
  const ts = require("typescript");
  const src = path.join(ROOT, "apps/world-builder/client/src/characterTypeBadge.ts");
  const out = ts.transpileModule(fs.readFileSync(src, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-s3c-badge-"));
  try {
    const mod = path.join(dir, "badge.mjs");
    fs.writeFileSync(mod, out);
    const { characterTypeBadge } = await import(pathToFileURL(mod).href);
    assert.deepEqual(characterTypeBadge({ characterType: "humanoid" }), { label: "Humanoid", tone: "accent" });
    assert.deepEqual(characterTypeBadge({ characterType: "prop" }), { label: "Prop", tone: "neutral" });
    assert.deepEqual(characterTypeBadge({ characterType: "unknown" }), { label: "Unknown", tone: "muted" });
    assert.deepEqual(characterTypeBadge({}), { label: "Unknown", tone: "muted" });
    assert.deepEqual(characterTypeBadge({ stage: "scene", characterType: "humanoid" }), {
      label: "Scene",
      tone: "scene",
    });
    // never from importMeta hint
    assert.equal(
      characterTypeBadge({ characterType: "prop", importMeta: { characterTypeHint: "humanoid" } }).label,
      "Prop",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const app = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  assert.match(app, /import \{ characterTypeBadge \} from "\.\/characterTypeBadge"/);
  const list = app.slice(app.indexOf('className="asset-list"'), app.indexOf("Register asset"));
  assert.match(list, /characterTypeBadge\(a\)/, "badge rendered per register-list row");
  assert.match(list, /data-testid="ctype-badge"/);
});

test("T1.3 OpenAPI: /api/openapi.json = JSON application/json; /api/openapi.yaml = YAML application/yaml", async () => {
  const express = require("express");
  const { registerOpenApiRoutes } = await import(
    pathToFileURL(path.join(ROOT, "apps/world-builder/server/src/openapi.js")).href
  );
  const app = express();
  registerOpenApiRoutes(app, ROOT);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const j = await fetch(`${base}/api/openapi.json`);
    assert.equal(j.status, 200);
    assert.match(j.headers.get("content-type"), /^application\/json/);
    const doc = JSON.parse(await j.text());
    assert.match(doc.openapi, /^3\.0/);
    assert.ok(doc.paths["/api/health"]);
    assert.ok(doc.paths["/api/assets"]);
    assert.ok(doc.paths["/api/openapi.json"]);
    assert.ok(doc.paths["/api/openapi.yaml"]);

    const y = await fetch(`${base}/api/openapi.yaml`);
    assert.equal(y.status, 200);
    assert.match(y.headers.get("content-type"), /^application\/yaml/);
    const yamlText = await y.text();
    assert.equal(yamlText, fs.readFileSync(path.join(ROOT, "docs/openapi.yaml"), "utf8"));
    assert.throws(() => JSON.parse(yamlText), "YAML route must not pretend to be JSON");
  } finally {
    await new Promise((r) => server.close(r));
  }
  const serverSrc = fs.readFileSync(path.join(ROOT, "apps/world-builder/server/src/index.js"), "utf8");
  assert.doesNotMatch(serverSrc, /type\("text\/yaml"\)/, "no YAML-as-.json lie left in index.js");
  assert.match(serverSrc, /registerOpenApiRoutes\(app, REPO_ROOT\)/);
});

// ---------------- tip2 R1 HARDEN ----------------
test("T1.6 #19 HARDEN: armatureCount must be 1 when hasArmature, 0 when not; shared root = one", () => {
  const id = "550e8400-e29b-41d4-a716-4466554400c3";
  const base = {
    id,
    slug: "s3c-armcount",
    name: "armcount",
    characterType: "prop",
    stage: "rigged",
    tags: [],
    clips: ["idle", "walk", "run"],
    formats: { glb: glbPathFor(id), preview: previewPathFor(id) },
    rig: { hasArmature: true, hasWeights: true, boneCount: 2, armatureCount: 1 },
    createdAt: "2026-10-29T00:00:00.000Z",
    updatedAt: "2026-10-29T00:00:00.000Z",
  };
  assert.equal(safeParseAsset(base).success, true);
  const zero = safeParseAsset({ ...base, rig: { ...base.rig, armatureCount: 0 } });
  assert.equal(zero.success, false);
  assert.ok(zero.error.issues.some((i) => /ARMATURE_COUNT/.test(i.message)));
  const bb = {
    ...base,
    characterType: "billboard",
    stage: "mvp-billboard",
    clips: ["spin"],
    rig: { hasArmature: false, hasWeights: false, armatureCount: 1 },
  };
  assert.equal(safeParseAsset(bb).success, false, "billboard claiming an armature rejects");
  assert.equal(safeParseAsset({ ...bb, rig: { hasArmature: false, hasWeights: false, armatureCount: 0 } }).success, true);
  // shared skeleton root (explicit skeleton field) across 3 skins = 1
  const shared = structuredClone(oneArmature);
  shared.skins = [0, 1, 2].map((k) => ({ joints: [1, 0], skeleton: 1, name: `s${k}` }));
  assert.equal(countArmatures(shared), 1);
});

test("T1.3 OpenAPI HARDEN: info.version 0.4.0; spec paths+methods ≡ Express routes (no phantoms)", async () => {
  const { loadOpenApi } = await import(
    pathToFileURL(path.join(ROOT, "apps/world-builder/server/src/openapi.js")).href
  );
  const { json } = loadOpenApi(ROOT);
  assert.equal(json.info.version, "0.4.0");
  const METHODS = ["get", "post", "put", "patch", "delete"];
  const spec = new Set();
  for (const [p, ops] of Object.entries(json.paths)) {
    for (const m of Object.keys(ops)) if (METHODS.includes(m)) spec.add(`${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ":$1")}`);
  }
  const src = fs.readFileSync(path.join(ROOT, "apps/world-builder/server/src/index.js"), "utf8");
  const routes = new Set();
  for (const m of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) routes.add(`${m[1].toUpperCase()} ${m[2]}`);
  const oa = fs.readFileSync(path.join(ROOT, "apps/world-builder/server/src/openapi.js"), "utf8");
  for (const m of oa.matchAll(/app\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) routes.add(`${m[1].toUpperCase()} ${m[2]}`);
  assert.deepEqual([...spec].sort(), [...routes].sort());
});

test("T1.6 #19 soft-env :8787 POST armatureCount 2 → 400 MULTI_ARMATURE", async (t) => {
  const API = process.env.WORLD_API || "http://127.0.0.1:8787";
  try {
    if (!(await fetch(`${API}/api/health`)).ok) throw new Error("down");
  } catch {
    t.skip("world-builder not listening on :8787 (soft-env)");
    return;
  }
  const id = "550e8400-e29b-41d4-a716-4466554400c4";
  const r = await fetch(`${API}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      slug: "s3c-multi-post",
      name: "multi",
      characterType: "prop",
      stage: "rigged",
      tags: [],
      clips: ["idle", "walk", "run"],
      formats: { glb: glbPathFor(id), preview: previewPathFor(id) },
      rig: { hasArmature: true, hasWeights: true, boneCount: 4, armatureCount: 2 },
      createdAt: "2026-10-29T00:00:00.000Z",
      updatedAt: "2026-10-29T00:00:00.000Z",
    }),
  });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /MULTI_ARMATURE/);
  const g = await fetch(`${API}/api/assets/${id}`);
  assert.equal(g.status, 404, "rejected asset not stored");
});
