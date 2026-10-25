/**
 * S2-F-E3 — scene compose resolve + fixtures
 * Unit tests hit validateSceneChildren (no :8787). Soft-env API cases skip when down.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateSceneChildren } from "../apps/world-builder/server/src/sceneResolve.js";
import { safeParseAsset, previewPathFor } from "../packages/asset-schema/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures/s2f-scene-compose.json");

const BILLBOARD_ID = "550e8400-e29b-41d4-a716-4466554400b1";
const RIGGED_ID = "550e8400-e29b-41d4-a716-4466554400b2";
const SCENE_CHILD_ID = "550e8400-e29b-41d4-a716-4466554400b3";
const SCENE_ID = "550e8400-e29b-41d4-a716-4466554400aa";

const store = new Map([
  [
    BILLBOARD_ID,
    {
      id: BILLBOARD_ID,
      slug: "bench-billboard",
      stage: "mvp-billboard",
      clips: ["spin"],
    },
  ],
  [
    RIGGED_ID,
    {
      id: RIGGED_ID,
      slug: "npc-rigged",
      stage: "rigged",
      clips: ["idle", "walk", "run"],
    },
  ],
  [
    SCENE_CHILD_ID,
    {
      id: SCENE_CHILD_ID,
      slug: "nested-scene",
      stage: "scene",
      clips: [],
    },
  ],
  [
    "corrupt-child",
    {
      id: "corrupt-child",
      slug: "corrupt",
      clips: ["idle"],
      // stage missing → V8
    },
  ],
]);

async function resolveDoc(idOrSlug) {
  if (store.has(idOrSlug)) return store.get(idOrSlug);
  for (const doc of store.values()) {
    if (doc.slug === idOrSlug) return doc;
  }
  return null;
}

test("E3 fixture shape: ≥2 nodes, transforms, JSON-only", () => {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.equal(raw.stage, "scene");
  assert.ok(Array.isArray(raw.scene.nodes));
  assert.ok(raw.scene.nodes.length >= 2);
  assert.ok(raw.scene.nodes[1].transform?.position);
  assert.equal(raw.scene.nodes[1].defaultClip, "idle");
});

test("V4: unknown assetId rejects", async () => {
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: "does-not-exist" }],
    resolveDoc,
  );
  assert.ok(err);
  assert.match(err, /unknown assetId/);
});

test("V4: valid ≥2 known children accept", async () => {
  const err = await validateSceneChildren(
    [
      { id: "n0", assetId: BILLBOARD_ID, transform: { position: [0, 0, 0] } },
      {
        id: "n1",
        assetId: RIGGED_ID,
        transform: { position: [2, 0, 0] },
        defaultClip: "idle",
      },
    ],
    resolveDoc,
  );
  assert.equal(err, null);
});

test("V4: slug resolve accepts when unique", async () => {
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: "bench-billboard" }],
    resolveDoc,
  );
  assert.equal(err, null);
});

test("V5: nested stage=scene child rejects", async () => {
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: SCENE_CHILD_ID }],
    resolveDoc,
  );
  assert.ok(err);
  assert.match(err, /nested stage=scene/);
});

test("V6b: dishonest defaultClip rejects", async () => {
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: RIGGED_ID, defaultClip: "fly" }],
    resolveDoc,
  );
  assert.ok(err);
  assert.match(err, /defaultClip/);
});

test("V6b: defaultClip on child with empty clips rejects", async () => {
  store.set("empty-clips", {
    id: "empty-clips",
    slug: "empty-clips",
    stage: "mvp-billboard",
    clips: [],
  });
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: "empty-clips", defaultClip: "spin" }],
    resolveDoc,
  );
  assert.ok(err);
  assert.match(err, /defaultClip/);
});

test("V8: missing/corrupt child stage rejects", async () => {
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: "corrupt-child" }],
    resolveDoc,
  );
  assert.ok(err);
  assert.match(err, /V8|corrupt|missing/i);
});

test("schema: valid scene stub with ≥2 nodes still accepts", () => {
  const doc = {
    id: SCENE_ID,
    slug: "courtyard-compose",
    name: "Courtyard Compose",
    characterType: "unknown",
    stage: "scene",
    tags: ["sprint2f"],
    clips: [],
    formats: {
      preview: previewPathFor(SCENE_ID),
      obj: `assets/${SCENE_ID}/placeholder.obj`,
    },
    rig: { hasArmature: false, hasWeights: false },
    createdAt: "2026-10-25T04:00:00.000Z",
    updatedAt: "2026-10-25T04:00:00.000Z",
    scene: {
      version: 1,
      rootId: "n0",
      nodes: [
        { id: "n0", assetId: BILLBOARD_ID, transform: { position: [0, 0, 0] } },
        {
          id: "n1",
          assetId: RIGGED_ID,
          transform: { position: [2, 0, 0] },
          defaultClip: "idle",
        },
      ],
    },
  };
  const r = safeParseAsset(doc);
  assert.equal(r.success, true, r.success ? "" : r.error.message);
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

test("soft-env API: V4 unknown reject when :8787 up", async (t) => {
  if (!(await apiUp())) {
    t.skip("world-builder not listening on :8787 (soft-env)");
    return;
  }
  const now = new Date().toISOString();
  const id = "550e8400-e29b-41d4-a716-4466554400f1";
  const r = await fetch(`${API}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id,
      slug: `s2f-unknown-${Date.now()}`,
      name: "s2f unknown child",
      characterType: "unknown",
      stage: "scene",
      tags: ["sprint2f"],
      clips: [],
      formats: {
        preview: previewPathFor(id),
        obj: `assets/${id}/placeholder.obj`,
      },
      rig: { hasArmature: false, hasWeights: false },
      createdAt: now,
      updatedAt: now,
      scene: {
        version: 1,
        nodes: [{ id: "n0", assetId: "00000000-0000-4000-8000-000000000000" }],
      },
    }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(String(body.error || ""), /unknown assetId/);
});
