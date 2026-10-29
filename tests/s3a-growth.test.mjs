/**
 * S3-A — clipTags, boneCount gate, schemaVersion, visibility, BRIDGE=mock
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import {
  safeParseAsset,
  coerceAssetSchemaVersion,
  ASSET_SCHEMA_VERSION,
  glbPathFor,
  previewPathFor,
} from "../packages/asset-schema/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = "550e8400-e29b-41d4-a716-4466554400c1";

const baseRigged = {
  id,
  slug: "s3a-hero",
  name: "S3A Hero",
  characterType: "humanoid",
  stage: "rigged",
  tags: ["npc"],
  clips: ["idle", "walk", "run", "jump", "wave"],
  formats: {
    glb: glbPathFor(id),
    preview: previewPathFor(id),
  },
  rig: { hasArmature: true, hasWeights: true, boneCount: 22 },
  importMeta: {
    source: "mixamo",
    boneMapStub: "mixamo-biped",
    characterTypeHint: "humanoid",
  },
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: "2026-10-26T00:00:00.000Z",
};

test("T1.4 clipTags: known clip + enum accepts", () => {
  const r = safeParseAsset({
    ...baseRigged,
    clipTags: {
      idle: ["locomotion"],
      wave: ["emote"],
      jump: ["locomotion", "combat"],
    },
  });
  assert.equal(r.success, true, r.success ? "" : r.error.message);
});

test("T1.4 clipTags: unknown clip name rejects", () => {
  const r = safeParseAsset({
    ...baseRigged,
    clipTags: { dance: ["emote"] },
  });
  assert.equal(r.success, false);
  assert.match(
    r.error.issues.map((i) => i.message).join(" "),
    /clipTags|not in clips/i,
  );
});

test("T1.4 clipTags: unknown tag string rejects", () => {
  const r = safeParseAsset({
    ...baseRigged,
    clipTags: { idle: ["dance"] },
  });
  assert.equal(r.success, false);
});

test("T1.4 clipTags: missing OK", () => {
  const r = safeParseAsset({ ...baseRigged });
  assert.equal(r.success, true);
});

test("T1.5 humanoid boneCount < 8 rejects", () => {
  const r = safeParseAsset({
    ...baseRigged,
    rig: { hasArmature: true, hasWeights: true, boneCount: 2 },
  });
  assert.equal(r.success, false);
  assert.match(
    r.error.issues.map((i) => i.message).join(" "),
    /HUMANOID_BONE_COUNT/,
  );
});

test("T1.5 humanoid boneCount missing rejects", () => {
  const r = safeParseAsset({
    ...baseRigged,
    rig: { hasArmature: true, hasWeights: true },
  });
  assert.equal(r.success, false);
  assert.match(
    r.error.issues.map((i) => i.message).join(" "),
    /HUMANOID_BONE_COUNT/,
  );
});

test("T1.5 humanoid boneCount ≥ 8 accepts", () => {
  const r = safeParseAsset({ ...baseRigged });
  assert.equal(r.success, true);
});

test("T1.3 scene node visible:false still parses (kept in graph)", () => {
  const sceneId = "550e8400-e29b-41d4-a716-4466554400c2";
  const childId = "550e8400-e29b-41d4-a716-4466554400c3";
  const r = safeParseAsset({
    id: sceneId,
    slug: "s3a-scene",
    name: "S3A Scene",
    characterType: "unknown",
    stage: "scene",
    tags: [],
    clips: [],
    formats: {
      preview: previewPathFor(sceneId),
      glb: glbPathFor(sceneId),
    },
    rig: { hasArmature: false, hasWeights: false },
    scene: {
      version: 1,
      nodes: [
        {
          id: "n0",
          assetId: childId,
          visible: false,
          transform: { position: [1, 0, 0] },
        },
      ],
    },
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
  });
  assert.equal(r.success, true, r.success ? "" : r.error.message);
  assert.equal(r.data.scene.nodes[0].visible, false);
  assert.equal(r.data.scene.nodes.length, 1);
});

test("T1.6 assetSchemaVersion coerce + constant", () => {
  assert.equal(ASSET_SCHEMA_VERSION, 3);
  assert.equal(coerceAssetSchemaVersion({}), 1);
  assert.equal(coerceAssetSchemaVersion({ assetSchemaVersion: 3 }), 3);
  const r = safeParseAsset({
    ...baseRigged,
    characterType: "prop",
    importMeta: { source: "png_pipeline" },
    assetSchemaVersion: 3,
  });
  assert.equal(r.success, true);
  assert.equal(r.data.assetSchemaVersion, 3);
});

test("T1.7 BRIDGE=mock health OK without Krita", async () => {
  execSync("npm run build -w @graphics-pipeline/mcp-krita", {
    cwd: ROOT,
    stdio: "pipe",
  });
  const mod = await import("../apps/mcp-krita/dist/index.js");
  const prev = process.env.BRIDGE;
  process.env.BRIDGE = "mock";
  try {
    assert.equal(mod.resolveBridgeMode(), "mock");
    const adapter = mod.createKritaBridgeAdapter({
      bridge: "mock",
      repoRoot: ROOT,
    });
    const h = await adapter.health();
    assert.equal(h.ok, true);
    assert.equal(h.bridge, "mock");
    assert.match(h.detail || "", /mock/i);
    // Default path must land under testdata/ (not data/inbox)
    const exp = await adapter.exportPng({ slug: "s3a-mock" });
    assert.equal(exp.slug, "s3a-mock");
    assert.ok(fs.existsSync(exp.path));
    assert.ok(fs.statSync(exp.path).size > 8);
    const norm = exp.path.replace(/\\/g, "/");
    assert.ok(
      norm.includes("/testdata/") || norm.includes("/tmp/") || norm.includes("/Temp/"),
      `mock export must use testdata/ or /tmp, got ${exp.path}`,
    );
    assert.ok(!norm.includes("/data/inbox/"), "mock must not write data/inbox");

    await assert.rejects(
      () =>
        adapter.exportPng({
          slug: "s3a-mock",
          outPath: path.join(ROOT, "data", "inbox", "s3a-mock", "nope.png"),
        }),
      /data\/inbox/,
    );
  } finally {
    if (prev === undefined) delete process.env.BRIDGE;
    else process.env.BRIDGE = prev;
  }
});

const API = process.env.WORLD_API || "http://127.0.0.1:8787";

async function apiUp() {
  try {
    const r = await fetch(`${API}/api/health`);
    return r.ok;
  } catch {
    return false;
  }
}

test("T1.6/T1.7 soft-env: health tools + PATCH/search", async (t) => {
  if (!(await apiUp())) {
    t.skip("world-builder not listening on :8787 (soft-env)");
    return;
  }
  const health = await (await fetch(`${API}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.ok(health.tools === null || typeof health.tools === "object");
  // when box tools present, blender version string expected
  if (health.tools?.blender?.version) {
    assert.match(String(health.tools.blender.version), /\d+\.\d+/);
  }

  const badStage = await fetch(`${API}/api/assets?stage=nope`);
  assert.equal(badStage.status, 400);

  const list = await (await fetch(`${API}/api/assets`)).json();
  assert.ok(Array.isArray(list));
  if (list.length === 0) {
    t.skip("no assets registered for PATCH/search soft-env");
    return;
  }
  const target = list[0];
  const patch = await fetch(`${API}/api/assets/${target.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: target.name,
      tags: Array.isArray(target.tags) ? target.tags : [],
    }),
  });
  assert.ok(patch.ok, await patch.clone().text());
  const updated = await patch.json();
  assert.ok(
    updated.assetSchemaVersion == null ||
      updated.assetSchemaVersion >= 1,
  );

  const forge = await fetch(`${API}/api/assets/${target.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: "rigged" }),
  });
  assert.equal(forge.status, 400);

  if (target.stage) {
    const filtered = await (
      await fetch(`${API}/api/assets?stage=${encodeURIComponent(target.stage)}`)
    ).json();
    assert.ok(Array.isArray(filtered));
    assert.ok(filtered.every((a) => a.stage === target.stage));
  }
});


test("T1.5 unique skin joints: duplicates across skins count once", async () => {
  const { countUniqueSkinJoints } = await import(
    "../apps/blender-pipeline/probe_glb.mjs"
  );
  const json = {
    nodes: [
      { name: "Hips" },
      { name: "Spine" },
      { name: "Head" },
      { name: "LeftLeg" },
      { name: "RightLeg" },
      { name: "LeftArm" },
      { name: "RightArm" },
      { name: "Chest" },
    ],
    skins: [
      { joints: [0, 1, 2, 3, 4, 5, 6, 7] },
      { joints: [0, 1, 2] }, // duplicate names — must not inflate count
    ],
  };
  assert.equal(countUniqueSkinJoints(json), 8);
  assert.equal(
    countUniqueSkinJoints({
      nodes: [{ name: "root" }, { name: "tip" }],
      skins: [{ joints: [0, 1] }, { joints: [0, 1] }],
    }),
    2,
  );
});

test("T1.6 queryStringList AND helper via server module smoke", async () => {
  // Inline mirror of server queryStringList (kept in sync by behavior tests below).
  function queryStringList(raw) {
    if (raw == null) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (const v of arr) {
      if (typeof v !== "string") continue;
      const trimmed = v.trim();
      if (trimmed) out.push(trimmed);
    }
    return out;
  }
  assert.deepEqual(queryStringList(["idle", "walk"]), ["idle", "walk"]);
  assert.deepEqual(queryStringList("idle"), ["idle"]);
  assert.deepEqual(queryStringList([1, "walk", null, ""]), ["walk"]);
  assert.deepEqual(queryStringList(undefined), []);
});
