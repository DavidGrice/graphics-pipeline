/**
 * S2-G — slug resolve (V4/V4a) + jump honesty + scene authoring fixtures
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  validateSceneChildren,
  pickResolvedAsset,
} from "../apps/world-builder/server/src/sceneResolve.js";
import { safeParseAsset, previewPathFor } from "../packages/asset-schema/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BILLBOARD_ID = "550e8400-e29b-41d4-a716-4466554400b1";
const RIGGED_ID = "550e8400-e29b-41d4-a716-4466554400b2";
const RIGGED_B_ID = "550e8400-e29b-41d4-a716-4466554400b9";
const SCENE_CHILD_ID = "550e8400-e29b-41d4-a716-4466554400b3";
const SCENE_ID = "550e8400-e29b-41d4-a716-4466554400bb";

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
      clips: ["idle", "walk", "run", "jump"],
    },
  ],
  [
    RIGGED_B_ID,
    {
      id: RIGGED_B_ID,
      slug: "npc-rigged", // intentional duplicate slug → V4a
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
]);

async function resolveDoc(idOrSlug) {
  if (store.has(idOrSlug)) return store.get(idOrSlug);
  for (const doc of store.values()) {
    if (doc.slug === idOrSlug) return doc; // first-match (legacy); resolveAll covers V4a
  }
  return null;
}

async function resolveAll(idOrSlug) {
  const out = [];
  for (const doc of store.values()) {
    if (doc.id === idOrSlug || doc.slug === idOrSlug) out.push(doc);
  }
  return out;
}

test("E1 pickResolvedAsset: unique slug OK", () => {
  const r = pickResolvedAsset("bench-billboard", [store.get(BILLBOARD_ID)]);
  assert.ok("doc" in r);
  assert.equal(r.doc.id, BILLBOARD_ID);
});

test("E1 pickResolvedAsset: ambiguous slug → V4a", () => {
  const r = pickResolvedAsset("npc-rigged", [
    store.get(RIGGED_ID),
    store.get(RIGGED_B_ID),
  ]);
  assert.ok("error" in r);
  assert.match(r.error, /V4a|ambiguous/i);
});

test("E1: child assetId accepts unique slug", async () => {
  // Temporarily drop duplicate so slug is unique
  store.delete(RIGGED_B_ID);
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: "bench-billboard" }],
    resolveDoc,
    { resolveAll },
  );
  assert.equal(err, null);
  store.set(RIGGED_B_ID, {
    id: RIGGED_B_ID,
    slug: "npc-rigged",
    stage: "rigged",
    clips: ["idle", "walk", "run"],
  });
});

test("E1: unknown slug still V4 rejects", async () => {
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: "no-such-slug" }],
    resolveDoc,
    { resolveAll },
  );
  assert.ok(err);
  assert.match(err, /unknown assetId/);
});

test("E1: ambiguous slug V4a rejects", async () => {
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: "npc-rigged" }],
    resolveDoc,
    { resolveAll },
  );
  assert.ok(err);
  assert.match(err, /V4a|ambiguous/i);
});

test("E1: normalize rewrites slug → canonical id", async () => {
  store.delete(RIGGED_B_ID);
  const nodes = [{ id: "n0", assetId: "bench-billboard" }];
  const err = await validateSceneChildren(nodes, resolveDoc, {
    resolveAll,
    normalize: true,
  });
  assert.equal(err, null);
  assert.equal(nodes[0].assetId, BILLBOARD_ID);
  store.set(RIGGED_B_ID, {
    id: RIGGED_B_ID,
    slug: "npc-rigged",
    stage: "rigged",
    clips: ["idle", "walk", "run"],
  });
});

test("E1 regress: nested scene still V5", async () => {
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: SCENE_CHILD_ID }],
    resolveDoc,
    { resolveAll },
  );
  assert.ok(err);
  assert.match(err, /nested stage=scene/);
});

test("E3: dishonest jump on billboard rejects", () => {
  const doc = {
    id: "550e8400-e29b-41d4-a716-4466554400c1",
    slug: "billboard-jump-lie",
    name: "lie",
    characterType: "billboard",
    stage: "mvp-billboard",
    tags: ["sprint2g"],
    clips: ["spin", "jump"],
    formats: {
      preview: previewPathFor("550e8400-e29b-41d4-a716-4466554400c1"),
      glb: "assets/550e8400-e29b-41d4-a716-4466554400c1/model.glb",
    },
    rig: { hasArmature: false, hasWeights: false },
    createdAt: "2026-10-25T04:00:00.000Z",
    updatedAt: "2026-10-25T04:00:00.000Z",
  };
  const r = safeParseAsset(doc);
  assert.equal(r.success, false);
  assert.match(
    r.error.issues.map((i) => i.message).join("; "),
    /jump/i,
  );
});

test("E3: V6b defaultClip=jump when child lacks jump rejects", async () => {
  store.delete(RIGGED_B_ID);
  // npc without jump
  store.set(RIGGED_ID, {
    id: RIGGED_ID,
    slug: "npc-rigged",
    stage: "rigged",
    clips: ["idle", "walk", "run"],
  });
  const err = await validateSceneChildren(
    [{ id: "n0", assetId: RIGGED_ID, defaultClip: "jump" }],
    resolveDoc,
    { resolveAll },
  );
  assert.ok(err);
  assert.match(err, /defaultClip/);
  // restore
  store.set(RIGGED_ID, {
    id: RIGGED_ID,
    slug: "npc-rigged",
    stage: "rigged",
    clips: ["idle", "walk", "run", "jump"],
  });
  store.set(RIGGED_B_ID, {
    id: RIGGED_B_ID,
    slug: "npc-rigged",
    stage: "rigged",
    clips: ["idle", "walk", "run"],
  });
});

test("E3: rigged with idle+walk+run+jump accepts", () => {
  const id = "550e8400-e29b-41d4-a716-4466554400c2";
  const doc = {
    id,
    slug: "npc-with-jump",
    name: "npc",
    characterType: "unknown",
    stage: "rigged",
    tags: ["sprint2g"],
    clips: ["idle", "walk", "run", "jump"],
    formats: {
      preview: previewPathFor(id),
      glb: `assets/${id}/model.glb`,
    },
    rig: { hasArmature: true, hasWeights: true },
    createdAt: "2026-10-25T04:00:00.000Z",
    updatedAt: "2026-10-25T04:00:00.000Z",
  };
  const r = safeParseAsset(doc);
  assert.equal(r.success, true, r.success ? "" : r.error.message);
});

test("E3: clipUx.defaultClip=jump not in clips rejects", () => {
  const id = "550e8400-e29b-41d4-a716-4466554400c3";
  const doc = {
    id,
    slug: "clipux-jump-lie",
    name: "lie",
    characterType: "unknown",
    stage: "rigged",
    tags: ["sprint2g"],
    clips: ["idle", "walk", "run"],
    clipUx: { defaultClip: "jump" },
    formats: {
      preview: previewPathFor(id),
      glb: `assets/${id}/model.glb`,
    },
    rig: { hasArmature: true, hasWeights: true },
    createdAt: "2026-10-25T04:00:00.000Z",
    updatedAt: "2026-10-25T04:00:00.000Z",
  };
  const r = safeParseAsset(doc);
  assert.equal(r.success, false);
  assert.match(
    r.error.issues.map((i) => i.message).join("; "),
    /jump|defaultClip|clips/i,
  );
});

test("E2 fixture: authoring scene with ≥2 nodes", () => {
  const fixturePath = path.join(__dirname, "fixtures/s2g-scene-author.json");
  assert.ok(existsSync(fixturePath), "fixture missing");
  const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.equal(raw.stage, "scene");
  assert.ok(raw.scene.nodes.length >= 2);
  assert.ok(raw.scene.nodes.every((n) => n.assetId));
});

test("docs folded: R1/D1/D2 present", () => {
  const root = path.join(__dirname, "..");
  for (const rel of [
    "docs/sprint2g-brief.md",
    "docs/sprint2g-d1-scene-authoring-wire.md",
    "docs/sprint2g-d2-jump-allowlist.md",
    "docs/s2g-scene-LIMITS.md",
  ]) {
    assert.ok(existsSync(path.join(root, rel)), `missing ${rel}`);
  }
});
