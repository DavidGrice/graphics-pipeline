/**
 * S2-D-E3 — characterType humanoid honesty gates
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeParseAsset,
  isContractClipName,
  glbPathFor,
  previewPathFor,
} from "../packages/asset-schema/dist/index.js";

const base = {
  id: "550e8400-e29b-41d4-a716-446655440099",
  slug: "mixamo-hero",
  name: "Mixamo Hero",
  stage: "rigged",
  tags: [],
  clips: ["idle", "walk", "run"],
  formats: {
    glb: glbPathFor("550e8400-e29b-41d4-a716-446655440099"),
    preview: previewPathFor("550e8400-e29b-41d4-a716-446655440099"),
  },
  rig: { hasArmature: true, hasWeights: true },
  createdAt: "2026-10-25T01:00:00.000Z",
  updatedAt: "2026-10-25T01:00:00.000Z",
};

test("E3: isContractClipName allowlist + emote_*", () => {
  assert.equal(isContractClipName("idle"), true);
  assert.equal(isContractClipName("run"), true);
  assert.equal(isContractClipName("emote_wave"), true);
  assert.equal(isContractClipName("IdlePose"), false);
  assert.equal(isContractClipName("emote_"), false);
});

test("E3: dishonest humanoid on png_pipeline rejects", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "humanoid",
    importMeta: { source: "png_pipeline" },
  });
  assert.equal(r.success, false);
  const msg = r.error.issues.map((i) => i.message).join(" ");
  assert.match(msg, /humanoid/i);
});

test("E3: dishonest humanoid without importMeta rejects", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "humanoid",
  });
  assert.equal(r.success, false);
});

test("E3: dishonest humanoid source=unknown without stub rejects", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "humanoid",
    importMeta: { source: "unknown" },
  });
  assert.equal(r.success, false);
});

test("E3: honest mixamo humanoid accepts", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "humanoid",
    importMeta: {
      source: "mixamo",
      actionMap: { Idle: "idle", Walking: "walk", Running: "run" },
      boneMapStub: "mixamo-biped-stub",
      characterTypeHint: "humanoid",
    },
  });
  assert.equal(r.success, true);
});

test("E3: honest fbx humanoid with boneMapStub accepts", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "humanoid",
    importMeta: {
      source: "fbx",
      boneMapStub: "generic-biped",
      characterTypeHint: "humanoid",
    },
  });
  assert.equal(r.success, true);
});

test("E3: humanoidPngApproved allows png_pipeline humanoid", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "humanoid",
    importMeta: {
      source: "png_pipeline",
      humanoidPngApproved: true,
    },
  });
  assert.equal(r.success, true);
});

test("E3: prop with png_pipeline still accepts (conservative)", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "prop",
    importMeta: { source: "png_pipeline" },
  });
  assert.equal(r.success, true);
});

test("E3: billboard + stage rigged rejects", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "billboard",
  });
  assert.equal(r.success, false);
});

test("E3: bad actionMap value rejects", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "prop",
    importMeta: {
      source: "mixamo",
      actionMap: { Idle: "IdlePose" },
    },
  });
  assert.equal(r.success, false);
});

test("E3: humanoid missing idle/walk rejects", () => {
  const r = safeParseAsset({
    ...base,
    characterType: "humanoid",
    clips: ["run", "jump", "wave"],
    importMeta: { source: "mixamo" },
  });
  assert.equal(r.success, false);
});
