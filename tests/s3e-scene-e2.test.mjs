/**
 * S3-E E2 — #38 live-node cap, #41 soft-delete / restore / purge, #35 replace child keeping the
 * transform (R1 §5–7, D1 §1–3 rebound at 3c2f26f). Hermetic API on a free port + tmp data root.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, startApi, billboardBody, runId, loadClientTs } from "./helpers/s3d-synth.mjs";

const ABS = /(^|[\s'"])\/(home|workspace|tmp|etc|usr|var)\//;
let api;
let S;
const child = runId("e2-child");
const child2 = runId("e2-child2");
const json = { "Content-Type": "application/json" };
const post = (b, a = api) => fetch(`${a.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) });
const patch = (id, b, a = api) => fetch(`${a.url}/api/assets/${id}`, { method: "PATCH", headers: json, body: JSON.stringify(b) });
const node = (i, extra = {}) => ({ id: `n${i}`, assetId: child, transform: { position: [i, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, ...extra });
const sceneBody = (id, slug, nodes, rootId = nodes[0]?.id) => ({
  ...billboardBody(id, slug),
  characterType: "unknown",
  stage: "scene",
  scene: { version: 1, rootId, nodes },
});

before(async () => {
  api = await startApi();
  S = await loadClientTs("apps/world-builder/client/src/s3eScene.ts");
  for (const [id, slug] of [[child, "e2-child"], [child2, "e2-child-two"]]) {
    const r = await post(billboardBody(id, slug));
    assert.equal(r.status, 201, await r.text());
  }
});
after(async () => api && (await api.stop()));

// ---------------------------------------------------------------- #38
test("#38 cap counts LIVE nodes only: 256 live + tombstones → 201; 257 live → 400 SCENE_NODES_MAX {max,count}", async () => {
  const live = Array.from({ length: 256 }, (_, i) => node(i));
  const dead = Array.from({ length: 5 }, (_, i) => node(1000 + i, { deleted: true }));
  const id = runId("38a");
  const ok = await post(sceneBody(id, "e2-cap-ok", [...live, ...dead]));
  assert.equal(ok.status, 201, await ok.clone().text());
  const over = await post(sceneBody(runId("38b"), "e2-cap-over", [...live, node(256)]));
  assert.equal(over.status, 400);
  const j = await over.json();
  assert.equal(j.code, "SCENE_NODES_MAX");
  assert.equal(j.max, 256);
  assert.equal(j.count, 257);
  assert.ok(!ABS.test(JSON.stringify(j)));
  // restore of a tombstone that would exceed the cap → same 400
  const restore = [...live, ...dead.map((n, i) => (i === 0 ? { ...n, deleted: false } : n))];
  const r = await patch(id, { scene: { version: 1, rootId: "n0", nodes: restore } });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, "SCENE_NODES_MAX");
  const h = await (await fetch(`${api.url}/api/health`)).json();
  assert.equal(h.limits.sceneMaxNodes, 256);
});

test("#38 SCENE_MAX_NODES env: custom cap honoured; invalid → CONFIG_INVALID start, value not echoed", async () => {
  const a = await startApi({ SCENE_MAX_NODES: "2" });
  try {
    assert.equal((await post(billboardBody(child, "e2-child"), a)).status, 201);
    const r = await post(sceneBody(runId("38c"), "e2-cap2", [node(0), node(1), node(2, { deleted: true })]), a);
    assert.equal(r.status, 201, await r.clone().text());
    const r3 = await post(sceneBody(runId("38d"), "e2-cap3", [node(0), node(1), node(2)]), a);
    assert.deepEqual(await r3.json(), {
      max: 2,
      count: 3,
      code: "SCENE_NODES_MAX",
      error: "scene has 3 live nodes; max is 2 (SCENE_MAX_NODES)",
    });
  } finally {
    await a.stop();
  }
  for (const bad of ["0", "-1", "1.5", "lots"]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, "apps/world-builder/server/src/index.js")], {
      env: { ...process.env, PORT: "1", MONGO_URI: "mongodb://127.0.0.1:1", SCENE_MAX_NODES: bad },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /FATAL CONFIG_INVALID: SCENE_MAX_NODES must be an integer >= 1/);
    if (bad.length > 1) assert.ok(!r.stderr.includes(bad));
  }
});

// ---------------------------------------------------------------- #41
test("#41 root tombstone → 400 SCENE_ROOT_DELETE; all tombstoned → 400 SCENE_NO_LIVE_NODES; deleted:false normalised", async () => {
  const id = runId("41a");
  assert.equal((await post(sceneBody(id, "e2-soft", [node(0), node(1)]))).status, 201);
  const root = await patch(id, { scene: { version: 1, rootId: "n0", nodes: [node(0, { deleted: true }), node(1)] } });
  assert.equal(root.status, 400);
  assert.equal((await root.json()).code, "SCENE_ROOT_DELETE");
  const none = await patch(id, { scene: { version: 1, nodes: [node(0, { deleted: true }), node(1, { deleted: true })] } });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).code, "SCENE_NO_LIVE_NODES");
  const ok = await patch(id, { scene: { version: 1, rootId: "n0", nodes: [node(0, { deleted: false }), node(1, { deleted: true })] } });
  assert.equal(ok.status, 200, await ok.clone().text());
  const got = await (await fetch(`${api.url}/api/assets/${id}`)).json();
  assert.ok(!("deleted" in got.scene.nodes[0]), "false normalised to absent");
  assert.equal(got.scene.nodes[1].deleted, true);
  assert.deepEqual(got.scene.nodes[1].transform.position, [1, 0, 0], "tombstone keeps its transform");
});

test("#41 tombstones are skipped by V4 resolve (unknown assetId on a deleted node is accepted)", async () => {
  const r = await post(sceneBody(runId("41b"), "e2-skip", [node(0), { ...node(1), assetId: "no-such-asset", deleted: true }]));
  assert.equal(r.status, 201, await r.clone().text());
  const bad = await post(sceneBody(runId("41c"), "e2-skip2", [node(0), { ...node(1), assetId: "no-such-asset" }]));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "SCENE_RESOLVE");
});

test("#41 a tombstoned reference still blocks DELETE (409 ASSET_IN_USE {deletedRefs}); purge frees it", async () => {
  const victim = runId("41-victim");
  assert.equal((await post(billboardBody(victim, "e2-victim"))).status, 201);
  const sid = runId("41d");
  const nodes = [node(0), { ...node(1), assetId: victim, deleted: true }];
  assert.equal((await post(sceneBody(sid, "e2-blocker", nodes))).status, 201);
  const d = await fetch(`${api.url}/api/assets/${victim}`, { method: "DELETE" });
  assert.equal(d.status, 409);
  const j = await d.json();
  assert.equal(j.code, "ASSET_IN_USE");
  assert.deepEqual(j.refs, [sid]);
  assert.deepEqual(j.deletedRefs, [sid]);
  assert.match(j.error, /only by deleted nodes/);
  assert.equal(S.inUseHint(j, () => "e2-blocker"), "Used by deleted nodes in e2-blocker, purge to free");
  // purge (drop the tombstone) + save → asset is free
  assert.equal((await patch(sid, { scene: { version: 1, rootId: "n0", nodes: [node(0)] } })).status, 200);
  assert.equal((await fetch(`${api.url}/api/assets/${victim}`, { method: "DELETE" })).status, 204);
});

// ---------------------------------------------------------------- #35
test("#35 replace via PATCH keeps id/transform/visible; scene child or self → V5 rejection", async () => {
  const sid = runId("35a");
  const n1 = node(1, { visible: false, transform: { position: [3, 2, 1], rotation: [0.1, 0.2, 0.3], scale: [2, 2, 2] } });
  assert.equal((await post(sceneBody(sid, "e2-replace", [node(0), n1]))).status, 201);
  const swapped = S.replaceNodeAsset([node(0), n1], "n1", { id: child2, slug: "e2-child-two", stage: "mvp-billboard", clips: [] }, sid);
  assert.ok(!("error" in swapped));
  const r = await patch(sid, { scene: { version: 1, rootId: "n0", nodes: swapped.nodes } });
  assert.equal(r.status, 200, await r.clone().text());
  const got = (await r.json()).scene.nodes[1];
  assert.equal(got.id, "n1");
  assert.equal(got.assetId, child2);
  assert.equal(got.visible, false);
  assert.deepEqual(got.transform, n1.transform);
  // server-side: nested scene / self reference still rejected (V5)
  for (const target of [sid, "e2-replace"]) {
    const bad = await patch(sid, { scene: { version: 1, rootId: "n0", nodes: [node(0), { ...n1, assetId: target }] } });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, "SCENE_RESOLVE");
  }
});

// ---------------------------------------------------------------- client helpers
test("E2 client helpers: cap tone, delete blocks, tombstone/restore/purge, replace + undo, wire form", () => {
  assert.equal(S.SCENE_MAX_NODES_DEFAULT, 256);
  assert.equal(S.capTone(229, 256), "ok");
  assert.equal(S.capTone(231, 256), "warn");
  assert.equal(S.capTone(256, 256), "max");
  assert.equal(S.capLabel(3, 256), "Nodes 3 / 256");
  assert.equal(S.capTitle(256), "Node limit reached (256)");
  const nodes = [node(0), node(1), node(2, { deleted: true })];
  assert.equal(S.deleteBlock(nodes, "n0", "n0").code, "SCENE_ROOT_DELETE");
  assert.equal(S.deleteBlock(nodes, "n1", "n0"), null);
  assert.equal(S.deleteBlock([node(0, { deleted: true }), node(1)], "n1", undefined).code, "SCENE_NO_LIVE_NODES");
  const t = S.tombstoneNode(nodes, "n1", "n0");
  assert.equal(t.nodes[1].deleted, true);
  assert.deepEqual(t.nodes[1].transform, nodes[1].transform);
  assert.match(S.tombstoneNode(nodes, "n0", "n0").error, /^SCENE_ROOT_DELETE/);
  assert.match(S.restoreNode(nodes, "n2", 2).error, /^SCENE_NODES_MAX/, "restore blocked at the cap");
  const rs = S.restoreNode(nodes, "n2", 3);
  assert.ok(!("deleted" in rs.nodes[2]));
  assert.equal(S.atCap(nodes, 2), true, "tombstones excluded from the cap");
  assert.equal(S.atCap(nodes, 3), false);
  assert.deepEqual(S.purgeTombstones(nodes).map((n) => n.id), ["n0", "n1"]);
  assert.equal(S.purgeConfirmText(2), "Permanently remove 2 nodes? This can't be undone.");
  assert.equal(S.wireNode(nodes[2]).deleted, true);
  assert.ok(!("deleted" in S.wireNode({ ...nodes[0], deleted: false })));
  // replace
  const tgt = { id: "c2", slug: "c-two", stage: "rigged", clips: ["idle", "walk"], clipUx: { defaultClip: "walk" } };
  const withClip = [node(0), node(1, { defaultClip: "spin", visible: false })];
  const rep = S.replaceNodeAsset(withClip, "n1", tgt, "scene-1");
  assert.equal(rep.nodes[1].assetId, "c2");
  assert.equal(rep.nodes[1].defaultClip, "walk", "defaultClip resets to the new asset's default");
  assert.equal(rep.nodes[1].visible, false);
  assert.deepEqual(rep.nodes[1].transform, withClip[1].transform);
  assert.equal(rep.undo.to, "c-two");
  const back = S.undoReplace(rep.nodes, rep.undo);
  assert.deepEqual(back, withClip);
  assert.match(S.replaceNodeAsset(withClip, "n1", { id: "s9", stage: "scene" }, "scene-1").error, /nested stage=scene/);
  assert.match(S.replaceNodeAsset(withClip, "n1", { id: "scene-1", stage: "rigged" }, "scene-1").error, /self-reference/);
  assert.match(S.replaceNodeAsset(nodes, "n2", tgt, "scene-1").error, /deleted nodes can't be replaced/);
});
