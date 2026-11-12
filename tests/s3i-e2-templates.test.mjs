/**
 * S3-I E2 #34 — scene templates (R1 §9, D1 §7): every template builds a graph the scene schema
 * accepts, creating one needs a picked asset per slot, templates bundle no media, and the API
 * accepts the body the dialog POSTs.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, startApi, billboardBody, loadClientTs, runId } from "./helpers/s3d-synth.mjs";
import { SceneGraphSchema, AssetSchema } from "../packages/asset-schema/dist/index.js";

const T = await loadClientTs("apps/world-builder/client/src/s3iTemplates.ts");
const json = { "Content-Type": "application/json" };
const fakePicks = (tpl) => Object.fromEntries(tpl.slots.map((s) => [s.key, randomUUID()]));
let api = null;
after(async () => api && (await api.stop()));

test("#34 templates: Blank, Duo billboard, Rigged + prop; each builds a SceneGraphSchema-valid graph", () => {
  assert.deepEqual(T.SCENE_TEMPLATES.map((t) => t.label), ["Blank", "Duo billboard", "Rigged + prop"]);
  for (const tpl of T.SCENE_TEMPLATES) {
    const picks = fakePicks(tpl);
    const g = T.templateGraph(tpl, picks);
    const r = SceneGraphSchema.safeParse(g);
    assert.ok(r.success, `${tpl.id}: ${JSON.stringify(r.error?.issues)}`);
    assert.equal(g.nodes.length, tpl.nodes.length);
    for (const n of g.nodes) assert.equal(n.assetId, picks[tpl.nodes.find((x) => x.id === n.id).slot]);
    const body = T.templateSceneBody(tpl, picks, [], { id: randomUUID(), name: "", now: "2026-11-12T11:00:00.000Z" });
    const a = AssetSchema.safeParse(body);
    assert.ok(a.success, `${tpl.id} body: ${JSON.stringify(a.error?.issues)}`);
    assert.equal(body.stage, "scene");
    assert.equal(body.name, `${tpl.label} scene`);
  }
});

test("#34 create needs a picked asset per slot; templates carry slots, never assets or media", () => {
  const duo = T.SCENE_TEMPLATES.find((t) => t.id === "duo-billboard");
  assert.deepEqual(T.missingSlots(duo, {}), ["left", "right"]);
  assert.deepEqual(T.missingSlots(duo, { left: "x" }), ["right"]);
  assert.equal(T.templateGraph(duo, { left: "x" }), null);
  assert.equal(T.templateSceneBody(duo, { left: "x" }, [], { id: randomUUID(), name: "n", now: "t" }), null);
  const raw = JSON.stringify(T.SCENE_TEMPLATES);
  assert.ok(!/assetId|assets\/|https?:|\.(glb|png|jpe?g|fbx|obj)\b/i.test(raw), "no bundled media or asset ids");
  // slot pickers draw from the user's own assets, filtered by kind; scenes are never children
  const lib = [
    { id: "b", stage: "mvp-billboard", characterType: "billboard" },
    { id: "r", stage: "rigged", characterType: "humanoid", rig: { hasArmature: true } },
    { id: "s", stage: "scene" },
  ];
  const ids = (slot) => T.slotCandidates(lib, slot).map((a) => a.id);
  assert.deepEqual(ids({ key: "x", label: "", accepts: "billboard" }), ["b"]);
  assert.deepEqual(ids({ key: "x", label: "", accepts: "rigged" }), ["r"]);
  assert.deepEqual(ids({ key: "x", label: "", accepts: "any" }), ["b", "r"]);
  assert.match(T.templateSlug("Duo billboard scene!", "ABC12345ff"), /^duo-billboard-scene-abc12345$/);
});

test("#34 API accepts the dialog's scene body (Duo billboard over two registered billboards)", async () => {
  api = await startApi();
  const a = runId("s3i-tpl-a");
  const b = runId("s3i-tpl-b");
  for (const id of [a, b]) assert.equal((await fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(billboardBody(id, id)) })).status, 201);
  const duo = T.SCENE_TEMPLATES.find((t) => t.id === "duo-billboard");
  const assets = await (await fetch(`${api.url}/api/assets`)).json();
  const id = randomUUID();
  const body = T.templateSceneBody(duo, { left: a, right: b }, assets, { id, name: "Two up", now: new Date().toISOString() });
  const r = await fetch(`${api.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(body) });
  assert.equal(r.status, 201, await r.text());
  const got = await (await fetch(`${api.url}/api/assets/${id}`)).json();
  assert.equal(got.stage, "scene");
  assert.deepEqual(got.scene.nodes.map((n) => n.assetId), [a, b]);
});

test("#34 App wiring: New scene dialog test ids, Cancel resets with no POST", () => {
  const app = fs.readFileSync(path.join(ROOT, "apps/world-builder/client/src/App.tsx"), "utf8");
  for (const tid of ["new-scene", "template-option", "template-slot-pick", "template-create", "template-cancel"]) {
    assert.ok(app.includes(`data-testid="${tid}"`), tid);
  }
  assert.match(app, /disabled=\{!tpl \|\| tplBusy \|\| rlLeft > 0 \|\| missingSlots\(tpl, tplPicks\)\.length > 0\}/);
  const close = app.slice(app.indexOf("const closeNewScene"), app.indexOf("const tpl = SCENE_TEMPLATES"));
  assert.ok(close.length > 0 && !/fetch\(/.test(close), "cancel never calls the API");
});
