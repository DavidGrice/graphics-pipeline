/**
 * S3-I E1 #40 — PATCH /api/assets/:id/nodes scene partial update (R1 §4, D1 §2, D2 ruling b).
 * Check order: 404 → 428 PRECONDITION_REQUIRED → 400 If-Match → 412 stale → 400 body/scene → 200 + ETag.
 * Hermetic API on a free port + tmp data root.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApi, billboardBody, runId } from "./helpers/s3d-synth.mjs";
import { etagOf } from "../apps/world-builder/server/src/etag.js";

const json = { "Content-Type": "application/json" };
let api;
const child = runId("i40-child");
const node = (i, extra = {}) => ({
  id: `n${i}`,
  assetId: child,
  transform: { position: [i, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  ...extra,
});
const sceneBody = (id, slug, nodes, rootId = nodes[0]?.id) => ({
  ...billboardBody(id, slug),
  characterType: "unknown",
  stage: "scene",
  scene: { version: 1, rootId, nodes },
});
const post = (b, a = api) => fetch(`${a.url}/api/assets`, { method: "POST", headers: json, body: JSON.stringify(b) });
const get = (id, a = api) => fetch(`${a.url}/api/assets/${id}`);
const nodesPatch = (id, body, headers = {}, a = api) =>
  fetch(`${a.url}/api/assets/${id}/nodes`, { method: "PATCH", headers: { ...json, ...headers }, body: JSON.stringify(body) });
const etag = async (id, a = api) => (await get(id, a)).headers.get("etag");
const makeScene = async (tag, nodes, a = api) => {
  const id = runId(tag);
  const r = await post(sceneBody(id, `i40-${tag}-${process.pid}`, nodes), a);
  assert.equal(r.status, 201, await r.clone().text());
  return id;
};

before(async () => {
  api = await startApi();
  const r = await post(billboardBody(child, `i40-child-${process.pid}`));
  assert.equal(r.status, 201, await r.text());
});
after(async () => api && (await api.stop()));

test("#40 404 NOT_FOUND before 428 (no If-Match on an unknown id)", async () => {
  const r = await nodesPatch("00000000-0000-4000-8000-000000000000", { remove: ["n0"] });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, "NOT_FOUND");
});

test("#40 missing If-Match → 428 PRECONDITION_REQUIRED {code, error}; nothing written", async () => {
  const id = await makeScene("428", [node(0), node(1)]);
  const before0 = await etag(id);
  const r = await nodesPatch(id, { remove: ["n1"] });
  assert.equal(r.status, 428);
  const j = await r.json();
  assert.equal(j.code, "PRECONDITION_REQUIRED");
  assert.equal(typeof j.error, "string");
  assert.deepEqual(Object.keys(j).sort(), ["code", "error"]);
  assert.equal(await etag(id), before0, "nothing written");
  // even an invalid body gets 428 first (header check precedes body)
  assert.equal((await nodesPatch(id, {})).status, 428);
});

test("#40 malformed If-Match → 400 VALIDATION {field:\"If-Match\"}; stale → 412 {current}; nothing written", async () => {
  const id = await makeScene("412", [node(0), node(1)]);
  const cur = await etag(id);
  const bad = await nodesPatch(id, { remove: ["n1"] }, { "If-Match": "not-quoted" });
  assert.equal(bad.status, 400);
  const bj = await bad.json();
  assert.equal(bj.code, "VALIDATION");
  assert.equal(bj.field, "If-Match");
  const stale = await nodesPatch(id, { remove: ["n1"] }, { "If-Match": '"deadbeefdeadbeefdeadbeefdeadbeef"' });
  assert.equal(stale.status, 412);
  const sj = await stale.json();
  assert.equal(sj.code, "PRECONDITION_FAILED");
  assert.equal(sj.current, cur);
  assert.equal(await etag(id), cur, "nothing written");
});

test("#40 match → 200 + new ETag; upsert replaces + appends; remove tombstones; unknown remove is a no-op", async () => {
  const id = await makeScene("ok", [node(0), node(1), node(2)]);
  const e0 = await etag(id);
  const r = await nodesPatch(
    id,
    { upsert: [node(1, { name: "moved", transform: { position: [9, 9, 9], rotation: [0, 0, 0], scale: [1, 1, 1] } }), node(3)], remove: ["n2", "ghost"] },
    { "If-Match": e0 },
  );
  assert.equal(r.status, 200, await r.clone().text());
  const e1 = r.headers.get("etag");
  assert.match(e1, /^"[0-9a-f]{32}"$/);
  assert.notEqual(e1, e0);
  const doc = await r.json();
  assert.equal(etagOf(doc), e1);
  const byId = Object.fromEntries(doc.scene.nodes.map((n) => [n.id, n]));
  assert.deepEqual(doc.scene.nodes.map((n) => n.id), ["n0", "n1", "n2", "n3"], "replace in place, append new");
  assert.deepEqual(byId.n1.transform.position, [9, 9, 9]);
  assert.equal(byId.n2.deleted, true, "remove tombstones, never purges");
  assert.equal(byId.n0.deleted, undefined);
  assert.ok(!byId.ghost, "unknown remove id is a no-op");
  assert.equal(await etag(id), e1, "stored");
  // `*` also satisfies the required header
  const star = await nodesPatch(id, { remove: ["ghost-2"] }, { "If-Match": "*" });
  assert.equal(star.status, 200);
  // the old ETag is now stale
  assert.equal((await nodesPatch(id, { remove: ["n3"] }, { "If-Match": e0 })).status, 412);
});

test("#40 records scene.save in the activity log", async () => {
  const id = await makeScene("act", [node(0), node(1)]);
  const r = await nodesPatch(id, { remove: ["n1"] }, { "If-Match": await etag(id) });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 150));
  const a = await (await fetch(`${api.url}/api/activity?limit=5`)).json();
  const items = a.items ?? a.entries ?? a;
  const top = items.find((x) => (x.assetId ?? x.id ?? x.asset?.id) === id || JSON.stringify(x).includes(id));
  assert.ok(top, JSON.stringify(a).slice(0, 400));
  assert.match(JSON.stringify(top), /scene\.save/);
});

test("#40 body validation: empty / duplicate upsert id → field upsert; overlap → field remove {ids}; non-array; bad node id", async () => {
  const id = await makeScene("body", [node(0), node(1)]);
  const e = await etag(id);
  const cases = [
    [{}, "upsert"],
    [{ upsert: [], remove: [] }, "upsert"],
    [{ upsert: [node(1)], remove: ["n1"] }, "remove"],
    [{ upsert: [node(1), node(1, { name: "dup" })] }, "upsert"], // duplicate upsert id
    [{ upsert: "n1" }, "upsert"],
    [{ remove: "n1" }, "remove"],
    [{ upsert: [{ assetId: child }] }, "upsert[0].id"],
    [{ remove: [1] }, "remove[0]"],
  ];
  for (const [body, field] of cases) {
    const r = await nodesPatch(id, body, { "If-Match": e });
    assert.equal(r.status, 400, JSON.stringify(body));
    const j = await r.json();
    assert.equal(j.code, "VALIDATION", JSON.stringify(body));
    assert.equal(j.field, field, JSON.stringify(body));
  }
  assert.equal(await etag(id), e, "nothing written");
  // the overlap 400 names the overlapping ids
  const ov = await (await nodesPatch(id, { upsert: [node(0), node(1)], remove: ["n1", "n0"] }, { "If-Match": e })).json();
  assert.deepEqual(ov.ids, ["n1", "n0"]);
});

test("#40 not a scene → 400 VALIDATION {field:\"stage\"}", async () => {
  const r = await nodesPatch(child, { remove: ["n0"] }, { "If-Match": await etag(child) });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.code, "VALIDATION");
  assert.equal(j.field, "stage");
});

test("#40 root tombstone → SCENE_ROOT_DELETE; last live → SCENE_NO_LIVE_NODES; nothing written", async () => {
  const id = await makeScene("root", [node(0), node(1)]);
  const e = await etag(id);
  const root = await nodesPatch(id, { remove: ["n0"] }, { "If-Match": e });
  assert.equal(root.status, 400);
  assert.equal((await root.json()).code, "SCENE_ROOT_DELETE");
  // a scene whose root id is not a node: tombstoning every node leaves no live nodes
  const id2 = runId("i40-last");
  const body = sceneBody(id2, `i40-last-${process.pid}`, [node(5)]);
  delete body.scene.rootId;
  assert.equal((await post(body)).status, 201);
  const e2 = await etag(id2);
  const last = await nodesPatch(id2, { remove: ["n5"] }, { "If-Match": e2 });
  assert.equal(last.status, 400);
  assert.equal((await last.json()).code, "SCENE_NO_LIVE_NODES");
  assert.equal(await etag(id), e);
  assert.equal(await etag(id2), e2);
});

test("#40 live-node cap: upsert past SCENE_MAX_NODES → 400 SCENE_NODES_MAX; tombstones don't count", async () => {
  const a = await startApi({ SCENE_MAX_NODES: "2" });
  try {
    const c = await post(billboardBody(child, `i40-child-cap-${process.pid}`), a);
    assert.equal(c.status, 201, await c.clone().text());
    const id = await makeScene("cap", [node(0), node(1)], a);
    const e = await etag(id, a);
    const over = await nodesPatch(id, { upsert: [node(2)] }, { "If-Match": e }, a);
    assert.equal(over.status, 400);
    const j = await over.json();
    assert.equal(j.code, "SCENE_NODES_MAX");
    assert.equal(j.max, 2);
    assert.equal(j.count, 3);
    const swap = await nodesPatch(id, { upsert: [node(2)], remove: ["n1"] }, { "If-Match": e }, a);
    assert.equal(swap.status, 200, await swap.clone().text());
  } finally {
    await a.stop();
  }
});

test("#40 only this route requires If-Match: full PATCH /api/assets/:id still opt-in", async () => {
  const id = await makeScene("optin", [node(0), node(1)]);
  const r = await fetch(`${api.url}/api/assets/${id}`, { method: "PATCH", headers: json, body: JSON.stringify({ name: "still-opt-in" }) });
  assert.equal(r.status, 200);
});
