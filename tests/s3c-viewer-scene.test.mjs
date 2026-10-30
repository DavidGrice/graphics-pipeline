/**
 * S3-C-E2/E3 — #1 blend · #2 timescale · #80 hotkeys · #82 overlay ·
 * #26 duplicate · #31 view (ground/shadows) · #32 orbit bookmarks.
 * Pure helpers (transpiled TS) + schema gates + App.tsx wiring + soft-env :8787 round-trip.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { safeParseAsset, glbPathFor, previewPathFor } from "../packages/asset-schema/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "apps/world-builder/package.json"));
const APP = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");

/** @type {any} */
let V;
before(async () => {
  const ts = require("typescript");
  const src = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/s3cViewer.ts"), "utf8");
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-s3c-viewer-"));
  const mod = path.join(dir, "s3cViewer.mjs");
  fs.writeFileSync(mod, out);
  V = await import(pathToFileURL(mod).href);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------- #1 blend ----------------
test("T1.4 #1 blend: default 250ms, clamp 0–1000, plan noop/cut/fade", () => {
  assert.equal(V.BLEND_MS_DEFAULT, 250);
  assert.equal(V.clampBlendMs(-5), 0);
  assert.equal(V.clampBlendMs(5000), 1000);
  assert.equal(V.clampBlendMs(NaN), 250);
  assert.equal(V.clampBlendMs("300"), 300);
  const base = { prevClip: "idle", nextClip: "walk", blendMs: 250, clipCount: 3, playing: true, scrubbing: false };
  assert.deepEqual(V.planCrossfade(base), { kind: "fade", seconds: 0.25 });
  assert.deepEqual(V.planCrossfade({ ...base, nextClip: "idle" }), { kind: "noop" }, "same clip = no fade restart");
  assert.deepEqual(V.planCrossfade({ ...base, blendMs: 0 }), { kind: "cut" }, "0 = hard cut");
  assert.deepEqual(V.planCrossfade({ ...base, prevClip: null }), { kind: "cut" });
  assert.deepEqual(V.planCrossfade({ ...base, clipCount: 1 }), { kind: "cut" }, "single clip → no blend");
  assert.deepEqual(V.planCrossfade({ ...base, scrubbing: true }), { kind: "cut" });
  assert.deepEqual(V.planCrossfade({ ...base, blendMs: 1000 }), { kind: "fade", seconds: 1 });
  assert.equal(V.blendControlEnabled(["spin"]), false, "billboard spin → control disabled");
  assert.equal(V.blendControlEnabled(["idle", "walk"]), true);
  assert.deepEqual(V.actionsToStop(["a", "b", "c", "d"], ["c", "d"]), ["a", "b"], "≤2 weighted after rapid switches");
});

// ---------------- #2 timescale ----------------
test("T1.4 #2 timescale: 0.5–2.0 clamp + 0.1 step; effective length only (raw durations untouched)", () => {
  assert.equal(V.clampTimeScale(0.1), 0.5);
  assert.equal(V.clampTimeScale(9), 2);
  assert.equal(V.clampTimeScale(1.26), 1.3);
  assert.equal(V.clampTimeScale(Infinity), 1);
  assert.equal(V.clampTimeScale("abc"), 1);
  const durations = { walk: 1667 };
  assert.equal(V.effectiveDurationMs(durations.walk, 2), 834);
  assert.equal(V.effectiveDurationMs(durations.walk, 0.5), 3334);
  assert.equal(durations.walk, 1667, "clipDurations stay raw");
});

// ---------------- #80 hotkeys ----------------
test("T1.4 #80 hotkeys 1..9 → n-th CLIP; ignore fields/modifiers; out-of-range no-op", () => {
  const clips = ["idle", "walk", "run", "jump"];
  assert.equal(V.clipForHotkey(clips, { key: "1" }), "idle");
  assert.equal(V.clipForHotkey(clips, { key: "4" }), "jump");
  assert.equal(V.clipForHotkey(clips, { key: "5" }), null, "index ≥ count → no-op");
  assert.equal(V.clipForHotkey(clips, { key: "0" }), null);
  assert.equal(V.clipForHotkey(clips, { key: "a" }), null);
  assert.equal(V.clipForHotkey(clips, { key: "1", ctrlKey: true }), null);
  assert.equal(V.clipForHotkey(clips, { key: "1", metaKey: true }), null);
  assert.equal(V.clipForHotkey(clips, { key: "1", altKey: true }), null);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT", "input"]) {
    assert.equal(V.clipForHotkey(clips, { key: "2", target: { tagName } }), null, tagName);
  }
  assert.equal(V.clipForHotkey(clips, { key: "2", target: { tagName: "DIV", isContentEditable: true } }), null);
  assert.equal(V.clipForHotkey(clips, { key: "2", target: { tagName: "BUTTON" } }), "walk");
  const many = Array.from({ length: 12 }, (_, i) => `emote_${i}`);
  assert.equal(V.clipForHotkey(many, { key: "9" }), "emote_8");
  assert.equal(V.hotkeyLabel(8), "9");
  assert.equal(V.hotkeyLabel(9), null, "clips 10+ have no hotkey");
});

// ---------------- #82 overlay ----------------
test("T1.4 #82 overlay: session default off; bones disabled without skin", () => {
  assert.deepEqual(V.OVERLAY_DEFAULT, { wireframe: false, bones: false });
  assert.equal(V.bonesToggleEnabled(0, false), false);
  assert.equal(V.bonesToggleEnabled(undefined, false), false);
  assert.equal(V.bonesToggleEnabled(2, false), true);
  assert.equal(V.bonesToggleEnabled(null, true), true);
});

// ---------------- #26 duplicate ----------------
test("T1.5 #26 duplicate: new id, +0.5 X (or +snap), copies fields, hidden stays hidden, no collision", () => {
  const nodes = [
    { id: "n1", assetId: "hero", defaultClip: "walk", visible: true, transform: { position: [1, 2, 3], rotation: [0, 1, 0], scale: [2, 2, 2] } },
    { id: "n2", assetId: "prop", visible: false, transform: { position: [0, 0, 0] } },
  ];
  const r = V.duplicateSceneNode(nodes, "n1", { newId: "u-1" });
  assert.equal(r.node.id, "u-1");
  assert.notEqual(r.node.id, "n1");
  assert.equal(r.node.assetId, "hero");
  assert.equal(r.node.defaultClip, "walk");
  assert.deepEqual(r.node.transform.position, [1.5, 2, 3]);
  assert.deepEqual(r.node.transform.rotation, [0, 1, 0]);
  assert.deepEqual(r.node.transform.scale, [2, 2, 2]);
  assert.notEqual(r.node.transform.rotation, nodes[0].transform.rotation, "copied, not aliased");
  assert.equal(r.nodes.length, 3);
  assert.equal(r.nodes[1].id, "u-1", "inserted after source");
  assert.equal(nodes.length, 2, "input not mutated");
  const snap = V.duplicateSceneNode(nodes, "n1", { newId: "u-2", snapEnabled: true, snapStep: 0.25 });
  assert.deepEqual(snap.node.transform.position, [1.25, 2, 3]);
  const hid = V.duplicateSceneNode(nodes, "n2", { newId: "u-3" });
  assert.equal(hid.node.visible, false, "hidden source duplicates hidden");
  const col = V.duplicateSceneNode(nodes, "n1", { newId: "n2" });
  assert.equal(col.node.id, "n1-copy-1", "collision → <src>-copy-N");
  const col2 = V.duplicateSceneNode([...nodes, { id: "n1-copy-1", assetId: "x" }], "n1", { newId: "n1" });
  assert.equal(col2.node.id, "n1-copy-2");
  assert.match(V.duplicateSceneNode(nodes, "zz").error, /DUPLICATE_NO_SOURCE/);
  assert.match(V.duplicateSceneNode(nodes, "n1", { maxNodes: 2 }).error, /DUPLICATE_MAX_NODES/);
  // duplicate result passes the schema (unique ids)
  const ids = new Set(r.nodes.map((n) => n.id));
  assert.equal(ids.size, r.nodes.length);
});

// ---------------- #31 view ----------------
test("T1.5 #31 view defaults ground on / shadows off; tolerant of missing view", () => {
  assert.deepEqual(V.resolveSceneView(undefined), { ground: true, shadows: false });
  assert.deepEqual(V.resolveSceneView({}), { ground: true, shadows: false });
  assert.deepEqual(V.resolveSceneView({ ground: false, shadows: true }), { ground: false, shadows: true });
});

// ---------------- #32 cameras helpers ----------------
const cam = (i, extra = {}) => ({ id: `c${i}`, name: `View ${i}`, position: [i, 1, 3], target: [0, 0, 0], fov: 50, ...extra });

test("T1.5 #32 bookmarks: cap 16, finite only, unique names, rename/delete", () => {
  let cams = [];
  for (let i = 1; i <= 16; i++) {
    const r = V.addCameraBookmark(cams, cam(i));
    assert.ok(r.cameras, r.error);
    cams = r.cameras;
  }
  assert.equal(cams.length, 16);
  assert.match(V.addCameraBookmark(cams, cam(17)).error, /SCENE_CAMERAS_MAX/);
  assert.match(V.addCameraBookmark([], cam(1, { position: [NaN, 0, 0] })).error, /finite/);
  assert.match(V.addCameraBookmark([], cam(1, { target: [0, Infinity, 0] })).error, /finite/);
  assert.match(V.addCameraBookmark([], cam(1, { name: "" })).error, /1–40/);
  assert.match(V.addCameraBookmark([], cam(1, { name: "x".repeat(41) })).error, /1–40/);
  assert.match(V.addCameraBookmark([], cam(1, { fov: 5 })).error, /fov/);
  assert.match(V.addCameraBookmark([cam(1)], cam(2, { name: "view 1" })).error, /duplicate camera name/);
  const ren = V.renameCameraBookmark(cams, "c2", "Hero close-up");
  assert.equal(ren.cameras[1].name, "Hero close-up");
  assert.match(V.renameCameraBookmark(cams, "c2", "View 3").error, /duplicate/);
  assert.equal(V.deleteCameraBookmark(cams, "c1").length, 15);
  assert.equal(V.nextCameraName([cam(1), cam(2)]), "View 3");
  assert.deepEqual(V.roundVec([1.234567, 2, 3.00004]), [1.2346, 2, 3]);
});

// ---------------- schema gates ----------------
const childId = "550e8400-e29b-41d4-a716-4466554400e1";
const sceneId = "550e8400-e29b-41d4-a716-4466554400e2";
const childAsset = (id = childId, slug = "s3c-child") => ({
  id,
  slug,
  name: "S3C child",
  characterType: "prop",
  stage: "rigged",
  tags: [],
  clips: ["idle", "walk", "run"],
  clipDurations: { idle: 1625, walk: 1625, run: 958 },
  formats: { glb: glbPathFor(id), preview: previewPathFor(id) },
  rig: { hasArmature: true, hasWeights: true, boneCount: 2, armatureCount: 1 },
  createdAt: "2026-10-29T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
});
const sceneAsset = (scene, id = sceneId, slug = "s3c-scene") => ({
  id,
  slug,
  name: "S3C scene",
  characterType: "unknown",
  stage: "scene",
  tags: [],
  clips: [],
  formats: { preview: previewPathFor(id), glb: glbPathFor(id) },
  rig: { hasArmature: false, hasWeights: false },
  scene,
  createdAt: "2026-10-29T00:00:00.000Z",
  updatedAt: "2026-10-29T00:00:00.000Z",
});
const nodes = (assetId = childId) => [{ id: "n0", assetId, transform: { position: [0, 0, 0] } }];
const cams = (n) => Array.from({ length: n }, (_, i) => cam(i + 1));

test("T1.4 schema clipUx.blendMs 0–1000 / timeScale 0.5–2.0; out of range rejects", () => {
  const ok = safeParseAsset({ ...childAsset(), clipUx: { blendMs: 250, timeScale: 1.5 } });
  assert.equal(ok.success, true, ok.success ? "" : ok.error.message);
  for (const bad of [{ blendMs: -1 }, { blendMs: 1001 }, { timeScale: 0.4 }, { timeScale: 2.1 }, { blendMs: Infinity }, { timeScale: "1" }]) {
    assert.equal(safeParseAsset({ ...childAsset(), clipUx: bad }).success, false, JSON.stringify(bad));
  }
  assert.equal(safeParseAsset({ ...childAsset(), clipUx: { blendMs: 0, timeScale: 0.5 } }).success, true);
  assert.equal(safeParseAsset({ ...childAsset(), clipUx: { blendMs: 1000, timeScale: 2 } }).success, true);
});

test("T1.5 schema scene.view + scene.cameras: 16 ok, 17 / NaN / bad fov / dup name reject; legacy scene ok", () => {
  const legacy = safeParseAsset(sceneAsset({ version: 1, nodes: nodes() }));
  assert.equal(legacy.success, true, "older scenes without view/cameras parse");
  const full = safeParseAsset(sceneAsset({ version: 1, nodes: nodes(), view: { ground: false, shadows: true }, cameras: cams(16) }));
  assert.equal(full.success, true, full.success ? "" : full.error.message);
  const over = safeParseAsset(sceneAsset({ version: 1, nodes: nodes(), cameras: cams(17) }));
  assert.equal(over.success, false);
  assert.ok(over.error.issues.some((i) => /SCENE_CAMERAS_MAX/.test(i.message)));
  for (const bad of [
    [cam(1, { position: [NaN, 0, 0] })],
    [cam(1, { target: [0, Infinity, 0] })],
    [cam(1, { fov: 200 })],
    [cam(1, { name: "" })],
    [cam(1), cam(2, { name: "VIEW 1" })],
    [cam(1), cam(1, { name: "other" })],
  ]) {
    assert.equal(safeParseAsset(sceneAsset({ version: 1, nodes: nodes(), cameras: bad })).success, false, JSON.stringify(bad));
  }
  assert.equal(
    safeParseAsset(sceneAsset({ version: 1, nodes: nodes(), view: { ground: true, fog: true } })).success,
    false,
    "unknown view key rejects (strict)",
  );
});

// ---------------- App.tsx wiring ----------------
test("T1.4/T1.5 App.tsx wiring: crossfade, timescale, hotkeys, overlay, duplicate, view, cameras", () => {
  assert.match(APP, /crossFadeTo\(next, plan\.seconds/);
  assert.match(APP, /mixer\.current\.timeScale = clampTimeScale\(timeScale\)/);
  assert.match(APP, /addEventListener\("keydown"/);
  assert.match(APP, /clipForHotkey\(clipsForUi/);
  assert.match(APP, /new THREE\.SkeletonHelper\(/);
  assert.match(APP, /c\.wireframe = true/);
  assert.match(APP, /m\.clone\(\)/, "wireframe uses cloned materials (no cache mutation)");
  assert.match(APP, /duplicateSceneNode\(sceneDraft, sceneNodeId/);
  assert.match(APP, /shadows=\{viewDraft\.shadows\}/);
  assert.match(APP, /view: \{ ground: viewDraft\.ground, shadows: viewDraft\.shadows \}/);
  assert.match(APP, /cameras: camerasDraft/);
  assert.match(APP, /\+ Save view/);
  // session-only overlay: wireframe/bones never in persisted payloads
  const persistScene = APP.slice(APP.indexOf("const persistScene"), APP.indexOf("const resolveChild"));
  assert.doesNotMatch(persistScene, /wireframe|showBones/);
  const persistUx = APP.slice(APP.indexOf("const persistClipUx"), APP.indexOf("const setDefaultClip"));
  assert.doesNotMatch(persistUx, /wireframe|showBones/);
});

// ---------------- soft-env :8787 round-trip ----------------
const API = process.env.WORLD_API || "http://127.0.0.1:8787";
async function apiUp() {
  try {
    return (await fetch(`${API}/api/health`)).ok;
  } catch {
    return false;
  }
}
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Assets this file registers on :8787 — deleted in after() (scenes first, then children). */
const registered = { scenes: [], assets: [] };
async function post(asset) {
  const r = await fetch(`${API}/api/assets`, json("POST", asset));
  if (r.status === 201) (asset.stage === "scene" ? registered.scenes : registered.assets).push(asset.id);
  return r;
}
after(async () => {
  if (!registered.scenes.length && !registered.assets.length) return;
  for (const id of [...registered.scenes, ...registered.assets]) {
    try {
      await fetch(`${API}/api/assets/${id}`, { method: "DELETE" });
    } catch {
      /* API went away — nothing persisted in memory mode */
    }
  }
});

test("T1.4 soft-env :8787 clip-ux blend/timescale round-trip; out of range 400; clipDurations untouched", async (t) => {
  if (!(await apiUp())) {
    t.skip("world-builder not listening on :8787 (soft-env)");
    return;
  }
  const id = randomUUID();
  const created = await post(childAsset(id, `s3c-ux-${id.slice(0, 8)}`));
  assert.equal(created.status, 201, await created.clone().text());
  for (const bad of [{ blendMs: 1001 }, { blendMs: -1 }, { timeScale: 0.4 }, { timeScale: 3 }, { timeScale: "fast" }, { clipDurations: { idle: 1 } }]) {
    const r = await fetch(`${API}/api/assets/${id}/clip-ux`, json("PATCH", bad));
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const ok = await fetch(`${API}/api/assets/${id}/clip-ux`, json("PATCH", { defaultClip: "walk", blendMs: 400, timeScale: 1.5 }));
  assert.equal(ok.status, 200);
  const got = await (await fetch(`${API}/api/assets/${id}`)).json();
  assert.equal(got.clipUx.blendMs, 400);
  assert.equal(got.clipUx.timeScale, 1.5);
  assert.deepEqual(got.clipDurations, { idle: 1625, walk: 1625, run: 958 }, "timescale never rewrites clipDurations");
});

test("T1.5 soft-env :8787 scene view + cameras persist; 17th camera 400; NaN 400; duplicate persists", async (t) => {
  if (!(await apiUp())) {
    t.skip("world-builder not listening on :8787 (soft-env)");
    return;
  }
  const cid = randomUUID();
  const sid = randomUUID();
  assert.equal((await post(childAsset(cid, `s3c-c-${cid.slice(0, 8)}`))).status, 201);
  const sc = await post(sceneAsset({ version: 1, nodes: nodes(cid) }, sid, `s3c-s-${sid.slice(0, 8)}`));
  assert.equal(sc.status, 201, await sc.clone().text());

  const dup = V.duplicateSceneNode(nodes(cid), "n0", { newId: randomUUID() });
  const scene16 = { version: 1, rootId: "n0", nodes: dup.nodes, view: { ground: false, shadows: true }, cameras: cams(16) };
  const ok = await fetch(`${API}/api/assets/${sid}`, json("PATCH", { scene: scene16 }));
  assert.equal(ok.status, 200, await ok.clone().text());
  const got = await (await fetch(`${API}/api/assets/${sid}`)).json();
  assert.deepEqual(got.scene.view, { ground: false, shadows: true });
  assert.equal(got.scene.cameras.length, 16);
  assert.equal(got.scene.nodes.length, 2);
  assert.deepEqual(got.scene.nodes[1].transform.position, [0.5, 0, 0]);

  const over = await fetch(`${API}/api/assets/${sid}`, json("PATCH", { scene: { ...scene16, cameras: cams(17) } }));
  assert.equal(over.status, 400);
  assert.match(await over.text(), /SCENE_CAMERAS_MAX/);
  // JSON NaN/Infinity serialize to null → must 400, never coerce
  const nan = await fetch(`${API}/api/assets/${sid}`, json("PATCH", { scene: { ...scene16, cameras: [cam(1, { position: [NaN, 0, 0] })] } }));
  assert.equal(nan.status, 400);
  const after = await (await fetch(`${API}/api/assets/${sid}`)).json();
  assert.equal(after.scene.cameras.length, 16, "rejected PATCH did not persist");
});

test("tip3 soft-env :8787 DELETE /api/assets/:id: 404 unknown, 409 while scene references, 204 then gone", async (t) => {
  if (!(await apiUp())) {
    t.skip("world-builder not listening on :8787 (soft-env)");
    return;
  }
  const cid = randomUUID();
  const sid = randomUUID();
  assert.equal((await fetch(`${API}/api/assets/${randomUUID()}`, { method: "DELETE" })).status, 404);
  assert.equal((await post(childAsset(cid, `s3c-del-c-${cid.slice(0, 8)}`))).status, 201);
  assert.equal((await post(sceneAsset({ version: 1, nodes: nodes(cid) }, sid, `s3c-del-s-${sid.slice(0, 8)}`))).status, 201);
  const blocked = await fetch(`${API}/api/assets/${cid}`, { method: "DELETE" });
  assert.equal(blocked.status, 409, "child referenced by scene");
  assert.equal((await fetch(`${API}/api/assets/${sid}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${API}/api/assets/${cid}`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${API}/api/assets/${cid}`)).status, 404);
  assert.equal((await fetch(`${API}/api/assets/${sid}`)).status, 404);
  registered.scenes = registered.scenes.filter((x) => x !== sid);
  registered.assets = registered.assets.filter((x) => x !== cid);
});
