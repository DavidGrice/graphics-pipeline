/**
 * S2-E-E3 — stage:scene stub schema honesty gates
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeParseAsset,
  previewPathFor,
} from "../packages/asset-schema/dist/index.js";

const sceneId = "550e8400-e29b-41d4-a716-4466554400aa";
const childId = "550e8400-e29b-41d4-a716-4466554400bb";

const baseScene = {
  id: sceneId,
  slug: "courtyard-demo",
  name: "Courtyard Demo",
  characterType: "unknown",
  stage: "scene",
  tags: ["sprint2e"],
  clips: [],
  formats: {
    // Scene stub still needs a preview path; glb optional at root
    preview: previewPathFor(sceneId),
    obj: `assets/${sceneId}/placeholder.obj`,
  },
  rig: { hasArmature: false, hasWeights: false },
  createdAt: "2026-10-25T01:30:00.000Z",
  updatedAt: "2026-10-25T01:30:00.000Z",
  scene: {
    version: 1,
    nodes: [{ id: "n0", assetId: childId }],
  },
};

test("E3: valid scene stub accepts", () => {
  const r = safeParseAsset(baseScene);
  assert.equal(r.success, true, r.success ? "" : r.error.message);
});

test("E3: scene without nodes rejects", () => {
  const r = safeParseAsset({
    ...baseScene,
    scene: { version: 1, nodes: [] },
  });
  assert.equal(r.success, false);
});

test("E3: scene missing scene graph rejects", () => {
  const { scene: _drop, ...rest } = baseScene;
  const r = safeParseAsset(rest);
  assert.equal(r.success, false);
});

test("E3: duplicate node ids reject", () => {
  const r = safeParseAsset({
    ...baseScene,
    scene: {
      version: 1,
      nodes: [
        { id: "n0", assetId: childId },
        { id: "n0", assetId: "other" },
      ],
    },
  });
  assert.equal(r.success, false);
});

test("E3: bad rootId rejects", () => {
  const r = safeParseAsset({
    ...baseScene,
    scene: {
      version: 1,
      nodes: [{ id: "n0", assetId: childId }],
      rootId: "missing",
    },
  });
  assert.equal(r.success, false);
});

test("E3: scene root claiming humanoid rejects", () => {
  const r = safeParseAsset({
    ...baseScene,
    characterType: "humanoid",
    importMeta: { source: "mixamo", boneMapStub: "x" },
    clips: ["idle", "walk"],
    formats: {
      glb: `assets/${sceneId}/model.glb`,
      preview: previewPathFor(sceneId),
    },
    rig: { hasArmature: true, hasWeights: true },
  });
  assert.equal(r.success, false);
});

test("E3: scene root with armature rejects", () => {
  const r = safeParseAsset({
    ...baseScene,
    rig: { hasArmature: true, hasWeights: false },
  });
  assert.equal(r.success, false);
});

test("E3: scene root with clips rejects", () => {
  const r = safeParseAsset({
    ...baseScene,
    clips: ["idle"],
    formats: {
      glb: `assets/${sceneId}/model.glb`,
      preview: previewPathFor(sceneId),
    },
  });
  assert.equal(r.success, false);
});

test("E3: scene graph on non-scene stage rejects", () => {
  const r = safeParseAsset({
    ...baseScene,
    stage: "mvp-billboard",
    characterType: "billboard",
  });
  assert.equal(r.success, false);
});
