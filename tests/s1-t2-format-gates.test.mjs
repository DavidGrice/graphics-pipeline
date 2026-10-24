/**
 * S1-T2 — Format gates against @graphics-pipeline/asset-schema
 * clips require glb OR fbx; OBJ static-only
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeParseAsset,
  glbPathFor,
  previewPathFor,
  inboxPngPattern,
} from "../packages/asset-schema/dist/index.js";

const base = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  slug: "hero-billboard",
  name: "Hero Billboard",
  characterType: "billboard",
  stage: "mvp-billboard",
  tags: [],
  createdAt: "2026-10-24T19:00:00.000Z",
  updatedAt: "2026-10-24T19:00:00.000Z",
};

test("T2: animated asset with GLB + clips passes", () => {
  const r = safeParseAsset({
    ...base,
    clips: ["spin"],
    formats: {
      glb: glbPathFor(base.id),
      preview: previewPathFor(base.id),
    },
    rig: { hasArmature: false, hasWeights: false },
  });
  assert.equal(r.success, true);
});

test("T2: animated asset with FBX-only + clips passes", () => {
  const r = safeParseAsset({
    ...base,
    clips: ["spin"],
    formats: {
      fbx: `assets/${base.id}/model.fbx`,
      preview: previewPathFor(base.id),
    },
    rig: { hasArmature: true, hasWeights: true },
  });
  assert.equal(r.success, true);
});

test("T2: clips without glb and fbx hard-fails", () => {
  const r = safeParseAsset({
    ...base,
    clips: ["spin"],
    formats: { preview: previewPathFor(base.id), obj: `assets/${base.id}/model.obj` },
    rig: { hasArmature: false, hasWeights: false },
  });
  assert.equal(r.success, false);
});

test("T2: clips + formats.obj hard-fails (OBJ no anim)", () => {
  const r = safeParseAsset({
    ...base,
    clips: ["spin"],
    formats: {
      glb: glbPathFor(base.id),
      obj: `assets/${base.id}/model.obj`,
      preview: previewPathFor(base.id),
    },
    rig: { hasArmature: false, hasWeights: false },
  });
  assert.equal(r.success, false);
  const msg = r.error.issues.map((i) => i.message).join(" ");
  assert.match(msg, /obj/i);
});

test("T2: static OBJ-only with empty clips + no rig passes", () => {
  const r = safeParseAsset({
    ...base,
    clips: [],
    formats: {
      obj: `assets/${base.id}/model.obj`,
      preview: previewPathFor(base.id),
    },
    rig: { hasArmature: false, hasWeights: false },
  });
  assert.equal(r.success, true);
});

test("T2: static OBJ claiming armature fails", () => {
  const r = safeParseAsset({
    ...base,
    clips: [],
    formats: {
      obj: `assets/${base.id}/model.obj`,
      preview: previewPathFor(base.id),
    },
    rig: { hasArmature: true, hasWeights: false },
  });
  assert.equal(r.success, false);
});

test("T2: bad slug rejected", () => {
  const r = safeParseAsset({
    ...base,
    slug: "Hero_Billboard",
    clips: [],
    formats: { glb: glbPathFor(base.id), preview: previewPathFor(base.id) },
  });
  assert.equal(r.success, false);
});

test("T2: path helpers match contract", () => {
  assert.equal(glbPathFor(base.id), `assets/${base.id}/model.glb`);
  assert.equal(previewPathFor(base.id), `assets/${base.id}/preview.png`);
  assert.equal(
    inboxPngPattern("hero-billboard", "20261024-194500"),
    "inbox/hero-billboard/20261024-194500.png",
  );
});
